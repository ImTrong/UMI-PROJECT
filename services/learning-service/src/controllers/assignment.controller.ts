import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AssignmentService, pickAssignmentFields } from '../services/assignment.service';
import { SubmissionAccessService, SubmissionAccessError, AssignmentScopeError } from '../services/submission-access.service';
import { CourseAccessError } from '../services/course-access.service';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class AssignmentController {
  static async createAssignment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      if (req.user.role !== 'INSTRUCTOR' && req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      }

      const { lessonId } = req.params;
      const body = req.body || {};
      if (body.lessonId !== undefined && body.lessonId !== lessonId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'lessonId does not match the route' });
      }
      // FIX-INS-10: the course is derived from the lesson by the course-service and the caller must own it (ADMIN: any course);
      // body.courseId / body.createdBy are never stored.
      const { courseId } = await SubmissionAccessService.requireAssignmentCreator(lessonId, body.courseId, { userId: req.user.userId, role: req.user.role });
      const assignment = await AssignmentService.createAssignment({
        ...pickAssignmentFields(body),
        courseId,
        lessonId,
        createdBy: req.user.userId,
      } as any);

      res.status(HTTP_STATUS.CREATED).json({ message: 'Assignment created', data: assignment });
    } catch (error: any) {
      const scoped = AssignmentController.scopeErrorResponse(error);
      if (scoped) return res.status(scoped.status).json({ error: scoped.message });
      logger.error('Create assignment error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async updateAssignment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { assignmentId } = req.params;
      const existing = await SubmissionAccessService.requireAssignmentEditor(assignmentId, { userId: req.user.userId, role: req.user.role });
      const body = req.body || {};
      // FIX-INS-10: an assignment never moves to another course / lesson
      if ((body.courseId !== undefined && body.courseId !== existing.courseId)
        || (body.lessonId !== undefined && body.lessonId !== existing.lessonId)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'courseId / lessonId cannot be changed' });
      }
      const assignment = await AssignmentService.updateAssignment(assignmentId, pickAssignmentFields(body));
      res.status(HTTP_STATUS.OK).json({ message: 'Assignment updated', data: assignment });
    } catch (error: any) {
      const scoped = AssignmentController.scopeErrorResponse(error);
      if (scoped) return res.status(scoped.status).json({ error: scoped.message });
      logger.error('Update assignment error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  /** FIX-INS-10: authorization / scope / course-service errors keep their own status (403 / 400 / 404 / 503). */
  private static scopeErrorResponse(error: any): { status: number; message: string } | null {
    if (error instanceof SubmissionAccessError) return { status: HTTP_STATUS.FORBIDDEN, message: ERROR_MESSAGES.FORBIDDEN };
    if (error instanceof AssignmentScopeError || error instanceof CourseAccessError) {
      return { status: error.statusCode, message: error.message };
    }
    return null;
  }

  static async getAssignmentByLesson(req: AuthRequest, res: Response) {
    try {
      const { lessonId } = req.params;
      const assignment = await AssignmentService.getAssignmentByLessonId(lessonId);
      res.status(HTTP_STATUS.OK).json({ data: assignment });
    } catch (error: any) {
      if (error.message === 'Assignment not found') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      logger.error('Get assignment error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get assignment' });
    }
  }

  static async submitAssignment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { assignmentId } = req.params;
      const submission = await AssignmentService.submitAssignment({
        assignmentId,
        userId: req.user.userId,
        courseId: req.body.courseId,
        content: req.body.content || req.body.submissionText,
        fileUrl: req.body.fileUrl || (Array.isArray(req.body.fileUrls) ? req.body.fileUrls[0] : undefined),
        fileKey: req.body.fileKey,
        fileName: req.body.fileName || (Array.isArray(req.body.fileUrls) && req.body.fileUrls.length > 0 ? req.body.fileUrls[0].split('/').pop() : undefined),
      });
      res.status(HTTP_STATUS.CREATED).json({ message: 'Assignment submitted', data: submission });
    } catch (error: any) {
      logger.error('Submit assignment error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async gradeSubmission(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      if (req.user.role !== 'INSTRUCTOR' && req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      }

      const { submissionId } = req.params;
      // FIX-INS-09: per object - the owner of the course that contains this assignment's lesson, or an ADMIN (403 otherwise,
      // also for an unknown id). Only score + feedback come from the body; the grader is the authenticated caller.
      await SubmissionAccessService.requireAssignmentSubmissionGrader(submissionId, { userId: req.user.userId, role: req.user.role });
      const graded = await AssignmentService.gradeSubmission({
        submissionId,
        score: req.body.score,
        feedback: req.body.feedback,
        gradedBy: req.user.userId,
      });

      res.status(HTTP_STATUS.OK).json({ message: 'Submission graded', data: graded });
    } catch (error: any) {
      if (error instanceof SubmissionAccessError) return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      logger.error('Grade submission error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async getSubmissions(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      if (req.user.role !== 'INSTRUCTOR' && req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      }
      const { assignmentId } = req.params;
      // FIX-INS-09: only the grader of THIS assignment (course owner / ADMIN) - not every INSTRUCTOR
      await SubmissionAccessService.requireAssignmentGrader(assignmentId, { userId: req.user.userId, role: req.user.role });
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await AssignmentService.getSubmissions(assignmentId, page, limit);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      if (error instanceof SubmissionAccessError) return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      logger.error('Get submissions error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get submissions' });
    }
  }

  static async getUserSubmission(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { assignmentId } = req.params;
      const submission = await AssignmentService.getUserSubmission(assignmentId, req.user.userId);
      if (!submission) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Submission not found' });
      }
      res.status(HTTP_STATUS.OK).json({ data: submission });
    } catch (error: any) {
      logger.error('Get user submission error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get submission' });
    }
  }

  static async getUploadUrl(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { assignmentId } = req.params;
      const { fileName, mimeType, contentType } = req.body;
      const result = await AssignmentService.getUploadUrl(assignmentId, fileName, mimeType || contentType);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error: any) {
      logger.error('Get upload URL error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async deleteAssignment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { assignmentId } = req.params;
      await AssignmentService.deleteAssignment(assignmentId, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ message: 'Assignment deleted' });
    } catch (error: any) {
      logger.error('Delete assignment error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }
}
