import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { FinalProjectService } from '../services/final-project.service';
import { HTTP_STATUS, ERROR_MESSAGES, SUCCESS_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class FinalProjectController {
  /**
   * POST /api/learning/final-project/:pathId
   * Create a final project for a learning path (Admin/Instructor)
   */
  static async createFinalProject(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { pathId } = req.params;
      const project = await FinalProjectService.createFinalProject(
        { ...req.body, learningPathId: pathId },
        req.user.userId
      );
      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.FINAL_PROJECT_CREATED,
        data: project,
      });
    } catch (error: any) {
      logger.error('Create final project error:', error);
      if (error.message === ERROR_MESSAGES.FINAL_PROJECT_EXISTS) {
        return res.status(HTTP_STATUS.CONFLICT).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to create final project' });
    }
  }

  /**
   * GET /api/learning/final-project/:pathId
   * Get final project for a learning path
   */
  static async getFinalProject(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { pathId } = req.params;
      const project = await FinalProjectService.getFinalProject(pathId);
      res.status(HTTP_STATUS.OK).json({ data: project });
    } catch (error: any) {
      logger.error('Get final project error:', error);
      if (error.message === ERROR_MESSAGES.FINAL_PROJECT_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get final project' });
    }
  }

  /**
   * PUT /api/learning/final-project/:projectId
   * Update a final project (Admin/Instructor)
   */
  static async updateFinalProject(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { projectId } = req.params;
      const updated = await FinalProjectService.updateFinalProject(projectId, req.body, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: updated });
    } catch (error: any) {
      logger.error('Update final project error:', error);
      if (error.message === ERROR_MESSAGES.FINAL_PROJECT_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to update final project' });
    }
  }

  /**
   * POST /api/learning/final-project/:projectId/submit
   * Submit a final project (Student)
   */
  static async submitFinalProject(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { projectId } = req.params;
      const submission = await FinalProjectService.submitFinalProject(req.user.userId, projectId, req.body);
      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.FINAL_PROJECT_SUBMITTED,
        data: submission,
      });
    } catch (error: any) {
      logger.error('Submit final project error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to submit final project' });
    }
  }

  /**
   * POST /api/learning/final-project/:projectId/upload-url
   * Get upload URL for final project file
   */
  static async getUploadUrl(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { fileName, contentType } = req.body;
      const result = await FinalProjectService.getUploadUrl(fileName, contentType);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error: any) {
      logger.error('Get upload URL error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get upload URL' });
    }
  }

  /**
   * GET /api/learning/final-project/:projectId/submissions
   * Get all submissions for a project (Instructor/Admin)
   */
  static async getSubmissions(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { projectId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await FinalProjectService.getSubmissions(projectId, page, limit);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get submissions error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get submissions' });
    }
  }

  /**
   * GET /api/learning/final-project/:projectId/submission/me
   * Get user's latest submission
   */
  static async getUserSubmission(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { projectId } = req.params;
      const submission = await FinalProjectService.getUserSubmission(projectId, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: submission });
    } catch (error: any) {
      logger.error('Get user submission error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get submission' });
    }
  }

  /**
   * GET /api/learning/final-project/:projectId/submissions/me
   * Get ALL user's submissions (all attempts)
   */
  static async getUserSubmissions(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { projectId } = req.params;
      const submissions = await FinalProjectService.getUserSubmissions(projectId, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: submissions });
    } catch (error: any) {
      logger.error('Get user submissions error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get submissions' });
    }
  }

  /**
   * PUT /api/learning/final-project/submission/:submissionId/grade
   * Grade a final project submission (Instructor/Admin)
   */
  static async gradeSubmission(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { submissionId } = req.params;
      const result = await FinalProjectService.gradeSubmission(submissionId, req.user.userId, req.body);
      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.FINAL_PROJECT_GRADED,
        data: result,
      });
    } catch (error: any) {
      logger.error('Grade submission error:', error);
      if (error.message === ERROR_MESSAGES.SUBMISSION_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to grade submission' });
    }
  }

  /**
   * POST /api/learning/final-project/:submissionId/evaluate
   * Trigger AI evaluation for a submission
   */
  static async evaluateSubmission(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { submissionId } = req.params;
      const result = await FinalProjectService.evaluateSubmission(submissionId);
      res.status(HTTP_STATUS.OK).json({
        message: 'Đánh giá bài nộp thành công',
        data: result,
      });
    } catch (error: any) {
      logger.error('Evaluate submission error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to evaluate submission' });
    }
  }

  /**
   * GET /api/learning/final-project/:pathId/unlock-status
   * Check unlock status for the current user
   */
  static async getUnlockStatus(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { pathId } = req.params;
      const status = await FinalProjectService.checkUnlockCondition(req.user.userId, pathId);
      res.status(HTTP_STATUS.OK).json({ data: status });
    } catch (error: any) {
      logger.error('Get unlock status error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to check unlock status' });
    }
  }
}
