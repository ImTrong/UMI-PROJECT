import { RetrievedChunk } from '../types';
import logger from '../../../utils/logger';

/**
 * RelevanceGate — filters raw retrieved chunks by cosine similarity score.
 *
 * Purpose:
 *   Dense retrieval always returns topK results, even for out-of-knowledge queries.
 *   This gate removes chunks below a configurable score threshold so that
 *   only genuinely relevant chunks reach the prompt/generation layer.
 *
 * Score evidence from UMI runtime tests (gemini-embedding-001, 768d, Cosine):
 *   Relevant queries:        0.585 – 0.883  (lowest observed: 0.585)
 *   Out-of-knowledge:        0.490 – 0.509  (highest observed: 0.509)
 *   Gap:                     0.076
 *   Selected threshold:      0.55  (midpoint of gap, safe margin both ways)
 *
 * This module is the ONLY place where score threshold logic lives.
 * Threshold value comes from RAGConfig.retrievalScoreThreshold (env: RETRIEVAL_SCORE_THRESHOLD).
 */
export class RelevanceGate {
  private readonly scoreThreshold: number;

  constructor(scoreThreshold: number) {
    this.scoreThreshold = scoreThreshold;
  }

  /**
   * Filter chunks: keep only those with score >= threshold.
   *
   * @param chunks - Raw retrieved chunks from vector search
   * @returns Only chunks that pass the relevance gate
   */
  filter(chunks: RetrievedChunk[]): { accepted: RetrievedChunk[]; rejected: RetrievedChunk[] } {
    const accepted: RetrievedChunk[] = [];
    const rejected: RetrievedChunk[] = [];

    for (const chunk of chunks) {
      if (chunk.score >= this.scoreThreshold) {
        accepted.push(chunk);
      } else {
        rejected.push(chunk);
      }
    }

    if (rejected.length > 0) {
      logger.info(
        `[RelevanceGate] threshold=${this.scoreThreshold}: ` +
        `${accepted.length} accepted, ${rejected.length} rejected ` +
        `(rejected scores: ${rejected.map(r => r.score.toFixed(3)).join(', ')})`,
      );
    } else {
      logger.info(
        `[RelevanceGate] threshold=${this.scoreThreshold}: ` +
        `${accepted.length} accepted, 0 rejected`,
      );
    }

    return { accepted, rejected };
  }
}
