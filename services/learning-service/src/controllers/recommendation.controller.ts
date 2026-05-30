import { Request, Response } from 'express';
import { RecommendationService } from '../services/recommendation.service';
import { HomeRecommendationService } from '../services/home-recommendation.service';
import { PathService } from '../services/path.service';
import logger from '../utils/logger';

interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string;
  };
}

export class RecommendationController {
  /**
   * Get personalized recommendations for the logged-in user
   */
  static async getPersonalizedRecommendations(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 4;
      const recommendations = await RecommendationService.getPersonalizedRecommendations(userId, limit);

      return res.status(200).json({
        message: 'Personalized recommendations retrieved successfully',
        data: recommendations,
      });
    } catch (error: any) {
      logger.error('Error fetching recommendations:', error);
      return res.status(500).json({ error: 'Failed to retrieve recommendations' });
    }
  }

  /**
   * Get learning insights — category distribution, skills, weekly trends
   */
  static async getLearningInsights(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const insights = await RecommendationService.getLearningInsights(userId);

      return res.status(200).json({
        message: 'Learning insights retrieved successfully',
        data: insights,
      });
    } catch (error: any) {
      logger.error('Error fetching learning insights:', error);
      return res.status(500).json({ error: 'Failed to retrieve learning insights' });
    }
  }

  /**
   * Get smart next actions for the user
   */
  static async getSmartNextActions(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const actions = await RecommendationService.getSmartNextActions(userId);

      return res.status(200).json({
        message: 'Smart next actions retrieved successfully',
        data: actions,
      });
    } catch (error: any) {
      logger.error('Error fetching smart next actions:', error);
      return res.status(500).json({ error: 'Failed to retrieve smart next actions' });
    }
  }

  /**
   * Get enrolled learning paths with real-time progress for the logged-in user
   */
  static async getMyEnrolledPaths(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const paths = await RecommendationService.getMyEnrolledPaths(userId);

      return res.status(200).json({
        message: 'Enrolled paths retrieved successfully',
        data: paths,
      });
    } catch (error: any) {
      logger.error('Error fetching enrolled paths:', error);
      return res.status(500).json({ error: 'Failed to retrieve enrolled paths' });
    }
  }

  /**
   * Get all learning paths with optional filters (category, difficulty, search)
   */
  static async getLearningPaths(req: AuthRequest, res: Response) {
    try {
      const { categories, difficulties, search, sortBy } = req.query;

      const parsedCategories = categories ? (categories as string).split(',').map(c => c.trim()) : undefined;
      const parsedDifficulties = difficulties ? (difficulties as string).split(',').map(d => d.trim()) : undefined;

      const paths = await PathService.getLearningPaths({
        categories: parsedCategories,
        difficulties: parsedDifficulties,
        search: search as string | undefined,
        sortBy: sortBy as any,
      });

      return res.status(200).json({
        message: 'Learning paths retrieved successfully',
        data: paths,
      });
    } catch (error) {
      logger.error('Error fetching learning paths:', error);
      return res.status(500).json({ error: 'Failed to retrieve learning paths' });
    }
  }

  /**
   * Get distinct categories available in learning paths
   */
  static async getPathCategories(req: AuthRequest, res: Response) {
    try {
      const categories = await PathService.getCategories();
      return res.status(200).json({
        message: 'Categories retrieved successfully',
        data: categories,
      });
    } catch (error) {
      logger.error('Error fetching path categories:', error);
      return res.status(500).json({ error: 'Failed to retrieve categories' });
    }
  }

  /**
   * Get detail of a learning path along with milestone progress for user
   */
  static async getLearningPathDetail(req: AuthRequest, res: Response) {
    try {
      const { pathId } = req.params;
      const userId = req.user?.userId;

      const pathDetail = await PathService.getLearningPathDetail(pathId, userId);

      return res.status(200).json({
        message: 'Learning path details retrieved successfully',
        data: pathDetail,
      });
    } catch (error: any) {
      logger.error('Error fetching learning path detail:', error);
      if (error.message === 'Learning path not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to retrieve learning path details' });
    }
  }

  /**
   * Enroll the user in a learning path
   */
  static async enrollInPath(req: AuthRequest, res: Response) {
    try {
      const { pathId } = req.params;
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const enrollment = await PathService.enrollInPath(userId, pathId);

      return res.status(201).json({
        message: 'Enrolled in learning path successfully',
        data: enrollment,
      });
    } catch (error: any) {
      logger.error('Error enrolling in learning path:', error);
      if (error.message === 'Learning path not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to enroll in learning path' });
    }
  }

  /**
   * Unenroll the user from a learning path (preserves course progress)
   */
  static async unenrollFromPath(req: AuthRequest, res: Response) {
    try {
      const { pathId } = req.params;
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
      }

      const result = await PathService.unenrollFromPath(userId, pathId);

      return res.status(200).json({
        message: result.message,
      });
    } catch (error: any) {
      logger.error('Error unenrolling from learning path:', error);
      if (error.message === 'Enrollment not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to unenroll from learning path' });
    }
  }

  /**
   * Get home page recommendations — 7 personalized sections or cold-start
   */
  static async getHomeRecommendations(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId || null;

      const recommendations = await HomeRecommendationService.getHomeRecommendations(userId);

      return res.status(200).json({
        message: 'Home recommendations retrieved successfully',
        data: recommendations,
      });
    } catch (error: any) {
      logger.error('Error fetching home recommendations:', error);
      return res.status(500).json({ error: 'Failed to retrieve home recommendations' });
    }
  }
}
