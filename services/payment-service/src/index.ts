import app from './app';

const PORT = process.env.PORT || 3005;

app.listen(PORT, () => {
  console.log(`[PAYMENT-SERVICE] Server running on http://localhost:${PORT}`);
  console.log(`[PAYMENT-SERVICE] Environment: ${process.env.NODE_ENV}`);
  console.log(`[PAYMENT-SERVICE] Health check: http://localhost:${PORT}/api/payments/health`);
});

process.on('SIGTERM', () => {
  console.log('[PAYMENT-SERVICE] SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[PAYMENT-SERVICE] SIGINT signal received: closing HTTP server');
  process.exit(0);
});
