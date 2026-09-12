/**
 * AdvancedContextBuilder — Context builder for Advanced RAG pipeline.
 *
 * Uses reranked candidates instead of raw dense chunks.
 * Produces the same GroundedContext interface as baseline, so it is
 * transparent to the generation layer.
 *
 * Differences from baseline ContextBuilder:
 * - Uses finalSelected flag from reranker (no separate RelevanceGate)
 * - Preserves advanced observability data in metadata
 * - Same deduplication and token budgeting logic
 */

import { RerankedCandidate } from './advanced-types';
import { GroundedContext } from '../types';
import { RAGConfig } from '../rag.config';
import logger from '../../../utils/logger';

export class AdvancedContextBuilder {
  private readonly maxContextTokens: number;

  constructor(config: RAGConfig) {
    this.maxContextTokens = config.maxContextTokens;
  }

  /**
   * Build grounded context from reranked candidates.
   * Only candidates with finalSelected=true are included.
   */
  build(query: string, allCandidates: RerankedCandidate[]): GroundedContext {
    // 0. Filter to selected candidates only
    const selected = allCandidates.filter(c => c.finalSelected);

    // 1. Deduplicate by documentId + chunkIndex
    const seen = new Set<string>();
    const deduped: RerankedCandidate[] = [];
    for (const c of selected) {
      const key = `${c.documentId}_${c.chunkIndex}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(c);
      }
    }

    // 2. Already sorted by rerankScore from reranker

    // 3. Token budget limiting
    const TOKEN_RATIO = 2.5;
    let tokenBudget = this.maxContextTokens;
    const limited: RerankedCandidate[] = [];

    for (const c of deduped) {
      const estimatedTokens = Math.ceil(c.content.length / TOKEN_RATIO);
      if (tokenBudget - estimatedTokens < 0 && limited.length > 0) {
        break;
      }
      limited.push(c);
      tokenBudget -= estimatedTokens;
    }

    // 4. Build output (same GroundedContext interface as baseline)
    const context: GroundedContext = {
      chunks: limited.map(c => ({
        chunkId: c.chunkId,
        chunkIndex: c.chunkIndex,
        documentId: c.documentId,
        title: (c.metadata.title as string) || '',
        content: c.content,
        // Use rerankScore as the primary score for generation
        score: Math.round(c.rerankScore * 1000) / 1000,
        metadata: {
          ...c.metadata,
          // Advanced observability (for evaluation, not user-facing)
          _denseScore: c.denseScore,
          _lexicalScore: c.lexicalScore,
          _rrfScore: c.rrfScore,
          _rerankScore: c.rerankScore,
          _source: c.source,
        },
      })),
      totalChunks: limited.length,
      query,
    };

    logger.info(
      `[AdvancedContextBuilder] Built context: ` +
      `${allCandidates.length} reranked → ${selected.length} selected → ` +
      `${deduped.length} deduped → ${limited.length} final ` +
      `(budget: ~${this.maxContextTokens} tokens)`,
    );

    return context;
  }
}
