import { Request, Response } from 'express';
import { LearnerAnalysisService } from '../services/learner-analysis.service';
import logger from '../utils/logger';

/**
 * LearnerAnalysisController — API endpoints cho Learner Competency Profile
 * 
 * Endpoints:
 * - GET  /api/learning/learner-analysis/me            → Full profile
 * - GET  /api/learning/learner-analysis/me/career-fit  → Career Fit only
 * - GET  /api/learning/learner-analysis/me/skills      → Extended skills summary
 * - POST /api/learning/learner-analysis/me/refresh     → Force refresh
 * - GET  /api/learning/internal/learner-analysis/:userId → Internal (no auth)
 */
export class LearnerAnalysisController {

  /**
   * GET /api/learning/learner-analysis/me
   * Get full Learner Competency Profile for authenticated user
   */
  static async getMyProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const profile = await LearnerAnalysisService.getProfile(userId);

      res.json({
        success: true,
        data: profile,
      });
    } catch (error: any) {
      logger.error('[LearnerAnalysis] Error getting profile:', error);
      res.status(500).json({
        error: 'Failed to get learner analysis profile',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/learning/learner-analysis/me/career-fit
   * Get Career Fit Analysis only
   */
  static async getMyCareerFit(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const careerFit = await LearnerAnalysisService.getCareerFitAnalysis(userId);

      res.json({
        success: true,
        data: careerFit,
      });
    } catch (error: any) {
      logger.error('[LearnerAnalysis] Error getting career fit:', error);
      res.status(500).json({
        error: 'Failed to get career fit analysis',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/learning/learner-analysis/me/skills
   * Get extended skills summary
   */
  static async getMySkillsSummary(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const summary = await LearnerAnalysisService.getExtendedSkillsSummary(userId);

      res.json({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      logger.error('[LearnerAnalysis] Error getting skills summary:', error);
      res.status(500).json({
        error: 'Failed to get skills summary',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/learning/learner-analysis/me/refresh
   * Force refresh — invalidate cache and rebuild
   */
  static async refreshMyProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const profile = await LearnerAnalysisService.refreshProfile(userId);

      res.json({
        success: true,
        data: profile,
        message: 'Profile refreshed successfully',
      });
    } catch (error: any) {
      logger.error('[LearnerAnalysis] Error refreshing profile:', error);
      res.status(500).json({
        error: 'Failed to refresh learner analysis profile',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/learning/internal/learner-analysis/:userId
   * Internal endpoint for ai-service — no authentication
   */
  static async getProfileInternal(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const profile = await LearnerAnalysisService.getProfile(userId);

      res.json({
        success: true,
        data: profile,
      });
    } catch (error: any) {
      logger.error(`[LearnerAnalysis] Error getting internal profile for ${req.params.userId}:`, error);
      res.status(500).json({
        error: 'Failed to get learner analysis profile',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/learning/internal/learner-analysis/:userId/invalidate
   * Internal endpoint to invalidate cache — called by other services when data changes
   */
  static async invalidateCacheInternal(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { event } = req.body;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      await LearnerAnalysisService.invalidateCache(userId, event || 'MANUAL_REFRESH');

      res.json({
        success: true,
        message: `Cache invalidated for user ${userId}`,
      });
    } catch (error: any) {
      logger.error(`[LearnerAnalysis] Error invalidating cache for ${req.params.userId}:`, error);
      res.status(500).json({
        error: 'Failed to invalidate cache',
        message: error.message,
      });
    }
  }
}
