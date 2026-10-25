import axios from 'axios';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

/**
 * FIX-INS-07 - who may download a file through GET /api/courses/files/download.
 *
 * The bucket / key / courseId in the request prove nothing. The file is identified by what THIS service stored:
 *   - `courses` is the only bucket this endpoint serves (the one /api/courses/:courseId/upload-url writes to);
 *   - the key must be referenced, as `/api/courses/files/download?bucket=courses&key=<key>`, by a course thumbnail, a lesson's
 *     videoUrl or a lesson resource (fileUrl / url). An unreferenced key is refused (fail closed).
 * Every reference must allow the caller (the most restrictive one wins), so re-using a paid lesson's key as a thumbnail or as a
 * preview of another course cannot make that file public:
 *   - course thumbnail                         public (images are rendered by <img>, which cannot send credentials)
 *   - lesson file, lesson.isPreview + course published   public (the existing preview policy)
 *   - any other lesson file                    ADMIN, the course's instructor, or a learner enrolled in that course (the
 *                                              same rule as GET /api/courses/:courseId/lessons/:lessonId)
 */
export const DOWNLOAD_BUCKET = 'courses';
const KEY_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export type FileReference = { kind: 'THUMBNAIL'; courseId: string } | { kind: 'LESSON'; courseId: string; lessonId: string; isPreview: boolean };
export type FileDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 403 | 404; reason: string };

export interface Requester {
  userId: string;
  role?: string;
  token?: string;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** bucket + key of a stored download URL, or null when the string is not one of ours. */
export function parseDownloadRef(value: unknown): { bucket: string; key: string } | null {
  if (typeof value !== 'string' || !value.includes('/api/courses/files/download')) return null;
  const q = value.split('?')[1];
  if (!q) return null;
  const params = new URLSearchParams(q);
  const bucket = params.get('bucket');
  const key = params.get('key');
  return bucket && key ? { bucket, key } : null;
}

const refersTo = (value: unknown, key: string) => {
  const ref = parseDownloadRef(value);
  return !!ref && ref.bucket === DOWNLOAD_BUCKET && ref.key === key;
};

export class FileAccessService {
  static isValidRequest(bucket: unknown, key: unknown): key is string {
    return bucket === DOWNLOAD_BUCKET && typeof key === 'string' && KEY_FORMAT.test(key) && !key.includes('..');
  }

  /** Every course / lesson record that references this key (server-side data only). */
  static async findReferences(key: string): Promise<FileReference[]> {
    const refs: FileReference[] = [];

    const courses = await prisma.course.findMany({
      where: { thumbnail: { contains: key } },
      select: { id: true, thumbnail: true },
    });
    for (const c of courses) if (refersTo(c.thumbnail, key)) refs.push({ kind: 'THUMBNAIL', courseId: c.id });

    const lessons = await prisma.lesson.findMany({
      where: { videoUrl: { contains: key } },
      select: { id: true, courseId: true, isPreview: true, videoUrl: true },
    });
    for (const l of lessons) if (refersTo(l.videoUrl, key)) refs.push({ kind: 'LESSON', courseId: l.courseId, lessonId: l.id, isPreview: !!l.isPreview });

    // lesson resources are a JSON list ({ fileUrl | url, ... }): matched in the database, then re-checked exactly here
    const pattern = `key=${escapeRegex(key)}(&|$)`;
    const raw = (await prisma.lesson.findRaw({
      filter: { $or: [{ 'resources.fileUrl': { $regex: pattern } }, { 'resources.url': { $regex: pattern } }] },
      options: { projection: { _id: 1, courseId: 1, isPreview: 1, resources: 1 } },
    })) as unknown as any[];
    for (const doc of Array.isArray(raw) ? raw : []) {
      const resources = Array.isArray(doc.resources) ? doc.resources : [];
      if (!resources.some((r: any) => r && (refersTo(r.fileUrl, key) || refersTo(r.url, key)))) continue;
      const lessonId = String(doc._id?.$oid ?? doc._id);
      const courseId = String(doc.courseId?.$oid ?? doc.courseId);
      if (!refs.some((r) => r.kind === 'LESSON' && r.lessonId === lessonId)) {
        refs.push({ kind: 'LESSON', courseId, lessonId, isPreview: !!doc.isPreview });
      }
    }
    return refs;
  }

  static async decide(key: string, requester: Requester | undefined, claimedCourseId?: string): Promise<FileDecision> {
    const refs = await this.findReferences(key);
    if (refs.length === 0) return { allowed: false, status: 404, reason: 'UNREFERENCED' };
    // a courseId in the request grants nothing; it may only narrow the request to the file's own course
    if (claimedCourseId !== undefined && !refs.some((r) => r.courseId === claimedCourseId)) {
      return { allowed: false, status: 404, reason: 'COURSE_MISMATCH' };
    }

    const courseIds = [...new Set(refs.map((r) => r.courseId))];
    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, instructorId: true, published: true },
    });
    const byId = new Map(courses.map((c) => [c.id, c]));
    const enrollment = new Map<string, Promise<boolean>>();

    for (const ref of refs) {
      if (ref.kind === 'THUMBNAIL') continue;
      const course = byId.get(ref.courseId);
      if (!course) return { allowed: false, status: 404, reason: 'COURSE_GONE' };
      if (ref.isPreview && course.published) continue;

      if (!requester) return { allowed: false, status: 401, reason: 'LOGIN_REQUIRED' };
      if (requester.role === 'ADMIN' || requester.userId === course.instructorId) continue;
      if (!enrollment.has(course.id)) enrollment.set(course.id, this.isEnrolled(course.id, requester));
      if (!(await enrollment.get(course.id))) return { allowed: false, status: 403, reason: 'NOT_ENROLLED' };
    }
    return { allowed: true };
  }

  /** The learner's own enrollment, asked with the learner's own token (same check as the lesson-detail route). */
  static async isEnrolled(courseId: string, requester: Requester): Promise<boolean> {
    if (!requester.token) return false;
    try {
      const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
      const response = await axios.get(`${learningServiceUrl}/api/learning/progress/course/${courseId}`, {
        timeout: 5000,
        headers: { Authorization: `Bearer ${requester.token}` },
      });
      return !!response.data?.data;
    } catch (error: any) {
      logger.warn(`Enrollment check for a file of course ${courseId} failed: ${error?.response?.status ? `HTTP ${error.response.status}` : error?.code || 'error'}`);
      return false;
    }
  }
}
