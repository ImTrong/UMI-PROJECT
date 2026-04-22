import { Response, Request } from 'express';
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
      if (error.message === ERROR_MESSAGES.PROGRESS_NOT_FOUND) {
        return res.status(HTTP_STATUS.OK).json({ data: null });
      }
      logger.error('Get course progress error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get course progress' });
    }
  }

  static async getCourseStudents(req: AuthRequest, res: Response) {
    try {
      const { courseId } = req.params;
      const studentsProgress = await ProgressService.getCourseStudents(courseId);
      res.status(HTTP_STATUS.OK).json({ data: studentsProgress });
    } catch (error: any) {
      logger.error('Get course students error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get course students' });
    }
  }

  static async getStudentCourseProgress(req: AuthRequest, res: Response) {
    try {
      const { courseId, userId } = req.params;
      const studentProgress = await ProgressService.getStudentCourseProgress(courseId, userId);
      res.status(HTTP_STATUS.OK).json({ data: studentProgress });
    } catch (error: any) {
      logger.error('Get student course progress error:', error);
      if (error.message === ERROR_MESSAGES.PROGRESS_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get student progress' });
    }
  }

  static async getEnrolledCourses(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const filter = req.query.filter as string | undefined;

      const result = await ProgressService.getEnrolledCourses(req.user.userId, page, limit, filter);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get enrolled courses error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get enrolled courses' });
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

  static async enrollInCourseInternal(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'userId is required' });
      }

      const enrollment = await ProgressService.enrollInCourse(userId, courseId);
      res.status(HTTP_STATUS.CREATED).json({ message: 'Successfully enrolled in course internally', data: enrollment });
    } catch (error: any) {
      logger.error('Internal enroll in course error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to enroll in course internally' });
    }
  }

  static async healthCheck(req: AuthRequest, res: Response) {
    const health = await ProgressService.healthCheck();
    const statusCode = health.database === 'connected' ? HTTP_STATUS.OK : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    res.status(statusCode).json(health);
  }

  static async getLearningStats(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const stats = await ProgressService.getLearningStats(req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: stats });
    } catch (error) {
      logger.error('Get learning stats error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get learning stats' });
    }
  }

  static async syncEnrollments(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const result = await ProgressService.syncEnrollments(req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error) {
      logger.error('Sync enrollments error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to sync enrollments' });
    }
  }
}
