import app from './app';

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`[USER-SERVICE] Server running on http://localhost:${PORT}`);
  console.log(`[USER-SERVICE] Environment: ${process.env.NODE_ENV}`);
  console.log(`[USER-SERVICE] Health check: http://localhost:${PORT}/api/users/health`);
});

process.on('SIGTERM', () => {
  console.log('[USER-SERVICE] SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[USER-SERVICE] SIGINT signal received: closing HTTP server');
  process.exit(0);
});
