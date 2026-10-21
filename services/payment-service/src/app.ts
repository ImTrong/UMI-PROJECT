import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PaymentController } from './controllers/payment.controller';
import { StripeWebhook } from './webhooks/stripe.webhook';
import { authenticateToken, requireRole } from './middleware/auth.middleware';
import { verifyInternalService } from './middleware/internal-auth.middleware';
import { verifyStripeWebhook } from './middleware/webhook.middleware';
import {
  validateCreatePaymentIntent,
  validateConfirmPayment,
  validateRefundPayment,
  validatePaymentId,
  handleValidationErrors,
} from './middleware/validation.middleware';
import { PaymentService } from './services/payment.service';
import { syncPendingOrders } from './jobs/order-sync.job';
import { replayExhaustedEvent, listExhaustedEvents } from './jobs/stripe-event.job';
import logger from './utils/logger';

const app = express();
app.set('trust proxy', 1);

// Stripe webhook endpoint needs raw body
app.post(
  '/api/payments/webhook/stripe',
  express.raw({ type: 'application/json' }),
  verifyStripeWebhook,
  StripeWebhook.handleWebhook
);

// Legacy stripe webhook path
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  verifyStripeWebhook,
  StripeWebhook.handleWebhook
);

// Security middleware for other routes
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parser for non-webhook routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    const path = req.originalUrl || req.path;
    return path.includes('/internal') || path.includes('/health');
  }
});
app.use('/api/payments', limiter);

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/api/payments/health', PaymentController.healthCheck);

// ==================== Payment Routes ====================

// Protected routes - require authentication
app.post(
  '/api/payments/intents',
  authenticateToken,
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntent
);

app.post(
  '/api/payments/create-intent',
  authenticateToken,
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntent
);

app.post(
  '/api/payments/confirm',
  authenticateToken,
  validateConfirmPayment,
  handleValidationErrors,
  PaymentController.confirmPayment
);

// Complete mock/sandbox payment
app.post(
  '/api/payments/mock-complete',
  authenticateToken,
  PaymentController.completeMockPayment
);

app.get(
  '/api/payments/me',
  authenticateToken,
  PaymentController.getUserPayments
);

// Get payment by orderId (must be before :paymentId routes)
app.get(
  '/api/payments/order/:orderId',
  authenticateToken,
  PaymentController.getPaymentByOrder
);

app.get(
  '/api/payments/me/:paymentId',
  authenticateToken,
  validatePaymentId,
  handleValidationErrors,
  PaymentController.getPaymentById
);

app.post(
  '/api/payments/:paymentId/refund',
  authenticateToken,
  validateRefundPayment,
  handleValidationErrors,
  PaymentController.refundPayment
);

app.post(
  '/api/payments/:paymentId/cancel',
  authenticateToken,
  validatePaymentId,
  handleValidationErrors,
  PaymentController.cancelPayment
);

// Payment method management
app.post(
  '/api/payments/setup-intent',
  authenticateToken,
  PaymentController.createSetupIntent
);

app.post(
  '/api/payments/save-method',
  authenticateToken,
  PaymentController.savePaymentMethod
);

app.get(
  '/api/payments/methods',
  authenticateToken,
  PaymentController.getPaymentMethods
);

// Admin routes
app.get(
  '/api/payments',
  authenticateToken,
  requireRole(['ADMIN']),
  PaymentController.getAllPayments
);

app.get(
  '/api/payments/stats',
  authenticateToken,
  requireRole(['ADMIN']),
  PaymentController.getPaymentStats
);

app.get(
  '/api/payments/reconciliation-report',
  authenticateToken,
  requireRole(['ADMIN']),
  PaymentController.getReconciliationReport
);

app.post(
  '/api/payments/refunds/:refundId/confirm',
  authenticateToken,
  requireRole(['ADMIN']),
  PaymentController.confirmManualRefund
);

// Admin endpoints for exhausted Stripe events (Admin Dashboard)
app.get(
  '/api/payments/stripe-events/exhausted',
  authenticateToken,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const events = await listExhaustedEvents({ limit });
      res.status(200).json({ data: events, count: events.length });
    } catch (error: any) {
      logger.error('List exhausted events error:', error);
      res.status(500).json({ error: error.message || 'Failed to list exhausted events' });
    }
  }
);

app.post(
  '/api/payments/stripe-events/replay',
  authenticateToken,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const { stripeEventId } = req.body;
      if (!stripeEventId) {
        return res.status(400).json({ error: 'stripeEventId is required' });
      }
      const result = await replayExhaustedEvent(stripeEventId);
      const status = result.success ? 200 : 400;
      res.status(status).json(result);
    } catch (error: any) {
      logger.error('Replay exhausted event error:', error);
      res.status(500).json({ error: error.message || 'Failed to replay event' });
    }
  }
);

