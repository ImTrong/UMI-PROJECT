/**
 * ScoreBasedReranker — Deterministic score-based reranking.
 *
 * This is a DETERMINISTIC score-based reranker, NOT a Cross-Encoder
 * or LLM semantic reranker. It combines normalized dense, lexical,
 * and RRF position signals into a single rerank score.
 *
 * Formula:
 *   rerankScore = wDense * normDenseScore + wLexical * normLexicalScore + wRRF * rrfPositionScore
 *
 * Normalization:
 *   - Dense scores: min-max normalized across candidates
 *   - Lexical scores: min-max normalized across candidates
 *   - RRF position: 1/fusedRank (inversely proportional to rank)
 *
 * Initial weights (heuristic, not empirically optimal):
 *   wDense = 0.5, wLexical = 0.3, wRRF = 0.2
 */

import { FusedCandidate, RerankedCandidate } from './advanced-types';
import logger from '../../../utils/logger';

export class ScoreBasedReranker {
  private readonly wDense: number;
  private readonly wLexical: number;
  private readonly wRRF: number;

  constructor(wDense = 0.5, wLexical = 0.3, wRRF = 0.2) {
    this.wDense = wDense;
    this.wLexical = wLexical;
    this.wRRF = wRRF;
  }

  /**
   * Rerank fused candidates using deterministic score combination.
   *
   * @param candidates - Fused candidates from RRF
   * @param finalTopK - Max candidates to return
   * @param threshold - Minimum rerank score to pass (provisional, must be validated)
   * @returns Reranked candidates sorted by rerank score descending
   */
  rerank(
    candidates: FusedCandidate[],
    finalTopK: number,
    threshold: number,
  ): RerankedCandidate[] {
    if (candidates.length === 0) return [];

    // Compute min-max normalization ranges
    const denseScores = candidates.map(c => c.denseScore).filter(s => s > 0);
    const lexicalScores = candidates.map(c => c.lexicalScore).filter(s => s > 0);

    const denseMin = denseScores.length > 0 ? Math.min(...denseScores) : 0;
    const denseMax = denseScores.length > 0 ? Math.max(...denseScores) : 1;
    const denseRange = denseMax - denseMin || 1;

    const lexicalMin = lexicalScores.length > 0 ? Math.min(...lexicalScores) : 0;
    const lexicalMax = lexicalScores.length > 0 ? Math.max(...lexicalScores) : 1;
    const lexicalRange = lexicalMax - lexicalMin || 1;

    // Calculate rerank score for each candidate
    const reranked: RerankedCandidate[] = candidates.map(c => {
      // Normalize dense score [0, 1]
      const normDense = c.denseScore > 0 ? (c.denseScore - denseMin) / denseRange : 0;

      // Normalize lexical score [0, 1]
      const normLexical = c.lexicalScore > 0 ? (c.lexicalScore - lexicalMin) / lexicalRange : 0;

      // RRF position signal: inversely proportional to rank
      const rrfPositionScore = 1 / c.fusedRank;

      const rerankScore =
        this.wDense * normDense +
        this.wLexical * normLexical +
        this.wRRF * rrfPositionScore;

      return {
        ...c,
        rerankScore: Math.round(rerankScore * 10000) / 10000,
        finalRank: 0, // Set below
        finalSelected: false, // Set below
      };
    });

    // Sort by rerank score descending
    reranked.sort((a, b) => b.rerankScore - a.rerankScore);

    // Assign ranks and select top-K above threshold
    let selectedCount = 0;
    reranked.forEach((c, idx) => {
      c.finalRank = idx + 1;
      if (selectedCount < finalTopK && c.rerankScore >= threshold) {
        c.finalSelected = true;
        selectedCount++;
      }
    });

    logger.info(
      `[Reranker] Score-based: ${candidates.length} candidates → ` +
      `${selectedCount} selected (topK=${finalTopK}, threshold=${threshold}, ` +
      `weights: d=${this.wDense} l=${this.wLexical} r=${this.wRRF})`,
    );

    return reranked;
  }
}
