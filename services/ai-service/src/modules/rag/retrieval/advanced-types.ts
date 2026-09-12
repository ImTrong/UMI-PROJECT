/**
 * Advanced RAG Types — Types for Hybrid Retrieval, RRF, and Reranking.
 *
 * These types extend the baseline RAG types without modifying them.
 * Used only when RAG_RETRIEVAL_MODE=advanced.
 */

import { RetrievedChunk, MetadataFilter } from '../types';

// ==================== Lexical Retrieval ====================

/** A candidate from BM25 lexical search. */
export interface LexicalCandidate {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  bm25Score: number;
  /** 1-indexed rank in the BM25 results */
  lexicalRank: number;
}

// ==================== RRF Fusion ====================

/** A candidate after RRF fusion of dense + lexical results. */
export interface FusedCandidate {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;

  /** Original cosine similarity from dense retrieval */
  denseScore: number;
  /** 1-indexed rank in dense results (Infinity if not in dense) */
  denseRank: number;

  /** BM25 score from lexical retrieval (0 if not in lexical) */
  lexicalScore: number;
  /** 1-indexed rank in lexical results (Infinity if not in lexical) */
  lexicalRank: number;

  /** Fused RRF score: 1/(k+denseRank) + 1/(k+lexicalRank) */
  rrfScore: number;
  /** 1-indexed rank after RRF fusion */
  fusedRank: number;

  /** Which retrieval branches contributed this candidate */
  source: 'dense_only' | 'lexical_only' | 'both';
}

// ==================== Reranking ====================

/** A candidate after deterministic score-based reranking. */
export interface RerankedCandidate extends FusedCandidate {
  /**
   * Deterministic rerank score.
   * Computed as: wDense * normDenseScore + wLexical * normLexicalScore + wRRF * rrfPositionScore
   *
   * This is a deterministic score-based reranking, NOT a Cross-Encoder
   * or LLM semantic reranker.
   */
  rerankScore: number;
  /** 1-indexed rank after reranking */
  finalRank: number;
  /** Whether this candidate was selected for the final context */
  finalSelected: boolean;
}

// ==================== Advanced Retrieval Result ====================

/** Full result from the Advanced RAG retrieval pipeline. */
export interface AdvancedRetrievalResult {
  /** The reranked, filtered candidates (final context chunks) */
  candidates: RerankedCandidate[];

  /** All candidates before final selection (for debugging/evaluation) */
  allCandidates: RerankedCandidate[];

  /** Pipeline statistics */
  stats: {
    denseCount: number;
    lexicalCount: number;
    fusedCount: number;
    rerankedCount: number;
    selectedCount: number;
    topDenseScore: number;
    topLexicalScore: number;
    topRRFScore: number;
    topRerankScore: number;
    retrievalTimeMs: number;
  };
}

// ==================== BM25 Document ====================

/** A document entry in the BM25 index. */
export interface BM25Document {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  /** Tokenized content for BM25 scoring */
  tokens: string[];
}
