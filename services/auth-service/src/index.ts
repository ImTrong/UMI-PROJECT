import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import app from './app';
import logger from './utils/logger';
import { autoSeedAdmin } from './utils/auto-seed';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

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

      // Auto session cleanup: Remove sessions inactive for > 7 days
      const cleanupOldSessions = async () => {
        try {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const result = await prisma.deviceSession.deleteMany({
            where: { lastActivity: { lt: sevenDaysAgo } }
          });
          if (result.count > 0) {
            logger.info(`Cleaned up ${result.count} inactive device sessions`);
          }
        } catch (err) {
          logger.error('Failed to cleanup old sessions', err);
        }
      };
      
      // Run immediately and then every hour
      cleanupOldSessions();
      setInterval(cleanupOldSessions, 60 * 60 * 1000);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
