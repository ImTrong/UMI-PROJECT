/**
 * AdvancedRetrievalService — Orchestrates the full Advanced RAG pipeline.
 *
 * Pipeline:
 *   Query + Filter
 *     ├── Dense Retrieval (topN)
 *     └── Lexical/BM25 Retrieval (topN) — same metadata filter
 *           ↓
 *     RRF Fusion (k)
 *           ↓
 *     Top-M Candidates
 *           ↓
 *     Deterministic Score-Based Reranker
 *           ↓
 *     Advanced Gate (threshold)
 *           ↓
 *     Final Top-K
 *
 * Both retrieval branches MUST respect the same metadata constraints.
 * Baseline retrieval is NOT modified — this is a separate parallel path.
 */

import { RetrievalService } from './retrieval.service';
import { LexicalRetrievalService } from './lexical-retrieval.service';
import { RRFFusion } from './rrf-fusion';
import { ScoreBasedReranker } from './reranker';
import { AdvancedContextBuilder } from './advanced-context-builder';
import { AdvancedRetrievalResult, RerankedCandidate } from './advanced-types';
import { MetadataFilter, GroundedContext } from '../types';
import { RAGConfig } from '../rag.config';
import logger from '../../../utils/logger';

export class AdvancedRetrievalService {
  private readonly denseRetrieval: RetrievalService;
  private readonly lexicalRetrieval: LexicalRetrievalService;
  private readonly rrfFusion: RRFFusion;
  private readonly reranker: ScoreBasedReranker;
  private readonly contextBuilder: AdvancedContextBuilder;
  private readonly config: RAGConfig;

  constructor(
    config: RAGConfig,
    denseRetrieval: RetrievalService,
    lexicalRetrieval: LexicalRetrievalService,
  ) {
    this.config = config;
    this.denseRetrieval = denseRetrieval;
    this.lexicalRetrieval = lexicalRetrieval;
    this.rrfFusion = new RRFFusion(config.rrfK);
    this.reranker = new ScoreBasedReranker(
      config.rerankWeightDense,
      config.rerankWeightLexical,
      config.rerankWeightRRF,
    );
    this.contextBuilder = new AdvancedContextBuilder(config);
  }

  /**
   * Run the full Advanced RAG retrieval pipeline.
   *
   * Both dense and lexical branches use the SAME metadata filter.
   * This is an invariant — lexical retrieval must never bypass metadata constraints.
   */
  async retrieve(
    query: string,
    filter?: MetadataFilter,
  ): Promise<{ context: GroundedContext; advancedResult: AdvancedRetrievalResult }> {
    const startMs = Date.now();

    // 1. Dense retrieval (topN, using baseline threshold as hard floor)
    //    Dense candidates below the baseline relevance threshold are excluded
    //    BEFORE fusion. This preserves OOK rejection from baseline.
    const denseResults = await this.denseRetrieval.retrieve(
      query,
      filter,
      this.config.advancedDenseTopN,
      this.config.retrievalScoreThreshold, // baseline threshold as hard floor
    );

    // 2. Lexical retrieval (topN, SAME metadata filter)
    const lexicalResults = this.lexicalRetrieval.search(
      query,
      this.config.advancedLexicalTopN,
      filter,
    );

    // 3. RRF Fusion
    //    Only fuse candidates that passed their respective gates.
    //    If dense returned 0 results (OOK), lexical-only candidates still enter fusion,
    //    but will have lower RRF scores since they lack dense signal.
    const fusedCandidates = this.rrfFusion.fuse(
      denseResults,
      lexicalResults,
      this.config.rrfFusedTopM,
    );

    // 4. Deterministic score-based reranking
    const rerankedCandidates = this.reranker.rerank(
      fusedCandidates,
      this.config.advancedFinalTopK,
      this.config.advancedRerankThreshold,
    );

    const retrievalTimeMs = Date.now() - startMs;

    // 5. Build stats
    const selectedCandidates = rerankedCandidates.filter(c => c.finalSelected);
    const stats: AdvancedRetrievalResult['stats'] = {
      denseCount: denseResults.length,
      lexicalCount: lexicalResults.length,
      fusedCount: fusedCandidates.length,
      rerankedCount: rerankedCandidates.length,
      selectedCount: selectedCandidates.length,
      topDenseScore: denseResults.length > 0 ? denseResults[0].score : 0,
      topLexicalScore: lexicalResults.length > 0 ? lexicalResults[0].bm25Score : 0,
      topRRFScore: fusedCandidates.length > 0 ? fusedCandidates[0].rrfScore : 0,
      topRerankScore: rerankedCandidates.length > 0 ? rerankedCandidates[0].rerankScore : 0,
      retrievalTimeMs,
    };

    const advancedResult: AdvancedRetrievalResult = {
      candidates: selectedCandidates,
      allCandidates: rerankedCandidates,
      stats,
    };

    logger.info(
      `[AdvancedRetrieval] Pipeline: dense=${stats.denseCount} lexical=${stats.lexicalCount} ` +
      `→ fused=${stats.fusedCount} → reranked=${stats.rerankedCount} → selected=${stats.selectedCount} ` +
      `(${retrievalTimeMs}ms)`,
    );

    // 6. Build context (same GroundedContext interface as baseline)
    const context = this.contextBuilder.build(query, rerankedCandidates);

    return { context, advancedResult };
  }
}
