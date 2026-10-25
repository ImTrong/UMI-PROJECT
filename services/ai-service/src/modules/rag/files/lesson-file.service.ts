import axios from 'axios';
import { RAGError, describeError } from '../errors';
import { CourseLesson, RAGRequester } from '../access/rag-access.service';
import { maxFileBytes } from './file-extractor';
import logger from '../../../utils/logger';

/**
 * RAG-PDF-01 — the lesson files the RAG may read, and how they are fetched.
 *
 * Where files live (course-service, FIX-INS-07): uploaded through POST /api/courses/:courseId/upload-url into the storage bucket
 * "courses"; a lesson refers to a file by its `videoUrl` (the lesson upload: a video or a PDF) or a resource `fileUrl` / `url`,
 * of the form
 *   /api/courses/files/download?bucket=courses&key=<key>
 * and GET /api/courses/files/download only serves a key that some course / lesson record references, to ADMIN, the course's
 * instructor or an enrolled learner.
 *
 * So the client names a file only by its key, and that key must be one of the resources of the lesson as the course-service
 * returned it to the (already verified) instructor / admin. No URL from the client is ever fetched: the file is downloaded
 * from the course-service's own download route, with the caller's own token (the course-service re-checks access), with a
 * size limit and a timeout. Resources pointing anywhere else (external links) are not indexable.
 */
export const DOWNLOAD_BUCKET = 'courses';
const KEY_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const DOWNLOAD_TIMEOUT_MS = 30000;

export interface LessonFile {
  key: string;
  bucket: string;
  /** display name: the resource title / name, else the key */
  fileName: string;
  declaredType?: string;
}

export function isValidFileKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_FORMAT.test(key) && !key.includes('..');
}

/** bucket + key of a stored download reference ("/api/courses/files/download?bucket=..&key=.."), else null. */
export function parseDownloadRef(value: unknown): { bucket: string; key: string } | null {
  if (typeof value !== 'string' || !value.includes('/api/courses/files/download')) return null;
  const query = value.split('?')[1];
  if (!query) return null;
  const params = new URLSearchParams(query);
  const bucket = params.get('bucket');
  const key = params.get('key');
  return bucket && key ? { bucket, key } : null;
}

function resourcesOf(lesson: CourseLesson): any[] {
  const raw = lesson.resources;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Every file of the course bucket the lesson currently refers to: its main file (`videoUrl` - the lesson upload of
 * LessonManager stores a video OR a PDF there, RAG-PDF-02) and its resources.
 */
export function lessonFileKeys(lesson: CourseLesson): string[] {
  const refs = [lesson.videoUrl, ...resourcesOf(lesson).flatMap((r) => (r && typeof r === 'object' ? [r.fileUrl, r.url] : []))]
    .map(parseDownloadRef)
    .filter((ref): ref is { bucket: string; key: string } => !!ref && ref.bucket === DOWNLOAD_BUCKET && isValidFileKey(ref.key));
  return [...new Set(refs.map((ref) => ref.key))];
}

/** The lesson's main file or resource that stores the file `key` in the course bucket, or RESOURCE_NOT_FOUND. */
export function findLessonFile(lesson: CourseLesson, key: unknown): LessonFile {
  if (!isValidFileKey(key)) throw new RAGError('INVALID_FILE_KEY');
  // RAG-PDF-02: the existing lesson upload (LessonManager) keeps the uploaded PDF in videoUrl, with a generated key
  // ("<timestamp>-<uuid>.pdf"): the lesson title is the readable name
  const main = parseDownloadRef(lesson.videoUrl);
  if (main && main.bucket === DOWNLOAD_BUCKET && main.key === key) {
    const ext = key.split('.').pop()?.toLowerCase();
    const title = typeof lesson.title === 'string' && lesson.title.trim() ? lesson.title.trim().slice(0, 200) : key;
    return { key, bucket: main.bucket, fileName: ext === 'pdf' ? `${title} (PDF)` : title, declaredType: ext };
  }
  for (const resource of resourcesOf(lesson)) {
    if (!resource || typeof resource !== 'object') continue;
    const ref = parseDownloadRef(resource.fileUrl) ?? parseDownloadRef(resource.url);
    if (ref && ref.bucket === DOWNLOAD_BUCKET && ref.key === key) {
      const name = [resource.title, resource.name].find((v) => typeof v === 'string' && v.trim());
      const declaredType = [resource.fileType, resource.type].find((v) => typeof v === 'string' && v.trim());
      return { key, bucket: ref.bucket, fileName: (name as string | undefined)?.trim().slice(0, 200) || key, declaredType };
    }
  }
  throw new RAGError('RESOURCE_NOT_FOUND', `no resource of lesson ${lesson.id} stores ${key}`);
}

/** The file bytes, through the course-service download route, as the caller. */
export async function downloadLessonFile(file: LessonFile, courseId: string, requester: RAGRequester): Promise<Uint8Array> {
  const base = process.env.COURSE_SERVICE_URL || 'http://course-service:3003';
  const limit = maxFileBytes();
  try {
    const response = await axios.get<ArrayBuffer>(`${base}/api/courses/files/download`, {
      params: { bucket: file.bucket, key: file.key, courseId },
      headers: { Authorization: `Bearer ${requester.token}` },
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: limit,
      maxBodyLength: limit,
      maxRedirects: 0,
    });
    return new Uint8Array(response.data);
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) throw new RAGError('COURSE_ACCESS_DENIED', `download refused (HTTP ${status})`);
    if (status === 404) throw new RAGError('RESOURCE_NOT_FOUND', 'the course-service has no such file');
    if (/maxContentLength/i.test(String(error?.message))) throw new RAGError('FILE_TOO_LARGE', `over ${limit} bytes`);
    logger.warn(`[RAGFile] download of a lesson file failed: ${describeError(error)}`);
    throw new RAGError('FILE_DOWNLOAD_FAILED');
  }
}
