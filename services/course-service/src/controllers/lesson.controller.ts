import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { LessonService } from '../services/lesson.service';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import { FileStorageService } from '@umi/file-storage';

export class LessonController {
  static async getUploadUrl(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.params;
      const { fileName, contentType } = req.body;

      if (!fileName || !contentType) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'File name and content type are required',
        });
      }

      const fileStorage = new FileStorageService();
      const bucketName = 'courses';

      const { uploadUrl, publicUrl } = await fileStorage.getPresignedUploadUrl({
        bucket: bucketName,
        fileName: fileName,
        mimeType: contentType
      });

      res.status(HTTP_STATUS.OK).json({
        data: {
          uploadUrl,
          fileUrl: publicUrl,
        },
      });
    } catch (error) {
      logger.error('Generate upload URL error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to generate upload URL',
      });
    }
  }
  static async createLesson(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.params;
      const lesson = await LessonService.createLesson({
        ...req.body,
        courseId,
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.LESSON_CREATED,
        data: lesson,
      });
    } catch (error: any) {
      logger.error('Create lesson error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.LESSON_ALREADY_EXISTS || error.code === 'P2002') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: ERROR_MESSAGES.LESSON_ALREADY_EXISTS,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create lesson',
      });
    }
  }

  static async getCourseLessons(req: AuthRequest, res: Response) {
    try {
      const { courseId } = req.params;
      const includeUnpublished = req.user?.role === 'INSTRUCTOR' || req.user?.role === 'ADMIN';

      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      const lessons = await LessonService.getCourseLessons(
        courseId, 
        includeUnpublished,
        req.user?.userId,
        token
      );

      res.status(HTTP_STATUS.OK).json({
        data: lessons,
      });
    } catch (error: any) {
      logger.error('Get course lessons error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get lessons',
      });
    }
  }

  static async getLessonById(req: AuthRequest, res: Response) {
    try {
      const { courseId, lessonId } = req.params;
      
      // Lấy token từ header
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];
      
      const lesson = await LessonService.getLessonById(
        lessonId, 
        courseId,
        req.user?.userId,
        req.user?.role,
        token
      );

      res.status(HTTP_STATUS.OK).json({
        data: lesson,
      });
    } catch (error: any) {
      logger.error('Get lesson error:', error);

      if (error.message === ERROR_MESSAGES.LESSON_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === 'Access denied. You must purchase this course to view this lesson.') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get lesson',
      });
    }
  }

  static async updateLesson(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId, lessonId } = req.params;
      const lesson = await LessonService.updateLesson(
        lessonId,
        courseId,
        req.user.userId,
        req.body
      );

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.LESSON_UPDATED,
        data: lesson,
      });
    } catch (error: any) {
      logger.error('Update lesson error:', error);

      if (error.message === ERROR_MESSAGES.LESSON_NOT_FOUND) {
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
        error: 'Failed to update lesson',
      });
    }
  }

  static async deleteLesson(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId, lessonId } = req.params;
      await LessonService.deleteLesson(lessonId, courseId, req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.LESSON_DELETED,
      });
    } catch (error: any) {
      logger.error('Delete lesson error:', error);

      if (error.message === ERROR_MESSAGES.LESSON_NOT_FOUND) {
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
        error: 'Failed to delete lesson',
      });
    }
  }

  static async reorderLessons(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.params;
      const { lessonOrders } = req.body;

      await LessonService.reorderLessons(courseId, req.user.userId, lessonOrders);

      res.status(HTTP_STATUS.OK).json({
        message: 'Lessons reordered successfully',
      });
    } catch (error: any) {
      logger.error('Reorder lessons error:', error);

      if (error.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to reorder lessons',
      });
    }
  }
}
