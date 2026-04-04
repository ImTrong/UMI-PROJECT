import { PrismaClient, SubmissionStatus } from '@prisma/client';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface CreateAssignmentData {
  courseId: string;
  lessonId: string;
  title: string;
  description: string;
  instructions?: string;
  maxScore?: number;
  dueDate?: string;
  allowLateSubmission?: boolean;
  allowedFileTypes?: string[];
  maxFileSizeMB?: number;
  createdBy: string;
}

export interface SubmitAssignmentData {
  assignmentId: string;
  userId: string;
  courseId: string;
  content?: string;
  fileUrl?: string;
  fileKey?: string;
  fileName?: string;
}

export interface GradeAssignmentData {
  submissionId: string;
  score: number;
  feedback?: string;
  gradedBy: string;
}

export class AssignmentService {
  /**
   * Create an assignment for a lesson (Instructor only)
   */
  static async createAssignment(data: CreateAssignmentData) {
    const existing = await prisma.assignment.findUnique({
      where: { lessonId: data.lessonId },
    });

    if (existing) {
      throw new Error('An assignment already exists for this lesson');
    }

    const assignment = await prisma.assignment.create({
      data: {
        courseId: data.courseId,
        lessonId: data.lessonId,
        title: data.title,
        description: data.description,
        instructions: data.instructions,
        maxScore: data.maxScore ?? 100,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        allowLateSubmission: data.allowLateSubmission ?? false,
        allowedFileTypes: data.allowedFileTypes ?? ['pdf', 'doc', 'docx', 'zip', 'png', 'jpg'],
        maxFileSizeMB: data.maxFileSizeMB ?? 10,
        createdBy: data.createdBy,
      },
    });

    logger.info(`Assignment created: ${assignment.id} for lesson ${data.lessonId}`);
    return assignment;
  }

