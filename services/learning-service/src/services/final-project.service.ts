import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES, PROJECT_ANALYSIS_ERRORS, PROJECT_ANALYSIS_SUCCESS } from '../utils/constants';
import { ActivityService } from './activity.service';
import { ProjectAnalyzerService } from './project-analyzer.service';
import { EvaluationEngineService } from './evaluation-engine.service';
import { ActivityAction, FinalProjectData, EvaluationResult, SubmissionDataItem, ProcessingStatus } from '../types';
import logger from '../utils/logger';

let fileStorage: any = null;
try {
  const fileStorageModule = require('@umi/file-storage');
  fileStorage = fileStorageModule.fileStorage;
} catch (e1) {
  try {
    const fileStorageModule = require('../../../shared/file-storage/src');
    fileStorage = fileStorageModule.fileStorage;
  } catch (e2) {
    try {
      const fileStorageModule = require('../../shared/file-storage/src');
      fileStorage = fileStorageModule.fileStorage;
    } catch (e3) {
      logger.warn('FileStorageService not available for final project attachments');
    }
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
        submissionTypes: data.submissionTypes ? JSON.parse(JSON.stringify(data.submissionTypes)) : undefined,
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
        submissionTypes: data.submissionTypes ? JSON.parse(JSON.stringify(data.submissionTypes)) : undefined,
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
      submissionData?: SubmissionDataItem[];
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

    // Validate required submission types
    const submissionTypes = (project.submissionTypes as any[]) || [];
    if (submissionTypes.length > 0 && data.submissionData) {
      for (const st of submissionTypes) {
        if (st.required) {
          const found = data.submissionData.find((sd: SubmissionDataItem) => sd.type === st.type && sd.label === st.label && sd.value);
          if (!found) {
            throw new Error(`Vui lòng điền đầy đủ mục bắt buộc: "${st.label}"`);
          }
        }
      }
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
        submissionData: data.submissionData ? JSON.parse(JSON.stringify(data.submissionData)) : undefined,
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

  // ==================== Phase 1: ZIP & GitHub Submission ====================

  /**
   * Submit with ZIP file — upload to MinIO + trigger project analysis
   */
  static async submitWithZip(
    userId: string,
    projectId: string,
    zipFile: Express.Multer.File,
    data: {
      learningPathId: string;
      content?: string;
      demoUrl?: string;
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

    // Check max attempts
    if (existingCount >= project.maxAttempts) {
      throw new Error(`Bạn đã hết số lần nộp bài (${project.maxAttempts} lần)`);
    }

    const attemptNumber = existingCount + 1;

    // Upload ZIP to MinIO
    let sourceZipUrl = '';
    let sourceZipKey = '';
    if (fileStorage) {
      const result = await fileStorage.uploadFile({
        bucket: 'project-submissions',
        filePath: zipFile.path,
        fileName: `submissions/${userId}/${projectId}/attempt-${attemptNumber}/${zipFile.originalname}`,
        mimeType: 'application/zip',
      });
      sourceZipUrl = result.fileUrl || '';
      sourceZipKey = result.fileKey || '';
    }

    // Create submission with UPLOADED status
    const submission = await prisma.finalProjectSubmission.create({
      data: {
        finalProjectId: projectId,
        userId,
        learningPathId: project.learningPathId,
        attemptNumber,
        content: data.content,
        demoUrl: data.demoUrl,
        fileName: zipFile.originalname,
        sourceZipUrl,
        sourceZipKey,
        processingStatus: ProcessingStatus.UPLOADED,
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
        submissionType: 'ZIP',
      },
    });

    // Trigger async analysis (fire and forget)
    ProjectAnalyzerService.analyzeZipSubmission(submission.id, zipFile.path)
      .catch(err => logger.error(`Async ZIP analysis failed for submission ${submission.id}:`, err));

    logger.info(`ZIP submission created: ${submission.id} by user ${userId} (attempt ${attemptNumber})`);
    return submission;
  }

  /**
   * Submit with GitHub URL — validate URL + trigger project analysis
   */
  static async submitWithGithub(
    userId: string,
    projectId: string,
    data: {
      learningPathId: string;
      githubUrl: string;
      content?: string;
      demoUrl?: string;
    }
  ) {
    const project = await prisma.finalProject.findUnique({ where: { id: projectId } });
    if (!project) throw new Error(ERROR_MESSAGES.FINAL_PROJECT_NOT_FOUND);

    // Validate GitHub URL
    const githubUrlPattern = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/;
    if (!githubUrlPattern.test(data.githubUrl)) {
      throw new Error(PROJECT_ANALYSIS_ERRORS.INVALID_GITHUB_URL);
    }

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

    if (existingCount >= project.maxAttempts) {
      throw new Error(`Bạn đã hết số lần nộp bài (${project.maxAttempts} lần)`);
    }

    const attemptNumber = existingCount + 1;

    // Create submission
    const submission = await prisma.finalProjectSubmission.create({
      data: {
        finalProjectId: projectId,
        userId,
        learningPathId: project.learningPathId,
        attemptNumber,
        content: data.content,
        githubUrl: data.githubUrl,
        demoUrl: data.demoUrl,
        processingStatus: ProcessingStatus.UPLOADED,
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
        submissionType: 'GITHUB',
      },
    });

    // Trigger async analysis
    ProjectAnalyzerService.analyzeGithubSubmission(submission.id, data.githubUrl)
      .catch(err => logger.error(`Async GitHub analysis failed for submission ${submission.id}:`, err));

    logger.info(`GitHub submission created: ${submission.id} by user ${userId} (attempt ${attemptNumber})`);
    return submission;
  }

  /**
   * Get processing status for a submission
   */
  static async getSubmissionStatus(submissionId: string) {
    const submission = await prisma.finalProjectSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        processingStatus: true,
        processingError: true,
        status: true,
        fileName: true,
        githubUrl: true,
        sourceZipUrl: true,
        submittedAt: true,
        totalScore: true,
        score: true,
      },
    });

    if (!submission) throw new Error(ERROR_MESSAGES.SUBMISSION_NOT_FOUND);

    // Get analysis info if available
    const analysis = await prisma.projectAnalysis.findUnique({
      where: { submissionId },
      select: {
        projectType: true,
        primaryLanguage: true,
        totalFiles: true,
        totalLines: true,
        frameworks: true,
        processingStatus: true,
        analyzedAt: true,
      },
    });

    return {
      ...submission,
      analysis: analysis || null,
    };
  }

  /**
   * Get Project Context for a submission (for evaluation)
   */
  static async getProjectContext(submissionId: string) {
    const submission = await prisma.finalProjectSubmission.findUnique({
      where: { id: submissionId },
      select: { projectContext: true, processingStatus: true },
    });

    if (!submission) throw new Error(ERROR_MESSAGES.SUBMISSION_NOT_FOUND);

    if (!submission.projectContext) {
      throw new Error(PROJECT_ANALYSIS_ERRORS.ANALYSIS_NOT_FOUND);
    }

    return {
      processingStatus: submission.processingStatus,
      projectContext: submission.projectContext,
    };
  }

  /**
   * Retry analysis for a failed submission
   */
  static async retryAnalysis(submissionId: string) {
    const submission = await prisma.finalProjectSubmission.findUnique({
      where: { id: submissionId },
    });

    if (!submission) throw new Error(ERROR_MESSAGES.SUBMISSION_NOT_FOUND);

    // Only allow retry if status is ANALYSIS_FAILED or UPLOADED
    if (!['ANALYSIS_FAILED', 'UPLOADED', 'FAILED'].includes(submission.processingStatus)) {
      throw new Error(PROJECT_ANALYSIS_ERRORS.SUBMISSION_NOT_ANALYZABLE);
    }

    // Reset status
    await prisma.finalProjectSubmission.update({
      where: { id: submissionId },
      data: { processingStatus: ProcessingStatus.UPLOADED, processingError: null },
    });

    // Re-trigger analysis
    if (submission.githubUrl) {
      ProjectAnalyzerService.analyzeGithubSubmission(submissionId, submission.githubUrl)
        .catch(err => logger.error(`Retry GitHub analysis failed for submission ${submissionId}:`, err));
    } else if (submission.sourceZipKey && fileStorage) {
      // For ZIP, we need to re-download from MinIO
      const tempPath = `/tmp/project-uploads/retry-${submissionId}-${Date.now()}.zip`;
      try {
        const fs = require('fs');
        fs.mkdirSync('/tmp/project-uploads', { recursive: true });
        await fileStorage.downloadFile({
          bucket: 'project-submissions',
          key: submission.sourceZipKey,
          destinationPath: tempPath,
        });
        ProjectAnalyzerService.analyzeZipSubmission(submissionId, tempPath)
          .catch(err => logger.error(`Retry ZIP analysis failed for submission ${submissionId}:`, err))
          .finally(() => {
            try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
          });
      } catch (err: any) {
        await prisma.finalProjectSubmission.update({
          where: { id: submissionId },
          data: { processingStatus: ProcessingStatus.ANALYSIS_FAILED, processingError: 'Could not download ZIP for re-analysis' },
        });
        throw new Error('Không thể tải lại file ZIP để phân tích. Vui lòng nộp lại bài.');
      }
    } else {
      throw new Error(PROJECT_ANALYSIS_ERRORS.NO_SOURCE_PROVIDED);
    }

    return { message: PROJECT_ANALYSIS_SUCCESS.RETRY_STARTED };
  }

  // ==================== AI Evaluation (Updated for Project Context) ====================

  /**
   * Evaluate submission using AI pipeline
   * Updated: checks processingStatus and sends projectContext instead of raw content
   */
  static async evaluateSubmission(submissionId: string, token?: string) {
    const submission = await prisma.finalProjectSubmission.findUnique({
      where: { id: submissionId },
      include: { finalProject: true },
    });

    if (!submission) throw new Error(ERROR_MESSAGES.SUBMISSION_NOT_FOUND);

    // Check processingStatus — must be READY_FOR_EVALUATION or allow fallback for legacy submissions
    const hasProjectContext = !!submission.projectContext;
    if (submission.processingStatus &&
      submission.processingStatus !== ProcessingStatus.READY_FOR_EVALUATION &&
      submission.processingStatus !== ProcessingStatus.UPLOADED &&
      submission.processingStatus !== 'UPLOADED') {
      if (submission.processingStatus === ProcessingStatus.ANALYZING) {
        throw new Error('Project đang được phân tích. Vui lòng chờ hoàn tất trước khi đánh giá.');
      }
      if (submission.processingStatus === ProcessingStatus.ANALYSIS_FAILED) {
        throw new Error('Phân tích project thất bại. Vui lòng thử "Phân tích lại" trước khi đánh giá.');
      }
    }

    // Mark as grading / evaluating
    await prisma.finalProjectSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'GRADING',
        processingStatus: ProcessingStatus.EVALUATING
      },
    });

    const project = submission.finalProject;
    const pipeline = (project.evaluationPipeline as any[]) || [];

    if (pipeline.length === 0) {
      throw new Error('Bài kiểm tra chưa được cấu hình Evaluation Pipeline');
    }

    // === Phase 2: Per-Criterion Evaluation with Evidence Retrieval ===
    // If projectContext exists, delegate to EvaluationEngineService
    if (hasProjectContext) {
      try {
        const evaluationResult = await EvaluationEngineService.evaluateProject(submissionId, token);
        const isPassed = evaluationResult.passed;

        // If passed, auto-generate path certificate
        if (isPassed) {
          try {
            const enrollment = await prisma.userPathEnrollment.findUnique({
              where: { userId_learningPathId: { userId: submission.userId, learningPathId: submission.learningPathId } }
            });
            if (enrollment && enrollment.status !== 'COMPLETED') {
              await prisma.userPathEnrollment.update({
                where: { id: enrollment.id },
                data: { status: 'COMPLETED', completedAt: new Date() }
              });
            }
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
            score: evaluationResult.totalScore,
            passed: isPassed,
            attemptNumber: submission.attemptNumber,
          },
        });

        // Send notification
        try {
          const notifAxios = require('axios');
          const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
          await notifAxios.post(`${userServiceUrl}/api/users/internal/notifications`, {
            userId: submission.userId,
            title: isPassed ? '🎉 Bài kiểm tra cuối kỳ ĐẠT!' : '📝 Bài kiểm tra cuối kỳ đã được chấm',
            message: isPassed
              ? `Chúc mừng! Bài kiểm tra "${project.title}" đạt ${Math.round(evaluationResult.totalScore)}%. Bạn đủ điều kiện nhận chứng chỉ lộ trình!`
              : `Bài kiểm tra "${project.title}" đạt ${Math.round(evaluationResult.totalScore)}%. Xem feedback chi tiết và cải thiện bài nộp.`,
            type: isPassed ? 'SUCCESS' : 'INFO',
            link: `/final-project/${submission.learningPathId}`,
          });
        } catch (err) {
          logger.error('Failed to send evaluation notification:', err);
        }

        logger.info(`[Phase2] Submission ${submissionId} evaluated: score=${evaluationResult.totalScore}, passed=${isPassed}`);
        return prisma.finalProjectSubmission.findUnique({ where: { id: submissionId } });
      } catch (error: any) {
        await prisma.finalProjectSubmission.update({
          where: { id: submissionId },
          data: {
            status: 'SUBMITTED',
            processingStatus: ProcessingStatus.READY_FOR_EVALUATION,
          },
        });
        logger.error('[Phase2] Evaluation failed:', error);
        throw new Error('Không thể đánh giá bài nộp. Vui lòng thử lại sau.');
      }
    }

    // === Legacy Flow (no projectContext): Send raw content to AI ===
    try {
      const axios = require('axios');
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:3007';

      // Build submission content for AI
      // If projectContext is available (Phase 1 upgrade), use it
      // Otherwise fallback to legacy content assembly
      let submissionContent: string;
      let projectContextData: any = null;

      if (hasProjectContext) {
        // Phase 1 upgraded: send structured projectContext
        projectContextData = submission.projectContext;

        // Build a text summary from projectContext for the AI
        const ctx = submission.projectContext as any;
        const contentParts: string[] = [
          '=== PROJECT CONTEXT ===',
          `Loại project: ${ctx.metadata?.projectType || 'Unknown'}`,
          `Ngôn ngữ chính: ${ctx.metadata?.primaryLanguage || 'Unknown'}`,
          `Frameworks: ${ctx.metadata?.techStack?.frameworks?.join(', ') || 'N/A'}`,
          `Libraries: ${ctx.metadata?.techStack?.libraries?.slice(0, 20)?.join(', ') || 'N/A'}`,
          `Tổng files: ${ctx.structure?.totalFiles || 0}`,
          `Tổng dòng code: ${ctx.structure?.totalLines || 0}`,
          `Entry points: ${ctx.structure?.entryPoints?.join(', ') || 'N/A'}`,
        ];

        if (ctx.artifacts?.readme) {
          contentParts.push(`\n=== README ===\n${ctx.artifacts.readme}`);
        }

        if (submission.githubUrl) contentParts.push(`\nGitHub: ${submission.githubUrl}`);
        if (submission.demoUrl) contentParts.push(`Demo: ${submission.demoUrl}`);
        if (submission.content) contentParts.push(`\nMô tả: ${submission.content}`);

        submissionContent = contentParts.join('\n');
      } else {
        // Legacy fallback: build from submissionData or direct fields
        const contentParts: string[] = [];
        const submissionDataArr = (submission.submissionData as any[]) || [];
        if (submissionDataArr.length > 0) {
          contentParts.push('=== BÀI NỘP CỦA HỌC VIÊN ===');
          for (const item of submissionDataArr) {
            const typeLabels: Record<string, string> = {
              'FILE': '📎 Tệp tin',
              'IMAGE': '🖼️ Hình ảnh',
              'VIDEO': '🎬 Video',
              'AUDIO': '🎵 Âm thanh',
              'GITHUB_LINK': '💻 Link GitHub',
              'DEMO_LINK': '🔗 Link Demo',
              'FIGMA_LINK': '🎨 Link Figma',
              'TEXT': '📝 Văn bản',
              'CUSTOM': '📌 Khác',
            };
            const prefix = typeLabels[item.type] || '📌';
            contentParts.push(`\n${prefix} — ${item.label}:`);
            if (item.fileName) contentParts.push(`  Tên file: ${item.fileName}`);
            contentParts.push(`  Nội dung/Link: ${item.value}`);
          }
        } else {
          if (submission.content) contentParts.push(`Nội dung bài nộp:\n${submission.content}`);
          if (submission.githubUrl) contentParts.push(`Link tài liệu / Bài làm: ${submission.githubUrl}`);
          if (submission.demoUrl) contentParts.push(`Link Video / Demo: ${submission.demoUrl}`);
          if (submission.fileName) contentParts.push(`File đính kèm: ${submission.fileName}`);
        }
        submissionContent = contentParts.filter(Boolean).join('\n');
      }

      const projectInfo = {
        title: project.title,
        description: project.description,
        instructions: project.instructions || '',
        objectives: project.objectives || '',
      };

      // Call AI service to evaluate — include projectContext if available
      const response = await axios.post(`${aiServiceUrl}/api/ai/evaluate-submission`, {
        submissionContent,
        projectInfo,
        evaluationPipeline: pipeline,
        projectContext: projectContextData, // Send structured context for rubric-based retrieval
      }, {
        headers: token ? { Authorization: token } : undefined,
        timeout: 180000, // 3 minutes timeout for AI evaluation with project context
      });

      const result: EvaluationResult = response.data?.data || response.data;

      // Update submission with results
      const updated = await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'GRADED',
          processingStatus: ProcessingStatus.COMPLETED,
          stageResults: result.stageResults ? JSON.parse(JSON.stringify(result.stageResults)) : undefined,
          totalScore: result.totalScore,
          score: result.totalScore, // Also set legacy score field
          aiFeedback: result.feedbackReport,
          gradedAt: new Date(),
        },
      });

      const isPassed = result.totalScore >= project.passingScore;

      // If passed, auto-generate path certificate
      if (isPassed) {
        try {
          // Update enrollment to COMPLETED before generating certificate
          const enrollment = await prisma.userPathEnrollment.findUnique({
            where: { userId_learningPathId: { userId: submission.userId, learningPathId: submission.learningPathId } }
          });
          if (enrollment && enrollment.status !== 'COMPLETED') {
            await prisma.userPathEnrollment.update({
              where: { id: enrollment.id },
              data: { status: 'COMPLETED', completedAt: new Date() }
            });
          }

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
        data: {
          status: 'SUBMITTED',
          processingStatus: hasProjectContext ? ProcessingStatus.READY_FOR_EVALUATION : ProcessingStatus.FAILED,
        },
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
