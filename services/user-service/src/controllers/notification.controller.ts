import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { NotificationService } from '../services/notification.service';
import { HTTP_STATUS } from '../utils/constants';
import logger from '../utils/logger';

export class NotificationController {
  static async getUserNotifications(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await NotificationService.getUserNotifications(req.user.userId, page, limit);

      res.status(HTTP_STATUS.OK).json({
        message: 'Notifications retrieved successfully',
        ...result,
      });
    } catch (error: any) {
      logger.error('Get notifications error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to retrieve notifications',
      });
    }
  }

  static async markAsRead(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const { notificationId } = req.params;
      const result = await NotificationService.markAsRead(notificationId, req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: 'Notification marked as read',
        data: result,
      });
    } catch (error: any) {
      logger.error('Mark notification as read error:', error);
      res.status(
        error.message === 'Notification not found' 
          ? HTTP_STATUS.NOT_FOUND 
          : HTTP_STATUS.INTERNAL_SERVER_ERROR
      ).json({
        error: error.message || 'Failed to update notification',
      });
    }
  }

  static async markAllAsRead(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const result = await NotificationService.markAllAsRead(req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: 'All notifications marked as read',
        updatedCount: result.updatedCount,
      });
    } catch (error: any) {
      logger.error('Mark all notifications as read error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to update notifications',
      });
    }
  }

  static async deleteNotification(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const { notificationId } = req.params;
      const result = await NotificationService.deleteNotification(notificationId, req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: 'Notification deleted successfully',
        ...result,
      });
    } catch (error: any) {
      logger.error('Delete notification error:', error);
      res.status(
        error.message === 'Notification not found' 
          ? HTTP_STATUS.NOT_FOUND 
          : HTTP_STATUS.INTERNAL_SERVER_ERROR
      ).json({
        error: error.message || 'Failed to delete notification',
      });
    }
  }

  // Internal API for other services to create notifications
  static async createInternalNotification(req: AuthRequest, res: Response) {
    try {
      // Typically you'd verify if the request came from another internal microservice using an internal token
      const result = await NotificationService.createNotification(req.body);

      res.status(HTTP_STATUS.CREATED).json({
        message: 'Notification created successfully',
        data: result,
      });
    } catch (error: any) {
      logger.error('Create internal notification error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create notification',
      });
    }
  }
}
