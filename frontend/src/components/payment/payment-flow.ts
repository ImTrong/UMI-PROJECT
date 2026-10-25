import { paymentService } from '../../services/payment.service';
import { ConfirmationCallbacks, deliverConfirmationResult, PaymentConfirmationResult } from '../../services/payment-confirmation';

/**
 * What the payment forms do once the user has paid (FIX 07B-1.3), kept apart from the JSX so it can be tested without a browser.
 * Each step asks the backend, then hands the answer to deliverConfirmationResult - the one place that decides between success,
 * "still processing / not verified" and failure. None of them marks an order paid: the payment webhook / outbox does that.
 */

/**
 * Card payment accepted by Stripe.js on the client: the backend syncs it; success is shown only if it answers SUCCEEDED.
 * It is confirmed by the Stripe intent Stripe.js just charged (POST /api/payments/confirm, the caller's own payment only), not
 * through the order: an order whose QR tab was opened points at its payOS payment, and confirming that one is refused (409
 * PAYMENT_PROVIDER_MISMATCH) although the card was charged. The payment-service tells the order service PAID (webhook / outbox).
 */
export async function syncCardPayment(
  _orderId: string,
  paymentMethodId: string,
  stripePaymentIntentId: string,
  callbacks: ConfirmationCallbacks,
  service: Pick<typeof paymentService, 'confirmPayment'> = paymentService
): Promise<PaymentConfirmationResult> {
  const result = await service.confirmPayment({ paymentIntentId: stripePaymentIntentId, paymentMethodId });
  deliverConfirmationResult(result, callbacks, stripePaymentIntentId);
  return result;
}

/** Demo payment (Stripe sandbox form and the payOS "simulate" button) - development only on the server side. */
export async function runDemoPayment(
  orderId: string,
  callbacks: ConfirmationCallbacks,
  service: Pick<typeof paymentService, 'simulateMockPayment'> = paymentService
): Promise<PaymentConfirmationResult> {
  const result = await service.simulateMockPayment(orderId);
  deliverConfirmationResult(result, callbacks, orderId);
  return result;
}

/** Instructor registration paid with Stripe.js: the backend confirms the intent; success only if it answers SUCCEEDED. */
export async function confirmInstructorPayment(
  stripePaymentIntentId: string,
  paymentMethodId: string,
  callbacks: ConfirmationCallbacks,
  service: Pick<typeof paymentService, 'confirmPayment'> = paymentService
): Promise<PaymentConfirmationResult> {
  const result = await service.confirmPayment({ paymentIntentId: stripePaymentIntentId, paymentMethodId });
  deliverConfirmationResult(result, callbacks, stripePaymentIntentId);
  return result;
}
