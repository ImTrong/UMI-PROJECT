import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import orderRoutes from './routes';
import { errorHandler } from './middlewares/errorHandler';

const app: Express = express();

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://yourdomain.com']
    : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[ORDER-SERVICE] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

app.use('/api/orders', orderRoutes);

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    service: 'order-service',
    status: 'active',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/api/orders/health', (req: Request, res: Response) => {
  res.status(200).json({
    service: 'order-service',
    status: 'active',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    message: `Route not found: ${req.method} ${req.path}`,
  });
});

app.use(errorHandler);

export default app;
