import app from './app';

const PORT = process.env.PORT || 3004;

app.listen(PORT, () => {
  console.log(`[ORDER-SERVICE] Server running on http://localhost:${PORT}`);
  console.log(`[ORDER-SERVICE] Environment: ${process.env.NODE_ENV}`);
  console.log(`[ORDER-SERVICE] Health check: http://localhost:${PORT}/api/orders/health`);
});

process.on('SIGTERM', () => {
  console.log('[ORDER-SERVICE] SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[ORDER-SERVICE] SIGINT signal received: closing HTTP server');
  process.exit(0);
});
