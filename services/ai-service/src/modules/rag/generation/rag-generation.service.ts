import { geminiService, ChatMessage } from '../../../services/gemini.service';
import { GroundedContext } from '../types';
import { buildRAGPrompt, RAGPromptInput } from './prompt-builder';
import logger from '../../../utils/logger';

/**
 * Citation source — maps 1:1 with a retrieved chunk.
 * Never fabricated by the LLM.
 */
export interface CitationSource {
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  lessonId?: string;
  title: string;
  score: number;
}

/**
 * RAG Generation response — answer + deterministic citations.
 */
export interface RAGGenerationResult {
  answer: string;
  sources: CitationSource[];
  retrievalStats: {
    totalChunksRetrieved: number;
    topScore: number;
    query: string;
  };
}

/**
 * RAG Generation Service
 *
 * Responsible for:
 *   1. Building a grounded prompt from retrieved context
 *   2. Calling Gemini to generate an answer
 *   3. Constructing citations from the ACTUALLY retrieved chunks (not LLM output)
 *
 * Design:
 *   - Generation is separated from retrieval → can benchmark each independently
 *   - Citations are deterministic (from retrieval, not from LLM)
 *   - If no context → LLM explicitly told no UMI knowledge available
 */
export class RAGGenerationService {
  /**
   * Generate a grounded answer from retrieved context.
   */
  async generate(
    question: string,
    groundedContext: GroundedContext,
    conversationHistory: ChatMessage[] = [],
    learnerName?: string,
    learnerSummary?: string,
  ): Promise<RAGGenerationResult> {
    // 1. Build prompt
    const promptInput: RAGPromptInput = {
      question,
      groundedContext,
      conversationHistory,
      learnerName,
      learnerSummary,
    };
    const { systemPrompt, history, userMessage } = buildRAGPrompt(promptInput);

    // 2. Call Gemini
    logger.info(
      `[RAGGeneration] Generating answer: ` +
      `${groundedContext.chunks.length} chunks, ` +
      `${history.length} history messages`,
    );

    const answer = await geminiService.generateResponse(systemPrompt, history, userMessage);

    // 3. Build deterministic citations from retrieved chunks
    const sources = this.buildCitations(groundedContext);

    logger.info(
      `[RAGGeneration] Generated answer (${answer.length} chars), ` +
      `${sources.length} citations`,
    );

    return {
      answer,
      sources,
      retrievalStats: {
        totalChunksRetrieved: groundedContext.totalChunks,
        topScore: groundedContext.chunks.length > 0
          ? groundedContext.chunks[0].score
          : 0,
        query: groundedContext.query,
      },
    };
  }

  /**
   * Build citations from retrieved chunks.
   * Citations are deterministic — constructed from actual retrieval results,
   * NEVER from LLM output.
   */
  private buildCitations(context: GroundedContext): CitationSource[] {
    if (context.chunks.length === 0) {
      return [];
    }

    return context.chunks.map(chunk => ({
      documentId: chunk.documentId,
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      lessonId: (chunk.metadata.lessonId as string) || undefined,
      title: chunk.title,
      score: chunk.score,
    }));
  }
}
