import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES } from '../utils/constants';
import { ActivityService } from './activity.service';
import { ActivityAction, FinalProjectData, EvaluationResult } from '../types';
import logger from '../utils/logger';

let fileStorage: any = null;
try {
  const fileStorageModule = require('../../../shared/file-storage/src');
  fileStorage = fileStorageModule.fileStorage;
} catch {
  try {
    const fileStorageModule = require('../../shared/file-storage/src');
    fileStorage = fileStorageModule.fileStorage;
  } catch {
    logger.warn('FileStorageService not available for final project attachments');
  }
}

const prisma = new PrismaClient();

export class FinalProjectService {
  /**
   * Create a final project for a learning path (Admin/Instructor)
   */
  static async createFinalProject(data: FinalProjectData, createdBy: string) {
    // Check if final project already exists
    const existing = await prisma.finalProject.findUnique({
      where: { learningPathId: data.learningPathId },
    });

    if (existing) {
      throw new Error(ERROR_MESSAGES.FINAL_PROJECT_EXISTS);
    }

    // Verify learning path exists
    const path = await prisma.learningPath.findUnique({
      where: { id: data.learningPathId },
    });

    if (!path) {
      throw new Error('Learning path not found');
    }

    const project = await prisma.finalProject.create({
      data: {
        learningPathId: data.learningPathId,
        title: data.title,
        description: data.description,
        instructions: data.instructions,
        objectives: data.objectives,
        references: data.references ? JSON.parse(JSON.stringify(data.references)) : undefined,
        maxScore: data.maxScore ?? 100,
        passingScore: data.passingScore ?? 80,
        allowedFileTypes: data.allowedFileTypes ?? ['pdf', 'doc', 'docx', 'zip', 'rar', 'png', 'jpg'],
        maxFileSizeMB: data.maxFileSizeMB ?? 50,
        maxAttempts: data.maxAttempts ?? 3,
        deadline: data.deadline ? new Date(data.deadline) : undefined,
        evaluationPipeline: data.evaluationPipeline ? JSON.parse(JSON.stringify(data.evaluationPipeline)) : undefined,
        createdBy,
      },
    });

    logger.info(`Final project created: ${project.id} for path ${data.learningPathId}`);
    return project;
  }

  /**
   * Get final project by learning path ID
   */
  static async getFinalProject(learningPathId: string) {
    const project = await prisma.finalProject.findUnique({
      where: { learningPathId },
    });

    if (!project) {
      throw new Error(ERROR_MESSAGES.FINAL_PROJECT_NOT_FOUND);
    }

    return project;
  }

  /**
   * Update final project
   */
  static async updateFinalProject(projectId: string, data: Partial<FinalProjectData>, userId: string) {
    const project = await prisma.finalProject.findUnique({ where: { id: projectId } });
    if (!project) throw new Error(ERROR_MESSAGES.FINAL_PROJECT_NOT_FOUND);

    const updated = await prisma.finalProject.update({
      where: { id: projectId },
      data: {
        title: data.title,
        description: data.description,
        instructions: data.instructions,
        objectives: data.objectives,
        references: data.references ? JSON.parse(JSON.stringify(data.references)) : undefined,
        maxScore: data.maxScore,
        passingScore: data.passingScore,
        allowedFileTypes: data.allowedFileTypes,
        maxFileSizeMB: data.maxFileSizeMB,
        maxAttempts: data.maxAttempts,
        deadline: data.deadline ? new Date(data.deadline) : undefined,
        evaluationPipeline: data.evaluationPipeline ? JSON.parse(JSON.stringify(data.evaluationPipeline)) : undefined,
      },
    });

    return updated;
  }

