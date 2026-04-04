import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { BadgeService } from '../services/badge.service';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class BadgeController {
  static async getUserBadges(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const badges = await BadgeService.getUserBadges(req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: badges });
    } catch (error) {
      logger.error('Get user badges error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get badges' });
    }
  }
}
