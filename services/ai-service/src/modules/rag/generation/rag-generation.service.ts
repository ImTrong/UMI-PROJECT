import { geminiService, ChatMessage } from '../../../services/gemini.service';
import { GroundedContext } from '../types';
import { buildRAGPrompt, RAGPromptInput, PromptChunk, NOT_FOUND_IN_COURSE_MESSAGE } from './prompt-builder';
import { RAGError, describeError } from '../errors';
import { pickLocation } from '../vector-store/qdrant-vector-store';
import logger from '../../../utils/logger';

/**
 * Citation source — maps 1:1 with a chunk that was put in the prompt.
 * Never fabricated by the LLM.
 */
export interface CitationSource {
  /** The "[Nguồn n]" number the model was told to cite. */
  sourceIndex: number;
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  courseId?: string;
  lessonId?: string;
  title: string;
  score: number;
  /** Start of the chunk text, so a citation can be checked against its source. */
  snippet: string;
  /** RAG-PDF-01: for a chunk of a lesson file - which file, and the PDF page or DOCX paragraph range. */
  location?: {
    fileKey: string;
    fileName?: string;
    fileType?: string;
    page?: number;
    paragraphStart?: number;
    paragraphEnd?: number;
    heading?: string;
  };
}

/**
 * RAG Generation response — answer + deterministic citations.
 */
export interface RAGGenerationResult {
  answer: string;
  sources: CitationSource[];
  /** false = no chunk passed the RelevanceGate: the fixed "not found" answer, no LLM call, no sources. */
  grounded: boolean;
  retrievalStats: {
    totalChunksRetrieved: number;
    topScore: number;
    query: string;
  };
}

const SNIPPET_LENGTH = 200;

/**
 * RAG Generation Service
 *
 * Responsible for:
 *   1. Building a grounded prompt from retrieved context
 *   2. Calling Gemini to generate an answer — ONLY when there is at least one source
 *   3. Constructing citations from the chunks ACTUALLY put in the prompt (not from LLM output)
 *
 * Design:
 *   - Generation is separated from retrieval → can benchmark each independently
 *   - Citations are deterministic (from the prompt's sources, not from LLM output)
 *   - No context → fixed Vietnamese "not found" answer, the LLM is not called (RAG-P0)
 *   - LLM failure → RAGError LLM_FAILED, never an answer
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
    const retrievalStats = {
      totalChunksRetrieved: groundedContext.totalChunks,
      topScore: groundedContext.chunks.length > 0 ? groundedContext.chunks[0].score : 0,
      query: groundedContext.query,
    };

    // 0. Nothing passed the RelevanceGate: do not ask the model (it would answer from general knowledge)
    if (groundedContext.chunks.length === 0) {
      logger.info('[RAGGeneration] No chunk passed the relevance gate: "not found" answer, LLM not called');
      return { answer: NOT_FOUND_IN_COURSE_MESSAGE, sources: [], grounded: false, retrievalStats };
    }

    // 1. Build prompt
    const promptInput: RAGPromptInput = {
      question,
      groundedContext,
      conversationHistory,
      learnerName,
      learnerSummary,
    };
    const { systemPrompt, history, userMessage, usedChunks } = buildRAGPrompt(promptInput);

    // 2. Call Gemini
    logger.info(
      `[RAGGeneration] Generating answer: ` +
      `${usedChunks.length} chunks, ` +
      `${history.length} history messages`,
    );

    let answer: string;
    try {
      answer = await geminiService.generateResponse(systemPrompt, history, userMessage);
    } catch (error: any) {
      logger.error(`[RAGGeneration] LLM call failed: ${describeError(error)}`);
      throw new RAGError('LLM_FAILED');
    }
    if (typeof answer !== 'string' || answer.trim().length === 0) {
      throw new RAGError('LLM_FAILED', 'empty answer');
    }

    // 3. Build deterministic citations from the chunks that were in the prompt
    const sources = this.buildCitations(usedChunks);

    logger.info(
      `[RAGGeneration] Generated answer (${answer.length} chars), ` +
      `${sources.length} citations`,
    );

    return { answer, sources, grounded: true, retrievalStats };
  }

  /**
   * Build citations from the prompt's chunks.
   * Citations are deterministic — constructed from what the model was given,
   * NEVER from LLM output.
   */
  private buildCitations(usedChunks: PromptChunk[]): CitationSource[] {
    return usedChunks.map((chunk, i) => ({
      sourceIndex: i + 1,
      documentId: chunk.documentId,
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      courseId: (chunk.metadata.courseId as string) || undefined,
      lessonId: (chunk.metadata.lessonId as string) || undefined,
      title: chunk.title,
      score: chunk.score,
      snippet: chunk.content.slice(0, SNIPPET_LENGTH),
      ...(typeof chunk.metadata.fileKey === 'string'
        ? { location: pickLocation(chunk.metadata) as unknown as CitationSource['location'] }
        : {}),
    }));
  }
}
