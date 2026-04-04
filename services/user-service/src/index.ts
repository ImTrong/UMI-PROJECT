import dotenv from 'dotenv';
import app from './app';
import logger from './utils/logger';

import http from 'http';
import { initializeSockets } from './sockets/notification.socket';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3002;

const startServer = async () => {
  try {
    const server = http.createServer(app);
    
    // Initialize Socket.io
    initializeSockets(server);

    server.listen(PORT, () => {
      logger.info(`User service running on port ${PORT} with Socket.io enabled`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`Auth service URL: ${process.env.AUTH_SERVICE_URL}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
