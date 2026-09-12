import { Request, Response } from 'express';
import { LearnerAnalyticsEngine } from '../services/learner-analytics/learner-analytics-engine.service';
import logger from '../utils/logger';

interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string;
  };
}

export class LearnerAnalyticsDashboardController {
  /**
   * GET /api/learning/analytics/dashboard
   * Returns aggregated analytics data for the authenticated learner.
   * Single endpoint — all analytics computed in one call.
   */
  static async getDashboard(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const token = req.headers.authorization;
      const dashboardData = await LearnerAnalyticsEngine.getDashboardAnalytics(userId, token);

      return res.status(200).json({
        message: 'Learner analytics dashboard retrieved successfully',
        data: dashboardData,
      });
    } catch (error: any) {
      logger.error('Error fetching learner analytics dashboard:', error);
      return res.status(500).json({
        error: 'Failed to retrieve learner analytics dashboard',
      });
    }
  }
}
