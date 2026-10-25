import axios from 'axios';
import { RAGError, describeError } from '../errors';
import { MetadataFilter } from '../types';
import logger from '../../../utils/logger';

/**
 * RAG-P0 — who may read / manage the RAG documents of a course.
 *
 * Nothing the client sends (courseId, lessonId, filter, role) grants anything: it only names the course the request is about.
 * The decision is made from server-side answers, with the caller's OWN token, through the APIs the rest of UMI already uses:
 *   - course-service  GET /api/courses/:courseId              -> the course, its instructorId and its lessons
 *                     (404 unknown, 403 unpublished for a stranger - the course-service's own visibility rules)
 *   - learning-service GET /api/learning/progress/course/:id  -> data != null when the caller is enrolled
 *                     (the same enrollment check the course-service uses for lesson files, FIX-INS-07)
 * Role comes from req.user.role, which authenticateToken read from the user-service (not from the request).
 *
 *   ADMIN                       read + manage every course
 *   the course's instructor     read + manage that course
 *   an enrolled learner         read that course
 *   anyone else                 nothing (403)
 *
 * Fail-closed: a course-service / learning-service outage or timeout is ACCESS_CHECK_FAILED (503), never "allowed".
 */
export interface RAGRequester {
  userId: string;
  role?: string;
  token: string;
}

export interface CourseLesson {
  id: string;
  title?: string;
  description?: string | null;
  resources?: unknown;
  [key: string]: unknown;
}

export interface CourseAccess {
  courseId: string;
  canRead: boolean;
  canManage: boolean;
  /** How access was granted - for logs and tests. */
  via: 'ADMIN' | 'OWNER' | 'ENROLLED' | 'NONE';
  lessons: CourseLesson[];
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TIMEOUT_MS = 5000;

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

export class RAGAccessService {
  private courseServiceUrl(): string {
    return process.env.COURSE_SERVICE_URL || 'http://course-service:3003';
  }

  private learningServiceUrl(): string {
    return process.env.LEARNING_SERVICE_URL || 'http://learning-service:3006';
  }

  /**
   * Resolve what the requester may do with the RAG documents of `courseId`.
   * Throws RAGError for an invalid / unknown / hidden course or when access cannot be verified.
   */
  async resolveCourseAccess(requester: RAGRequester, courseId: unknown): Promise<CourseAccess> {
    if (courseId === undefined || courseId === null || courseId === '') throw new RAGError('COURSE_ID_REQUIRED');
    if (!isObjectId(courseId)) throw new RAGError('INVALID_COURSE_ID');
    if (!requester?.userId || !requester.token) throw new RAGError('COURSE_ACCESS_DENIED', 'no authenticated requester');

    const course = await this.fetchCourse(courseId, requester.token);
    const lessons: CourseLesson[] = Array.isArray(course.lessons)
      ? course.lessons.filter((l: any) => l && typeof l.id === 'string')
      : [];

    if (requester.role === 'ADMIN') {
      return { courseId, canRead: true, canManage: true, via: 'ADMIN', lessons };
    }
    if (typeof course.instructorId === 'string' && course.instructorId === requester.userId) {
      return { courseId, canRead: true, canManage: true, via: 'OWNER', lessons };
    }
    if (await this.isEnrolled(courseId, requester.token)) {
      return { courseId, canRead: true, canManage: false, via: 'ENROLLED', lessons };
    }
    return { courseId, canRead: false, canManage: false, via: 'NONE', lessons: [] };
  }

  /** Read access or 403. */
  async requireRead(requester: RAGRequester, courseId: unknown): Promise<CourseAccess> {
    const access = await this.resolveCourseAccess(requester, courseId);
    if (!access.canRead) throw new RAGError('COURSE_ACCESS_DENIED', `user ${requester.userId} cannot read course ${access.courseId}`);
    return access;
  }

