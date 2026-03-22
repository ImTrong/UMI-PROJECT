import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { UserController } from './controllers/user.controller';
import { authenticateToken, requireRole } from './middleware/auth.middleware';
import {
  validateCreateUser,
  validateUpdateUser,
  validateEducation,
  validateWorkExperience,
  validateUserId,
  validateId,
  handleValidationErrors,
} from './middleware/validation.middleware';
import logger from './utils/logger';
import { UserService } from './services/user.service';
import { ERROR_MESSAGES } from './utils/constants';

const app = express();

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
});
app.use('/api/users', limiter);

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Health check (no authentication required)
app.get('/api/users/health', UserController.healthCheck);

// ==================== User Profile Routes ====================

// Public routes (with authentication)
app.get(
  '/api/users',
  authenticateToken,
  UserController.getAllUsers
);

app.get(
  '/api/users/me',
  authenticateToken,
  UserController.getMyProfile
);

app.put(
  '/api/users/me',
  authenticateToken,
  validateUpdateUser,
  handleValidationErrors,
  UserController.updateMyProfile
);

app.delete(
  '/api/users/me',
  authenticateToken,
  UserController.deleteMyProfile
);

app.get(
  '/api/users/me/stats',
  authenticateToken,
  UserController.getUserStats
);

// Admin only routes
app.post(
  '/api/users',
  authenticateToken,
  requireRole(['ADMIN']),
  validateCreateUser,
  handleValidationErrors,
  UserController.createUserProfile
);

app.get(
  '/api/users/:userId',
  authenticateToken,
  validateUserId,
  handleValidationErrors,
  UserController.getUserProfile
);

// ==================== Education Routes ====================

app.post(
  '/api/users/me/education',
  authenticateToken,
  validateEducation,
  handleValidationErrors,
  UserController.addEducation
);

app.put(
  '/api/users/me/education/:id',
  authenticateToken,
  validateId,
  validateEducation,
  handleValidationErrors,
  UserController.updateEducation
);

app.delete(
  '/api/users/me/education/:id',
  authenticateToken,
  validateId,
  handleValidationErrors,
  UserController.deleteEducation
);

// ==================== Work Experience Routes ====================

app.post(
  '/api/users/me/work',
  authenticateToken,
  validateWorkExperience,
  handleValidationErrors,
  UserController.addWorkExperience
);

app.put(
  '/api/users/me/work/:id',
  authenticateToken,
  validateId,
  validateWorkExperience,
  handleValidationErrors,
  UserController.updateWorkExperience
);

app.delete(
  '/api/users/me/work/:id',
  authenticateToken,
  validateId,
  handleValidationErrors,
  UserController.deleteWorkExperience
);

// ==================== Admin Routes for Managing Users ====================

app.put(
  '/api/users/:userId',
  authenticateToken,
  requireRole(['ADMIN']),
  validateUserId,
  validateUpdateUser,
  handleValidationErrors,
  async (req: express.Request, res: express.Response) => {
    try {
      const { userId } = req.params;
      const updatedProfile = await UserService.updateUserProfile(userId, req.body);
      res.status(200).json({
        message: 'User updated successfully',
        data: updatedProfile,
      });
    } catch (error: any) {
      logger.error('Admin update user error:', error);
      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

app.delete(
  '/api/users/:userId',
  authenticateToken,
  requireRole(['ADMIN']),
  validateUserId,
  handleValidationErrors,
  async (req: express.Request, res: express.Response) => {
    try {
      const { userId } = req.params;
      await UserService.deleteUserProfile(userId);
      res.status(200).json({
        message: 'User deleted successfully',
      });
    } catch (error: any) {
      logger.error('Admin delete user error:', error);
      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

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
