import { QdrantClient } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';
import {
  IVectorStore,
  EmbeddedChunk,
  RetrievedChunk,
  SearchOptions,
  MetadataFilter,
} from '../types';
import { RAGConfig } from '../rag.config';
import logger from '../../../utils/logger';

// Deterministic UUID namespace for generating point IDs
const QDRANT_UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** RAG-PDF-01: file location fields carried from chunk metadata to the point payload and back (absent ones are omitted). */
export const LOCATION_FIELDS = ['fileKey', 'fileName', 'fileType', 'page', 'paragraphStart', 'paragraphEnd', 'heading'] as const;

export function pickLocation(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of LOCATION_FIELDS) {
    if (source[field] !== undefined && source[field] !== null && source[field] !== '') out[field] = source[field];
  }
  return out;
}

/**
 * Qdrant Vector Store implementation.
 *
 * MongoDB = Source of Truth (KnowledgeDocument, DocumentChunk).
 * Qdrant = Vector Index (embeddings + payload metadata for filtering).
 *
 * Point IDs are deterministic UUIDs derived from `${documentId}_${chunkIndex}`,
 * ensuring idempotent upserts and predictable cleanup.
 *
 * Uses Qdrant SDK v1.12+ `query()` API (replaces deprecated `search()`).
 */
export class QdrantVectorStore implements IVectorStore {
  public client: QdrantClient;
  private readonly collectionName: string;
  private readonly dimension: number;

  constructor(config: RAGConfig) {
    this.client = new QdrantClient({ url: config.qdrantUrl });
    this.collectionName = config.qdrantCollection;
    this.dimension = config.embeddingDimension;
  }

  /**
   * Initialize: create collection if it doesn't exist.
   * Validates dimension matches existing collection.
   */
  async initialize(): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        c => c.name === this.collectionName,
      );

      if (exists) {
        // Validate dimension
        const info = await this.client.getCollection(this.collectionName);
        const existingDim = (info.config?.params?.vectors as any)?.size;
        if (existingDim && existingDim !== this.dimension) {
          throw new Error(
            `Qdrant collection "${this.collectionName}" has dimension ${existingDim} ` +
            `but EMBEDDING_DIMENSION is ${this.dimension}. ` +
            `Delete the collection or update EMBEDDING_DIMENSION.`,
          );
        }
        logger.info(`[Qdrant] Collection "${this.collectionName}" exists (dim=${existingDim})`);
      } else {
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.dimension,
            distance: 'Cosine',
          },
        });

        // Create payload indices for metadata filtering
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'documentId',
          field_schema: 'keyword',
        });
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'courseId',
          field_schema: 'keyword',
        });
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'lessonId',
          field_schema: 'keyword',
        });
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'sourceType',
          field_schema: 'keyword',
        });
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'learningPathId',
          field_schema: 'keyword',
        });

        logger.info(`[Qdrant] Created collection "${this.collectionName}" (dim=${this.dimension}, distance=Cosine)`);
      }
    } catch (error: any) {
      logger.error(`[Qdrant] Initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upsert embedded chunks into Qdrant.
   * Uses deterministic point IDs for idempotent operations.
   */
  async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    const points = chunks.map(chunk => ({
      id: this.generatePointId(chunk.documentId, chunk.chunkIndex),
      vector: chunk.vector,
      payload: {
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        title: chunk.metadata.title || '',
        sourceType: chunk.metadata.sourceType || '',
        courseId: chunk.metadata.courseId || '',
        lessonId: chunk.metadata.lessonId || '',
        learningPathId: chunk.metadata.learningPathId || '',
        skills: chunk.metadata.skills || [],
        language: chunk.metadata.language || '',
        version: chunk.metadata.version || 1,
        // RAG-PDF-01: where the chunk comes from in a lesson file (only present for file documents)
        ...pickLocation(chunk.metadata),
      },
    }));

    // Upsert in batches of 100
    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: batch,
      });
    }

    logger.info(`[Qdrant] Upserted ${chunks.length} points`);
  }

  /**
   * Delete all vectors belonging to a document.
   */
  async deleteByDocument(documentId: string): Promise<void> {
    await this.client.delete(this.collectionName, {
      wait: true,
      filter: {
        must: [
          { key: 'documentId', match: { value: documentId } },
        ],
      },
    });
    logger.info(`[Qdrant] Deleted all points for document ${documentId}`);
  }

  /**
   * Semantic search without metadata filtering.
   * Uses Qdrant v1.12+ `query()` API.
   */
  async search(
    queryVector: number[],
    options: SearchOptions,
  ): Promise<RetrievedChunk[]> {
    const results = await this.client.query(this.collectionName, {
      query: queryVector,
      limit: options.topK,
      score_threshold: options.scoreThreshold,
      with_payload: true,
    });

    return (results.points || []).map((r: any) => this.toRetrievedChunk(r));
  }

  /**
   * Semantic search with metadata filtering.
   * Uses Qdrant v1.12+ `query()` API.
   */
  async searchByFilter(
    queryVector: number[],
    filter: MetadataFilter,
    options: SearchOptions,
  ): Promise<RetrievedChunk[]> {
    const qdrantFilter = this.buildFilter(filter);

    const results = await this.client.query(this.collectionName, {
      query: queryVector,
      limit: options.topK,
      score_threshold: options.scoreThreshold,
      filter: qdrantFilter,
      with_payload: true,
    });

    return (results.points || []).map((r: any) => this.toRetrievedChunk(r));
  }

  /**
   * Generate a deterministic UUID for a chunk.
   * Same documentId + chunkIndex always produces the same UUID.
   */
  private generatePointId(documentId: string, chunkIndex: number): string {
    return uuidv5(`${documentId}_${chunkIndex}`, QDRANT_UUID_NAMESPACE);
  }

  /**
   * Convert Qdrant query result to RetrievedChunk.
   */
  private toRetrievedChunk(result: any): RetrievedChunk {
    const payload = result.payload || {};
    return {
      chunkId: `${payload.documentId}_chunk_${payload.chunkIndex ?? 0}`,
      documentId: payload.documentId || '',
      chunkIndex: payload.chunkIndex ?? 0,
      content: payload.content || '',
      score: result.score || 0,
      metadata: {
        title: payload.title,
        sourceType: payload.sourceType,
        courseId: payload.courseId,
        lessonId: payload.lessonId,
        learningPathId: payload.learningPathId,
        skills: payload.skills,
        language: payload.language,
        version: payload.version,
        ...pickLocation(payload),
      },
    };
  }

  /**
   * Build Qdrant filter from MetadataFilter.
   */
  private buildFilter(filter: MetadataFilter): any {
    const must: any[] = [];

    if (filter.courseId) {
      must.push({ key: 'courseId', match: { value: filter.courseId } });
    }
    if (filter.lessonId) {
      must.push({ key: 'lessonId', match: { value: filter.lessonId } });
    }
    if (filter.learningPathId) {
      must.push({ key: 'learningPathId', match: { value: filter.learningPathId } });
    }
    if (filter.sourceType) {
      must.push({ key: 'sourceType', match: { value: filter.sourceType } });
    }
    if (filter.skills && filter.skills.length > 0) {
      for (const skill of filter.skills) {
        must.push({ key: 'skills', match: { value: skill } });
      }
    }

    if (must.length === 0) {
      return undefined;
    }

    return { must };
  }
}
