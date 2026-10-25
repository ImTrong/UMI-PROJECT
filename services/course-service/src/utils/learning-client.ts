import { readServiceToken, SERVICE_TOKEN_HEADER } from './service-token';

/**
 * Course <-> Learning credential (FIX-INS-03; since FIX-INS-06 it also guards this service's own internal lessons /
 * recommendations routes, called by the learning-service). The learning-service's per-course student-progress routes
 * (GET /api/learning/progress/course/:courseId/students[/:userId]) accept ONLY this token in X-Internal-Service-Token.
 * Without a usable value nothing is sent (no fallback to INTERNAL_SERVICE_TOKEN, a default or ""): each caller then fails
 * the way it already did when the learning-service could not answer.
 */
export const COURSE_LEARNING_TOKEN = 'COURSE_LEARNING_TOKEN';

export class LearningAuthNotConfiguredError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'LearningAuthNotConfiguredError';
  }
}

export function learningServiceAuthHeaders(): Record<string, string> {
  const token = readServiceToken(COURSE_LEARNING_TOKEN);
  if (!token.ok) throw new LearningAuthNotConfiguredError(token.reason);
  return { [SERVICE_TOKEN_HEADER]: token.value };
}

/** A log-safe description of a failed call: status or error code only - never the axios error, which carries the headers. */
export function describeCallError(error: any): string {
  if (error instanceof LearningAuthNotConfiguredError) return error.message;
  return error?.response?.status ? `HTTP ${error.response.status}` : String(error?.code || error?.message || 'unknown error');
}
