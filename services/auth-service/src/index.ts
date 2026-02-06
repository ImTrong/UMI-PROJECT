import app from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[AUTH-SERVICE] Server running on http://localhost:${PORT}`);
  console.log(`[AUTH-SERVICE] Environment: ${process.env.NODE_ENV}`);
  console.log(`[AUTH-SERVICE] Health check: http://localhost:${PORT}/api/auth/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[AUTH-SERVICE] SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[AUTH-SERVICE] SIGINT signal received: closing HTTP server');
  process.exit(0);
});
