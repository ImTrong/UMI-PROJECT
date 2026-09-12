import { Request, Response } from 'express';
import { RAGService } from './rag.service';
import { SourceType, IngestDocumentRequest, IngestLessonRequest, RAGSearchRequest } from './types';
import logger from '../../utils/logger';

/**
 * RAG Controller — REST endpoints for RAG Foundation.
 *
 * Admin endpoints (document ingestion/management) should be protected by admin auth.
 * Search endpoint is available to authenticated users.
 * Health endpoint is public.
 */
export class RAGController {
  /**
   * GET /api/ai/rag/health
   * Public health check for RAG subsystem.
   */
  static async health(_req: Request, res: Response): Promise<void> {
    try {
      const ragService = RAGService.getInstance();
      const healthData = await ragService.health();
      res.json({ success: true, data: healthData });
    } catch (error: any) {
      res.json({
        success: false,
        data: { status: 'error', message: error.message },
      });
    }
  }

  /**
   * POST /api/ai/rag/index/document
   * Ingest a knowledge document with content provided in the request body.
   */
  static async indexDocument(req: Request, res: Response): Promise<void> {
    try {
      const body: IngestDocumentRequest = req.body;

      // Validate required fields
      if (!body.sourceType || !body.sourceId) {
        res.status(400).json({
          success: false,
          error: 'sourceType and sourceId are required',
        });
        return;
      }

      if (!body.content || body.content.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'content is required and cannot be empty',
        });
        return;
      }

      const ragService = RAGService.getInstance();
      const document = await ragService.ingest(
        body.sourceType,
        body.sourceId,
        body.content,
        body.title,
        body.metadata,
      );

      res.status(201).json({
        success: true,
        data: {
          id: document.id,
          sourceType: document.sourceType,
          sourceId: document.sourceId,
          title: document.title,
          version: document.version,
          status: document.status,
          chunkCount: document.chunkCount,
          contentHash: document.contentHash,
          lastIndexedAt: document.lastIndexedAt,
        },
      });
    } catch (error: any) {
      logger.error(`[RAG Controller] indexDocument failed: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * POST /api/ai/rag/index/lesson
   * Ingest a lesson. Optionally provide content; otherwise fetches from course-service.
   */
  static async indexLesson(req: Request, res: Response): Promise<void> {
    try {
      const body: IngestLessonRequest = req.body;

      if (!body.lessonId) {
        res.status(400).json({
          success: false,
          error: 'lessonId is required',
        });
        return;
      }

      const ragService = RAGService.getInstance();
      const document = await ragService.ingest(
        'LESSON' as SourceType,
        body.lessonId,
        body.content,
      );

      res.status(201).json({
        success: true,
        data: {
          id: document.id,
          sourceType: document.sourceType,
          sourceId: document.sourceId,
          title: document.title,
          version: document.version,
          status: document.status,
          chunkCount: document.chunkCount,
          lastIndexedAt: document.lastIndexedAt,
        },
      });
    } catch (error: any) {
      if (error.code === 'LESSON_CONTENT_NOT_AVAILABLE') {
        res.status(422).json({
          success: false,
          error: 'LESSON_CONTENT_NOT_AVAILABLE',
          message: error.message,
        });
        return;
      }
      logger.error(`[RAG Controller] indexLesson failed: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * DELETE /api/ai/rag/index/document/:id
   * Delete a knowledge document and all associated chunks/vectors.
   */
  static async deleteDocument(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'Document ID is required',
        });
        return;
      }

      const ragService = RAGService.getInstance();
      await ragService.deleteDocument(id);

      res.json({
        success: true,
        message: `Document ${id} deleted (MongoDB chunks + Qdrant vectors)`,
      });
    } catch (error: any) {
      logger.error(`[RAG Controller] deleteDocument failed: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * POST /api/ai/rag/search
   * Dense semantic search with optional metadata filtering.
   * Returns retrieved chunks with relevance scores.
   */
  static async search(req: Request, res: Response): Promise<void> {
    try {
      const body: RAGSearchRequest = req.body;

      if (!body.query || body.query.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'query is required',
        });
        return;
      }

      const ragService = RAGService.getInstance();
      const context = await ragService.retrieve(
        body.query,
        body.filter,
        body.topK,
        body.scoreThreshold,
      );

      res.json({
        success: true,
        data: context,
      });
    } catch (error: any) {
      logger.error(`[RAG Controller] search failed: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * GET /api/ai/rag/documents
   * List all indexed knowledge documents.
   */
  static async listDocuments(req: Request, res: Response): Promise<void> {
    try {
      const status = req.query.status as string | undefined;
      const ragService = RAGService.getInstance();
      const documents = await ragService.listDocuments(status);

      res.json({
        success: true,
        data: {
          documents,
          total: documents.length,
        },
      });
    } catch (error: any) {
      logger.error(`[RAG Controller] listDocuments failed: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}
