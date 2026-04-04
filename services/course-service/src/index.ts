import dotenv from 'dotenv';
import app from './app';
import logger from './utils/logger';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3003;

const startServer = async () => {
  try {
    app.listen(PORT, () => {
      logger.info(`Course service running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`Auth service URL: ${process.env.AUTH_SERVICE_URL}`);
      logger.info(`User service URL: ${process.env.USER_SERVICE_URL}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
