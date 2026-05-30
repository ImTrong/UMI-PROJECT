import { Request, Response } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import logger from '../utils/logger';

interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string;
  };
}

export class AnalyticsController {
  /**
   * GET /api/learning/analytics/study-patterns
   * Get study patterns analysis (hourly distribution, peak hours, preferred time)
   */
  static async getStudyPatterns(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const patterns = await AnalyticsService.getStudyPatterns(userId);

      return res.status(200).json({
        message: 'Study patterns retrieved successfully',
        data: patterns,
      });
    } catch (error: any) {
      logger.error('Error fetching study patterns:', error);
      return res.status(500).json({ error: 'Failed to retrieve study patterns' });
    }
  }

  /**
   * GET /api/learning/analytics/reminders
   * Get smart study reminders (streak warnings, spaced repetition, abandoned courses)
   */
  static async getStudyReminders(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const reminders = await AnalyticsService.getStudyReminders(userId);

      return res.status(200).json({
        message: 'Study reminders retrieved successfully',
        data: reminders,
      });
    } catch (error: any) {
      logger.error('Error fetching study reminders:', error);
      return res.status(500).json({ error: 'Failed to retrieve study reminders' });
    }
  }

  /**
   * GET /api/learning/analytics/heatmap?year=2026
   * Get study heatmap data (GitHub contributions style)
   */
  static async getStudyHeatmap(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const year = req.query.year ? parseInt(req.query.year as string) : undefined;
      const heatmap = await AnalyticsService.getStudyHeatmap(userId, year);

      return res.status(200).json({
        message: 'Study heatmap retrieved successfully',
        data: heatmap,
      });
    } catch (error: any) {
      logger.error('Error fetching study heatmap:', error);
      return res.status(500).json({ error: 'Failed to retrieve study heatmap' });
    }
  }

  /**
   * GET /api/learning/analytics/weekly-report
   * Get weekly learning report with comparisons
   */
  static async getWeeklyReport(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const report = await AnalyticsService.getWeeklyReport(userId);

      return res.status(200).json({
        message: 'Weekly report retrieved successfully',
        data: report,
      });
    } catch (error: any) {
      logger.error('Error fetching weekly report:', error);
      return res.status(500).json({ error: 'Failed to retrieve weekly report' });
    }
  }

  /**
   * GET /api/learning/analytics/optimal-schedule
   * Get optimal study schedule based on user's study patterns
   */
  static async getOptimalSchedule(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const schedule = await AnalyticsService.getOptimalSchedule(userId);

      return res.status(200).json({
        message: 'Optimal schedule retrieved successfully',
        data: schedule,
      });
    } catch (error: any) {
      logger.error('Error fetching optimal schedule:', error);
      return res.status(500).json({ error: 'Failed to retrieve optimal schedule' });
    }
  }

  /**
   * GET /api/learning/analytics/content-recommendations
   * Get personalized content recommendations based on learning analysis
   */
  static async getContentRecommendations(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const recommendations = await AnalyticsService.getContentRecommendations(userId);

      return res.status(200).json({
        message: 'Content recommendations retrieved successfully',
        data: recommendations,
      });
    } catch (error: any) {
      logger.error('Error fetching content recommendations:', error);
      return res.status(500).json({ error: 'Failed to retrieve content recommendations' });
    }
  }

  /**
   * GET /api/learning/analytics/my-schedule
   * Get user's custom study schedule
   */
  static async getMySchedule(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const schedule = await AnalyticsService.getMySchedule(userId);

      return res.status(200).json({
        message: 'My schedule retrieved successfully',
        data: schedule, // Will be null if not set, which is fine
      });
    } catch (error: any) {
      logger.error('Error fetching my schedule:', error);
      return res.status(500).json({ error: 'Failed to retrieve my schedule' });
    }
  }

  /**
   * POST /api/learning/analytics/my-schedule
   * Save user's custom study schedule
   */
  static async saveMySchedule(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const scheduleData = req.body;
      if (!scheduleData || !Array.isArray(scheduleData.slots)) {
        return res.status(400).json({ error: 'Invalid schedule data format' });
      }

      await AnalyticsService.saveMySchedule(userId, scheduleData);

      return res.status(200).json({
        message: 'My schedule saved successfully',
      });
    } catch (error: any) {
      logger.error('Error saving my schedule:', error);
      return res.status(500).json({ error: 'Failed to save my schedule' });
    }
  }
}
