import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import authRoutes from './routes';
import { errorHandler } from './middlewares/errorHandler';

const app: Express = express();

// ============================================
// Middleware Setup
// ============================================

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://yourdomain.com']
    : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[AUTH-SERVICE] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// ============================================
// Routes
// ============================================
app.use('/api/auth', authRoutes);

// Health check endpoints
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    service: 'auth-service',
    status: 'active',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/api/auth/health', (req: Request, res: Response) => {
  res.status(200).json({
    service: 'auth-service',
    status: 'active',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    message: `Route not found: ${req.method} ${req.path}`,
  });
});

// ============================================
// Error Handler (Must be last)
// ============================================
app.use(errorHandler);

export default app;
