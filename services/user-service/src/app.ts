import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { UserController } from './controllers/user.controller';
import { NotificationController } from './controllers/notification.controller';
import { ChatController } from './controllers/chat.controller';
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
    return path.includes('/internal') || path.includes('/health');
  }
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
app.post('/api/users/batch', UserController.getBatchUsers);

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

app.get(
  '/api/users/profile/avatar/upload-url',
  authenticateToken,
  UserController.getAvatarUploadUrl
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

// ==================== Notification Routes ====================

app.get(
  '/api/users/me/notifications',
  authenticateToken,
  NotificationController.getUserNotifications
);

app.put(
  '/api/users/me/notifications/read-all',
  authenticateToken,
  NotificationController.markAllAsRead
);

app.put(
  '/api/users/me/notifications/:notificationId/read',
  authenticateToken,
  NotificationController.markAsRead
);

app.delete(
  '/api/users/me/notifications/:notificationId',
  authenticateToken,
  NotificationController.deleteNotification
);

app.post(
  '/api/users/internal/notifications',
  // In a real microservices setup, you'd protect this with a special internal network token
  NotificationController.createInternalNotification
);

// ==================== Chat Routes ====================

app.get(
  '/api/users/me/conversations',
  authenticateToken,
  ChatController.getConversations
);

app.post(
  '/api/users/me/conversations',
  authenticateToken,
  ChatController.createConversation
);

app.get(
  '/api/users/me/conversations/:conversationId/messages',
  authenticateToken,
  ChatController.getMessages
);

app.post(
  '/api/users/me/conversations/:conversationId/messages',
  authenticateToken,
  ChatController.sendMessage
);

app.put(
  '/api/users/me/conversations/:conversationId/read',
  authenticateToken,
  ChatController.markAsRead
);

app.get(
  '/api/users/me/chat/unread-count',
  authenticateToken,
  ChatController.getUnreadCount
);

// ==================== Analytics Route ====================

app.get(
  '/api/users/analytics',
  authenticateToken,
  requireRole(['ADMIN']),
  UserController.getAnalytics
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
      await UserService.softDeleteUserProfile(userId);
      res.status(200).json({
        message: 'User deactivated successfully',
      });
    } catch (error: any) {
      logger.error('Admin soft-delete user error:', error);
      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to deactivate user' });
    }
  }
);

app.post('/api/users/become-instructor', authenticateToken, UserController.becomeInstructor);
app.post('/api/users/become-instructor/confirm', UserController.confirmInstructor);

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
