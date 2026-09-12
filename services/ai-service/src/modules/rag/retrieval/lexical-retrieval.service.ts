/**
 * LexicalRetrievalService — BM25-based lexical retrieval.
 *
 * Wraps BM25Index to provide the same interface as dense retrieval.
 * Handles initialization (loading chunks from Qdrant into BM25 index)
 * and synchronization (add/remove documents on ingest/delete).
 *
 * Metadata filtering is applied INSIDE BM25 search, not after.
 * This ensures lexical retrieval never bypasses metadata constraints.
 */

import { BM25Index } from './bm25-index';
import { LexicalCandidate } from './advanced-types';
import { MetadataFilter, IVectorStore } from '../types';
import { QdrantVectorStore } from '../vector-store/qdrant-vector-store';
import { RAGConfig } from '../rag.config';
import logger from '../../../utils/logger';

export class LexicalRetrievalService {
  private bm25Index: BM25Index;
  private vectorStore: QdrantVectorStore;
  private config: RAGConfig;
  private initialized = false;

  constructor(config: RAGConfig, vectorStore: IVectorStore) {
    this.bm25Index = new BM25Index();
    this.vectorStore = vectorStore as QdrantVectorStore;
    this.config = config;
  }

  /**
   * Initialize the BM25 index by loading all chunks from Qdrant.
   * This ensures BM25 and Qdrant stay consistent from the start.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const startMs = Date.now();

      // Scroll all points from Qdrant to build BM25 index
      const chunks = await this.loadAllChunksFromQdrant();
      this.bm25Index.rebuildFromChunks(chunks);
      this.initialized = true;

      const elapsed = Date.now() - startMs;
      logger.info(`[LexicalRetrieval] Initialized BM25 index: ${chunks.length} chunks in ${elapsed}ms`);
    } catch (error: any) {
      logger.error(`[LexicalRetrieval] Initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search for lexical matches using BM25.
   * Metadata filter is applied INSIDE the search, not post-hoc.
   */
  search(query: string, topK: number, filter?: MetadataFilter): LexicalCandidate[] {
    if (!this.initialized) {
      logger.warn('[LexicalRetrieval] BM25 index not initialized, returning empty results');
      return [];
    }

    const results = this.bm25Index.search(query, topK, filter);

    return results.map((r, idx) => ({
      chunkId: r.doc.chunkId,
      documentId: r.doc.documentId,
      chunkIndex: r.doc.chunkIndex,
      content: r.doc.content,
      metadata: r.doc.metadata,
      bm25Score: r.score,
      lexicalRank: idx + 1,
    }));
  }

  // ==================== Synchronization Methods ====================
  // These ensure BM25 stays consistent with Qdrant.

  /**
   * Add a chunk to the BM25 index (called on ingest/update).
   */
  addChunk(chunkId: string, documentId: string, chunkIndex: number, content: string, metadata: Record<string, unknown>): void {
    this.bm25Index.addDocument({ chunkId, documentId, chunkIndex, content, metadata });
    logger.info(`[LexicalRetrieval] BM25 added chunk: ${chunkId}`);
  }

  /**
   * Remove all chunks for a document from the BM25 index (called on delete).
   */
  removeDocumentChunks(documentId: string): void {
    const count = this.bm25Index.removeByDocumentId(documentId);
    logger.info(`[LexicalRetrieval] BM25 removed ${count} chunks for document ${documentId}`);
  }

  /**
   * Get the BM25 index instance (for testing).
   */
  getBM25Index(): BM25Index {
    return this.bm25Index;
  }

  /**
   * Load all chunks from Qdrant via scroll API.
   */
  private async loadAllChunksFromQdrant(): Promise<Array<{
    chunkId: string;
    documentId: string;
    chunkIndex: number;
    content: string;
    metadata: Record<string, unknown>;
  }>> {
    const chunks: Array<{
      chunkId: string;
      documentId: string;
      chunkIndex: number;
      content: string;
      metadata: Record<string, unknown>;
    }> = [];

    let offset: string | number | null | undefined = undefined;
    const collectionName = this.config.qdrantCollection;
    const batchSize = 100;

    // Scroll through all points
    while (true) {
      const response = await this.vectorStore.client.scroll(collectionName, {
        limit: batchSize,
        offset,
        with_payload: true,
        with_vector: false, // Don't need vectors for BM25
      });

      const points = response.points || [];
      if (points.length === 0) break;

      for (const point of points) {
        const payload = (point.payload || {}) as Record<string, any>;
        chunks.push({
          chunkId: `${payload.documentId}_chunk_${payload.chunkIndex ?? 0}`,
          documentId: payload.documentId || '',
          chunkIndex: payload.chunkIndex ?? 0,
          content: payload.content || '',
          metadata: {
            title: payload.title,
            sourceType: payload.sourceType,
            courseId: payload.courseId,
            lessonId: payload.lessonId,
            learningPathId: payload.learningPathId,
            skills: payload.skills,
            language: payload.language,
            version: payload.version,
          },
        });
      }

      offset = response.next_page_offset as string | number | undefined;
      if (!offset) break;
    }

    return chunks;
  }
}