  /**
   * Update an assignment
   */
  static async updateAssignment(assignmentId: string, data: Partial<CreateAssignmentData>, userId: string) {
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new Error('Assignment not found');
    if (assignment.createdBy !== userId) throw new Error(ERROR_MESSAGES.FORBIDDEN);

    return prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        title: data.title,
        description: data.description,
        instructions: data.instructions,
        maxScore: data.maxScore,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        allowLateSubmission: data.allowLateSubmission,
        allowedFileTypes: data.allowedFileTypes,
        maxFileSizeMB: data.maxFileSizeMB,
      },
    });
  }

  /**
   * Get assignment by lesson ID
   */
  static async getAssignmentByLessonId(lessonId: string) {
    const assignment = await prisma.assignment.findUnique({
      where: { lessonId },
      include: {
        submissions: {
          select: { id: true, userId: true, status: true, score: true, submittedAt: true },
        },
      },
    });
    if (!assignment) throw new Error('Assignment not found');
    return assignment;
  }

  /**
   * Submit an assignment (Student)
   */
  static async submitAssignment(data: SubmitAssignmentData) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: data.assignmentId },
    });

    if (!assignment) throw new Error('Assignment not found');

    // Check if already submitted
    const existing = await prisma.assignmentSubmission.findUnique({
      where: {
        assignmentId_userId: { assignmentId: data.assignmentId, userId: data.userId },
      },
    });

    if (existing && existing.status === SubmissionStatus.GRADED) {
      throw new Error('Assignment already graded — cannot resubmit');
    }

    // Check due date
    let isLate = false;
    if (assignment.dueDate) {
      const now = new Date();
      if (now > assignment.dueDate) {
        if (!assignment.allowLateSubmission) {
          throw new Error('Assignment deadline has passed');
        }
        isLate = true;
      }
    }

    // Validate file type if file is submitted
    if (data.fileName) {
      const ext = data.fileName.split('.').pop()?.toLowerCase();
      if (ext && !assignment.allowedFileTypes.includes(ext)) {
        throw new Error(`File type .${ext} is not allowed. Allowed types: ${assignment.allowedFileTypes.join(', ')}`);
      }
    }

    if (!data.content && !data.fileUrl) {
      throw new Error('Must provide either text content or a file');
    }

    // Upsert (allow resubmission if not yet graded)
    if (existing) {
      const updated = await prisma.assignmentSubmission.update({
        where: { id: existing.id },
        data: {
          content: data.content,
          fileUrl: data.fileUrl,
          fileKey: data.fileKey,
          fileName: data.fileName,
          status: SubmissionStatus.SUBMITTED,
          isLate,
          submittedAt: new Date(),
          // Reset grading
          score: null,
          feedback: null,
          gradedBy: null,
          gradedAt: null,
        },
      });
      logger.info(`Assignment resubmitted: ${updated.id}`);
      return updated;
    }

    const submission = await prisma.assignmentSubmission.create({
      data: {
        assignmentId: data.assignmentId,
        userId: data.userId,
        courseId: data.courseId,
        content: data.content,
        fileUrl: data.fileUrl,
        fileKey: data.fileKey,
        fileName: data.fileName,
        isLate,
      },
    });

    logger.info(`Assignment submitted: ${submission.id} by user ${data.userId}`);
    return submission;
  }

  /**
   * Grade an assignment submission (Instructor)
   */
  static async gradeSubmission(data: GradeAssignmentData) {
    const submission = await prisma.assignmentSubmission.findUnique({
      where: { id: data.submissionId },
      include: { assignment: true },
    });

    if (!submission) throw new Error('Submission not found');

    if (data.score < 0 || data.score > submission.assignment.maxScore) {
      throw new Error(`Score must be between 0 and ${submission.assignment.maxScore}`);
    }

    const graded = await prisma.assignmentSubmission.update({
      where: { id: data.submissionId },
      data: {
        score: data.score,
        feedback: data.feedback,
        gradedBy: data.gradedBy,
        gradedAt: new Date(),
        status: SubmissionStatus.GRADED,
      },
    });

    logger.info(`Submission graded: ${data.submissionId}, score: ${data.score}`);
    return graded;
  }

  /**
   * Get submissions for an assignment (Instructor view)
   */
  static async getSubmissions(assignmentId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [submissions, total] = await Promise.all([
      prisma.assignmentSubmission.findMany({
        where: { assignmentId },
        skip,
        take: limit,
        orderBy: { submittedAt: 'desc' },
      }),
      prisma.assignmentSubmission.count({ where: { assignmentId } }),
    ]);

    return {
      data: submissions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get user's submission for an assignment
   */
  static async getUserSubmission(assignmentId: string, userId: string) {
    return prisma.assignmentSubmission.findUnique({
      where: { assignmentId_userId: { assignmentId, userId } },
    });
  }

  /**
   * Get presigned upload URL for assignment file (via MinIO)
   */
  static async getUploadUrl(assignmentId: string, fileName: string, mimeType: string) {
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new Error('Assignment not found');

    // Validate file type
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext && !assignment.allowedFileTypes.includes(ext)) {
      throw new Error(`File type .${ext} is not allowed`);
    }

    // Import file storage dynamically (shared package)
    try {
      const { fileStorage } = require('@umi/file-storage');
      const result = await fileStorage.getPresignedUploadUrl({
        bucket: 'assignments',
        fileName,
        mimeType,
      });
      return result;
    } catch (error) {
      logger.error('File storage unavailable:', error);
      throw new Error('File upload service is not available');
    }
  }

  /**
   * Delete assignment
   */
  static async deleteAssignment(assignmentId: string, userId: string) {
    const assignment = await prisma.assignment.findUnique({ 
      where: { id: assignmentId },
      include: {
        submissions: {
          select: { fileKey: true }
        }
      }
    });

    if (!assignment) throw new Error('Assignment not found');
    if (assignment.createdBy !== userId) throw new Error(ERROR_MESSAGES.FORBIDDEN);

    // Garbage collect MinIO files before deleting database records
    try {
      const { fileStorage } = require('@umi/file-storage');
      
      const deletePromises = assignment.submissions
        .filter(sub => sub.fileKey)
        .map(sub => fileStorage.deleteFile('assignments', sub.fileKey).catch((e: any) => {
          logger.warn(`Failed to garbage collect file ${sub.fileKey}: ${e.message}`);
        }));

      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
        logger.info(`Garbage collected ${deletePromises.length} files for assignment ${assignmentId}`);
      }
    } catch (error) {
      logger.error('File storage unavailable for garbage collection:', error);
    }

    await prisma.assignment.delete({ where: { id: assignmentId } });
    logger.info(`Assignment deleted: ${assignmentId}`);
  }
}
