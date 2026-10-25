import { PrismaClient } from '@prisma/client';
import { RAGService } from '../rag.service';
import { RAGGenerationService, RAGGenerationResult } from '../generation/rag-generation.service';
import { ChatMessage } from '../../../services/gemini.service';
import { geminiService } from '../../../services/gemini.service';
import { MetadataFilter } from '../types';
import logger from '../../../utils/logger';

const MAX_CONTEXT_MESSAGES = parseInt(process.env.MAX_CONTEXT_MESSAGES || '20');
const DEFAULT_TITLE = 'Cuộc trò chuyện mới';

/** The Conversation / Message operations this service uses (the Prisma client in production). */
export type RAGChatStore = Pick<PrismaClient, 'conversation' | 'message'>;

export interface RAGChatResult {
  message: string;
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  sources: RAGGenerationResult['sources'];
  grounded: boolean;
  retrievalStats: RAGGenerationResult['retrievalStats'];
}

/**
 * RAG Chat Service — integrates RAG retrieval + generation into conversational flow.
 *
 * This is a NEW service that creates a RAG-powered chat endpoint.
 * It does NOT modify existing chat.service.ts.
 *
 * Flow:
 *   1. Verify conversation ownership
 *   2. Retrieve conversation history (memory ≠ RAG)
 *   3. RAG retrieval: semantic search, restricted to the scope the CONTROLLER verified (courseId / lessonId)
 *   4. Grounded generation (no chunk passed the gate -> fixed answer, no LLM call)
 *   5. Only then save the user message + the answer (a failure leaves no orphan message / empty conversation)
 *
 * The `filter` given here must come from the access check (rag-chat.controller), never from the client as is.
 */
export class RAGChatService {
  private ragService: RAGService;
  private generationService: RAGGenerationService;
  private db: RAGChatStore;

  constructor(deps: { db?: RAGChatStore; ragService?: RAGService; generationService?: RAGGenerationService } = {}) {
    this.ragService = deps.ragService ?? RAGService.getInstance();
    this.generationService = deps.generationService ?? new RAGGenerationService();
    this.db = deps.db ?? new PrismaClient();
  }

  /**
   * Send a message in a RAG-powered conversation.
   *
   * @param userId - User ID (from auth)
   * @param conversationId - Conversation ID
   * @param userMessage - User's question
   * @param filter - Verified scope (courseId, optional lessonId)
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
  ): Promise<RAGChatResult> {
    // 1. Verify conversation ownership
    const conversation = await this.db.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!conversation) {
      throw new Error('CONVERSATION_NOT_FOUND');
    }

    // 2. Get conversation history (memory — separate from RAG)
    const previousMessages = await this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: MAX_CONTEXT_MESSAGES,
    });

    const chatHistory: ChatMessage[] = previousMessages.map((msg) => ({
      role: msg.role as 'USER' | 'ASSISTANT',
      content: msg.content,
    }));

    // 3-4. Retrieval + generation (throws RAGError on failure - nothing saved yet)
    const result = await this.answer(userMessage, filter, chatHistory, learnerName, learnerSummary);

    // 5. Persist the turn
    return this.persistTurn(conversation, previousMessages.length === 0, userMessage, result);
  }

  /**
   * Create a new conversation and send the first RAG-powered message.
   * The conversation is created only once an answer exists.
   */
  async createAndChat(
    userId: string,
    userMessage: string,
    filter?: MetadataFilter,
    learnerName?: string,
    learnerSummary?: string,
  ): Promise<RAGChatResult> {
    const result = await this.answer(userMessage, filter, [], learnerName, learnerSummary);

    const conversation = await this.db.conversation.create({
      data: {
        userId,
        title: DEFAULT_TITLE,
      },
    });

    logger.info(`[RAGChat] Created conversation ${conversation.id} for user ${userId}`);

    return this.persistTurn(conversation, true, userMessage, result);
  }

  private async answer(
    userMessage: string,
    filter: MetadataFilter | undefined,
    chatHistory: ChatMessage[],
    learnerName?: string,
    learnerSummary?: string,
  ): Promise<RAGGenerationResult> {
    logger.info(`[RAGChat] Retrieving context (scope: ${JSON.stringify(filter || {})})`);
    const groundedContext = await this.ragService.retrieve(userMessage, filter);

    logger.info(
      `[RAGChat] Retrieved ${groundedContext.totalChunks} chunks ` +
      `(top score: ${groundedContext.chunks[0]?.score ?? 'N/A'})`,
    );

    return this.generationService.generate(
      userMessage,
      groundedContext,
      chatHistory,
      learnerName,
      learnerSummary,
    );
  }

  private async persistTurn(
    conversation: { id: string; title: string },
    isFirstMessage: boolean,
    userMessage: string,
    result: RAGGenerationResult,
  ): Promise<RAGChatResult> {
    const conversationId = conversation.id;
    let conversationTitle = conversation.title;

    await this.db.message.create({
      data: {
        conversationId,
        role: 'USER',
        content: userMessage,
      },
    });

    const aiMessage = await this.db.message.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content: result.answer,
      },
    });

    // Title of a new conversation: generated by the LLM only for a grounded answer (no LLM call without sources)
    let titleUpdate: string | undefined;
    if (isFirstMessage) {
      if (result.grounded) {
        try {
          titleUpdate = await geminiService.generateTitle(userMessage, result.answer);
        } catch (titleError) {
          logger.warn('[RAGChat] Failed to auto-generate title');
        }
      } else {
        titleUpdate = userMessage.trim().replace(/\s+/g, ' ').slice(0, 80) || DEFAULT_TITLE;
      }
    }

    // Touch conversation updatedAt (and set the title)
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date(), ...(titleUpdate ? { title: titleUpdate } : {}) },
    });
    if (titleUpdate) conversationTitle = titleUpdate;

    return {
      message: result.answer,
      messageId: aiMessage.id,
      conversationId,
      conversationTitle,
      sources: result.sources,
      grounded: result.grounded,
      retrievalStats: result.retrievalStats,
    };
  }
}
