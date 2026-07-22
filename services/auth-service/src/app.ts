import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AuthController } from './controllers/auth.controller';
import { authenticateToken, optionalAuth } from './middleware/auth.middleware';
import { validateRegister, validateLogin, validateChangePassword, validateForgotPassword, validateResetPassword, handleValidationErrors } from './middleware/validation.middleware';
import logger from './utils/logger';

const app = express();
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    const path = req.originalUrl || req.path;
    return path.includes('/verify-token') || path.includes('/health');
  }
});
app.use('/api/auth', limiter);

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Routes
app.get('/api/auth/health', AuthController.healthCheck);

app.post(
  '/api/auth/register',
  validateRegister,
  handleValidationErrors,
  AuthController.register
);

app.post(
  '/api/auth/login',
  validateLogin,
  handleValidationErrors,
  AuthController.login
);

app.post('/api/auth/refresh-token', AuthController.refreshToken);
app.post('/api/auth/logout', optionalAuth, AuthController.logout);
app.post('/api/auth/verify-token', AuthController.verifyToken);

app.post(
  '/api/auth/change-password',
  authenticateToken,
  validateChangePassword,
  handleValidationErrors,
  AuthController.changePassword
);

app.post(
  '/api/auth/forgot-password',
  validateForgotPassword,
  handleValidationErrors,
  AuthController.forgotPassword
);

app.post(
  '/api/auth/reset-password',
  validateResetPassword,
  handleValidationErrors,
  AuthController.resetPassword
);

app.post('/api/auth/verify-email', AuthController.verifyEmail);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
