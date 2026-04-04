import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ActivityService } from '../services/activity.service';
import { ActivityAction } from '../types';
import { HTTP_STATUS, ERROR_MESSAGES, SUCCESS_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class ActivityController {
  static async logActivity(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { action, courseId, lessonId, durationSeconds, metadata } = req.body;
      await ActivityService.logActivity({
        userId: req.user.userId,
        courseId,
        lessonId,
        action: action as ActivityAction,
        durationSeconds,
        metadata,
      });
      res.status(HTTP_STATUS.CREATED).json({ message: SUCCESS_MESSAGES.ACTIVITY_LOGGED });
    } catch (error) {
      logger.error('Log activity error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to log activity' });
    }
  }

  static async getUserActivities(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await ActivityService.getUserActivities(req.user.userId, page, limit);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error) {
      logger.error('Get user activities error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get activities' });
    }
  }
}
