import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { DocumentLoader } from './document-loader';
import { DocumentCleaner } from './document-cleaner';
import { RecursiveChunker } from '../chunking/recursive-chunker';
import { IEmbeddingService, IVectorStore, EmbeddedChunk, SourceType, DocumentMetadata } from '../types';
import { RAGConfig } from '../rag.config';
import logger from '../../../utils/logger';

/** The KnowledgeDocument / DocumentChunk operations this service uses (the Prisma client in production). */
export type IngestionStore = Pick<PrismaClient, 'knowledgeDocument' | 'documentChunk'>;

/**
 * RAG-PDF-01: a part of a document with its own location (PDF page, DOCX paragraph range). Each segment is cleaned and
 * chunked on its own, and its metadata is added to every chunk it produces.
 */
export interface IngestSegment {
  text: string;
  metadata: Record<string, unknown>;
}

/**
 * IngestionService — orchestrates the full ingestion pipeline.
 *
 * Flow:
 *   Content → Clean → Chunk → Embed → Validate → Store in Qdrant → Persist in MongoDB
 *   (with segments: each segment → Clean → Chunk, chunk indexes numbered across the whole document)
 *
 * Safety guarantees:
 * 1. Idempotency via contentHash — same content = no-op
 * 2. Versioning — changed content creates new version, old version archived AFTER success
 * 3. Safe re-index — old ACTIVE data remains searchable until new version is fully indexed
 * 4. Fail-fast — dimension mismatch or embedding failure stops before corrupting state
 */
export class IngestionService {
  private loader: DocumentLoader;
  private chunker: RecursiveChunker;
  private embeddingService: IEmbeddingService;
  private vectorStore: IVectorStore;
  private db: IngestionStore;

  constructor(
    config: RAGConfig,
    embeddingService: IEmbeddingService,
    vectorStore: IVectorStore,
    db?: IngestionStore,
  ) {
    this.loader = new DocumentLoader(config);
    this.chunker = new RecursiveChunker(config.chunkSize, config.chunkOverlap);
    this.embeddingService = embeddingService;
    this.vectorStore = vectorStore;
    this.db = db ?? new PrismaClient();
  }

