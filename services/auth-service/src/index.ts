import dotenv from 'dotenv';
import app from './app';
import logger from './utils/logger';
import { autoSeedAdmin } from './utils/auto-seed';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    app.listen(PORT, () => {
      logger.info(`Auth service running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      
      // Auto seed admin
      autoSeedAdmin().catch(error => {
        logger.error('Failed to auto-seed admin:', error);
      });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
