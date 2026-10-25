/**
 * Which payments POST /api/payments/confirm (and its internal twin) may touch - FIX 07B-1.2.
 *
 * The endpoint confirms a STRIPE PaymentIntent (or the Stripe demo flow). A payOS payment is completed only by the signed payOS
 * webhook (or the payOS demo route mock-complete), so it must never reach Stripe here - and must never be marked FAILED because
 * Stripe has no intent for it. The provider is read from the Payment document only (`provider`, plus `payosOrderCode` /
 * `stripePaymentIntentId` as consistency checks); nothing the client sends is used. When the document does not say clearly that it
 * is a Stripe payment, the request is refused before anything is written - the provider is never guessed.
 */
export type ConfirmationRejection = 'PAYMENT_PROVIDER_MISMATCH' | 'PAYMENT_PROVIDER_UNKNOWN' | 'STRIPE_INTENT_MISSING';

export class PaymentConfirmationRejectedError extends Error {
  constructor(readonly code: ConfirmationRejection) {
    super('Payment cannot be confirmed through this endpoint');
    this.name = 'PaymentConfirmationRejectedError';
  }
}

const present = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/** null when the payment is a Stripe payment this endpoint may confirm; otherwise the reason it may not. */
export function stripeConfirmationProblem(payment: { provider?: unknown; payosOrderCode?: unknown; stripePaymentIntentId?: unknown }): ConfirmationRejection | null {
  if (payment.provider === 'payos') return 'PAYMENT_PROVIDER_MISMATCH';
  if (payment.provider !== 'stripe') return 'PAYMENT_PROVIDER_UNKNOWN';         // missing, empty, other spelling, other provider
  if (present(payment.payosOrderCode)) return 'PAYMENT_PROVIDER_UNKNOWN';       // says stripe but carries a payOS order: contradictory
  if (payment.stripePaymentIntentId != null && !present(payment.stripePaymentIntentId)) return 'STRIPE_INTENT_MISSING';
  return null;
}
