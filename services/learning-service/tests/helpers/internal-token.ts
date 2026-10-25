import { randomBytes } from 'node:crypto';

/**
 * The notification client (src/services/user-notification.client.ts) refuses to send anything without INTERNAL_SERVICE_TOKEN
 * (FIX 06C-4B2A). Tests that exercise a notifying code path give the process a fresh random secret instead of a literal one,
 * so no token value lives in the source or in a fixture. Returns the secret so a test can check it is the one that was sent.
 */
export function useRandomInternalToken(): string {
  const token = randomBytes(24).toString('hex');
  process.env.INTERNAL_SERVICE_TOKEN = token;
  return token;
}

/**
 * FIX-INS-06: the learning -> course internal calls (lessons, recommendations) refuse to send anything without
 * COURSE_LEARNING_TOKEN. Tests that drive those code paths (with a stubbed course-service) give the process a fresh random
 * value, so no token lives in the source. Returns it so a test can check it is the one that was sent.
 */
export function useRandomCourseLearningToken(): string {
  const token = randomBytes(32).toString('hex');
  process.env.COURSE_LEARNING_TOKEN = token;
  return token;
}
