import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { CourseExamService } from '../services/course-exam.service';
import { HTTP_STATUS, ERROR_MESSAGES, SUCCESS_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class CourseExamController {
  /**
   * GET /api/learning/exam/course/:courseId/result
   * Get course exam result (average quiz score, pass/fail)
   */
  static async getCourseExamResult(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { courseId } = req.params;
      const result = await CourseExamService.getCourseExamResult(req.user.userId, courseId);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error: any) {
      logger.error('Get course exam result error:', error);
      if (error.message === ERROR_MESSAGES.PROGRESS_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get course exam result' });
    }
  }

  /**
   * POST /api/learning/exam/course/:courseId/retake
   * Retake a course (reset progress, keep enrollment)
   */
  static async retakeCourse(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { courseId } = req.params;
      const result = await CourseExamService.retakeCourse(req.user.userId, courseId);
      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.COURSE_RETAKE_SUCCESS,
        data: result,
      });
    } catch (error: any) {
      logger.error('Retake course error:', error);
      if (error.message === ERROR_MESSAGES.PROGRESS_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      if (error.message === ERROR_MESSAGES.RETAKE_NOT_ALLOWED || error.message === ERROR_MESSAGES.COURSE_NOT_COMPLETED) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to retake course' });
    }
  }
}
