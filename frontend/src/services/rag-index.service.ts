import { aiApi } from './api';

/**
 * RAG-PDF-02 — let the course instructor (or ADMIN) make a lesson's uploaded PDF readable by the lesson assistant.
 *
 *   POST /api/ai/rag/index/lesson-file { courseId, lessonId, fileKey }
 *   201 { success: true, data: { id, version, status, chunkCount, removedStaleDocuments, file: { fileType, pages, pagesWithText } } }
 *   error { success: false, error: CODE, message: <Vietnamese> }  (PDF_NO_TEXT_LAYER, ONLY_PDF_SUPPORTED, FILE_TOO_LARGE, ...)
 *
 * The file is identified only by the storage key of the lesson's own upload (`videoUrl`); the backend checks that key
 * against the lesson the course-service returns, and the caller's right to manage the course.
 */
const DOWNLOAD_PATH = '/api/courses/files/download';

/** Storage key of the lesson's uploaded PDF (videoUrl "/api/courses/files/download?bucket=courses&key=<key>.pdf"), else null. */
export function lessonPdfKey(videoUrl: string | null | undefined): string | null {
  if (typeof videoUrl !== 'string' || !videoUrl.includes(DOWNLOAD_PATH)) return null;
  const params = new URLSearchParams(videoUrl.split('?')[1] || '');
  const key = params.get('key');
  if (params.get('bucket') !== 'courses' || !key || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(key)) return null;
  return key.toLowerCase().endsWith('.pdf') ? key : null;
}

export interface LessonIndexResult {
  chunkCount: number;
  version: number;
  pages?: number;
  pagesWithText?: number;
}

export class LessonIndexError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'LessonIndexError';
  }
}

const FALLBACK = 'Không lập chỉ mục được tài liệu lúc này. Vui lòng thử lại sau.';

export const ragIndexService = {
  indexLessonPdf: async (courseId: string, lessonId: string, fileKey: string): Promise<LessonIndexResult> => {
    try {
      const response = await aiApi.post('/api/ai/rag/index/lesson-file', { courseId, lessonId, fileKey });
      const data = response.data?.data;
      return { chunkCount: data?.chunkCount ?? 0, version: data?.version ?? 1, pages: data?.file?.pages, pagesWithText: data?.file?.pagesWithText };
    } catch (error: any) {
      const body = error?.response?.data;
      // only the backend's own Vietnamese message (RAGError bodies) is shown, never a technical text
      const message = body?.success === false && typeof body?.message === 'string' ? body.message : FALLBACK;
      throw new LessonIndexError(message, typeof body?.error === 'string' ? body.error : undefined, error?.response?.status);
    }
  },
};
