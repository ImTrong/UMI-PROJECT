// ==================== RAG Foundation — Core Types ====================

/**
 * Supported knowledge source types.
 * Extensible for future document types (PDF, CODE, etc.)
 */
export type SourceType =
  | 'LESSON'
  | 'COURSE'
  | 'TRANSCRIPT'
  | 'PDF'
  | 'DOCX'
  | 'MARKDOWN'
  | 'DOCUMENT'
  | 'CODE';

/**
 * Knowledge document status lifecycle.
 */
export type DocumentStatus = 'ACTIVE' | 'ARCHIVED' | 'INDEXING' | 'ERROR';

// ==================== Document Models ====================

/**
 * Metadata attached to every KnowledgeDocument and inherited by its chunks.
 * Used for pre-filtering during retrieval.
 */
export interface DocumentMetadata {
  courseId?: string;
  learningPathId?: string;
  lessonId?: string;
  skills?: string[];
  language?: string;
  [key: string]: unknown;
}

/**
 * Raw document returned by a DocumentLoader before cleaning/chunking.
 */
export interface RawDocument {
  content: string;
  title: string;
  sourceType: SourceType;
  sourceId: string;
  metadata: DocumentMetadata;
}

/**
 * A chunk of text derived from a KnowledgeDocument after recursive splitting.
 * Carries inherited metadata from the parent document.
 */
export interface DocumentChunkData {
  chunkIndex: number;
  content: string;
  metadata: DocumentMetadata & {
    documentId: string;
    title: string;
    sourceType: string;
    version: number;
  };
}

// ==================== Embedding ====================

/**
 * A chunk with its embedding vector, ready for vector store upsert.
 */
export interface EmbeddedChunk {
  documentId: string;
  chunkIndex: number;
  content: string;
  vector: number[];
  metadata: DocumentChunkData['metadata'];
}

/**
 * Abstraction for embedding services.
 * Allows swapping providers (Gemini, OpenAI, local) without changing business logic.
 */
export interface IEmbeddingService {
  embedDocument(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  getDimension(): number;
  getModelName(): string;
}

// ==================== Vector Store ====================

/**
 * A chunk retrieved from the vector store, including relevance score.
 */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * Search options for vector store queries.
 */
export interface SearchOptions {
  topK: number;
  scoreThreshold?: number;
}

/**
 * Metadata-based pre-filter for retrieval.
 */
export interface MetadataFilter {
  courseId?: string;
  lessonId?: string;
  learningPathId?: string;
  sourceType?: string;
  skills?: string[];
}

/**
 * Abstraction for vector store implementations.
 * Allows swapping backends (Qdrant, pgvector, Pinecone) without changing business logic.
 */
export interface IVectorStore {
  initialize(): Promise<void>;
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  deleteByDocument(documentId: string): Promise<void>;
  search(queryVector: number[], options: SearchOptions): Promise<RetrievedChunk[]>;
  searchByFilter(
    queryVector: number[],
    filter: MetadataFilter,
    options: SearchOptions,
  ): Promise<RetrievedChunk[]>;
}

// ==================== Retrieval ====================

/**
 * Grounded context output from the Context Builder.
 * Contains deduplicated, ranked, token-limited chunks ready for consumption.
 */
export interface GroundedContext {
  chunks: Array<{
    chunkId: string;
    chunkIndex: number;
    documentId: string;
    title: string;
    content: string;
    score: number;
    metadata: Record<string, unknown>;
  }>;
  totalChunks: number;
  query: string;
}

// ==================== API Request / Response ====================

export interface IngestDocumentRequest {
  sourceType: SourceType;
  sourceId: string;
  title: string;
  content: string;
  metadata?: DocumentMetadata;
}

export interface IngestLessonRequest {
  lessonId: string;
  content?: string;
}

export interface RAGSearchRequest {
  query: string;
  topK?: number;
  scoreThreshold?: number;
  filter?: MetadataFilter;
}

export interface RAGSearchResponse {
  success: boolean;
  data: GroundedContext;
}
