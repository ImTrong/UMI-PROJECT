import app from './app';

const PORT = process.env.PORT || 3006;

app.listen(PORT, () => {
  console.log(`[LEARNING-SERVICE] Server running on http://localhost:${PORT}`);
  console.log(`[LEARNING-SERVICE] Environment: ${process.env.NODE_ENV}`);
  console.log(`[LEARNING-SERVICE] Health check: http://localhost:${PORT}/api/learning/health`);
});

process.on('SIGTERM', () => {
  console.log('[LEARNING-SERVICE] SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[LEARNING-SERVICE] SIGINT signal received: closing HTTP server');
  process.exit(0);
});
