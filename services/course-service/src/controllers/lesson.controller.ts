import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { LessonService, CreateLessonData } from '../services/lesson.service';
import { LESSON_WRITABLE_FIELDS, pickFields } from '../utils/course-fields';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import { FileStorageService } from '@umi/file-storage';

export class LessonController {
  static async getLessonOwnerInternal(req: AuthRequest, res: Response) {
    try {
      const owner = await LessonService.getLessonOwnerInternal(req.params.lessonId);
      if (!owner) return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.LESSON_NOT_FOUND });
      res.status(HTTP_STATUS.OK).json({ data: owner });
    } catch (error: any) {
      logger.error('Get internal lesson owner error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get lesson owner' });
    }
  }

  static async getCourseLessonsInternal(req: AuthRequest, res: Response) {
    try {
      const { courseId } = req.params;
      const lessons = await LessonService.getCourseLessonsInternal(courseId);

      res.status(HTTP_STATUS.OK).json({
        data: lessons,
      });
    } catch (error: any) {
      logger.error('Get internal course lessons error:', error);
      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get internal lessons' });
    }
  }

  static async getLessonByIdInternal(req: AuthRequest, res: Response) {
    try {
      const { courseId, lessonId } = req.params;
      const lesson = await LessonService.getLessonByIdInternal(courseId, lessonId);

      res.status(HTTP_STATUS.OK).json({
        data: lesson,
      });
    } catch (error: any) {
      logger.error('Get internal lesson by id error:', error);
      if (error.message === ERROR_MESSAGES.LESSON_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get internal lesson' });
    }
  }

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

      // Only the course's instructor gets an upload URL for it (same rule as creating / editing its lessons).
      // Checked BEFORE the storage client is even created, so a refused caller causes no side effect (FIX-INS-02).
      await LessonService.assertCourseOwner(courseId, req.user.userId);

      const fileStorage = new FileStorageService();
      const bucketName = 'courses';

      const { uploadUrl, fileKey } = await fileStorage.getPresignedUploadUrl({
        bucket: bucketName,
        fileName: fileName,
        mimeType: contentType
      });

      res.status(HTTP_STATUS.OK).json({
        data: {
          uploadUrl,
          fileUrl: `/api/courses/files/download?bucket=${bucketName}&key=${fileKey}`,
        },
      });
    } catch (error: any) {
      if (error?.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      if (error?.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: error.message });
      }
      // message only: never the error object, which could carry the signed URL or storage credentials
      logger.error(`Generate upload URL error: ${error?.code || error?.message || 'unknown error'}`);
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

      // The course comes from the URL and the owner check uses the authenticated caller - nothing from the body.
      const { courseId } = req.params;
      const lesson = await LessonService.createLesson(req.user.userId, {
        ...pickFields(req.body, LESSON_WRITABLE_FIELDS),
        courseId,
      } as CreateLessonData);

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

      if (error.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
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
      // FIX-INS-06: the full lesson list (every videoUrl) only for an ADMIN here; the course OWNER is recognised in the service.
      // It used to be ANY instructor - and anyone can register as one - so a paid course's videos were readable without buying it.
      const includeUnpublished = req.user?.role === 'ADMIN';

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

      if (error.message === ERROR_MESSAGES.LESSON_NOT_IN_COURSE) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to reorder lessons',
      });
    }
  }
}
