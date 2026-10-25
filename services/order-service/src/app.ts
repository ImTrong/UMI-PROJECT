import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { OrderController } from './controllers/order.controller';
import { CartController } from './controllers/cart.controller';
import { authenticateToken, requireRole } from './middleware/auth.middleware';
import { requireServiceToken } from './middleware/service-token.middleware';
import {
  validateAddToCart,
  validateCreateOrder,
  validateUpdateOrderStatus,
  validateCancelOrder,
  validateOrderId,
  validatePagination,
  handleValidationErrors,
} from './middleware/validation.middleware';
import logger from './utils/logger';

const app = express();
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    const path = req.originalUrl || req.path;
    // service-to-service entitlement checks (FIX-INS-04) come from ONE learning-service IP and are token-protected; limiting them
    // per IP would refuse enrollments during a burst of purchases (same rule as the other services' /internal routes)
    return path.includes('/health') || path.startsWith('/api/orders/internal/');
  }
});
app.use('/api/orders', limiter);
app.use('/api/cart', limiter);

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Health check (no authentication required)
app.get('/api/orders/health', OrderController.healthCheck);

// ==================== Cart Routes ====================

app.get(
  '/api/cart',
  authenticateToken,
  CartController.getCart
);

app.post(
  '/api/cart',
  authenticateToken,
  validateAddToCart,
  handleValidationErrors,
  CartController.addToCart
);

app.delete(
  '/api/cart/:courseId',
  authenticateToken,
  CartController.removeFromCart
);

app.delete(
  '/api/cart',
  authenticateToken,
  CartController.clearCart
);

app.get(
  '/api/cart/total',
  authenticateToken,
  CartController.getCartTotal
);

// ==================== Order Routes ====================

// User routes
app.get(
  '/api/orders/me',
  authenticateToken,
  validatePagination,
  handleValidationErrors,
  OrderController.getUserOrders
);

// Internal webhook endpoint, called ONLY by the payment-service (notifyOrderService + its outbox job). It accepts only the
// Order <-> Payment credential ORDER_PAYMENT_TOKEN (FIX 07B-2A) - never INTERNAL_SERVICE_TOKEN or a public default; fail-closed.
app.post(
  '/api/orders/webhook/payment',
  requireServiceToken('ORDER_PAYMENT_TOKEN'),
  OrderController.handlePaymentWebhook
);

// Internal, READ-ONLY (FIX-INS-04): the learning-service asks whether an order entitles a learner to a course before it writes
// the enrollment. It accepts only the Order <-> Learning credential ORDER_LEARNING_TOKEN - never INTERNAL_SERVICE_TOKEN or a
// default; fail-closed. It answers yes/no from this service's records and can neither enroll nor change an order.
app.get(
  '/api/orders/internal/:orderId/entitlement',
  requireServiceToken('ORDER_LEARNING_TOKEN'),
  validateOrderId,
  handleValidationErrors,
  OrderController.getEnrollmentEntitlement
);

app.get(
  '/api/orders/me/:orderId',
  authenticateToken,
  validateOrderId,
  handleValidationErrors,
  OrderController.getOrderById
);

app.get(
  '/api/orders/me/number/:orderNumber',
  authenticateToken,
  OrderController.getOrderByNumber
);

app.post(
  '/api/orders',
  authenticateToken,
  validateCreateOrder,
  handleValidationErrors,
  OrderController.createOrder
);

// Order routes with payment
app.post(
  '/api/orders/with-payment',
  authenticateToken,
  validateCreateOrder,
  handleValidationErrors,
  OrderController.createOrderWithPayment
);

app.post(
  '/api/orders/:orderId/payment',
  authenticateToken,
  validateOrderId,
  handleValidationErrors,
  OrderController.processPayment
);

app.post(
  '/api/orders/:orderId/payos-payment',
  authenticateToken,
  validateOrderId,
  handleValidationErrors,
  OrderController.initiatePayosPayment
);

app.get(
  '/api/orders/:orderId/payment-status',
  authenticateToken,
  validateOrderId,
  handleValidationErrors,
  OrderController.getPaymentStatus
);

app.post(
  '/api/orders/:orderId/cancel',
  authenticateToken,
  validateCancelOrder,
  handleValidationErrors,
  OrderController.cancelOrder
);

// Admin routes
app.get(
  '/api/orders',
  authenticateToken,
  requireRole(['ADMIN']),
  validatePagination,
  handleValidationErrors,
  OrderController.getAllOrders
);

app.get(
  '/api/orders/analytics',
  authenticateToken,
  requireRole(['ADMIN']),
  OrderController.getAnalytics
);

app.get(
  '/api/orders/analytics/sales-performance',
  authenticateToken,
  requireRole(['ADMIN']),
  OrderController.getSalesPerformance
);

app.get(
  '/api/orders/stats',
  authenticateToken,
  requireRole(['ADMIN']),
  OrderController.getOrderStats
);

app.put(
  '/api/orders/:orderId/status',
  authenticateToken,
  requireRole(['ADMIN']),
  validateUpdateOrderStatus,
  handleValidationErrors,
  OrderController.updateOrderStatus
);

app.get(
  '/api/orders/:orderId',
  authenticateToken,
  requireRole(['ADMIN']),
  validateOrderId,
  handleValidationErrors,
  OrderController.getOrderById
);



// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
