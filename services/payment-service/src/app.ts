import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PaymentController } from './controllers/payment.controller';
import { StripeWebhook } from './webhooks/stripe.webhook';
import { authenticateToken, requireRole } from './middleware/auth.middleware';
import { verifyStripeWebhook } from './middleware/webhook.middleware';
import {
  validateCreatePaymentIntent,
  validateConfirmPayment,
  validateRefundPayment,
  validatePaymentId,
  handleValidationErrors,
} from './middleware/validation.middleware';
import logger from './utils/logger';

const app = express();
app.set('trust proxy', 1);

// Webhook endpoint needs raw body
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
  '/api/payments/:paymentId',
  authenticateToken,
  requireRole(['ADMIN']),
  validatePaymentId,
  handleValidationErrors,
  PaymentController.getPaymentById
);
// ==================== Internal Service-to-Service Routes ====================
// These routes are called by other microservices (no user auth required)

app.post(
  '/api/payments/internal/create-intent',
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntentInternal
);

app.post(
  '/api/payments/internal/confirm',
  validateConfirmPayment,
  handleValidationErrors,
  PaymentController.confirmPaymentInternal
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
