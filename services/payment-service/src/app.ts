import express from 'express';
import { requireMockPaymentEnabled } from './utils/mock-payment';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PaymentController } from './controllers/payment.controller';
import { StripeWebhook } from './webhooks/stripe.webhook';
import { authenticateToken, requireRole } from './middleware/auth.middleware';
import { verifyInternalService } from './middleware/internal-auth.middleware';
import { requireServiceToken } from './middleware/service-token.middleware';
import { OrderRefundRejectedError, parseOrderRefundRequest, parsePaymentEvidenceRequest } from './utils/order-refund';
import { ERROR_MESSAGES } from './utils/constants';
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

// Complete mock/sandbox payment - development / test only (FIX 07B-1): OFF unless PAYMENT_MOCK_ENABLED=true, never in production.
// The flag is checked first (404 when off) and again inside PaymentService.completeMockPayment.
app.post(
  '/api/payments/mock-complete',
  requireMockPaymentEnabled,
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

// SCOPE-RESET-01: only an ADMIN starts a refund (role read from the user-service by requireRole). A learner refunding their own
// payment kept the course; the order-service keeps its own internal refund route (ORDER_PAYMENT_TOKEN).
app.post(
  '/api/payments/:paymentId/refund',
  authenticateToken,
  requireRole(['ADMIN']),
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
// The four routes called by the order-service (PaymentClient) accept only the Order <-> Payment credential ORDER_PAYMENT_TOKEN
// (FIX 07B-2A) - never INTERNAL_SERVICE_TOKEN or a public default; fail-closed. The operations routes further down (no service
// calls them) keep the shared INTERNAL_SERVICE_TOKEN until their own FIX.
const orderPaymentAuth = requireServiceToken('ORDER_PAYMENT_TOKEN');

app.post(
  '/api/payments/internal/create-intent',
  orderPaymentAuth,
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntentInternal
);

app.post(
  '/api/payments/internal/confirm',
  orderPaymentAuth,
  validateConfirmPayment,
  handleValidationErrors,
  PaymentController.confirmPaymentInternal
);

// PayOS internal payment creation
app.post(
  '/api/payments/internal/create-payos',
  orderPaymentAuth,
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

// Payment status for the order-service (FIX 07B-2A.1): ORDER_PAYMENT_TOKEN only, the payment must belong to ?orderId=,
// minimal fields, database state (no provider call). Missing payment and payment of another order: the same 404.
app.get(
  '/api/payments/internal/payment-status/:paymentId',
  orderPaymentAuth,
  async (req, res) => {
    try {
      const data = await PaymentService.getPaymentStatusForOrder(req.params.paymentId, String(req.query.orderId ?? ''));
      res.status(200).json({ data });
    } catch (error: any) {
      if (error.message === ERROR_MESSAGES.PAYMENT_NOT_FOUND) return res.status(404).json({ error: ERROR_MESSAGES.PAYMENT_NOT_FOUND });
      logger.error(`Internal payment status error: ${error?.message}`);
      res.status(500).json({ error: 'Failed to get payment status' });
    }
  }
);

// Payment evidence for the order-service's sales statistics (ADMIN-DASHBOARD-01): ORDER_PAYMENT_TOKEN only, read-only, a bounded list of
// order ids, minimal fields, database state (no provider call). The order-service - not this route - decides what counts as a sale.
app.post(
  '/api/payments/internal/payment-evidence',
  orderPaymentAuth,
  async (req, res) => {
    try {
      const data = await PaymentService.getPaymentEvidenceForOrders(parsePaymentEvidenceRequest(req.body));
      res.status(200).json({ data });
    } catch (error: any) {
      if (error instanceof OrderRefundRejectedError) return res.status(error.httpStatus).json({ error: error.message, code: error.code });
      logger.error(`Internal payment evidence error: ${error?.message}`);
      res.status(500).json({ error: 'Failed to get payment evidence' });
    }
  }
);

// Refund for the order-service (FIX 07B-2A.1): ORDER_PAYMENT_TOKEN only; runs the existing refund process. `outcome` is what the
// payment-service could verify: SUCCEEDED / PENDING as recorded, UNVERIFIED (502) when the provider call failed - never a guess.
app.post(
  '/api/payments/internal/create-refund',
  orderPaymentAuth,
  async (req, res) => {
    try {
      const result = await PaymentService.refundForOrder(parseOrderRefundRequest(req.body));
      if (result.outcome === 'UNVERIFIED') {
        // the reservation is kept; a retry with the same key continues this refund (FIX 07B-2A.2)
        return res.status(502).json({ error: 'Refund not verified', code: 'REFUND_NOT_VERIFIED', data: result });
      }
      res.status(result.replayed ? 200 : 201).json({ data: result });
    } catch (error: any) {
      if (error instanceof OrderRefundRejectedError) return res.status(error.httpStatus).json({ error: error.message, code: error.code });
      if (error.message === ERROR_MESSAGES.PAYMENT_NOT_FOUND) return res.status(404).json({ error: ERROR_MESSAGES.PAYMENT_NOT_FOUND });
      if (error.message === ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED || error.message === ERROR_MESSAGES.REFUND_ALREADY_PROCESSED
        || /exceeds remaining refundable amount/.test(error.message || '') || error.message === ERROR_MESSAGES.INVALID_PAYMENT_AMOUNT) {
        return res.status(422).json({ error: error.message, code: 'REFUND_NOT_ALLOWED' });
      }
      // an unexpected error (e.g. database) after the request was accepted: the state is not known to this answer
      logger.error(`Internal refund not verified: ${error?.message}`);
      res.status(502).json({ error: 'Refund not verified', code: 'REFUND_NOT_VERIFIED', data: { outcome: 'UNVERIFIED' } });
    }
  }
);

// PayOS internal payment cancellation
app.post(
  '/api/payments/internal/cancel-payos',
  orderPaymentAuth,
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
