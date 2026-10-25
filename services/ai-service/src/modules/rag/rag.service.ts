import { PrismaClient } from '@prisma/client';
import { RAGConfig, loadRAGConfig } from './rag.config';
import { GeminiEmbeddingService } from './embeddings/gemini-embedding.service';
import { QdrantVectorStore } from './vector-store/qdrant-vector-store';
import { IngestionService, IngestSegment } from './ingestion/ingestion.service';
import { RetrievalService } from './retrieval/retrieval.service';
import { ContextBuilder } from './retrieval/context-builder';
import { LexicalRetrievalService } from './retrieval/lexical-retrieval.service';
import { AdvancedRetrievalService } from './retrieval/advanced-retrieval.service';
import {
  IEmbeddingService,
  IVectorStore,
  GroundedContext,
  MetadataFilter,
  SourceType,
  DocumentMetadata,
} from './types';
import { RAGError } from './errors';
import logger from '../../utils/logger';

const prisma = new PrismaClient();

/**
 * RAGService — Main facade for the RAG Foundation.
 *
 * Provides:
 * - initialize() — setup vector store and verify embedding model
 * - ingest()     — index a knowledge document
 * - retrieve()   — semantic search with optional metadata filter
 * - delete()     — remove a document and its vectors
 * - health()     — check subsystem health
 * - listDocuments() — list indexed documents
 */
export class RAGService {
  private static instance: RAGService | null = null;

  private config: RAGConfig;
  private embeddingService: IEmbeddingService;
  private vectorStore: IVectorStore;
  private ingestionService: IngestionService;
  private retrievalService: RetrievalService;
  private contextBuilder: ContextBuilder;
  private lexicalRetrieval: LexicalRetrievalService | null = null;
  private advancedRetrieval: AdvancedRetrievalService | null = null;
  private initialized = false;

  private constructor(config: RAGConfig) {
    this.config = config;

    // Create embedding service based on provider config
    if (config.embeddingProvider === 'gemini') {
      this.embeddingService = new GeminiEmbeddingService(
        config.embeddingModel,
        config.embeddingDimension,
      );
    } else {
      throw new Error(`Unsupported embedding provider: ${config.embeddingProvider}`);
    }

    // Create vector store (Qdrant)
    this.vectorStore = new QdrantVectorStore(config);

    // Create pipeline services
    this.ingestionService = new IngestionService(config, this.embeddingService, this.vectorStore);
    this.retrievalService = new RetrievalService(config, this.embeddingService, this.vectorStore);
    this.contextBuilder = new ContextBuilder(config);

    // Advanced RAG services (only if mode is 'advanced')
    if (config.retrievalMode === 'advanced') {
      this.lexicalRetrieval = new LexicalRetrievalService(config, this.vectorStore);
      this.advancedRetrieval = new AdvancedRetrievalService(
        config,
        this.retrievalService,
        this.lexicalRetrieval,
      );
    }
  }

  /**
   * Get singleton instance.
   */
  static getInstance(): RAGService {
    if (!RAGService.instance) {
      const config = loadRAGConfig();
      RAGService.instance = new RAGService(config);
    }
    return RAGService.instance;
  }

  /**
   * Initialize the RAG subsystem.
   * - Creates Qdrant collection if needed
   * - Validates dimension consistency
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('[RAG] Initializing RAG Foundation...');

    try {
      await this.vectorStore.initialize();

      // Initialize Advanced RAG (BM25 index) if enabled
      if (this.lexicalRetrieval) {
        await this.lexicalRetrieval.initialize();
        logger.info('[RAG] Advanced RAG (BM25) initialized');
      }

      this.initialized = true;
      logger.info('[RAG] RAG Foundation initialized successfully');
    } catch (error: any) {
      logger.error(`[RAG] Initialization failed: ${error.message}`);
      // Non-fatal: RAG features won't work but existing AI features continue
      logger.warn('[RAG] RAG features will be unavailable. Existing AI features unaffected.');
    }
  }

  /**
   * Ingest a knowledge document into the RAG pipeline.
   * Also syncs BM25 index if Advanced RAG is enabled.
   */
  async ingest(
    sourceType: SourceType,
    sourceId: string,
    content?: string,
    title?: string,
    metadata?: DocumentMetadata,
  ): Promise<any> {
    await this.ensureReady();
    const result = await this.ingestionService.ingestDocument(sourceType, sourceId, content, title, metadata);

    // Sync BM25 index after ingestion
    if (this.lexicalRetrieval && result?.id) {
      await this.syncBM25AfterIngest(result.id);
    }

    return result;
  }