  /**
   * Ingest a knowledge document: load → clean → chunk → embed → store.
   *
   * @returns The created/updated KnowledgeDocument record
   */
  async ingestDocument(
    sourceType: SourceType,
    sourceId: string,
    providedContent?: string,
    providedTitle?: string,
    metadata?: DocumentMetadata,
    segments?: IngestSegment[],
  ): Promise<any> {
    logger.info(`[Ingestion] Starting ingestion: sourceType=${sourceType}, sourceId=${sourceId}`);

    // RAG-PDF-01: cleaned segments (empty ones dropped) - the document content is their concatenation
    const cleanedSegments = segments
      ?.map((s) => ({ text: DocumentCleaner.clean(s.text), metadata: s.metadata }))
      .filter((s) => s.text.trim().length > 0);
    if (segments && (!cleanedSegments || cleanedSegments.length === 0)) {
      throw new Error('Document content is empty after cleaning');
    }

    // 1. Load content
    const rawDoc = await this.loader.load(
      sourceType,
      sourceId,
      cleanedSegments ? cleanedSegments.map((s) => s.text).join('\n\n') : providedContent,
      providedTitle,
      metadata,
    );

    // 2. Clean content
    const cleanedContent = DocumentCleaner.clean(rawDoc.content);
    if (!cleanedContent || cleanedContent.trim().length === 0) {
      throw new Error('Document content is empty after cleaning');
    }

    // 3. Compute content hash for idempotency (with segments: their locations too, so a page change is a new version)
    const contentHash = crypto
      .createHash('sha256')
      .update(cleanedSegments ? JSON.stringify(cleanedSegments.map((s) => [s.text, s.metadata])) : cleanedContent)
      .digest('hex');

    // 4. Check for existing document with same source
    const existing = await this.db.knowledgeDocument.findFirst({
      where: {
        sourceType,
        sourceId,
        status: { in: ['ACTIVE', 'INDEXING'] },
      },
      orderBy: { version: 'desc' },
    });

    // 4a. Same content, already indexed — no-op
    if (existing && existing.contentHash === contentHash && existing.status === 'ACTIVE') {
      logger.info(`[Ingestion] Content unchanged (hash match). Skipping. docId=${existing.id}`);
      return existing;
    }

    // 5. Determine version
    const newVersion = existing ? existing.version + 1 : 1;

    // 6. Create new KnowledgeDocument in INDEXING status
    const doc = await this.db.knowledgeDocument.create({
      data: {
        sourceType,
        sourceId,
        title: rawDoc.title,
        content: cleanedContent,
        contentHash,
        metadata: rawDoc.metadata as any,
        version: newVersion,
        status: 'INDEXING',
        chunkCount: 0,
      },
    });

    logger.info(`[Ingestion] Created document: id=${doc.id}, version=${newVersion}`);

    try {
      // 7. Chunk (per segment when the document has segments; chunk indexes numbered across the document)
      const chunks = cleanedSegments
        ? cleanedSegments
          .flatMap((s) => this.chunker.chunk(s.text, doc.id, rawDoc.title, sourceType, newVersion, { ...rawDoc.metadata, ...s.metadata }))
          .map((chunk, i) => ({ ...chunk, chunkIndex: i }))
        : this.chunker.chunk(
          cleanedContent,
          doc.id,
          rawDoc.title,
          sourceType,
          newVersion,
          rawDoc.metadata,
        );

      if (chunks.length === 0) {
        throw new Error('Chunking produced 0 chunks');
      }

      // 8. Generate embeddings for all chunks
      logger.info(`[Ingestion] Generating embeddings for ${chunks.length} chunks...`);
      const chunkTexts = chunks.map(c => c.content);
      const embeddings = await this.embeddingService.embedDocuments(chunkTexts);

      // 9. Validate all embeddings have correct dimension
      const expectedDim = this.embeddingService.getDimension();
      for (let i = 0; i < embeddings.length; i++) {
        if (embeddings[i].length !== expectedDim) {
          throw new Error(
            `Embedding dimension mismatch at chunk ${i}: expected ${expectedDim}, got ${embeddings[i].length}`,
          );
        }
      }

      // 10. Build embedded chunks
      const embeddedChunks: EmbeddedChunk[] = chunks.map((chunk, i) => ({
        documentId: doc.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        vector: embeddings[i],
        metadata: chunk.metadata,
      }));

      // 11. Store in Qdrant (new vectors)
      await this.vectorStore.upsert(embeddedChunks);

      // 12. Persist chunks in MongoDB
      await Promise.all(
        chunks.map((chunk, i) =>
          this.db.documentChunk.create({
            data: {
              documentId: doc.id,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              metadata: chunk.metadata as any,
              vectorId: `${doc.id}_${chunk.chunkIndex}`,
            },
          }),
        ),
      );

      // 13. Update document status to ACTIVE
      await this.db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: 'ACTIVE',
          chunkCount: chunks.length,
          lastIndexedAt: new Date(),
        },
      });

      // 14. Archive old version AFTER new one is fully indexed
      // This ensures old data remains searchable during indexing
      if (existing && existing.id !== doc.id) {
        // Delete old vectors from Qdrant
        await this.vectorStore.deleteByDocument(existing.id);
        // Delete old chunks from MongoDB
        await this.db.documentChunk.deleteMany({ where: { documentId: existing.id } });
        // Archive old document
        await this.db.knowledgeDocument.update({
          where: { id: existing.id },
          data: { status: 'ARCHIVED' },
        });
        logger.info(`[Ingestion] Archived previous version: id=${existing.id}, v=${existing.version}`);
      }

      logger.info(
        `[Ingestion] Successfully indexed: docId=${doc.id}, chunks=${chunks.length}, version=${newVersion}`,
      );

      return await this.db.knowledgeDocument.findUnique({ where: { id: doc.id } });
    } catch (error: any) {
      // Safe failure: mark new doc as ERROR, old ACTIVE data remains untouched
      logger.error(`[Ingestion] Failed for docId=${doc.id}: ${error.message}`);

      await this.db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: 'ERROR',
          errorMessage: error.message,
        },
      });

      // Clean up any partial Qdrant data for the failed doc
      try {
        await this.vectorStore.deleteByDocument(doc.id);
      } catch { /* best effort cleanup */ }

      // Clean up any partial MongoDB chunks
      try {
        await this.db.documentChunk.deleteMany({ where: { documentId: doc.id } });
      } catch { /* best effort cleanup */ }

      throw error;
    }
  }

  /**
   * Delete a knowledge document and all its chunks/vectors.
   */
  async deleteDocument(documentId: string): Promise<void> {
    logger.info(`[Ingestion] Deleting document: ${documentId}`);

    // Delete from Qdrant
    await this.vectorStore.deleteByDocument(documentId);

    // Delete chunks from MongoDB
    await this.db.documentChunk.deleteMany({ where: { documentId } });

    // Delete document from MongoDB
    await this.db.knowledgeDocument.delete({ where: { id: documentId } });

    logger.info(`[Ingestion] Deleted document ${documentId} (MongoDB + Qdrant)`);
  }
}
