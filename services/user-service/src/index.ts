import dotenv from 'dotenv';
import app from './app';

dotenv.config();

const PORT = process.env.PORT || 3002;

const server = app.listen(PORT, () => {
  console.log(`
    🚀 User Service is running!
    📡 Listening on port ${PORT}
    🔗 Health check: http://localhost:${PORT}/api/users/health
    📝 API Base URL: http://localhost:${PORT}/api/users
    ⏰ Started at: ${new Date().toISOString()}
  `);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Received shutdown signal, closing server...');
  
  server.close(() => {
    console.log('Server closed successfully');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown();
});

export default server;
