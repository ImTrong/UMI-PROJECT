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
  CART_NOT_FOUND: 'Cart not found',
  COURSE_NOT_FOUND: 'Course not found',
  COURSE_ALREADY_IN_CART: 'Course already in cart',
  ORDER_NOT_FOUND: 'Order not found',
  ORDER_ALREADY_PROCESSED: 'Order already processed',
  INSUFFICIENT_STOCK: 'Insufficient stock',
  INVALID_ORDER_STATUS: 'Invalid order status',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  PAYMENT_FAILED: 'Payment failed',
  COURSE_ALREADY_PURCHASED: 'Course already purchased',
} as const;

export const SUCCESS_MESSAGES = {
  CART_ADDED: 'Course added to cart successfully',
  CART_REMOVED: 'Course removed from cart successfully',
  CART_CLEARED: 'Cart cleared successfully',
  ORDER_CREATED: 'Order created successfully',
  ORDER_UPDATED: 'Order updated successfully',
  ORDER_CANCELLED: 'Order cancelled successfully',
  PAYMENT_CONFIRMED: 'Payment confirmed successfully',
} as const;

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;

export const PAYMENT_STATUS = {
  UNPAID: 'UNPAID',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
} as const;