  /**
   * RAG-PDF-01: ingest a lesson file already extracted into located segments (PDF pages / DOCX paragraph ranges).
   * Same pipeline as ingest() (cleaner, chunker, embeddings, versioning, Qdrant), one chunking pass per segment.
   */
  async ingestFile(
    sourceType: SourceType,
    sourceId: string,
    title: string,
    metadata: DocumentMetadata,
    segments: IngestSegment[],
  ): Promise<any> {
    await this.ensureReady();
    const result = await this.ingestionService.ingestDocument(sourceType, sourceId, undefined, title, metadata, segments);
    if (this.lexicalRetrieval && result?.id) {
      await this.syncBM25AfterIngest(result.id);
    }
    return result;
  }

  /**
   * Retrieve relevant context for a query.
   * Uses baseline (dense) or advanced (hybrid) pipeline based on config.
   */
  async retrieve(
    query: string,
    filter?: MetadataFilter,
    topK?: number,
    scoreThreshold?: number,
  ): Promise<GroundedContext> {
    await this.ensureReady();

    let context: GroundedContext;
    if (this.config.retrievalMode === 'advanced' && this.advancedRetrieval) {
      // Advanced RAG path
      ({ context } = await this.advancedRetrieval.retrieve(query, filter));
    } else {
      // Baseline path
      const chunks = await this.retrievalService.retrieve(query, filter, topK, scoreThreshold);
      context = this.contextBuilder.build(query, chunks);
    }

    return RAGService.enforceScope(context, filter);
  }

  /**
   * RAG-P0 defense in depth: the vector store already filters on courseId / lessonId, but a chunk whose payload does not
   * match the requested scope never leaves this service (a store bug, a missing payload index or the BM25 branch cannot
   * leak another course's content).
   */
  static enforceScope(context: GroundedContext, filter?: MetadataFilter): GroundedContext {
    if (!filter?.courseId && !filter?.lessonId) return context;
    const inScope = context.chunks.filter((chunk) =>
      (!filter.courseId || chunk.metadata?.courseId === filter.courseId) &&
      (!filter.lessonId || chunk.metadata?.lessonId === filter.lessonId));
    if (inScope.length !== context.chunks.length) {
      logger.warn(`[RAG] Dropped ${context.chunks.length - inScope.length} out-of-scope chunk(s) returned by the vector store`);
    }
    return { ...context, chunks: inScope, totalChunks: inScope.length };
  }

  /** A knowledge document by id (null when absent / not an ObjectId). */
  async getDocument(documentId: string): Promise<any | null> {
    if (!/^[a-f0-9]{24}$/i.test(documentId)) return null;
    return prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
  }

