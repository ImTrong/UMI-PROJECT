import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { FinalProjectService, pickFinalProjectFields, FINAL_PROJECT_MOVE_REFUSED, FinalProjectUploadError } from '../services/final-project.service';
import { SubmissionAccessService, SubmissionAccessError } from '../services/submission-access.service';
import { SkillProfileService } from '../services/skill-profile.service';
import { PathAccessService, PATH_NOT_FOUND } from '../services/path-access.service';
import { HTTP_STATUS, ERROR_MESSAGES, SUCCESS_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class FinalProjectController {
  /**
   * POST /api/learning/final-project/:pathId
   * Create a final project for a learning path (ADMIN only, FIX-INS-10)
   */
  static async createFinalProject(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      // FIX-INS-10: a final project belongs to a learning path, which only ADMIN manages (no instructor scope exists on paths) -
      // creating one also makes its author a grader (SubmissionAccessService.canGradeFinalProject), so nobody else may create it.
      if (req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      }
      const { pathId } = req.params;
      const body = req.body || {};
      if (body.learningPathId !== undefined && body.learningPathId !== pathId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'learningPathId does not match the route' });
      }
      const project = await FinalProjectService.createFinalProject(
        { ...pickFinalProjectFields(body), learningPathId: pathId } as any,
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
      if (error.message === 'Learning path not found') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
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
      // FIX-INS-12: a learner reads the final project of a path they may see; ADMIN (the path editor) reads any
      if (req.user.role !== 'ADMIN') {
        try {
          await PathAccessService.requireViewable(pathId, req.user.userId);
        } catch {
          return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.FINAL_PROJECT_NOT_FOUND });
        }
      }
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
   * Update a final project (ADMIN only, FIX-INS-10)
   */
  static async updateFinalProject(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      // FIX-INS-10: same rule as create - ADMIN only, before anything is read or written
      if (req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      }
      const { projectId } = req.params;
      const body = req.body || {};
      const updated = await FinalProjectService.updateFinalProject(
        projectId,
        { ...pickFinalProjectFields(body), learningPathId: body.learningPathId } as any,
        req.user.userId
      );
      res.status(HTTP_STATUS.OK).json({ data: updated });
    } catch (error: any) {
      logger.error('Update final project error:', error);
      if (error.message === ERROR_MESSAGES.FINAL_PROJECT_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      if (error.message === FINAL_PROJECT_MOVE_REFUSED) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
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
      const { projectId } = req.params;
      const { fileName, contentType } = req.body || {};
      if (typeof fileName !== 'string' || !fileName.trim() || typeof contentType !== 'string' || !contentType.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'fileName and contentType are required' });
      }
      // FIX-INS-13: only a learner who may submit to THIS final project gets a URL - checked before storage is touched
      await FinalProjectService.requireUploadPermission(projectId, req.user.userId);
      const result = await FinalProjectService.getUploadUrl(fileName, contentType);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error: any) {
      if (error instanceof FinalProjectUploadError) return res.status(error.statusCode).json({ error: error.message });
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
      // FIX-INS-09: only this final project's grader (its author / an ADMIN); learners use /submission(s)/me
      await SubmissionAccessService.requireFinalProjectGrader(projectId, { userId: req.user.userId, role: req.user.role });
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await FinalProjectService.getSubmissions(projectId, page, limit);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      if (error instanceof SubmissionAccessError) return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
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
      // FIX-INS-09: the grader of THIS submission's final project (its author / an ADMIN), checked before anything is written;
      // the grader recorded is the authenticated caller and only score / feedback / status are read from the body
      await SubmissionAccessService.requireFinalProjectSubmission(submissionId, { userId: req.user.userId, role: req.user.role }, false);
      const { score, feedback, status } = req.body || {};
      const result = await FinalProjectService.gradeSubmission(submissionId, req.user.userId, { score, feedback, status });
      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.FINAL_PROJECT_GRADED,
        data: result,
      });
    } catch (error: any) {
      if (error instanceof SubmissionAccessError) return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
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
      // FIX-INS-09: it writes the result, so only the submitter (own work) or this project's grader may trigger it
      await SubmissionAccessService.requireFinalProjectSubmission(submissionId, { userId: req.user.userId, role: req.user.role }, true);
      const token = req.headers.authorization;
      const result = await FinalProjectService.evaluateSubmission(submissionId, token);
      res.status(HTTP_STATUS.OK).json({
        message: 'Đánh giá bài nộp thành công',
        data: result,
      });
    } catch (error: any) {
      if (error instanceof SubmissionAccessError) return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
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
      if (error?.message === PATH_NOT_FOUND) return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      logger.error('Get unlock status error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to check unlock status' });
    }
  }

  // ==================== Phase 1: ZIP & GitHub Submission ====================

  /**
   * POST /api/learning/final-project/:projectId/submit-zip
   * Submit a final project with ZIP source code (Student)
   */
  static async submitWithZip(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { projectId } = req.params;
      const zipFile = req.file;
      if (!zipFile) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Vui lòng upload file ZIP' });
      }

      const { learningPathId, content, demoUrl } = req.body;
      const submission = await FinalProjectService.submitWithZip(
        req.user.userId,
        projectId,
        zipFile,
        { learningPathId, content, demoUrl }
      );

      res.status(HTTP_STATUS.CREATED).json({
        message: 'File ZIP đã được upload thành công. Đang phân tích project...',
        data: submission,
      });
    } catch (error: any) {
      logger.error('Submit ZIP error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to submit ZIP' });
    }
  }

  /**
   * POST /api/learning/final-project/:projectId/submit-github
   * Submit a final project with GitHub URL (Student)
   */
  static async submitWithGithub(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { projectId } = req.params;
      const { learningPathId, githubUrl, content, demoUrl } = req.body;

      if (!githubUrl) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Vui lòng cung cấp GitHub URL' });
      }

      const submission = await FinalProjectService.submitWithGithub(
        req.user.userId,
        projectId,
        { learningPathId, githubUrl, content, demoUrl }
      );

      res.status(HTTP_STATUS.CREATED).json({
        message: 'GitHub URL đã được gửi thành công. Đang phân tích project...',
        data: submission,
      });
    } catch (error: any) {
      logger.error('Submit GitHub error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to submit GitHub URL' });
    }
  }

  /**
   * GET /api/learning/final-project/submission/:submissionId/status
   * Get processing status for a submission
   */
  static async getProcessingStatus(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { submissionId } = req.params;
      await SubmissionAccessService.requireFinalProjectSubmission(submissionId, { userId: req.user.userId, role: req.user.role }, true); // FIX-INS-09
      const result = await FinalProjectService.getSubmissionStatus(submissionId);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error: any) {
      if (error instanceof SubmissionAccessError) return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      logger.error('Get processing status error:', error);
      if (error.message === ERROR_MESSAGES.SUBMISSION_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get processing status' });
    }
  }

  /**
   * GET /api/learning/final-project/submission/:submissionId/context
   * Get Project Context for a submission
   */
  static async getProjectContext(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { submissionId } = req.params;
      await SubmissionAccessService.requireFinalProjectSubmission(submissionId, { userId: req.user.userId, role: req.user.role }, true); // FIX-INS-09
      const result = await FinalProjectService.getProjectContext(submissionId);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error: any) {
      if (error instanceof SubmissionAccessError) return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      logger.error('Get project context error:', error);
      if (error.message === ERROR_MESSAGES.SUBMISSION_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to get project context' });
    }
  }

  /**
   * POST /api/learning/final-project/submission/:submissionId/retry-analysis
   * Retry analysis for a failed submission
   */
  static async retryAnalysis(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { submissionId } = req.params;
      await SubmissionAccessService.requireFinalProjectSubmission(submissionId, { userId: req.user.userId, role: req.user.role }, true); // FIX-INS-09
      const result = await FinalProjectService.retryAnalysis(submissionId);
      res.status(HTTP_STATUS.OK).json({
        message: 'Đang phân tích lại project...',
        data: result,
      });
    } catch (error: any) {
      if (error instanceof SubmissionAccessError) return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      logger.error('Retry analysis error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to retry analysis' });
    }
  }

  // ==================== Skill Profile Endpoints (Phase 3A) ====================

  /**
   * GET /api/learning/skill-profile/me
   * Get current user's skill profile
   */
  static async getMySkillProfile(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const profile = await SkillProfileService.getOrCreateProfile(req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: profile });
    } catch (error: any) {
      logger.error('Get skill profile error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to get skill profile' });
    }
  }

  /**
   * GET /api/learning/skill-profile/me/summary
   * Get skill summary for dashboard
   */
  static async getMySkillSummary(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const summary = await SkillProfileService.getSkillSummary(req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: summary });
    } catch (error: any) {
      logger.error('Get skill summary error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to get skill summary' });
    }
  }

  /**
   * POST /api/learning/skill-profile/me/gap-analysis
   * Get skill gap analysis vs target skills
   * Body: { targetSkills: [{ skill: "React", requiredLevel: "INTERMEDIATE" }] }
   */
  static async getSkillGapAnalysis(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { targetSkills } = req.body;
      if (!targetSkills || !Array.isArray(targetSkills)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'targetSkills array is required' });
      }
      const gaps = await SkillProfileService.getSkillGapAnalysis(req.user.userId, targetSkills);
      res.status(HTTP_STATUS.OK).json({ data: gaps });
    } catch (error: any) {
      logger.error('Skill gap analysis error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to analyze skill gaps' });
    }
  }

  /**
   * GET /api/learning/internal/skill-profile/:userId
   * Internal endpoint — for ai-service to fetch skill profile
   */
  static async getSkillProfileInternal(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      const profile = await SkillProfileService.getProfile(userId);
      res.status(HTTP_STATUS.OK).json({ data: profile });
    } catch (error: any) {
      logger.error('Internal skill profile error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to get skill profile' });
    }
  }
}
