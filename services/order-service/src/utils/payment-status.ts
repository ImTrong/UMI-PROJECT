/**
 * Contract of the payment-service's confirmation answer, as seen by the order-service (FIX 07B-1.2).
 *
 * POST /api/payments/internal/confirm answers `{ message, data: Payment }`; `data.status` is the payment-service's PaymentStatus enum,
 * written exactly as stored: PENDING | PROCESSING | SUCCEEDED | FAILED | PARTIALLY_REFUNDED | REFUNDED | CANCELLED (upper case).
 * Stripe's own lower-case PaymentIntent statuses ('succeeded', ...) are never part of this answer, so they are NOT accepted as aliases:
 * anything outside the enum - another spelling, a missing or non-string status - is UNKNOWN and is never treated as a success.
 */
export const PAYMENT_SERVICE_STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED'] as const;
export type PaymentServiceStatus = (typeof PAYMENT_SERVICE_STATUSES)[number];

/** What a confirmation answer means for the order: paid, not decided yet, not paid, or not a confirmation outcome / unreadable. */
export type ConfirmationOutcome = 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'UNKNOWN';

export function classifyConfirmationStatus(status: unknown): ConfirmationOutcome {
  switch (status) {
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'PENDING':
    case 'PROCESSING':
      return 'PENDING';
    case 'FAILED':
    case 'CANCELLED':
      return 'FAILED';
    default:
      return 'UNKNOWN';   // includes REFUNDED / PARTIALLY_REFUNDED: not an answer to "did this payment go through now?"
  }
}

/**
 * For GET /api/orders/:orderId/payment-status (FIX 07B-2A.1): the stored status of the order's payment, in the same enum, grouped
 * for display. Refunds are reported as such; anything outside the enum is UNKNOWN (never a success).
 */
export type PaymentStatusOutcome = ConfirmationOutcome | 'REFUNDED';

export function describePaymentStatus(status: unknown): PaymentStatusOutcome {
  if (status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED') return 'REFUNDED';
  return classifyConfirmationStatus(status);
}
