import { PrismaClient } from '@prisma/client';
import { RAGService } from '../rag.service';
import { RAGGenerationService, RAGGenerationResult } from '../generation/rag-generation.service';
import { ChatMessage } from '../../../services/gemini.service';
import { geminiService } from '../../../services/gemini.service';
import { MetadataFilter } from '../types';
import logger from '../../../utils/logger';

const prisma = new PrismaClient();

const MAX_CONTEXT_MESSAGES = parseInt(process.env.MAX_CONTEXT_MESSAGES || '20');

/**
 * RAG Chat Service — integrates RAG retrieval + generation into conversational flow.
 *
 * This is a NEW service that creates a RAG-powered chat endpoint.
 * It does NOT modify existing chat.service.ts.
 *
 * Flow:
 *   1. User sends message
 *   2. Retrieve conversation history (memory ≠ RAG)
 *   3. RAG retrieval: semantic search for relevant knowledge
 *   4. Build grounded prompt with context + history
 *   5. Gemini generates answer
 *   6. Build deterministic citations
 *   7. Save messages + return answer with sources
 */
export class RAGChatService {
  private ragService: RAGService;
  private generationService: RAGGenerationService;

  constructor() {
    this.ragService = RAGService.getInstance();
    this.generationService = new RAGGenerationService();
  }

  /**
   * Send a message in a RAG-powered conversation.
   *
   * @param userId - User ID (from auth)
   * @param conversationId - Conversation ID
   * @param userMessage - User's question
   * @param filter - Optional metadata filter (courseId, lessonId, etc.)
   * @param learnerName - Optional learner name for personalization
   * @param learnerSummary - Optional minimal learner context
   */
  async chat(
    userId: string,
    conversationId: string,
    userMessage: string,
    filter?: MetadataFilter,
    learnerName?: string,
    learnerSummary?: string,
  ): Promise<{
    message: string;
    messageId: string;
    conversationId: string;
    conversationTitle: string;
    sources: RAGGenerationResult['sources'];
    retrievalStats: RAGGenerationResult['retrievalStats'];
  }> {
    // 1. Verify conversation ownership
    let conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!conversation) {
      throw new Error('CONVERSATION_NOT_FOUND');
    }

    // 2. Get conversation history (memory — separate from RAG)
    const previousMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: MAX_CONTEXT_MESSAGES,
    });

    const chatHistory: ChatMessage[] = previousMessages.map((msg) => ({
      role: msg.role as 'USER' | 'ASSISTANT',
      content: msg.content,
    }));

    // 3. Save user message
    await prisma.message.create({
      data: {
        conversationId,
        role: 'USER',
        content: userMessage,
      },
    });

    // 4. RAG retrieval — semantic search for relevant knowledge
    logger.info(`[RAGChat] Retrieving context for: "${userMessage.substring(0, 80)}..."`);
    const groundedContext = await this.ragService.retrieve(
      userMessage,
      filter,
    );

    logger.info(
      `[RAGChat] Retrieved ${groundedContext.totalChunks} chunks ` +
      `(top score: ${groundedContext.chunks[0]?.score || 'N/A'})`,
    );

    // 5. Generate grounded answer with citations
    const result = await this.generationService.generate(
      userMessage,
      groundedContext,
      chatHistory,
      learnerName,
      learnerSummary,
    );

    // 6. Save AI response
    const aiMessage = await prisma.message.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content: result.answer,
      },
    });

    // 7. Auto-generate title if first message
    const isFirstMessage = previousMessages.length === 0;
    if (isFirstMessage) {
      try {
        const generatedTitle = await geminiService.generateTitle(userMessage, result.answer);
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { title: generatedTitle },
        });
        conversation = { ...conversation, title: generatedTitle };
        logger.info(`[RAGChat] Auto-generated title: "${generatedTitle}"`);
      } catch (titleError) {
        logger.warn('[RAGChat] Failed to auto-generate title:', titleError);
      }
    }

    // 8. Touch conversation updatedAt
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return {
      message: result.answer,
      messageId: aiMessage.id,
      conversationId,
      conversationTitle: conversation.title,
      sources: result.sources,
      retrievalStats: result.retrievalStats,
    };
  }

  /**
   * Create a new conversation and send the first RAG-powered message.
   */
  async createAndChat(
    userId: string,
    userMessage: string,
    filter?: MetadataFilter,
    learnerName?: string,
    learnerSummary?: string,
  ) {
    // Create conversation
    const conversation = await prisma.conversation.create({
      data: {
        userId,
        title: 'Cuộc trò chuyện mới',
      },
    });

    logger.info(`[RAGChat] Created conversation ${conversation.id} for user ${userId}`);

    // Send message
    const result = await this.chat(
      userId,
      conversation.id,
      userMessage,
      filter,
      learnerName,
      learnerSummary,
    );

    return result;
  }
}