  /**
   * Check unlock condition for a user on a learning path's final project
   * Returns { unlocked: boolean, reasons: string[], completedCourses, totalCourses }
   */
  static async checkUnlockCondition(userId: string, learningPathId: string) {
    // Get the path and its course IDs
    const path = await prisma.learningPath.findUnique({
      where: { id: learningPathId },
    });

    if (!path) throw new Error('Learning path not found');

    const courseIds = path.courseIds || [];
    if (courseIds.length === 0) {
      return { unlocked: true, reasons: [], completedCourses: 0, totalCourses: 0 };
    }

    // Check enrollment
    const enrollment = await prisma.userPathEnrollment.findUnique({
      where: { userId_learningPathId: { userId, learningPathId } },
    });

    if (!enrollment) {
      return {
        unlocked: false,
        reasons: ['Bạn chưa đăng ký lộ trình này'],
        completedCourses: 0,
        totalCourses: courseIds.length,
      };
    }

    // Check certificates for each course in the path
    const certificates = await prisma.certificate.findMany({
      where: {
        userId,
        courseId: { in: courseIds },
        type: 'COURSE_COMPLETION',
      },
    });

    const certifiedCourseIds = certificates.map(c => c.courseId);
    const missingCourses: string[] = [];

    for (const courseId of courseIds) {
      if (!certifiedCourseIds.includes(courseId)) {
        missingCourses.push(courseId);
      }
    }

    const reasons: string[] = [];
    if (missingCourses.length > 0) {
      // Fetch course progress to get titles
      const courseProgresses = await prisma.courseProgress.findMany({
        where: { userId, courseId: { in: missingCourses } },
      });
      const titleMap = new Map(courseProgresses.map(cp => [cp.courseId, cp.courseTitle]));

      for (const cid of missingCourses) {
        const title = titleMap.get(cid) || cid;
        reasons.push(`Chưa nhận chứng nhận khóa: "${title}"`);
      }
    }

    return {
      unlocked: missingCourses.length === 0,
      reasons,
      completedCourses: courseIds.length - missingCourses.length,
      totalCourses: courseIds.length,
    };
  }

  /**
   * Submit a final project (Student) — supports multi-attempt
   */
  static async submitFinalProject(
    userId: string,
    projectId: string,
    data: {
      learningPathId: string;
      content?: string;
      githubUrl?: string;
      demoUrl?: string;
      fileUrl?: string;
      fileKey?: string;
      fileName?: string;
    }
  ) {
    const project = await prisma.finalProject.findUnique({ where: { id: projectId } });
    if (!project) throw new Error(ERROR_MESSAGES.FINAL_PROJECT_NOT_FOUND);

    // Check unlock condition
    const unlockStatus = await this.checkUnlockCondition(userId, project.learningPathId);
    if (!unlockStatus.unlocked) {
      throw new Error('Bạn chưa đủ điều kiện để làm bài kiểm tra cuối kỳ. ' + unlockStatus.reasons.join('. '));
    }

    // Check deadline
    if (project.deadline && new Date() > project.deadline) {
      throw new Error('Đã quá thời hạn nộp bài kiểm tra cuối kỳ');
    }

    // Count existing submissions
    const existingCount = await prisma.finalProjectSubmission.count({
      where: { finalProjectId: projectId, userId },
    });

    // Check if there's already a passing submission
    const passingSubmission = await prisma.finalProjectSubmission.findFirst({
      where: {
        finalProjectId: projectId,
        userId,
        status: 'GRADED',
        totalScore: { gte: project.passingScore },
      },
    });

    if (passingSubmission) {
      throw new Error('Bạn đã đạt bài kiểm tra cuối kỳ này rồi!');
    }

    // Check max attempts
    if (existingCount >= project.maxAttempts) {
      throw new Error(`Bạn đã hết số lần nộp bài (${project.maxAttempts} lần)`);
    }

    const attemptNumber = existingCount + 1;

    const submission = await prisma.finalProjectSubmission.create({
      data: {
        finalProjectId: projectId,
        userId,
        learningPathId: project.learningPathId,
        attemptNumber,
        content: data.content,
        githubUrl: data.githubUrl,
        demoUrl: data.demoUrl,
        fileUrl: data.fileUrl,
        fileKey: data.fileKey,
        fileName: data.fileName,
        status: 'SUBMITTED',
      },
    });

    // Log activity
    await ActivityService.logActivity({
      userId,
      action: ActivityAction.FINAL_PROJECT_SUBMITTED,
      metadata: {
        projectTitle: project.title,
        learningPathId: project.learningPathId,
        attemptNumber,
      },
    });

    logger.info(`Final project submitted: ${submission.id} by user ${userId} (attempt ${attemptNumber})`);
    return submission;
  }