  /** Manage access (index / list / delete documents) or 403. */
  async requireManage(requester: RAGRequester, courseId: unknown): Promise<CourseAccess> {
    const access = await this.resolveCourseAccess(requester, courseId);
    if (!access.canManage) throw new RAGError('COURSE_ACCESS_DENIED', `user ${requester.userId} cannot manage course ${access.courseId}`);
    return access;
  }

  /** The lesson, when it belongs to the course (lesson list from the course-service, never from the client). */
  requireLesson(access: CourseAccess, lessonId: unknown): CourseLesson {
    if (!isObjectId(lessonId)) throw new RAGError('INVALID_LESSON_ID');
    const lesson = access.lessons.find((l) => l.id === lessonId);
    if (!lesson) throw new RAGError('LESSON_NOT_IN_COURSE', `lesson ${lessonId} is not in course ${access.courseId}`);
    return lesson;
  }

  private async fetchCourse(courseId: string, token: string): Promise<any> {
    try {
      const response = await axios.get(`${this.courseServiceUrl()}/api/courses/${courseId}`, {
        timeout: TIMEOUT_MS,
        headers: { Authorization: `Bearer ${token}` },
      });
      const course = response.data?.data;
      if (!course || typeof course !== 'object') throw new RAGError('COURSE_NOT_FOUND');
      return course;
    } catch (error: any) {
      if (error instanceof RAGError) throw error;
      const status = error?.response?.status;
      if (status === 404 || status === 400) throw new RAGError('COURSE_NOT_FOUND');
      if (status === 401 || status === 403) throw new RAGError('COURSE_ACCESS_DENIED', `course-service answered HTTP ${status}`);
      logger.warn(`[RAGAccess] course lookup failed for course ${courseId}: ${describeError(error)}`);
      throw new RAGError('ACCESS_CHECK_FAILED', 'course-service unavailable');
    }
  }

  private async isEnrolled(courseId: string, token: string): Promise<boolean> {
    try {
      const response = await axios.get(`${this.learningServiceUrl()}/api/learning/progress/course/${courseId}`, {
        timeout: TIMEOUT_MS,
        headers: { Authorization: `Bearer ${token}` },
      });
      return !!response.data?.data;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status && status >= 400 && status < 500) return false;
      logger.warn(`[RAGAccess] enrollment check failed for course ${courseId}: ${describeError(error)}`);
      throw new RAGError('ACCESS_CHECK_FAILED', 'learning-service unavailable');
    }
  }
}

export const ragAccessService = new RAGAccessService();

/**
 * The retrieval scope of a read request (chat / search), VERIFIED.
 *
 * The client names a course (`courseId`, or `filter.courseId` for the former body shape) and optionally a lesson of it.
 * Access is decided above (ADMIN / course instructor / enrolled learner); the lesson must belong to that course according
 * to the course-service. Every other filter key (sourceType, learningPathId, skills...) is ignored: the returned filter only
 * contains server-verified values.
 */
export async function resolveReadScope(requester: RAGRequester, body: any): Promise<MetadataFilter> {
  const filter = body?.filter && typeof body.filter === 'object' ? body.filter : {};
  const courseId = pickOne(body?.courseId, filter.courseId, 'INVALID_COURSE_ID');
  const lessonId = pickOne(body?.lessonId, filter.lessonId, 'INVALID_LESSON_ID');

  const access = await ragAccessService.requireRead(requester, courseId);
  const scope: MetadataFilter = { courseId: access.courseId };
  if (lessonId !== undefined) {
    scope.lessonId = ragAccessService.requireLesson(access, lessonId).id;
  }
  return scope;
}

/** One value given in two places; both present and different is refused (no guessing which one was meant). */
export function pickOne(a: unknown, b: unknown, code: 'INVALID_COURSE_ID' | 'INVALID_LESSON_ID'): unknown {
  const present = (v: unknown) => v !== undefined && v !== null && v !== '';
  if (present(a) && present(b) && a !== b) throw new RAGError(code, 'conflicting values');
  return present(a) ? a : present(b) ? b : undefined;
}
