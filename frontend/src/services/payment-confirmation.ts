/**
 * How the frontend reads the answer of a payment confirmation (FIX 07B-1.3). One place, used by every caller.
 *
 * The answers are NOT changed on the server; their real shapes are pinned in tests/fixtures/payment-confirmation-contract.json and
 * checked against the services by their own tests:
 *   POST /api/payments/confirm          200 { message, data: Payment }              (message is the same for every status)
 *   POST /api/payments/mock-complete    200 { success, message, payment: Payment }  (not wrapped in `data`)
 *   POST /api/orders/:orderId/payment   200 { message, data: { success, status, payment: Payment } }
 *   refusals                            4xx { error, code? }   server / provider errors 5xx { error }
 *
 * Only `Payment.status` decides, and only the exact upper-case SUCCEEDED is a success. A 2xx answer is not a success by itself, the
 * message text is never read for the outcome, and a missing / unknown status is UNVERIFIED (never success). The order itself is still
 * moved to PAID by the payment webhook / outbox - the frontend only shows what the confirmation said.
 */
export type PaymentStatusClass = 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'UNKNOWN';

/** Same mapping as the order-service (order-service/src/utils/payment-status.ts). */
export function classifyPaymentStatus(status: unknown): PaymentStatusClass {
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
      return 'UNKNOWN';
  }
}

/**
 * SUCCEEDED  paid                                  -> success screen
 * PENDING    the provider has not decided yet      -> "processing" notice, wait for the order to change
 * FAILED     the provider declined / cancelled     -> failure
 * REJECTED   the request was refused (4xx)         -> failure message, nothing was confirmed by this call
 * UNVERIFIED unreadable answer, 5xx, network error -> "not verified yet" notice - never success
 */
export type ConfirmationOutcome = 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'REJECTED' | 'UNVERIFIED';

export interface PaymentConfirmationResult {
  outcome: ConfirmationOutcome;
  paymentId: string | null;
  paymentStatus: string | null;
  httpStatus: number | null;
  message: string;
}

export const CONFIRMATION_MESSAGES = {
  SUCCEEDED: 'Thanh toán thành công.',
  PENDING: 'Thanh toán đang được nhà cung cấp xử lý. Đơn hàng sẽ được cập nhật ngay khi có xác nhận.',
  FAILED: 'Thanh toán không thành công. Vui lòng thử lại hoặc chọn phương thức khác.',
  CANCELLED: 'Thanh toán đã bị hủy.',
  UNVERIFIED: 'Chưa xác minh được trạng thái thanh toán. Đơn hàng sẽ tự cập nhật khi hệ thống nhận được xác nhận; vui lòng không thanh toán lại.',
  NOT_FOUND: 'Không tìm thấy thanh toán của bạn.',
  PROVIDER_MISMATCH: 'Thanh toán này không thể xác nhận qua cổng thẻ.',
  DEMO_DISABLED: 'Thanh toán demo không khả dụng trong môi trường này.',
  REJECTED: 'Yêu cầu thanh toán bị từ chối.',
} as const;

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** From a Payment object of a 2xx answer. `successFlag` is the extra `success` field some answers carry: it must agree. */
export function resultFromPayment(payment: unknown, httpStatus: number, successFlag?: unknown): PaymentConfirmationResult {
  const status = isObject(payment) ? payment.status : undefined;
  const paymentId = isObject(payment) && typeof payment.id === 'string' ? payment.id : null;
  const base = { paymentId, paymentStatus: typeof status === 'string' ? status : null, httpStatus };
  const cls = classifyPaymentStatus(status);
  // an answer that contradicts itself (success flag vs status) is not trusted either way
  if (successFlag !== undefined && (successFlag === true) !== (cls === 'SUCCEEDED')) {
    return { ...base, outcome: 'UNVERIFIED', message: CONFIRMATION_MESSAGES.UNVERIFIED };
  }
  switch (cls) {
    case 'SUCCEEDED':
      return { ...base, outcome: 'SUCCEEDED', message: CONFIRMATION_MESSAGES.SUCCEEDED };
    case 'PENDING':
      return { ...base, outcome: 'PENDING', message: CONFIRMATION_MESSAGES.PENDING };
    case 'FAILED':
      return { ...base, outcome: 'FAILED', message: status === 'CANCELLED' ? CONFIRMATION_MESSAGES.CANCELLED : CONFIRMATION_MESSAGES.FAILED };
    default:
      return { ...base, outcome: 'UNVERIFIED', message: CONFIRMATION_MESSAGES.UNVERIFIED };
  }
}

