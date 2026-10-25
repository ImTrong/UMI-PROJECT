import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { ERROR_MESSAGES, HTTP_STATUS } from '../utils/constants';
import { CourseDetails, LessonDetails } from '../types';
import logger from '../utils/logger';
import { courseInternalHeaders } from './course-internal.client';

const prisma = new PrismaClient();

const COURSE_SERVICE_TIMEOUT_MS = 5000;

/** 4xx means "course-service answered no"; timeouts / throttling (408, 425, 429) are transient, not a verdict. */
const isDefinitiveClientError = (status: unknown): boolean =>
  typeof status === 'number' && status >= 400 && status < 500 && ![408, 425, 429].includes(status);

export const ACCESS_ERROR_MESSAGES = {
  ENROLLMENT_REQUIRED: 'You must be enrolled in this course to perform this action.',
  PAID_COURSE: 'This is a paid course. Please purchase through the order service.',
  PRICE_UNVERIFIED: 'Course price could not be verified. Enrollment was not granted.',
  NOT_PUBLISHED: 'Course is not published',
  COURSE_SERVICE_UNAVAILABLE: 'Course service is unavailable. Please try again later.',
  COURSE_METADATA_INVALID: 'Course metadata could not be verified. Please try again later.',
  COURSE_NOT_APPROVED: 'Course is not approved for distribution',
} as const;

/**
 * Error carrying the HTTP status controllers should answer with.
 * Thrown whenever learning access is refused so that nothing is written.
 */
/** FIX-INS-10: who owns a lesson, as the course-service reports it. */
export interface LessonOwner {
  lessonId: string;
  courseId: string;
  instructorId: string;
}

export class CourseAccessError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'CourseAccessError';
  }
}

/**
 * A course is only considered free when course-service explicitly reports a
 * finite price of exactly 0 AND the course is published. A missing, null,
 * non-numeric or negative price is never treated as free.
 */
export const isVerifiedFreeCourse = (course: Partial<CourseDetails> | null | undefined): boolean =>
  !!course &&
  course.published === true &&
  typeof course.price === 'number' &&
  Number.isFinite(course.price) &&
  course.price === 0;

export class CourseAccessService {
  /**
   * Fetch course metadata from course-service.
   * 4xx -> course not found / not visible; anything else (network, 5xx, malformed)
   * -> service unavailable. Never falls back to guessed data.
   */
  static async fetchCourse(courseId: string): Promise<CourseDetails> {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    try {
      const response = await axios.get<{ data: CourseDetails }>(
        `${courseServiceUrl}/api/courses/${courseId}`,
        { timeout: COURSE_SERVICE_TIMEOUT_MS }
      );
      const course = response.data?.data;
      if (!course || typeof course !== 'object') {
        throw new CourseAccessError(ACCESS_ERROR_MESSAGES.COURSE_SERVICE_UNAVAILABLE, HTTP_STATUS.SERVICE_UNAVAILABLE);
      }
      return course;
    } catch (err: any) {
      if (err instanceof CourseAccessError) throw err;
      const status = err?.response?.status;
      if (isDefinitiveClientError(status)) {
        throw new CourseAccessError(ERROR_MESSAGES.COURSE_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
      }
      logger.warn(`Course lookup failed for ${courseId}: ${err?.message}`);
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.COURSE_SERVICE_UNAVAILABLE, HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
  }

  /**
   * Strictly verified course for point redemption. Every field is checked on the raw
   * course-service response; nothing is defaulted. Rejects BEFORE any wallet access.
   *  - id must echo the requested id
   *  - price must be a finite number >= 0 (validated only; it is NOT used to price points)
   *  - published === true AND approvalStatus === 'APPROVED' (independent conditions)
   */
  static async fetchRedeemableCourse(courseId: string): Promise<CourseDetails> {
    const course: any = await this.fetchCourse(courseId);

    const invalid = () =>
      new CourseAccessError(ACCESS_ERROR_MESSAGES.COURSE_METADATA_INVALID, HTTP_STATUS.SERVICE_UNAVAILABLE);

    if (typeof course.id !== 'string' || course.id !== courseId) throw invalid();
    if (typeof course.price !== 'number' || !Number.isFinite(course.price) || course.price < 0) throw invalid();
    if (typeof course.published !== 'boolean') throw invalid();
    if (typeof course.approvalStatus !== 'string' || !course.approvalStatus) throw invalid();

    if (course.published !== true) {
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.NOT_PUBLISHED, HTTP_STATUS.FORBIDDEN);
    }
    if (course.approvalStatus !== 'APPROVED') {
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.COURSE_NOT_APPROVED, HTTP_STATUS.FORBIDDEN);
    }
    return course as CourseDetails;
  }

