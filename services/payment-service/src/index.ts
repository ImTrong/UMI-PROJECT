import dotenv from 'dotenv';
import app from './app';
import logger from './utils/logger';
import { startOrderSyncJob } from './jobs/order-sync.job';
import { processUnfinishedStripeEvents } from './jobs/stripe-event.job';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3005;

const startServer = async () => {
  try {
    app.listen(PORT, () => {
      logger.info(`Payment service running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`Stripe configured: ${process.env.STRIPE_SECRET_KEY ? 'Yes' : 'No'}`);
      logger.info(`Auth service URL: ${process.env.AUTH_SERVICE_URL}`);
      logger.info(`Order service URL: ${process.env.ORDER_SERVICE_URL}`);

      // Khởi chạy Outbox Order Sync Job định kỳ 30s
      startOrderSyncJob(30000);

      // C3: Khởi chạy Stripe Event Worker định kỳ 45s (process durable inbox)
      setInterval(() => {
        processUnfinishedStripeEvents().catch((err) =>
          logger.error('[StripeEventWorker] Cron error:', err)
        );
      }, 45000);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
