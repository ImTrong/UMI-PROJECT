import { RetrievedChunk, GroundedContext } from '../types';
import { RAGConfig } from '../rag.config';
import { RelevanceGate } from './relevance-gate';
import logger from '../../../utils/logger';

/**
 * ContextBuilder — processes retrieved chunks into a structured, deduplicated,
 * token-limited context ready for consumption (by API response or Generation).
 *
 * Pipeline:
 * 0. Relevance Gate — reject chunks below score threshold
 * 1. Deduplicate — remove duplicate chunks (same documentId + chunkIndex)
 * 2. Sort — by relevance score descending
 * 3. Token budget — limit total estimated tokens
 * 4. Build output — structured GroundedContext
 *
 * The Relevance Gate is the ONLY place where score thresholding happens.
 * Citation/Generation only see chunks that passed the gate.
 */
export class ContextBuilder {
  private readonly maxContextTokens: number;
  private readonly relevanceGate: RelevanceGate;

  constructor(config: RAGConfig) {
    this.maxContextTokens = config.maxContextTokens;
    this.relevanceGate = new RelevanceGate(config.retrievalScoreThreshold);
  }

  /**
   * Build grounded context from retrieved chunks.
   */
  build(query: string, chunks: RetrievedChunk[]): GroundedContext {
    // 0. Relevance Gate — reject low-score chunks
    const { accepted } = this.relevanceGate.filter(chunks);

    // 1. Deduplicate by documentId + chunkIndex
    const seen = new Set<string>();
    const deduped: RetrievedChunk[] = [];
    for (const chunk of accepted) {
      const key = `${chunk.documentId}_${chunk.chunkIndex}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(chunk);
      }
    }

    // 2. Sort by score descending
    deduped.sort((a, b) => b.score - a.score);

    // 3. Token budget limiting (rough estimate: 1 token ≈ 4 chars for English, ~2 chars for Vietnamese)
    const TOKEN_RATIO = 2.5; // conservative for mixed vi/en content
    let tokenBudget = this.maxContextTokens;
    const limited: RetrievedChunk[] = [];

    for (const chunk of deduped) {
      const estimatedTokens = Math.ceil(chunk.content.length / TOKEN_RATIO);
      if (tokenBudget - estimatedTokens < 0 && limited.length > 0) {
        break; // Budget exceeded, stop adding
      }
      limited.push(chunk);
      tokenBudget -= estimatedTokens;
    }

    // 4. Build output
    const context: GroundedContext = {
      chunks: limited.map(chunk => ({
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        documentId: chunk.documentId,
        title: (chunk.metadata.title as string) || '',
        content: chunk.content,
        score: Math.round(chunk.score * 1000) / 1000, // 3 decimal places
        metadata: chunk.metadata,
      })),
      totalChunks: limited.length,
      query,
    };

    logger.info(
      `[ContextBuilder] Built context: ` +
      `${chunks.length} raw → ${accepted.length} gated → ${deduped.length} deduped → ${limited.length} selected ` +
      `(budget: ~${this.maxContextTokens} tokens)`,
    );

    return context;
  }
}