  /**
   * Lessons of a course from course-service. Fails closed (never returns a guessed list).
   */
  static async fetchCourseLessons(courseId: string): Promise<LessonDetails[]> {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    try {
      const response = await axios.get<{ data: LessonDetails[] }>(
        `${courseServiceUrl}/api/courses/internal/${courseId}/lessons`,
        { timeout: COURSE_SERVICE_TIMEOUT_MS, headers: courseInternalHeaders() }
      );
      return Array.isArray(response.data?.data) ? response.data.data : [];
    } catch (err: any) {
      const status = err?.response?.status;
      if (isDefinitiveClientError(status)) {
        throw new CourseAccessError(ERROR_MESSAGES.COURSE_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
      }
      logger.warn(`Lesson lookup failed for ${courseId}: ${err?.message}`);
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.COURSE_SERVICE_UNAVAILABLE, HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
  }

  /**
   * FIX-INS-10 - the course a lesson REALLY belongs to and that course's owner, from the course-service internal route
   * (COURSE_LEARNING_TOKEN), whatever the course status (draft / pending / unpublished). null only when the course-service says
   * the lesson or its course does not exist (404); anything else - wrong token, outage, malformed answer - is a 503, never a guess.
   */
  static async fetchLessonOwner(lessonId: string): Promise<LessonOwner | null> {
    if (typeof lessonId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(lessonId)) return null;
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    const unavailable = () => new CourseAccessError(ACCESS_ERROR_MESSAGES.COURSE_SERVICE_UNAVAILABLE, HTTP_STATUS.SERVICE_UNAVAILABLE);
    let data: any;
    try {
      const response = await axios.get<{ data: LessonOwner }>(
        `${courseServiceUrl}/api/courses/internal/lessons/${lessonId}/owner`,
        { timeout: COURSE_SERVICE_TIMEOUT_MS, headers: courseInternalHeaders() }
      );
      data = response.data?.data;
    } catch (err: any) {
      if (err?.response?.status === HTTP_STATUS.NOT_FOUND) return null;
      logger.warn(`Lesson owner lookup failed (${err?.response?.status || err?.message || 'error'})`);
      throw unavailable();
    }
    if (!data || data.lessonId !== lessonId || typeof data.courseId !== 'string' || !data.courseId
      || typeof data.instructorId !== 'string' || !data.instructorId) {
      logger.warn('Lesson owner lookup: malformed course-service answer');
      throw unavailable();
    }
    return { lessonId: data.lessonId, courseId: data.courseId, instructorId: data.instructorId };
  }

  /** Server-side enrollment lookup: a CourseProgress row is the enrollment record. */
  static async findEnrollment(userId: string, courseId: string) {
    return prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
  }

  /** Read-only gate: refuse unless the user is already enrolled. Never creates anything. */
  static async requireEnrollment(userId: string, courseId: string) {
    const enrollment = await this.findEnrollment(userId, courseId);
    if (!enrollment) {
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.ENROLLMENT_REQUIRED, HTTP_STATUS.FORBIDDEN);
    }
    return enrollment;
  }
}
