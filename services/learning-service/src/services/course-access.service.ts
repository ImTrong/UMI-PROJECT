import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { ERROR_MESSAGES, HTTP_STATUS } from '../utils/constants';
import { CourseDetails, LessonDetails } from '../types';
import logger from '../utils/logger';

const prisma = new PrismaClient();

const COURSE_SERVICE_TIMEOUT_MS = 5000;

export const ACCESS_ERROR_MESSAGES = {
  ENROLLMENT_REQUIRED: 'You must be enrolled in this course to perform this action.',
  PAID_COURSE: 'This is a paid course. Please purchase through the order service.',
  PRICE_UNVERIFIED: 'Course price could not be verified. Enrollment was not granted.',
  NOT_PUBLISHED: 'Course is not published',
  COURSE_SERVICE_UNAVAILABLE: 'Course service is unavailable. Please try again later.',
} as const;

/**
 * Error carrying the HTTP status controllers should answer with.
 * Thrown whenever learning access is refused so that nothing is written.
 */
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
      if (typeof status === 'number' && status >= 400 && status < 500) {
        throw new CourseAccessError(ERROR_MESSAGES.COURSE_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
      }
      logger.warn(`Course lookup failed for ${courseId}: ${err?.message}`);
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.COURSE_SERVICE_UNAVAILABLE, HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
  }

  /**
   * Lessons of a course from course-service. Fails closed (never returns a guessed list).
   */
  static async fetchCourseLessons(courseId: string): Promise<LessonDetails[]> {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    try {
      const response = await axios.get<{ data: LessonDetails[] }>(
        `${courseServiceUrl}/api/courses/internal/${courseId}/lessons`,
        { timeout: COURSE_SERVICE_TIMEOUT_MS }
      );
      return Array.isArray(response.data?.data) ? response.data.data : [];
    } catch (err: any) {
      const status = err?.response?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        throw new CourseAccessError(ERROR_MESSAGES.COURSE_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
      }
      logger.warn(`Lesson lookup failed for ${courseId}: ${err?.message}`);
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.COURSE_SERVICE_UNAVAILABLE, HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
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