  /** The current (ACTIVE / INDEXING) document for a source, the one a re-index would replace. */
  async findActiveDocumentBySource(sourceType: SourceType, sourceId: string): Promise<any | null> {
    return prisma.knowledgeDocument.findFirst({
      where: { sourceType, sourceId, status: { in: ['ACTIVE', 'INDEXING'] } },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Delete a knowledge document and all associated data.
   * Also removes from BM25 index if Advanced RAG is enabled.
   */
  async deleteDocument(documentId: string): Promise<void> {
    await this.ensureReady();

    // Remove from BM25 index BEFORE deleting from Qdrant
    if (this.lexicalRetrieval) {
      this.lexicalRetrieval.removeDocumentChunks(documentId);
    }

    return this.ingestionService.deleteDocument(documentId);
  }

  /**
   * List indexed knowledge documents, optionally only those of one course (metadata.courseId).
   */
  async listDocuments(status?: string, courseId?: string): Promise<any[]> {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    const documents = await prisma.knowledgeDocument.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        title: true,
        version: true,
        status: true,
        chunkCount: true,
        contentHash: true,
        metadata: true,
        lastIndexedAt: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // Json path filters are not available on MongoDB with Prisma: filter the (small) list here
    return courseId
      ? documents.filter((d: any) => (d.metadata as any)?.courseId === courseId)
      : documents;
  }

  /**
   * Health check for RAG subsystem.
   */
  async health(): Promise<{
    status: string;
    qdrant: boolean;
    embeddingModel: string;
    embeddingDimension: number;
    collection: string;
    documentsCount: number;
    retrievalMode: string;
  }> {
    let qdrantOk = false;
    let documentsCount = 0;

    try {
      // Check Qdrant connectivity
      const store = this.vectorStore as QdrantVectorStore;
      // A simple collection check verifies connectivity
      await (store as any).client?.getCollections();
      qdrantOk = true;
    } catch {
      qdrantOk = false;
    }

    try {
      documentsCount = await prisma.knowledgeDocument.count({
        where: { status: 'ACTIVE' },
      });
    } catch { /* ignore */ }

    return {
      status: this.initialized && qdrantOk ? 'healthy' : 'degraded',
      qdrant: qdrantOk,
      embeddingModel: this.config.embeddingModel,
      embeddingDimension: this.config.embeddingDimension,
      collection: this.config.qdrantCollection,
      documentsCount,
      retrievalMode: this.config.retrievalMode,
    };
  }

  /**
   * Sync BM25 index after a document is ingested/updated.
   * Loads the newly ingested chunks from Qdrant and adds them to BM25.
   */
  private async syncBM25AfterIngest(documentId: string): Promise<void> {
    if (!this.lexicalRetrieval) return;

    try {
      // Remove old chunks for this document (handles re-indexing)
      this.lexicalRetrieval.removeDocumentChunks(documentId);

      // Load new chunks from Qdrant
      const store = this.vectorStore as QdrantVectorStore;
      const response = await store.client.scroll(this.config.qdrantCollection, {
        filter: {
          must: [{ key: 'documentId', match: { value: documentId } }],
        },
        limit: 1000,
        with_payload: true,
        with_vector: false,
      });

      for (const point of response.points || []) {
        const payload = (point.payload || {}) as Record<string, any>;
        this.lexicalRetrieval.addChunk(
          `${payload.documentId}_chunk_${payload.chunkIndex ?? 0}`,
          payload.documentId || '',
          payload.chunkIndex ?? 0,
          payload.content || '',
          {
            title: payload.title,
            sourceType: payload.sourceType,
            courseId: payload.courseId,
            lessonId: payload.lessonId,
            learningPathId: payload.learningPathId,
            skills: payload.skills,
            language: payload.language,
            version: payload.version,
          },
        );
      }

      logger.info(`[RAG] BM25 synced after ingest: ${(response.points || []).length} chunks for doc ${documentId}`);
    } catch (error: any) {
      logger.warn(`[RAG] BM25 sync failed (non-fatal): ${error.message}`);
    }
  }

  /**
   * RAG-P0: the startup initialization may have failed (Qdrant not up yet). Try again on use instead of failing forever;
   * still not ready -> RAG_UNAVAILABLE (503), never an empty "successful" answer.
   */
  private async ensureReady(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.initialized) {
      throw new RAGError('RAG_UNAVAILABLE', 'vector store not initialized');
    }
  }
}
