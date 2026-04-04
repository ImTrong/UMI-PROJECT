import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ProgressService } from '../services/progress.service';
import { HTTP_STATUS, ERROR_MESSAGES, SUCCESS_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class ProgressController {
  static async getUserProgress(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const progress = await ProgressService.getUserProgress(req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: progress });
    } catch (error) {
      logger.error('Get user progress error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get user progress' });
    }
  }

  static async getCourseProgress(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { courseId } = req.params;
      const progress = await ProgressService.getCourseProgress(req.user.userId, courseId);
      res.status(HTTP_STATUS.OK).json({ data: progress });
    } catch (error: any) {
      logger.error('Get course progress error:', error);
      if (error.message === ERROR_MESSAGES.PROGRESS_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get course progress' });
    }
  }

  static async markLessonComplete(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { courseId, lessonId } = req.params;
      const { timeSpent } = req.body;
      const result = await ProgressService.markLessonComplete({
        userId: req.user.userId,
        courseId,
        lessonId,
        timeSpentSeconds: timeSpent || 0,
      });
      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.LESSON_COMPLETED,
        data: result,
      });
    } catch (error: any) {
      logger.error('Mark lesson complete error:', error);
      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND || error.message === ERROR_MESSAGES.LESSON_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to mark lesson as complete' });
    }
  }

  static async enrollInCourse(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { courseId } = req.params;
      const enrollment = await ProgressService.enrollInCourse(req.user.userId, courseId);
      res.status(HTTP_STATUS.CREATED).json({ message: 'Successfully enrolled in course', data: enrollment });
    } catch (error: any) {
      logger.error('Enroll in course error:', error);
      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to enroll in course' });
    }
  }

  static async healthCheck(req: AuthRequest, res: Response) {
    const health = await ProgressService.healthCheck();
    const statusCode = health.database === 'connected' ? HTTP_STATUS.OK : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    res.status(statusCode).json(health);
  }
}
