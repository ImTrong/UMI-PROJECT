import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ReviewService } from '../services/review.service';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class ReviewController {
  static async createReview(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.params;
      const review = await ReviewService.createReview({
        ...req.body,
        courseId,
        userId: req.user.userId,
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.REVIEW_CREATED,
        data: review,
      });
    } catch (error: any) {
      logger.error('Create review error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.ALREADY_REVIEWED) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create review',
      });
    }
  }

  static async getCourseReviews(req: AuthRequest, res: Response) {
    try {
      const { courseId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await ReviewService.getCourseReviews(courseId, page, limit);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get course reviews error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get reviews',
      });
    }
  }

  static async getUserReview(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.params;
      const review = await ReviewService.getUserReview(courseId, req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        data: review,
      });
    } catch (error: any) {
      logger.error('Get user review error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get review',
      });
    }
  }

  static async updateReview(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { reviewId } = req.params;
      const review = await ReviewService.updateReview(reviewId, req.user.userId, req.body);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.REVIEW_UPDATED,
        data: review,
      });
    } catch (error: any) {
      logger.error('Update review error:', error);

      if (error.message === ERROR_MESSAGES.REVIEW_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to update review',
      });
    }
  }

  static async deleteReview(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { reviewId } = req.params;
      const isAdmin = req.user.role === 'ADMIN';
      await ReviewService.deleteReview(reviewId, req.user.userId, isAdmin);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.REVIEW_DELETED,
      });
    } catch (error: any) {
      logger.error('Delete review error:', error);

      if (error.message === ERROR_MESSAGES.REVIEW_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to delete review',
      });
    }
  }

  static async getRatingDistribution(req: AuthRequest, res: Response) {
    try {
      const { courseId } = req.params;
      const distribution = await ReviewService.getRatingDistribution(courseId);

      res.status(HTTP_STATUS.OK).json({
        data: distribution,
      });
    } catch (error: any) {
      logger.error('Get rating distribution error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get rating distribution',
      });
    }
  }

  static async getUserReviews(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await ReviewService.getUserReviews(req.user.userId, page, limit);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get user reviews error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get your reviews',
      });
    }
  }
}
