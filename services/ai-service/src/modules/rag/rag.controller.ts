import { Response } from 'express';
import { RAGService } from './rag.service';
import { SourceType, DocumentMetadata } from './types';
import { AuthRequest } from '../../middleware/auth.middleware';
import { ragAccessService, resolveReadScope, pickOne, CourseAccess } from './access/rag-access.service';
import { DocumentLoader } from './ingestion/document-loader';
import { RAGError } from './errors';
import { requesterFrom, sendRAGError } from './http';
import { findLessonFile, downloadLessonFile, lessonFileKeys } from './files/lesson-file.service';
import { extractFile } from './files/file-extractor';

const SOURCE_TYPES: SourceType[] = ['LESSON', 'COURSE', 'TRANSCRIPT', 'PDF', 'MARKDOWN', 'DOCUMENT', 'CODE'];
const DOCUMENT_STATUSES = ['ACTIVE', 'ARCHIVED', 'INDEXING', 'ERROR'];
const MAX_SEARCH_TOP_K = 10;

const isNonEmptyString = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * A source (sourceType + sourceId) is versioned in place by the ingestion: re-indexing it ARCHIVES the current document.
 * It may therefore only be re-indexed for the course it already belongs to (no overwriting another course's document).
 */
async function guardSource(sourceType: SourceType, sourceId: string, courseId: string): Promise<void> {
  const existing = await RAGService.getInstance().findActiveDocumentBySource(sourceType, sourceId);
  if (existing && (existing.metadata as any)?.courseId !== courseId) {
    throw new RAGError('SOURCE_BELONGS_TO_OTHER_COURSE', `${sourceType}/${sourceId} is indexed for another course`);
  }
}

/** Only server-verified scope keys plus harmless descriptive ones; anything else the client sent is dropped. */
function buildMetadata(access: CourseAccess, lessonId: string | undefined, raw: any): DocumentMetadata {
  const metadata: DocumentMetadata = { courseId: access.courseId };
  if (lessonId) metadata.lessonId = lessonId;
  if (Array.isArray(raw?.skills)) {
    const skills = raw.skills.filter((s: unknown) => isNonEmptyString(s, 100));
    if (skills.length > 0) metadata.skills = skills;
  }
  if (isNonEmptyString(raw?.language, 20)) metadata.language = raw.language;
  return metadata;
}

function documentSummary(document: any) {
  return {
    id: document.id,
    sourceType: document.sourceType,
    sourceId: document.sourceId,
    title: document.title,
    version: document.version,
    status: document.status,
    chunkCount: document.chunkCount,
    contentHash: document.contentHash,
    lastIndexedAt: document.lastIndexedAt,
  };
}

/**
 * RAG Controller — REST endpoints for RAG Foundation.
 *
 * RAG-P0 access rules (RAGAccessService, never what the client claims):
 *   - search: ADMIN, the course's instructor or an enrolled learner, inside ONE verified course
 *   - index / list / delete: ADMIN, or the instructor of the document's course (requireAdmin only lets ADMIN/INSTRUCTOR in)
 * Health endpoint is public.
 */
export class RAGController {
  /**
   * GET /api/ai/rag/health
   * Public health check for RAG subsystem.
   */
  static async health(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const ragService = RAGService.getInstance();
      const healthData = await ragService.health();
      res.json({ success: true, data: healthData });
    } catch (error: any) {
      res.json({
        success: false,
        data: { status: 'error', message: 'RAG health check failed' },
      });
    }
  }

  /**
   * POST /api/ai/rag/index/document
   * Ingest a knowledge document of a course with content provided in the request body.
   * Body: sourceType, sourceId, content, title?, courseId (or metadata.courseId), lessonId? (or metadata.lessonId), metadata?
   */
  static async indexDocument(req: AuthRequest, res: Response): Promise<void> {
    try {
      const requester = requesterFrom(req);
      if (!requester) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = req.body || {};

      if (!SOURCE_TYPES.includes(body.sourceType) || !isNonEmptyString(body.sourceId)) {
        res.status(400).json({
          success: false,
          error: `sourceType (${SOURCE_TYPES.join(', ')}) and sourceId are required`,
        });
        return;
      }

      if (typeof body.content !== 'string' || body.content.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'content is required and cannot be empty',
        });
        return;
      }

      const sourceType = body.sourceType as SourceType;
      const access = await ragAccessService.requireManage(
        requester,
        pickOne(body.courseId, body.metadata?.courseId, 'INVALID_COURSE_ID'),
      );

      let lessonId = pickOne(body.lessonId, body.metadata?.lessonId, 'INVALID_LESSON_ID') as string | undefined;
      // A LESSON source IS a lesson of this course; a COURSE source IS this course.
      if (sourceType === 'LESSON') {
        if (lessonId !== undefined && lessonId !== body.sourceId) throw new RAGError('INVALID_LESSON_ID', 'lessonId differs from sourceId');
        lessonId = body.sourceId;
      }
      if (lessonId !== undefined) lessonId = ragAccessService.requireLesson(access, lessonId).id;
      if (sourceType === 'COURSE' && body.sourceId !== access.courseId) {
        throw new RAGError('INVALID_COURSE_ID', 'a COURSE source must be the course itself');
      }

      await guardSource(sourceType, body.sourceId, access.courseId);

      const ragService = RAGService.getInstance();
      const document = await ragService.ingest(
        sourceType,
        body.sourceId,
        body.content,
        isNonEmptyString(body.title, 300) ? body.title : undefined,
        buildMetadata(access, lessonId, body.metadata),
      );

      res.status(201).json({ success: true, data: documentSummary(document) });
    } catch (error: any) {
      sendRAGError(res, error, 'RAG Controller indexDocument', 'INDEXING_FAILED');
    }
  }

  /**
   * POST /api/ai/rag/index/lesson-file — RAG-PDF-01 / RAG-PDF-02
   * Ingest one PDF file of a lesson. Body: courseId, lessonId, fileKey. (The DOCX extractor exists but the flow is PDF-only.)
   * The file must be the lesson's own upload (videoUrl) or one of its resources, stored in the course bucket
   * (findLessonFile); it is downloaded from the
   * course-service with the caller's token. One document per file: sourceId = "<lessonId>:<fileKey>" (several files of a
   * lesson do not replace each other, nor the lesson description indexed by /index/lesson).
   */
  static async indexLessonFile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const requester = requesterFrom(req);
      if (!requester) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = req.body || {};

      const access = await ragAccessService.requireManage(requester, body.courseId);
      const lesson = ragAccessService.requireLesson(access, body.lessonId);
      const file = findLessonFile(lesson, body.fileKey);

      // RAG-PDF-02: PDF only for now (DOCX postponed) - refused before the download when the stored name says so,
      // and again from the real bytes after it
      if (/\.(docx?|odt|rtf)$/i.test(file.key)) throw new RAGError('ONLY_PDF_SUPPORTED', file.key);
      const bytes = await downloadLessonFile(file, access.courseId, requester);
      const extracted = await extractFile(bytes);
      if (extracted.kind !== 'PDF') throw new RAGError('ONLY_PDF_SUPPORTED', `${extracted.kind} file`);

      const sourceType: SourceType = extracted.kind;
      const sourceId = `${lesson.id}:${file.key}`;
      await guardSource(sourceType, sourceId, access.courseId);

      const metadata: DocumentMetadata = {
        courseId: access.courseId,
        lessonId: lesson.id,
        fileKey: file.key,
        fileName: file.fileName,
        fileType: extracted.kind,
        ...(extracted.stats.pages !== undefined ? { pageCount: extracted.stats.pages } : {}),
        ...(extracted.stats.paragraphs !== undefined ? { paragraphCount: extracted.stats.paragraphs } : {}),
      };
      const segments = extracted.segments.map((s) => ({ text: s.text, metadata: { ...s.location } }));

      const ragService = RAGService.getInstance();
      const document = await ragService.ingestFile(sourceType, sourceId, file.fileName, metadata, segments);

      // RAG-PDF-02: a re-uploaded lesson file gets a new key; the documents of files the lesson no longer refers to
      // would keep answering with the old content - they are removed (MongoDB + Qdrant) once the new file is indexed
      const current = new Set(lessonFileKeys(lesson));
      const stale = (await ragService.listDocuments(undefined, access.courseId)).filter((d: any) =>
        d.id !== document.id
        && (d.metadata as any)?.lessonId === lesson.id
        && typeof (d.metadata as any)?.fileKey === 'string'
        && !current.has((d.metadata as any).fileKey));
      for (const d of stale) await ragService.deleteDocument(d.id);

      res.status(201).json({
        success: true,
        data: {
          ...documentSummary(document),
          removedStaleDocuments: stale.map((d: any) => d.id),
          file: {
            fileKey: file.key,
            fileName: file.fileName,
            fileType: extracted.kind,
            ...extracted.stats,
            segments: extracted.segments.length,
          },
        },
      });
    } catch (error: any) {
      sendRAGError(res, error, 'RAG Controller indexLessonFile', 'INDEXING_FAILED');
    }
  }

  /**
   * POST /api/ai/rag/index/lesson
   * Ingest a lesson of a course. Body: courseId, lessonId, content?
   * Without content, the text is built from the lesson the course-service returned to the verified caller
   * (title, description, text resources).
   */
  static async indexLesson(req: AuthRequest, res: Response): Promise<void> {
    try {
      const requester = requesterFrom(req);
      if (!requester) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = req.body || {};

      if (!body.lessonId) {
        res.status(400).json({
          success: false,
          error: 'lessonId is required',
        });
        return;
      }

      const access = await ragAccessService.requireManage(requester, body.courseId);
      const lesson = ragAccessService.requireLesson(access, body.lessonId);

      await guardSource('LESSON', lesson.id, access.courseId);

      const content = typeof body.content === 'string' && body.content.trim().length > 0
        ? body.content
        : DocumentLoader.extractLessonContent(lesson);
      if (!content) {
        res.status(422).json({
          success: false,
          error: 'LESSON_CONTENT_NOT_AVAILABLE',
          message: `Bài học "${lesson.title || lesson.id}" chưa có nội dung văn bản (chỉ có video). Cần bổ sung nội dung trước khi lập chỉ mục.`,
        });
        return;
      }

      const ragService = RAGService.getInstance();
      const document = await ragService.ingest(
        'LESSON' as SourceType,
        lesson.id,
        content,
        typeof lesson.title === 'string' ? lesson.title : undefined,
        { courseId: access.courseId, lessonId: lesson.id },
      );

      res.status(201).json({ success: true, data: documentSummary(document) });
    } catch (error: any) {
      sendRAGError(res, error, 'RAG Controller indexLesson', 'INDEXING_FAILED');
    }
  }

  /**
   * DELETE /api/ai/rag/index/document/:id
   * Delete a knowledge document and all associated chunks/vectors — ADMIN, or the instructor of its course.
   */
  static async deleteDocument(req: AuthRequest, res: Response): Promise<void> {
    try {
      const requester = requesterFrom(req);
      if (!requester) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;

      const ragService = RAGService.getInstance();
      const document = await ragService.getDocument(id);
      if (!document) throw new RAGError('DOCUMENT_NOT_FOUND');

      const courseId = (document.metadata as any)?.courseId;
      if (courseId) {
        await ragAccessService.requireManage(requester, courseId);
      } else if (requester.role !== 'ADMIN') {
        // a document without a course (indexed before RAG-P0) is managed by ADMIN only
        throw new RAGError('COURSE_ACCESS_DENIED', 'document without courseId');
      }

      await ragService.deleteDocument(document.id);

      res.json({
        success: true,
        message: `Document ${document.id} deleted (MongoDB chunks + Qdrant vectors)`,
      });
    } catch (error: any) {
      sendRAGError(res, error, 'RAG Controller deleteDocument', 'DELETE_FAILED');
    }
  }

  /**
   * POST /api/ai/rag/search
   * Dense semantic search inside ONE course the caller may read (body: query, courseId or filter.courseId, lessonId?, topK?).
   * The client cannot widen the filter nor lower the RelevanceGate threshold.
   */
  static async search(req: AuthRequest, res: Response): Promise<void> {
    try {
      const requester = requesterFrom(req);
      if (!requester) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = req.body || {};

      if (typeof body.query !== 'string' || body.query.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'query is required',
        });
        return;
      }

      const scope = await resolveReadScope(requester, body);
      const requestedTopK = Number(body.topK);
      const topK = Number.isFinite(requestedTopK)
        ? Math.min(MAX_SEARCH_TOP_K, Math.max(1, Math.floor(requestedTopK)))
        : undefined;

      const ragService = RAGService.getInstance();
      const context = await ragService.retrieve(body.query, scope, topK);

      res.json({
        success: true,
        data: context,
      });
    } catch (error: any) {
      sendRAGError(res, error, 'RAG Controller search', 'SEARCH_FAILED');
    }
  }

  /**
   * GET /api/ai/rag/documents?courseId=&status=
   * ADMIN: all documents (or one course). INSTRUCTOR: the documents of a course they teach (courseId required).
   */
  static async listDocuments(req: AuthRequest, res: Response): Promise<void> {
    try {
      const requester = requesterFrom(req);
      if (!requester) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const status = typeof req.query.status === 'string' && DOCUMENT_STATUSES.includes(req.query.status)
        ? req.query.status
        : undefined;
      const courseId = req.query.courseId;

      let scopeCourseId: string | undefined;
      if (courseId !== undefined && courseId !== '') {
        scopeCourseId = (await ragAccessService.requireManage(requester, courseId)).courseId;
      } else if (requester.role !== 'ADMIN') {
        throw new RAGError('COURSE_ID_REQUIRED');
      }

      const ragService = RAGService.getInstance();
      const documents = await ragService.listDocuments(status, scopeCourseId);

      res.json({
        success: true,
        data: {
          documents,
          total: documents.length,
        },
      });
    } catch (error: any) {
      sendRAGError(res, error, 'RAG Controller listDocuments', 'LIST_FAILED');
    }
  }
}
