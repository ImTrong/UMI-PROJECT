export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const ERROR_MESSAGES = {
  PAYMENT_NOT_FOUND: 'Payment not found',
  PAYMENT_ALREADY_PROCESSED: 'Payment already processed',
  INVALID_PAYMENT_AMOUNT: 'Invalid payment amount',
  STRIPE_ERROR: 'Stripe API error',
  WEBHOOK_SIGNATURE_INVALID: 'Invalid webhook signature',
  ORDER_NOT_FOUND: 'Order not found',
  USER_NOT_FOUND: 'User not found',
  REFUND_NOT_FOUND: 'Refund not found',
  REFUND_ALREADY_PROCESSED: 'Refund already processed',
  INSUFFICIENT_PAYMENT_AMOUNT: 'Insufficient payment amount',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
} as const;

export const SUCCESS_MESSAGES = {
  PAYMENT_INTENT_CREATED: 'Payment intent created successfully',
  PAYMENT_CONFIRMED: 'Payment confirmed successfully',
  PAYMENT_REFUNDED: 'Payment refunded successfully',
  WEBHOOK_PROCESSED: 'Webhook processed successfully',
} as const;

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;

export const REFUND_STATUS = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;
