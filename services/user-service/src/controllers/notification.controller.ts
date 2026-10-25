import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { NotificationService, IdempotencyKeyReusedError, IdempotencyRetryError } from '../services/notification.service';
import { IDEMPOTENCY_HEADER, readIdempotencyKey } from '../services/notification-idempotency';
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

  // Internal API for other services to create notifications.
  // The caller is authenticated by `verifyInternalService` (X-Internal-Service-Token) where the route is registered in app.ts.
  // With an X-Idempotency-Key header the request is idempotent (FIX 06C-4B2B1): 201 when created, 200 + deduplicated for a
  // replay, 400 for an invalid key, 422 when the key was used for a different notification, 409 when the client must retry.
  // Without the header the existing flow below is unchanged.
  static async createInternalNotification(req: AuthRequest, res: Response) {
    let key: string | undefined;
    try {
      key = readIdempotencyKey(req.headers[IDEMPOTENCY_HEADER], req.body);
    } catch (error: any) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message, code: 'INVALID_IDEMPOTENCY_KEY' });
    }
    if (key !== undefined) return NotificationController.createIdempotent(req, res, key);

    try {
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

  private static async createIdempotent(req: AuthRequest, res: Response, key: string) {
    try {
      const result = await NotificationService.createNotificationIdempotent(req.body, key);
      if (!result.deduplicated) {
        return res.status(HTTP_STATUS.CREATED).json({ message: 'Notification created successfully', data: result.notification, deduplicated: false });
      }
      return res.status(HTTP_STATUS.OK).json({
        message: 'Notification already created',
        data: result.notification,
        deduplicated: true,
        ...(result.payloadChanged ? { payloadChanged: true } : {}),
      });
    } catch (error: any) {
      if (error instanceof IdempotencyKeyReusedError) {
        return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
          error: 'The idempotency key was already used for a different notification',
          code: error.code,
          fields: error.fields,
        });
      }
      if (error instanceof IdempotencyRetryError) {
        res.setHeader('Retry-After', '1');
        return res.status(HTTP_STATUS.CONFLICT).json({ error: error.message, code: error.code });
      }
      logger.error('Create idempotent internal notification error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to create notification' });
    }
  }
}
