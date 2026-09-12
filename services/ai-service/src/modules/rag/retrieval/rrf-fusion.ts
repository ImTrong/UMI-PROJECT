/**
 * RRF Fusion — Reciprocal Rank Fusion for combining dense + lexical results.
 *
 * Standard RRF formula:
 *   rrfScore = 1/(k + denseRank) + 1/(k + lexicalRank)
 *
 * Where k is a constant (default 60).
 * If a candidate only appears in one list, the other rank = Infinity (contributes 0).
 *
 * Preserves all original scores for debugging/evaluation.
 */

import { RetrievedChunk } from '../types';
import { LexicalCandidate, FusedCandidate } from './advanced-types';
import logger from '../../../utils/logger';

export class RRFFusion {
  private readonly k: number;

  constructor(k = 60) {
    this.k = k;
  }

  /**
   * Fuse dense and lexical results using Reciprocal Rank Fusion.
   *
   * @param denseResults - Dense retrieval results (sorted by cosine score desc)
   * @param lexicalResults - BM25 lexical results (sorted by BM25 score desc)
   * @param topM - Max fused candidates to return
   * @returns Fused candidates sorted by RRF score descending
   */
  fuse(
    denseResults: RetrievedChunk[],
    lexicalResults: LexicalCandidate[],
    topM: number,
  ): FusedCandidate[] {
    // Build lookup maps by chunkId
    const denseMap = new Map<string, { chunk: RetrievedChunk; rank: number }>();
    denseResults.forEach((chunk, idx) => {
      denseMap.set(chunk.chunkId, { chunk, rank: idx + 1 });
    });

    const lexicalMap = new Map<string, { candidate: LexicalCandidate; rank: number }>();
    lexicalResults.forEach((candidate, idx) => {
      lexicalMap.set(candidate.chunkId, { candidate, rank: idx + 1 });
    });

    // Collect all unique chunkIds
    const allChunkIds = new Set<string>([
      ...denseMap.keys(),
      ...lexicalMap.keys(),
    ]);

    // Calculate RRF score for each candidate
    const candidates: FusedCandidate[] = [];
    for (const chunkId of allChunkIds) {
      const dense = denseMap.get(chunkId);
      const lexical = lexicalMap.get(chunkId);

      const denseRank = dense ? dense.rank : Infinity;
      const lexicalRank = lexical ? lexical.rank : Infinity;

      const rrfScore =
        1 / (this.k + denseRank) +
        1 / (this.k + lexicalRank);

      // Determine source
      let source: 'dense_only' | 'lexical_only' | 'both';
      if (dense && lexical) source = 'both';
      else if (dense) source = 'dense_only';
      else source = 'lexical_only';

      // Use dense chunk data if available, otherwise lexical
      const baseData = dense?.chunk || lexical!.candidate;

      candidates.push({
        chunkId,
        documentId: baseData.documentId,
        chunkIndex: baseData.chunkIndex,
        content: baseData.content,
        metadata: baseData.metadata,
        denseScore: dense ? dense.chunk.score : 0,
        denseRank,
        lexicalScore: lexical ? lexical.candidate.bm25Score : 0,
        lexicalRank,
        rrfScore,
        fusedRank: 0, // Will be set below
        source,
      });
    }

    // Sort by RRF score descending and assign ranks
    candidates.sort((a, b) => b.rrfScore - a.rrfScore);
    candidates.forEach((c, idx) => {
      c.fusedRank = idx + 1;
    });

    // Limit to topM
    const result = candidates.slice(0, topM);

    logger.info(
      `[RRF] Fused ${denseResults.length} dense + ${lexicalResults.length} lexical → ` +
      `${allChunkIds.size} unique → top ${result.length} (k=${this.k})`,
    );

    return result;
  }
}
