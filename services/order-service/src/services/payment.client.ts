import axios from 'axios';
import logger from '../utils/logger';
import { readServiceToken, SERVICE_TOKEN_HEADER } from '../utils/service-token';

export interface CreatePaymentIntentRequest {
  orderId: string;
  orderNumber: string;
  userId: string;
  amount: number;
  currency: string;
  description: string;
}

export interface CreatePayosPaymentRequest {
  orderId: string;
  orderNumber: string;
  orderCode: number;
  userId: string;
  amount: number;
  description: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  regenerate?: boolean;
}

export interface PaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
}

export interface PayosPaymentResult {
  paymentId: string;
  checkoutUrl: string;
  qrCode: string;
  orderCode: number;
}

/** GET /api/payments/internal/payment-status/:paymentId - minimal view (FIX 07B-2A.1) */
export interface InternalPaymentStatus {
  id: string;
  orderId: string | null;
  status: string;
  provider: string | null;
  amount: number;
  currency: string;
  refundedTotal: number;
  completedAt: string | null;
  updatedAt: string | null;
}

/** POST /api/payments/internal/payment-evidence - the stored course-purchase payments of several orders (ADMIN-DASHBOARD-01) */
export interface InternalPaymentEvidence {
  id: string;
  orderId: string | null;
  status: string;
  provider: string | null;
  amount: number;
  currency: string;
  refundedTotal: number;
  completedAt: string | null;
}

export const PAYMENT_EVIDENCE_BATCH = 200;

export interface InternalRefundRequest {
  paymentId: string;
  orderId: string;
  amount: number;
  currency?: string;
  reason?: string;
  idempotencyKey: string;
}

export interface InternalRefundResult {
  outcome: 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'REJECTED' | 'UNVERIFIED';
  httpStatus: number | null;
  refund: { id: string; paymentId: string; orderId: string | null; amount: number; currency: string; status: string } | null;
  replayed?: boolean;
  error?: string;
}

export class PaymentClient {
  private static baseUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3005';

  /**
   * The Order <-> Payment credential (FIX 07B-2A), read at call time. Without a usable ORDER_PAYMENT_TOKEN this throws BEFORE any
   * request is sent (each caller's catch then answers as it always did): no fallback to INTERNAL_SERVICE_TOKEN, a default or "".
   */
  private static getInternalHeaders() {
    const token = readServiceToken('ORDER_PAYMENT_TOKEN');
    if (!token.ok) {
      throw new Error(`Payment service call not sent: ${token.reason}`);
    }
    return { [SERVICE_TOKEN_HEADER]: token.value };
  }

