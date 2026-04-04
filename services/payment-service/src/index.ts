import dotenv from 'dotenv';
import app from './app';
import logger from './utils/logger';

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
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
