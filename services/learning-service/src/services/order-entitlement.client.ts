import axios from 'axios';
import logger from '../utils/logger';
import { readServiceToken, SERVICE_TOKEN_HEADER } from '../utils/service-token';

/**
 * Order <-> Learning credential (FIX-INS-04), the SAME value in learning-service and order-service. It authenticates the
 * order-service on POST /api/learning/internal/courses/:courseId/enroll and THIS service on the order-service's read-only
 * GET /api/orders/internal/:orderId/entitlement.
 *
 * A valid token only proves WHICH service is calling; it does not prove a payment. So before writing an enrollment for a
 * purchase, the learning-service asks the order-service - the record of the payment webhook - whether that order is PAID, belongs
 * to that learner and grants that course. Nothing the caller says about the payment is believed.
 */
export const ORDER_LEARNING_TOKEN = 'ORDER_LEARNING_TOKEN';

/** The entitlement could not be checked (no usable token, order-service down, unexpected answer): nothing may be written. */
export class EntitlementUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntitlementUnavailableError';
  }
}

export class OrderEntitlementClient {
  static async check(orderId: string, userId: string, courseId: string): Promise<{ entitled: boolean; reason: string }> {
    const token = readServiceToken(ORDER_LEARNING_TOKEN);
    if (!token.ok) throw new EntitlementUnavailableError(token.reason);

    const orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:3004';
    let data: any;
    try {
      const response = await axios.get(`${orderServiceUrl}/api/orders/internal/${orderId}/entitlement`, {
        params: { userId, courseId },
        timeout: 5000,
        headers: { [SERVICE_TOKEN_HEADER]: token.value },
      });
      data = response.data?.data;
    } catch (error: any) {
      // never the error object itself: an axios error carries the request headers, i.e. the token
      const status = error?.response?.status;
      const reason = status ? `HTTP ${status}` : String(error?.code || error?.message || 'unknown error').split(token.value).join('[redacted]');
      logger.error(`Entitlement check for order ${orderId} / course ${courseId} failed: ${reason}`);
      throw new EntitlementUnavailableError(`entitlement check failed: ${reason}`);
    }
    if (!data || typeof data.entitled !== 'boolean') {
      throw new EntitlementUnavailableError('entitlement check returned an unexpected answer');
    }
    return { entitled: data.entitled === true, reason: typeof data.reason === 'string' ? data.reason : '' };
  }
}