  /**
   * Evaluate submission using AI pipeline
   */
  static async evaluateSubmission(submissionId: string) {
    const submission = await prisma.finalProjectSubmission.findUnique({
      where: { id: submissionId },
      include: { finalProject: true },
    });

    if (!submission) throw new Error(ERROR_MESSAGES.SUBMISSION_NOT_FOUND);

    // Mark as grading
    await prisma.finalProjectSubmission.update({
      where: { id: submissionId },
      data: { status: 'GRADING' },
    });

    const project = submission.finalProject;
    const pipeline = (project.evaluationPipeline as any[]) || [];

    if (pipeline.length === 0) {
      throw new Error('Bài kiểm tra chưa được cấu hình Evaluation Pipeline');
    }

    try {
      const axios = require('axios');
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:3007';

      // Build submission content for AI
      const submissionContent = [
        submission.content ? `Nội dung bài nộp:\n${submission.content}` : '',
        submission.githubUrl ? `Link tài liệu / Bài làm: ${submission.githubUrl}` : '',
        submission.demoUrl ? `Link Video / Demo: ${submission.demoUrl}` : '',
        submission.fileName ? `File đính kèm: ${submission.fileName}` : '',
      ].filter(Boolean).join('\n\n');

      const projectInfo = {
        title: project.title,
        description: project.description,
        instructions: project.instructions || '',
        objectives: project.objectives || '',
      };

      // Call AI service to evaluate
      const response = await axios.post(`${aiServiceUrl}/api/ai/evaluate-submission`, {
        submissionContent,
        projectInfo,
        evaluationPipeline: pipeline,
      }, {
        timeout: 120000, // 2 minutes timeout for AI evaluation
      });

      const result: EvaluationResult = response.data?.data || response.data;

      // Update submission with results
      const updated = await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'GRADED',
          stageResults: result.stageResults ? JSON.parse(JSON.stringify(result.stageResults)) : undefined,
          totalScore: result.totalScore,
          score: result.totalScore, // Also set legacy score field
          aiFeedback: result.feedbackReport,
          gradedAt: new Date(),
          gradedBy: 'AI_EVALUATOR',
        },
      });

      const isPassed = result.totalScore >= project.passingScore;

      // If passed, auto-generate path certificate
      if (isPassed) {
        try {
          const { CertificateService } = require('./certificate.service');
          await CertificateService.generatePathCertificate(submission.userId, submission.learningPathId);
          logger.info(`Auto-generated path certificate for user ${submission.userId} on path ${submission.learningPathId}`);
        } catch (certErr: any) {
          logger.warn(`Could not auto-generate path certificate: ${certErr.message}`);
        }
      }

      // Log activity
      await ActivityService.logActivity({
        userId: submission.userId,
        action: ActivityAction.FINAL_PROJECT_GRADED,
        metadata: {
          projectTitle: project.title,
          score: result.totalScore,
          passed: isPassed,
          attemptNumber: submission.attemptNumber,
        },
      });

      // Send notification to student
      try {
        const notifAxios = require('axios');
        const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
        await notifAxios.post(`${userServiceUrl}/api/users/internal/notifications`, {
          userId: submission.userId,
          title: isPassed ? '🎉 Bài kiểm tra cuối kỳ ĐẠT!' : '📝 Bài kiểm tra cuối kỳ đã được chấm',
          message: isPassed
            ? `Chúc mừng! Bài kiểm tra "${project.title}" đạt ${Math.round(result.totalScore)}%. Bạn đủ điều kiện nhận chứng chỉ lộ trình!`
            : `Bài kiểm tra "${project.title}" đạt ${Math.round(result.totalScore)}%. Xem feedback chi tiết và cải thiện bài nộp.`,
          type: isPassed ? 'SUCCESS' : 'INFO',
          link: `/final-project/${submission.learningPathId}`,
        });
      } catch (err) {
        logger.error('Failed to send evaluation notification:', err);
      }

      logger.info(`Submission ${submissionId} evaluated: score=${result.totalScore}, passed=${isPassed}`);
      return updated;
    } catch (error: any) {
      // Revert status on failure
      await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: { status: 'SUBMITTED' },
      });
      logger.error('AI evaluation failed:', error);
      throw new Error('Không thể đánh giá bài nộp. Vui lòng thử lại sau.');
    }
  }

  /**
   * Get upload URL for final project file
   */
  static async getUploadUrl(fileName: string, mimeType: string) {
    if (!fileStorage) {
      throw new Error('File storage service is not available');
    }

    const result = await fileStorage.getPresignedUploadUrl({
      bucket: 'assignments', // Reuse assignments bucket
      fileName: `final-projects/${fileName}`,
      mimeType,
    });

    return {
      uploadUrl: result.uploadUrl,
      fileUrl: `/api/learning/files/download?bucket=assignments&key=${result.fileKey}`,
      fileKey: result.fileKey,
    };
  }

  /**
   * Grade a final project submission (Instructor/Admin) — manual grading
   */
  static async gradeSubmission(
    submissionId: string,
    gradedBy: string,
    data: { score: number; feedback?: string; status?: string }
  ) {
    const submission = await prisma.finalProjectSubmission.findUnique({
      where: { id: submissionId },
      include: { finalProject: true },
    });

    if (!submission) throw new Error(ERROR_MESSAGES.SUBMISSION_NOT_FOUND);

    const updated = await prisma.finalProjectSubmission.update({
      where: { id: submissionId },
      data: {
        score: data.score,
        totalScore: data.score,
        feedback: data.feedback,
        status: data.status === 'RETURNED' ? 'RETURNED' : 'GRADED',
        gradedBy,
        gradedAt: new Date(),
      },
    });

    // Log activity
    await ActivityService.logActivity({
      userId: submission.userId,
      action: ActivityAction.FINAL_PROJECT_GRADED,
      metadata: {
        projectTitle: submission.finalProject.title,
        score: data.score,
        passed: data.score >= submission.finalProject.passingScore,
      },
    });

    // Send notification to student
    try {
      const axios = require('axios');
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      const isPassed = data.score >= submission.finalProject.passingScore;

      await axios.post(`${userServiceUrl}/api/users/internal/notifications`, {
        userId: submission.userId,
        title: isPassed ? '🎉 Project cuối kỳ đạt điểm!' : '📝 Project cuối kỳ đã được chấm',
        message: isPassed
          ? `Chúc mừng! Project "${submission.finalProject.title}" đạt ${Math.round(data.score)}%. Bạn đủ điều kiện nhận chứng chỉ lộ trình!`
          : `Project "${submission.finalProject.title}" đạt ${Math.round(data.score)}%. Hãy cải thiện để nhận chứng chỉ.`,
        type: isPassed ? 'SUCCESS' : 'INFO',
        link: '/learning-paths',
      });
    } catch (err) {
      logger.error('Failed to send final project grading notification:', err);
    }

    logger.info(`Final project graded: ${submissionId}, score: ${data.score}`);
    return updated;
  }

  /**
   * Get all submissions for a project (Instructor/Admin)
   */
  static async getSubmissions(projectId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [submissions, total] = await Promise.all([
      prisma.finalProjectSubmission.findMany({
        where: { finalProjectId: projectId },
        skip,
        take: limit,
        orderBy: { submittedAt: 'desc' },
      }),
      prisma.finalProjectSubmission.count({
        where: { finalProjectId: projectId },
      }),
    ]);

    return {
      data: submissions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get user's own submission (latest attempt)
   */
  static async getUserSubmission(projectId: string, userId: string) {
    return prisma.finalProjectSubmission.findFirst({
      where: { finalProjectId: projectId, userId },
      orderBy: { attemptNumber: 'desc' },
    });
  }

  /**
   * Get ALL user's submissions for a project (all attempts)
   */
  static async getUserSubmissions(projectId: string, userId: string) {
    return prisma.finalProjectSubmission.findMany({
      where: { finalProjectId: projectId, userId },
      orderBy: { attemptNumber: 'desc' },
    });
  }
}