app.get(
  '/api/payments/:paymentId',
  authenticateToken,
  requireRole(['ADMIN']),
  validatePaymentId,
  handleValidationErrors,
  PaymentController.getPaymentById
);
// ==================== Internal Service-to-Service Routes ====================
// These routes are called by other microservices (require internal service token)

app.post(
  '/api/payments/internal/create-intent',
  verifyInternalService,
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntentInternal
);

app.post(
  '/api/payments/internal/confirm',
  verifyInternalService,
  validateConfirmPayment,
  handleValidationErrors,
  PaymentController.confirmPaymentInternal
);

// PayOS internal payment creation
app.post(
  '/api/payments/internal/create-payos',
  verifyInternalService,
  async (req, res) => {
    try {
      const { orderId, orderNumber, orderCode, userId, amount, description, items, regenerate } = req.body;
      const result = await PaymentService.createPayosPayment({
        orderId, orderNumber, orderCode, userId, amount, description, items, regenerate,
      });
      res.status(201).json({ message: 'PayOS payment created', data: result });
    } catch (error: any) {
      logger.error('Internal create payOS payment error:', error);
      res.status(error.message?.includes('not configured') ? 503 : 500).json({
        error: error.message || 'Failed to create PayOS payment',
      });
    }
  }
);

// PayOS internal payment cancellation
app.post(
  '/api/payments/internal/cancel-payos',
  verifyInternalService,
  async (req, res) => {
    try {
      const { orderCode, reason } = req.body;
      const result = await PaymentService.cancelPayosPaymentByOrderCode(orderCode, reason);
      res.status(200).json({ message: 'PayOS payment cancelled', data: result });
    } catch (error: any) {
      logger.error('Internal cancel payOS payment error:', error);
      res.status(500).json({ error: error.message || 'Failed to cancel PayOS payment' });
    }
  }
);

// Internal manual trigger for order sync outbox job
app.post(
  '/api/payments/internal/sync-pending-orders',
  verifyInternalService,
  async (req, res) => {
    try {
      const result = await syncPendingOrders();
      res.status(200).json({ message: 'Order sync completed', data: result });
    } catch (error: any) {
      logger.error('Internal sync pending orders error:', error);
      res.status(500).json({ error: error.message || 'Failed to sync pending orders' });
    }
  }
);

// B.5: Admin endpoints for exhausted Stripe events
app.get(
  '/api/payments/internal/stripe-events/exhausted',
  verifyInternalService,
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const events = await listExhaustedEvents({ limit });
      res.status(200).json({ data: events, count: events.length });
    } catch (error: any) {
      logger.error('List exhausted events error:', error);
      res.status(500).json({ error: error.message || 'Failed to list exhausted events' });
    }
  }
);

app.post(
  '/api/payments/internal/stripe-events/replay',
  verifyInternalService,
  async (req, res) => {
    try {
      const { stripeEventId } = req.body;
      if (!stripeEventId) {
        return res.status(400).json({ error: 'stripeEventId is required' });
      }
      const result = await replayExhaustedEvent(stripeEventId);
      const status = result.success ? 200 : 400;
      res.status(status).json(result);
    } catch (error: any) {
      logger.error('Replay exhausted event error:', error);
      res.status(500).json({ error: error.message || 'Failed to replay event' });
    }
  }
);

// ==================== PayOS Webhook ====================
// payOS sends JSON body with signature, no raw body needed
app.post(
  '/api/payments/webhook/payos',
  express.json(),
  async (req, res) => {
    try {
      const result = await PaymentService.handlePayosWebhook(req.body);
      const httpStatus = (result as any).httpStatus || (result.success ? 200 : 400);
      return res.status(httpStatus).json(result);
    } catch (error: any) {
      logger.error('PayOS webhook error:', error);
      if (error.message?.includes('signature verification failed')) {
        // Chữ ký không hợp lệ: 400 Bad Request
        return res.status(400).json({ success: false, error: 'Invalid webhook signature' });
      }
      if (error.message?.includes('Failed to notify order service')) {
        // Lỗi tạm thời phía dịch vụ đích: 503 để payOS tự động retry
        return res.status(503).json({ success: false, error: 'Downstream order-service unavailable, please retry' });
      }
      // Các lỗi không mong muốn khác: 500
      return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
    }
  }
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
