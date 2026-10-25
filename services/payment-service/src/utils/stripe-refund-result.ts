/**
 * What a Stripe answer proves about a refund (FIX 07B-2A.2).
 *
 *   a refund object       its status decides: succeeded -> SUCCEEDED, failed / canceled -> FAILED, anything else -> PENDING
 *   a rejected request    Stripe refused it (4xx card / invalid request / authentication / permission error): nothing was refunded,
 *                         and with the same idempotency key Stripe will give the same answer again -> a DEFINITE failure
 *   everything else       timeout, connection reset, 5xx, rate limit, idempotency conflict, an unknown error: it is NOT known whether
 *                         money moved -> UNVERIFIED (keep the reservation, retry with the SAME key and parameters, or let the webhook tell)
 */
export type StripeRefundVerdict = 'SUCCEEDED' | 'FAILED' | 'PENDING';

export function verdictFromStripeRefund(refund: { status?: unknown }): StripeRefundVerdict {
  if (refund.status === 'succeeded') return 'SUCCEEDED';
  if (refund.status === 'failed' || refund.status === 'canceled') return 'FAILED';
  return 'PENDING';
}

const DEFINITE_REJECTIONS = new Set(['StripeCardError', 'StripeInvalidRequestError', 'StripeAuthenticationError', 'StripePermissionError']);

/** true only when Stripe itself answered that the refund request is rejected */
export function isDefiniteStripeRejection(error: any): boolean {
  const type = error?.stripeType ?? error?.type;
  return typeof type === 'string' && DEFINITE_REJECTIONS.has(type);
}
