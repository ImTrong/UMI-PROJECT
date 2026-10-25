import { Response, Request } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ProgressService } from '../services/progress.service';
import { CourseAccessError, CourseAccessService } from '../services/course-access.service';
import { OrderEntitlementClient, EntitlementUnavailableError } from '../services/order-entitlement.client';
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
      if (error instanceof CourseAccessError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
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
      const enrollment = await ProgressService.enrollInCourse(req.user.userId, courseId, false);
      res.status(HTTP_STATUS.CREATED).json({ message: 'Successfully enrolled in course', data: enrollment });
    } catch (error: any) {
      logger.error('Enroll in course error:', error);
      if (error instanceof CourseAccessError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      if (error.message?.includes('paid course')) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to enroll in course' });
    }
  }

  /**
   * POST /api/learning/internal/courses/:courseId/enroll - order-service only (ORDER_LEARNING_TOKEN, checked by the route).
   * Body: exactly { userId, orderId }. A paid enrollment is written ONLY after the order-service confirms that this order is
   * PAID, belongs to this learner and grants this course (FIX-INS-04); a payment status, role or price in the body is refused.
   * 201 = enrollment written now, 200 = already enrolled (idempotent retry), 403 = not entitled, 503 = could not be verified.
   */
  static async enrollInCourseInternal(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      const body = req.body;
      const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'userId' && k !== 'orderId')) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Body must be exactly { userId, orderId }' });
      }
      const { userId, orderId } = body;
      if (!isId(userId)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'userId is required' });
      }
      if (!isId(orderId)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'orderId is required' });
      }

      // Payment proof from the order-service's records, BEFORE anything is read or written here.
      const entitlement = await OrderEntitlementClient.check(orderId, userId, courseId);
      if (!entitlement.entitled) {
        logger.warn(`Internal enroll refused: order ${orderId} does not entitle user ${userId} to course ${courseId} (${entitlement.reason})`);
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'The order does not entitle this learner to this course', code: 'NOT_ENTITLED', reason: entitlement.reason });
      }

      const existed = await CourseAccessService.findEnrollment(userId, courseId);
      const enrollment = await ProgressService.enrollInCourse(userId, courseId, true);
      res.status(existed ? HTTP_STATUS.OK : HTTP_STATUS.CREATED).json({
        message: existed ? 'Already enrolled in course' : 'Successfully enrolled in course internally',
        data: enrollment,
      });
    } catch (error: any) {
      if (error instanceof EntitlementUnavailableError) {
        logger.error(`Internal enroll not verified: ${error.message}`);
        return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ error: 'Payment could not be verified; nothing was enrolled', code: 'ENTITLEMENT_UNAVAILABLE' });
      }
      logger.error('Internal enroll in course error:', error);
      if (error instanceof CourseAccessError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to enroll in course internally' });
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