  static async createPaymentIntent(data: CreatePaymentIntentRequest): Promise<PaymentIntent> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/payments/internal/create-intent`,
        {
          orderId: data.orderId,
          orderNumber: data.orderNumber,
          userId: data.userId,
          amount: data.amount,
          currency: data.currency,
          description: data.description,
          provider: 'stripe',
        },
        { headers: this.getInternalHeaders() }
      );

      logger.info(`Payment intent created for order ${data.orderNumber}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to create payment intent:', error.response?.data || error.message);
      throw new Error('Payment service unavailable');
    }
  }

  static async createPayosPayment(data: CreatePayosPaymentRequest): Promise<PayosPaymentResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/payments/internal/create-payos`,
        {
          orderId: data.orderId,
          orderNumber: data.orderNumber,
          orderCode: data.orderCode,
          userId: data.userId,
          amount: data.amount,
          description: data.description,
          items: data.items,
          regenerate: data.regenerate,
        },
        { headers: this.getInternalHeaders() }
      );

      logger.info(`PayOS payment created for order ${data.orderNumber}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to create payOS payment:', error.response?.data || error.message);
      throw new Error('PayOS payment service unavailable');
    }
  }

  static async cancelPayosPayment(orderCode: number | string, reason?: string) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/payments/internal/cancel-payos`,
        { orderCode: String(orderCode), reason },
        { headers: this.getInternalHeaders() }
      );
      return response.data.data;
    } catch (error: any) {
      logger.warn(`Failed to cancel payOS payment ${orderCode}:`, error.response?.data || error.message);
      return null;
    }
  }

  static async confirmPayment(paymentIntentId: string, paymentMethodId: string) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/payments/internal/confirm`,
        { paymentIntentId, paymentMethodId },
        { headers: this.getInternalHeaders() }
      );

      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to confirm payment:', error.response?.data || error.message);
      throw new Error('Payment confirmation failed');
    }
  }

  /**
   * Status of the payment of one order (FIX 07B-2A.1): internal route, ORDER_PAYMENT_TOKEN - no user JWT is forwarded or forged.
   * null when the payment-service has no payment for that order; throws for anything else (incl. no usable token: nothing sent).
   */
  static async getPaymentStatus(paymentId: string, orderId: string): Promise<InternalPaymentStatus | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/payments/internal/payment-status/${encodeURIComponent(paymentId)}`, {
        params: { orderId },
        headers: this.getInternalHeaders(),
      });
      return response.data.data;
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      logger.error('Failed to get payment status:', error.response?.data || error.message);
      throw new Error('Payment status check failed');
    }
  }

  /**
   * What the payment-service has stored for these orders (ADMIN-DASHBOARD-01), asked in batches. Read-only. Throws when any batch
   * cannot be answered (no usable token: nothing is sent): a sales figure must never be built on payments that were not checked.
   */
  static async getPaymentEvidence(orderIds: string[]): Promise<InternalPaymentEvidence[]> {
    const headers = this.getInternalHeaders();
    const evidence: InternalPaymentEvidence[] = [];
    for (let i = 0; i < orderIds.length; i += PAYMENT_EVIDENCE_BATCH) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/api/payments/internal/payment-evidence`,
          { orderIds: orderIds.slice(i, i + PAYMENT_EVIDENCE_BATCH) },
          { headers }
        );
        if (!Array.isArray(response.data?.data)) throw new Error('unreadable answer');
        evidence.push(...response.data.data);
      } catch (error: any) {
        logger.error(`Failed to get payment evidence: ${error.response?.status ? `HTTP ${error.response.status}` : error.code || error.message}`);
        throw new Error('Payment evidence check failed');
      }
    }
    return evidence;
  }

  /**
   * Refund the payment of one order (FIX 07B-2A.1) through the payment-service's existing refund process: internal route,
   * ORDER_PAYMENT_TOKEN. The same idempotencyKey on a retry returns the same refund. Never throws for an HTTP / network error - the
   * outcome says what is known: SUCCEEDED / PENDING / FAILED as verified by the payment-service, REJECTED (4xx), or UNVERIFIED (provider or
   * network failure: it is NOT known whether money moved, so nothing may be concluded from it).
   */
  static async refundPayment(request: InternalRefundRequest): Promise<InternalRefundResult> {
    let headers: Record<string, string>;
    try {
      headers = this.getInternalHeaders();
    } catch (error: any) {
      logger.error(`Refund request not sent: ${error.message}`);
      return { outcome: 'UNVERIFIED', httpStatus: null, refund: null, error: 'Refund request not sent' };
    }
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/internal/create-refund`, request, { headers });
      const data = response.data?.data;
      // FAILED: Stripe rejected the refund or reported it failed (FIX 07B-2A.2) - definite, nothing was refunded
      const outcome = data?.outcome === 'SUCCEEDED' || data?.outcome === 'PENDING' || data?.outcome === 'FAILED' ? data.outcome : 'UNVERIFIED';
      return { outcome, httpStatus: response.status, refund: data?.refund ?? null, replayed: data?.replayed === true };
    } catch (error: any) {
      const status = error.response?.status;
      const body = error.response?.data;
      logger.error(`Refund request for order ${request.orderId} failed: ${status ? `HTTP ${status} ${body?.code ?? ''}` : error.code || error.message}`);
      if (status && status >= 400 && status < 500) return { outcome: 'REJECTED', httpStatus: status, refund: null, error: body?.code || body?.error || 'rejected' };
      return { outcome: 'UNVERIFIED', httpStatus: status ?? null, refund: null, error: body?.code || 'not verified' };
    }
  }
}
