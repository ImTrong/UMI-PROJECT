import { Response, Request } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { CourseService } from '../services/course.service';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class CourseController {
  static async createCourse(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const course = await CourseService.createCourse({
        ...req.body,
        instructorId: req.user.userId,
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.COURSE_CREATED,
        data: course,
      });
    } catch (error: any) {
      logger.error('Create course error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_ALREADY_EXISTS) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create course',
      });
    }
  }

  static async getCourseById(req: AuthRequest, res: Response) {
    try {
      const { courseId } = req.params;
      const user = req.user ? { userId: req.user.userId, role: req.user.role || 'STUDENT' } : undefined;

      const course = await CourseService.getCourseById(courseId, user);

      res.status(HTTP_STATUS.OK).json({
        data: course,
      });
    } catch (error: any) {
      logger.error('Get course error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.COURSE_NOT_PUBLISHED) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get course',
      });
    }
  }

  static async getCourseBySlug(req: AuthRequest, res: Response) {
    try {
      const { slug } = req.params;
      const user = req.user ? { userId: req.user.userId, role: req.user.role || 'STUDENT' } : undefined;

      const course = await CourseService.getCourseBySlug(slug, user);

      res.status(HTTP_STATUS.OK).json({
        data: course,
      });
    } catch (error: any) {
      logger.error('Get course by slug error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.COURSE_NOT_PUBLISHED) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get course',
      });
    }
  }

  static async getAllCourses(req: AuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const filters = {
        categoryId: req.query.categoryId as string,
        level: req.query.level as any,
        instructorId: req.query.instructorId as string,
        search: req.query.search as string,
        minPrice: req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined,
        maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
      };

      const result = await CourseService.getAllCourses(page, limit, filters);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get all courses error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get courses',
      });
    }
  }

  static async getMyCourses(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await CourseService.getInstructorCourses(req.user.userId, page, limit);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get my courses error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get your courses',
      });
    }
  }

  static async updateCourse(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.params;
      const course = await CourseService.updateCourse(courseId, req.user.userId, req.body);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.COURSE_UPDATED,
        data: course,
      });
    } catch (error: any) {
      logger.error('Update course error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to update course',
      });
    }
  }

  static async deleteCourse(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.params;
      const isAdmin = req.user.role === 'ADMIN';
      await CourseService.deleteCourse(courseId, req.user.userId, isAdmin);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.COURSE_DELETED,
      });
    } catch (error: any) {
      logger.error('Delete course error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to delete course',
      });
    }
  }

  static async publishCourse(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.params;
      const course = await CourseService.publishCourse(courseId, req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.COURSE_PUBLISHED,
        data: course,
      });
    } catch (error: any) {
      logger.error('Publish course error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      // Handle all publish validation errors with 400 so the frontend shows the real message
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: error.message,
      });
    }
  }

  // ==================== Analytics ====================
  static async getAnalytics(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const result = await CourseService.getCourseAnalytics();

      res.status(HTTP_STATUS.OK).json({
        message: 'Course analytics retrieved successfully',
        data: result,
      });
    } catch (error: any) {
      logger.error('Get course analytics error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to retrieve analytics',
      });
    }
  }

  // ==================== Admin Approval ====================

  static async getPendingCourses(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;

      const result = await CourseService.getPendingCourses(page, limit, search);

      res.status(HTTP_STATUS.OK).json({
        message: 'Pending courses retrieved successfully',
        ...result,
      });
    } catch (error: any) {
      logger.error('Get pending courses error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get pending courses' });
    }
  }

  static async approveCourse(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Admin access required' });
      }
      const { courseId } = req.params;
      const course = await CourseService.approveCourse(courseId, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ message: 'Course approved and published', data: course });
    } catch (error: any) {
      logger.error('Approve course error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async rejectCourse(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Admin access required' });
      }
      const { courseId } = req.params;
      const { reason } = req.body;
      if (!reason) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Rejection reason is required' });
      }
      const course = await CourseService.rejectCourse(courseId, req.user.userId, reason);
      res.status(HTTP_STATUS.OK).json({ message: 'Course rejected', data: course });
    } catch (error: any) {
      logger.error('Reject course error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  // ==================== Instructor Dashboard ====================

  static async getInstructorDashboard(req: AuthRequest, res: Response) {
    try {
      if (!req.user || (req.user.role !== 'INSTRUCTOR' && req.user.role !== 'ADMIN')) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Instructor access required' });
      }
      const result = await CourseService.getInstructorDashboard(req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error: any) {
      logger.error('Get instructor dashboard error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get dashboard' });
    }
  }

  static async getCourseStudents(req: AuthRequest, res: Response) {
    try {
      if (!req.user || (req.user.role !== 'INSTRUCTOR' && req.user.role !== 'ADMIN')) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Instructor access required' });
      }
      const { courseId } = req.params;
      const result = await CourseService.getInstructorCourseStudents(courseId, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error: any) {
      logger.error('Get course students error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async getBatchCourses(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'ids array is required in the request body' });
      }

      const courses = await CourseService.getBatchCourses(ids);
      res.status(HTTP_STATUS.OK).json({ data: courses });
    } catch (error: any) {
      logger.error('Get batch courses error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to fetch batch courses' });
    }
  }

  static async incrementEnrollment(req: Request, res: Response) {
    try {
      const { courseId } = req.params;
      await CourseService.incrementEnrollment(courseId);
      res.status(HTTP_STATUS.OK).json({ message: 'Enrollment incremented' });
    } catch (error: any) {
      logger.error('Increment enrollment error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to increment enrollment' });
    }
  }

  static async healthCheck(req: AuthRequest, res: Response) {
    const health = await CourseService.healthCheck();
    const statusCode = health.database === 'connected'
      ? HTTP_STATUS.OK
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;

    res.status(statusCode).json(health);
  }
}
