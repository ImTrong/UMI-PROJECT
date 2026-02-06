import app from './app';

const PORT = process.env.PORT || 3003;

app.listen(PORT, () => {
  console.log(`[COURSE-SERVICE] Server running on http://localhost:${PORT}`);
  console.log(`[COURSE-SERVICE] Environment: ${process.env.NODE_ENV}`);
  console.log(`[COURSE-SERVICE] Health check: http://localhost:${PORT}/api/courses/health`);
});

process.on('SIGTERM', () => {
  console.log('[COURSE-SERVICE] SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[COURSE-SERVICE] SIGINT signal received: closing HTTP server');
  process.exit(0);
});
