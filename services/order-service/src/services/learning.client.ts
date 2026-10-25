import axios from 'axios';
import logger from '../utils/logger';
import { readServiceToken, SERVICE_TOKEN_HEADER } from '../utils/service-token';

/**
 * Order <-> Learning credential (FIX-INS-04), the SAME value in order-service and learning-service:
 *   - sent by this client to POST /api/learning/internal/courses/:courseId/enroll;
 *   - checked by GET /api/orders/internal/:orderId/entitlement, which the learning-service calls back to confirm that the order
 *     is PAID, belongs to the learner and grants the course before it writes any enrollment.
 * Without a usable value nothing is sent (no fallback to INTERNAL_SERVICE_TOKEN, a default or ""); the course is then simply not
 * granted on this run, exactly as when the learning-service is down.
 */
export const ORDER_LEARNING_TOKEN = 'ORDER_LEARNING_TOKEN';

export type EnrollResult = { ok: true; created: boolean } | { ok: false; reason: string };

export class LearningEnrollmentClient {
  /** created = a new enrollment was written (201); false = the learner was already enrolled (200, idempotent retry). */
  static async enroll(courseId: string, userId: string, orderId: string): Promise<EnrollResult> {
    const token = readServiceToken(ORDER_LEARNING_TOKEN);
    if (!token.ok) {
      logger.error(`Not enrolling user ${userId} in course ${courseId} (order ${orderId}): ${token.reason}`);
      return { ok: false, reason: token.reason };
    }
    const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
    try {
      const response = await axios.post(
        `${learningServiceUrl}/api/learning/internal/courses/${courseId}/enroll`,
        { userId, orderId },
        { timeout: 10000, headers: { [SERVICE_TOKEN_HEADER]: token.value } }
      );
      return { ok: true, created: response.status === 201 };
    } catch (error: any) {
      // never the error object itself: an axios error carries the request headers, i.e. the token
      const status = error?.response?.status;
      const reason = status ? `HTTP ${status}` : String(error?.code || error?.message || 'unknown error').split(token.value).join('[redacted]');
      logger.error(`Failed to enroll user ${userId} in course ${courseId} (order ${orderId}): ${reason}`);
      return { ok: false, reason };
    }
  }
}
