/**
 * RAG Evaluation Types
 *
 * Type definitions for the RAG evaluation pipeline based on RAGAS methodology.
 * This is NOT an official RAGAS implementation — it is a native TypeScript
 * implementation of RAG evaluation metrics following published RAGAS methodology.
 */

// ==================== Dataset Types ====================

export type EvalCategory =
  | 'direct_factual'
  | 'paraphrase'
  | 'multi_sentence'
  | 'conceptual'
  | 'out_of_knowledge'
  | 'similar_but_unrelated'
  | 'metadata_scoped';

/**
 * A single evaluation sample in the dataset.
 */
export interface EvalSample {
  id: string;
  category: EvalCategory;
  question: string;
  /** Ground truth answer. null for out-of-knowledge queries. */
  groundTruth: string | null;
  /** Expected lesson sourceIds that should be retrieved. [] for out-of-knowledge. */
  expectedSources: string[];
  /** Metadata filter to apply during retrieval. */
  metadata: {
    courseId?: string;
    lessonId?: string;
  };
}

export interface EvalDataset {
  version: string;
  description: string;
  createdAt: string;
  samples: EvalSample[];
}

// ==================== Fixture Types ====================

export interface LessonFixture {
  sourceId: string;
  title: string;
  content: string;
  metadata: {
    courseId: string;
    lessonId: string;
    skills: string[];
    language: string;
  };
}

// ==================== Evaluation Result Types ====================

/**
 * Raw result from running a single sample through the RAG pipeline.
 */
export interface SampleRAGResult {
  sampleId: string;
  question: string;
  category: EvalCategory;
  groundTruth: string | null;
  expectedSources: string[];

  // RAG outputs
  generatedAnswer: string;
  retrievedContexts: RetrievedContextInfo[];
  sources: SourceInfo[];

  // Retrieval stats
  totalChunksRetrieved: number;
  topScore: number;

  // Timing
  retrievalTimeMs: number;
  generationTimeMs: number;
}

export interface RetrievedContextInfo {
  chunkId: string;
  chunkIndex: number;
  documentId: string;
  sourceId: string;
  title: string;
  content: string;
  score: number;
}

export interface SourceInfo {
  documentId: string;
  chunkId: string;
  lessonId?: string;
  title: string;
  score: number;
}

// ==================== Metric Types ====================

export interface MetricScore {
  metric: string;
  score: number;
  rawData: Record<string, unknown>;
}

export interface SampleEvalResult {
  sampleId: string;
  category: EvalCategory;
  question: string;

  ragResult: SampleRAGResult;

  metrics: {
    faithfulness: MetricScore | null;
    answerRelevancy: MetricScore | null;
    contextPrecision: MetricScore | null;
    contextRecall: MetricScore | null;
  };

  // Retrieval classification
  retrievalClassification: RetrievalClassification;
  retrievalCause: RetrievalCause | null;
}

export type RetrievalClassification =
  | 'correct'
  | 'partial'
  | 'wrong'
  | 'no_retrieval'
  | 'ambiguous';

export type RetrievalCause =
  | 'paraphrase_failure'
  | 'shared_terminology'
  | 'missing_knowledge'
  | 'bad_metadata_filter'
  | 'false_positive'
  | 'insufficient_context'
  | 'generation_hallucination'
  | 'generation_refusal'
  | null;

// ==================== Report Types ====================

export interface EvalConfig {
  evaluationId: string;
  datasetVersion: string;
  retrievalMode: 'dense' | 'advanced';
  config: {
    llmModel: string;
    embeddingModel: string;
    embeddingDimension: number;
    retrievalTopK: number;
    relevanceThreshold: number;
    maxContextTokens: number;
    chunkSize: number;
    chunkOverlap: number;
    judgeTemperature: number;
    judgePromptVersion: string;
    // Advanced RAG config (only present when retrievalMode=advanced)
    advancedDenseTopN?: number;
    advancedLexicalTopN?: number;
    rrfK?: number;
    rrfFusedTopM?: number;
    advancedFinalTopK?: number;
    rerankWeights?: string;
    advancedRerankThreshold?: number;
  };
  timestamp: string;
  totalSamples: number;
}

export interface AggregatedMetrics {
  faithfulness: { average: number; min: number; max: number; count: number };
  answerRelevancy: { average: number; min: number; max: number; count: number };
  contextPrecision: { average: number; min: number; max: number; count: number };
  contextRecall: { average: number; min: number; max: number; count: number };
}

export interface CategoryMetrics {
  category: EvalCategory;
  sampleCount: number;
  metrics: AggregatedMetrics;
}

export interface EvalReport {
  config: EvalConfig;
  overallMetrics: AggregatedMetrics;
  perCategory: CategoryMetrics[];
  retrievalAnalysis: {
    correct: number;
    partial: number;
    wrong: number;
    noRetrieval: number;
    ambiguous: number;
  };
  gateAnalysis: {
    relevantSurvivedGate: number;
    irrelevantRejectedByGate: number;
    ambiguousRemaining: number;
  };
  sampleResults: SampleEvalResult[];
  totalGeminiCalls: number;
  totalTimeMs: number;
}
