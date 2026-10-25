import logger from '../../utils/logger';

/** Validated RelevanceGate threshold (RAG evaluation baseline-v1, gemini-embedding-001 768d Cosine). */
export const DEFAULT_RETRIEVAL_SCORE_THRESHOLD = 0.56;

// ==================== RAG Configuration ====================

/**
 * Centralized RAG configuration.
 * All values come from environment variables with sensible defaults.
 * No architectural decisions are hard-coded.
 */
export interface RAGConfig {
  // Embedding
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimension: number;

  // Vector Store
  qdrantUrl: string;
  qdrantCollection: string;

  // Chunking
  chunkSize: number;
  chunkOverlap: number;

  // Retrieval (Baseline v1 — DO NOT MODIFY)
  retrievalTopK: number;
  retrievalScoreThreshold: number;

  // Context Builder
  maxContextTokens: number;

  // Internal service URLs (for lesson loading)
  courseServiceUrl: string;

  // ==================== Advanced RAG (Enhancement Layer) ====================
  // These fields control the optional Advanced RAG pipeline.
  // Default retrievalMode='dense' preserves Baseline v1 behavior exactly.

  /** Retrieval mode: 'dense' = Baseline v1, 'advanced' = Hybrid + RRF + Reranker */
  retrievalMode: 'dense' | 'advanced';

  /** Number of dense candidates to retrieve before fusion (default: 10) */
  advancedDenseTopN: number;

  /** Number of lexical/BM25 candidates to retrieve before fusion (default: 10) */
  advancedLexicalTopN: number;

  /** RRF constant k (default: 60) */
  rrfK: number;

  /** Max candidates after RRF fusion before reranking (default: 15) */
  rrfFusedTopM: number;

  /** Final top-K after reranking (default: 5) */
  advancedFinalTopK: number;

  /** Deterministic reranker weights */
  rerankWeightDense: number;
  rerankWeightLexical: number;
  rerankWeightRRF: number;

  /** Advanced gate threshold for reranker scores (provisional, must be validated) */
  advancedRerankThreshold: number;
}

/**
 * Load RAG configuration from environment variables.
 * Fails fast if critical configuration is missing.
 */
export function loadRAGConfig(): RAGConfig {
  const config: RAGConfig = {
    // Embedding — configurable, not hard-coded
    embeddingProvider: process.env.EMBEDDING_PROVIDER || 'gemini',
    embeddingModel: process.env.EMBEDDING_MODEL || 'gemini-embedding-001',
    embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION || '768', 10),

    // Vector Store
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantCollection: process.env.QDRANT_COLLECTION || 'umi_knowledge',

    // Chunking
    chunkSize: parseInt(process.env.CHUNK_SIZE || '600', 10),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '100', 10),

    // Retrieval (Baseline v1)
    retrievalTopK: parseInt(process.env.RETRIEVAL_TOP_K || '5', 10),
    // RAG-P0: an unset value keeps the gate ON at the validated threshold (it used to default to 0.0 = gate off)
    retrievalScoreThreshold: parseFloat(process.env.RETRIEVAL_SCORE_THRESHOLD || String(DEFAULT_RETRIEVAL_SCORE_THRESHOLD)),

    // Context Builder
    maxContextTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || '4000', 10),

    // Internal service URLs
    courseServiceUrl: process.env.COURSE_SERVICE_URL || 'http://course-service:3003',

    // Advanced RAG (Enhancement Layer)
    retrievalMode: (process.env.RAG_RETRIEVAL_MODE as 'dense' | 'advanced') || 'dense',
    advancedDenseTopN: parseInt(process.env.ADVANCED_DENSE_TOP_N || '10', 10),
    advancedLexicalTopN: parseInt(process.env.ADVANCED_LEXICAL_TOP_N || '10', 10),
    rrfK: parseInt(process.env.RRF_K || '60', 10),
    rrfFusedTopM: parseInt(process.env.RRF_FUSED_TOP_M || '15', 10),
    advancedFinalTopK: parseInt(process.env.ADVANCED_FINAL_TOP_K || '5', 10),
    rerankWeightDense: parseFloat(process.env.RERANK_WEIGHT_DENSE || '0.5'),
    rerankWeightLexical: parseFloat(process.env.RERANK_WEIGHT_LEXICAL || '0.3'),
    rerankWeightRRF: parseFloat(process.env.RERANK_WEIGHT_RRF || '0.2'),
    advancedRerankThreshold: parseFloat(process.env.ADVANCED_RERANK_THRESHOLD || '0.75'),
  };

  // Validation
  if (config.embeddingDimension <= 0) {
    throw new Error('EMBEDDING_DIMENSION must be a positive integer');
  }
  if (config.chunkSize <= 0) {
    throw new Error('CHUNK_SIZE must be a positive integer');
  }
  if (config.chunkOverlap < 0 || config.chunkOverlap >= config.chunkSize) {
    throw new Error('CHUNK_OVERLAP must be >= 0 and < CHUNK_SIZE');
  }
  if (config.retrievalTopK <= 0) {
    throw new Error('RETRIEVAL_TOP_K must be a positive integer');
  }
  if (!Number.isFinite(config.retrievalScoreThreshold) || config.retrievalScoreThreshold < 0 || config.retrievalScoreThreshold > 1) {
    throw new Error('RETRIEVAL_SCORE_THRESHOLD must be a number between 0 and 1');
  }
  if (config.retrievalScoreThreshold === 0) {
    logger.warn('[RAG Config] RETRIEVAL_SCORE_THRESHOLD=0 disables the RelevanceGate: out-of-knowledge questions will reach the LLM');
  }

  logger.info('[RAG Config] Loaded:', {
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingDimension: config.embeddingDimension,
    qdrantUrl: config.qdrantUrl,
    qdrantCollection: config.qdrantCollection,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    retrievalTopK: config.retrievalTopK,
    retrievalScoreThreshold: config.retrievalScoreThreshold,
    retrievalMode: config.retrievalMode,
    ...(config.retrievalMode === 'advanced' ? {
      advancedDenseTopN: config.advancedDenseTopN,
      advancedLexicalTopN: config.advancedLexicalTopN,
      rrfK: config.rrfK,
      rrfFusedTopM: config.rrfFusedTopM,
      advancedFinalTopK: config.advancedFinalTopK,
      rerankWeights: `d=${config.rerankWeightDense} l=${config.rerankWeightLexical} r=${config.rerankWeightRRF}`,
      advancedRerankThreshold: config.advancedRerankThreshold,
    } : {}),
  });

  return config;
}