/** From a thrown request error: a 4xx is a refusal, anything else (5xx, timeout, network) is unverified. */
export function resultFromError(error: unknown): PaymentConfirmationResult {
  const response = isObject(error) && isObject(error.response) ? error.response : null;
  const httpStatus = response && typeof response.status === 'number' ? response.status : null;
  const base = { paymentId: null, paymentStatus: null, httpStatus };
  if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
    const body = isObject(response!.data) ? response!.data : {};
    const message =
      httpStatus === 404 ? CONFIRMATION_MESSAGES.NOT_FOUND
      : httpStatus === 409 ? CONFIRMATION_MESSAGES.PROVIDER_MISMATCH
      : httpStatus === 403 && /mock|demo/i.test(String(body.error ?? '')) ? CONFIRMATION_MESSAGES.DEMO_DISABLED
      : typeof body.error === 'string' && body.error ? body.error
      : CONFIRMATION_MESSAGES.REJECTED;
    return { ...base, outcome: 'REJECTED', message };
  }
  return { ...base, outcome: 'UNVERIFIED', message: CONFIRMATION_MESSAGES.UNVERIFIED };
}

/** POST /api/payments/confirm: 200 { message, data: Payment } */
export const readConfirmAnswer = (body: unknown, httpStatus: number) =>
  resultFromPayment(isObject(body) ? body.data : undefined, httpStatus);

/** POST /api/payments/mock-complete: 200 { success, message, payment } */
export const readMockCompleteAnswer = (body: unknown, httpStatus: number) =>
  resultFromPayment(isObject(body) ? body.payment : undefined, httpStatus, isObject(body) ? body.success ?? false : false);

/** POST /api/orders/:orderId/payment: 200 { message, data: { success, status, payment } } */
export const readOrderPaymentAnswer = (body: unknown, httpStatus: number) => {
  const data = isObject(body) && isObject(body.data) ? body.data : undefined;
  return resultFromPayment(data?.payment, httpStatus, data ? data.success ?? false : false);
};

export interface ConfirmationCallbacks {
  onSuccess: (paymentId: string) => void;
  onPending: (message: string) => void;
  onError: (message: string) => void;
}

/** The ONLY place that turns a result into UI callbacks: success only for SUCCEEDED. */
export function deliverConfirmationResult(result: PaymentConfirmationResult, callbacks: ConfirmationCallbacks, fallbackPaymentId: string): void {
  switch (result.outcome) {
    case 'SUCCEEDED':
      callbacks.onSuccess(result.paymentId ?? fallbackPaymentId);
      return;
    case 'PENDING':
    case 'UNVERIFIED':
      callbacks.onPending(result.message);
      return;
    default:
      callbacks.onError(result.message);
  }
}

/**
 * What the success page may say about an order (FIX 07B-1.3). The order is the source of truth - it is moved to PAID / COMPLETED by the
 * payment webhook / outbox, never by the frontend. PROCESSING alone is not a payment.
 */
export function orderPaymentState(order: { status?: unknown; paymentStatus?: unknown } | null | undefined): 'PAID' | 'FAILED' | 'PENDING' {
  if (!order) return 'PENDING';
  if (order.paymentStatus === 'PAID' || order.status === 'COMPLETED') return 'PAID';
  if (order.status === 'FAILED' || order.status === 'CANCELLED') return 'FAILED';
  return 'PENDING';
}
