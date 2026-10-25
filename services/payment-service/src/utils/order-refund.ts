/**
 * Internal payment status / refund API for the order-service (FIX 07B-2A.1) - request checks and the shapes it answers.
 *
 * Both routes are called with ORDER_PAYMENT_TOKEN only (no user identity is forged); the order-service has already checked that the
 * signed-in user owns the order. Here the payment must belong to THAT order (Payment.orderId), and a refund request carries its own
 * idempotency key so that a retry never creates a second refund.
 */
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9:_-]{8,128}$/;

export type RefundRejection =
  | 'INVALID_REQUEST'
  | 'CURRENCY_MISMATCH'
  | 'PAYMENT_PROVIDER_UNKNOWN'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'REFUND_IN_PROGRESS'
  | 'REFUND_NOT_ALLOWED';

export class OrderRefundRejectedError extends Error {
  constructor(readonly code: RefundRejection, readonly httpStatus: number, message = 'Refund request rejected') {
    super(message);
    this.name = 'OrderRefundRejectedError';
  }
}

export const isObjectId = (v: unknown): v is string => typeof v === 'string' && OBJECT_ID.test(v);

export interface OrderRefundRequest {
  paymentId: string;
  orderId: string;
  amount: number;
  currency?: string;
  reason?: string;
  idempotencyKey: string;
}

/** Shape check of the body; business checks (ownership, remaining amount, provider) happen against the stored payment. */
export function parseOrderRefundRequest(body: any): OrderRefundRequest {
  const b = body && typeof body === 'object' ? body : {};
  const amount = b.amount;
  if (!isObjectId(b.paymentId) || !isObjectId(b.orderId)) throw new OrderRefundRejectedError('INVALID_REQUEST', 400, 'paymentId and orderId are required');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new OrderRefundRejectedError('INVALID_REQUEST', 400, 'amount must be a positive number');
  if (typeof b.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(b.idempotencyKey)) throw new OrderRefundRejectedError('INVALID_REQUEST', 400, 'idempotencyKey is required (8-128 characters: letters, digits, : _ -)');
  if (b.currency !== undefined && (typeof b.currency !== 'string' || !b.currency.trim())) throw new OrderRefundRejectedError('INVALID_REQUEST', 400, 'currency must be a string');
  if (b.reason !== undefined && typeof b.reason !== 'string') throw new OrderRefundRejectedError('INVALID_REQUEST', 400, 'reason must be a string');
  return { paymentId: b.paymentId, orderId: b.orderId, amount, currency: b.currency, reason: b.reason, idempotencyKey: b.idempotencyKey };
}

/** The refund provider a payment allows, from the stored payment only; null when it is not clear (never guessed). */
export function refundProviderOf(payment: { provider?: unknown; stripePaymentIntentId?: unknown; payosOrderCode?: unknown }): 'stripe' | 'payos' | null {
  const has = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  if (payment.provider === 'stripe' && has(payment.stripePaymentIntentId) && !has(payment.payosOrderCode)) return 'stripe';
  if (payment.provider === 'payos' && !has(payment.stripePaymentIntentId)) return 'payos';
  return null;
}

/** Key stored on the Refund row (unique) and sent to Stripe: the same request key always maps to the same refund. */
export const refundIdempotencyKey = (requestKey: string) => `order_refund:${requestKey}`;

/**
 * What a refund row means for the caller (FIX 07B-2A.2): SUCCEEDED and FAILED are definite (a FAILED row is only written when Stripe
 * rejected the request or reported the refund failed); PENDING is "not finished" - awaiting the provider, an admin, or a retry.
 */
export type RefundOutcome = 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'UNVERIFIED';

export const refundOutcome = (status: unknown): RefundOutcome =>
  status === 'SUCCEEDED' ? 'SUCCEEDED' : status === 'FAILED' ? 'FAILED' : 'PENDING';

export const refundView = (r: any) => ({
  id: r.id,
  paymentId: r.paymentId,
  orderId: r.orderId ?? null,
  amount: r.amount,
  currency: r.currency,
  status: r.status,
  createdAt: r.createdAt,
  completedAt: r.completedAt ?? null,
});

/** Fields of a payment the order-service needs - no payer data, card / provider ids, client secrets, checkout links or metadata. */
export const paymentStatusView = (p: any) => ({
  id: p.id,
  orderId: p.orderId ?? null,
  status: p.status,
  provider: p.provider ?? null,
  amount: p.amount,
  currency: p.currency,
  refundedTotal: p.refundedTotal ?? 0,
  completedAt: p.completedAt ?? null,
  updatedAt: p.updatedAt ?? null,
});

/**
 * ADMIN-DASHBOARD-01: batch payment evidence for the order-service's sales statistics (ORDER_PAYMENT_TOKEN only, read-only).
 * The body is `{ orderIds: string[] }`: 1..MAX_EVIDENCE_ORDER_IDS distinct 24-hex ids; anything else is rejected, never trimmed.
 */
export const MAX_EVIDENCE_ORDER_IDS = 200;

export function parsePaymentEvidenceRequest(body: any): string[] {
  const ids = body && typeof body === 'object' ? body.orderIds : undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_EVIDENCE_ORDER_IDS || !ids.every(isObjectId)) {
    throw new OrderRefundRejectedError('INVALID_REQUEST', 400, `orderIds must be 1-${MAX_EVIDENCE_ORDER_IDS} order ids`);
  }
  return Array.from(new Set(ids.map((id: string) => id.toLowerCase())));
}

/** What the sales statistics need about one stored payment: its state as stored, amounts, no client secrets or provider ids. */
export const paymentEvidenceView = (p: any) => ({
  id: p.id,
  orderId: p.orderId ?? null,
  status: p.status,
  provider: p.provider ?? null,
  amount: p.amount,
  currency: p.currency,
  refundedTotal: p.refundedTotal ?? 0,
  completedAt: p.completedAt ?? null,
});
