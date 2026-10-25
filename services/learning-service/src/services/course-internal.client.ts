import { readServiceToken, SERVICE_TOKEN_HEADER } from '../utils/service-token';

/**
 * Course <-> Learning credential (FIX-INS-03 / FIX-INS-06), the SAME value in learning-service and course-service. Since
 * FIX-INS-06 it also authenticates THIS service on the course-service's internal routes:
 *   GET  /api/courses/internal/:courseId/lessons[/:lessonId]   (every lesson WITH its videoUrl)
 *   GET  /api/courses/internal/lessons/:lessonId/owner        (lesson -> course -> instructorId, FIX-INS-10)
 *   POST /api/courses/recommendations/batch
 * Without a usable value nothing is sent (no fallback to INTERNAL_SERVICE_TOKEN, a default or ""): the error thrown here is caught
 * by each caller exactly like a course-service outage.
 */
export const COURSE_LEARNING_TOKEN = 'COURSE_LEARNING_TOKEN';

export class CourseAuthNotConfiguredError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CourseAuthNotConfiguredError';
  }
}

/** Headers for a learning -> course internal call; throws (nothing is sent) without a usable token. */
export function courseInternalHeaders(): Record<string, string> {
  const token = readServiceToken(COURSE_LEARNING_TOKEN);
  if (!token.ok) throw new CourseAuthNotConfiguredError(token.reason);
  return { [SERVICE_TOKEN_HEADER]: token.value };
}
