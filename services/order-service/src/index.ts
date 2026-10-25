import dotenv from 'dotenv';
import app from './app';
import logger from './utils/logger';
import { startupConfigProblems } from './utils/startup-config';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3004;

const startServer = async () => {
  try {
    // fail fast (FIX 07B-2A): never serve with a missing / weak ORDER_PAYMENT_TOKEN
    const problems = startupConfigProblems();
    if (problems.length > 0) {
      for (const problem of problems) logger.error(`Refusing to start: ${problem}`);
      process.exit(1);
    }

    app.listen(PORT, () => {
      logger.info(`Order service running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`Auth service URL: ${process.env.AUTH_SERVICE_URL}`);
      logger.info(`Course service URL: ${process.env.COURSE_SERVICE_URL}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
