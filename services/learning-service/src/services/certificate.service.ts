import { PrismaClient, CertificateType } from '@prisma/client';
import axios, { AxiosResponse } from 'axios';
import { ERROR_MESSAGES } from '../utils/constants';
import { CertificateGenerator } from '../utils/certificate-generator';
import { ActivityService } from './activity.service';
import { ActivityAction, CourseDetails, UserDetails, CertificateMetadata } from '../types';
import logger from '../utils/logger';
import { minioInternalClient, BUCKETS } from '../config/minio.config';

const prisma = new PrismaClient();

export class CertificateService {
  static async generateCertificate(userId: string, courseId: string) {
    const courseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (!courseProgress) throw new Error(ERROR_MESSAGES.PROGRESS_NOT_FOUND);
    if (courseProgress.progressPercentage < 100) throw new Error(ERROR_MESSAGES.COURSE_NOT_COMPLETED);

    // Check if course is passed (quiz score check)
    if (courseProgress.passed === false) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_PASSED);
    }

    const existing = await prisma.certificate.findFirst({
      where: { userId, courseId, learningPathId: null },
    });
    if (existing) return existing;

    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

    let user: UserDetails;
    let course: CourseDetails;

    try {
      const userRes: AxiosResponse<{ data: UserDetails[] }> = await axios.post(`${userServiceUrl}/api/users/batch`, { ids: [userId] });
      user = userRes.data.data?.[0];
      if (!user) {
        logger.error(`User not found in batch lookup for userId: ${userId}`);
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }
    } catch (err: any) {
      logger.error(`Failed to fetch user for certificate generation. userId: ${userId}, URL: ${userServiceUrl}, error:`, err.message);
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    try {
      const courseRes: AxiosResponse<{ data: CourseDetails }> = await axios.get(`${courseServiceUrl}/api/courses/${courseId}`);
      course = courseRes.data.data;
    } catch {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    const certificateNumber = this.generateCertificateNumber(userId, courseId);
    const baseUrl = process.env.BASE_URL || 'http://localhost:3006';
    const verificationUrl = `${baseUrl}/api/learning/certificates/verify/${certificateNumber}`;
    const issueDate = new Date();
    const expiresAt = null;

    // Get certificate config from course if available
    const certificateConfig = (course as any).certificateConfig || null;

    let pdfPath = '';
    try {
      pdfPath = await CertificateGenerator.generate({
        certificateNumber,
        userName: user.fullName,
        courseTitle: course.title,
        issueDate,
        verificationUrl,
        type: 'COURSE_COMPLETION',
        certificateConfig,
      });
    } catch (error) {
      logger.error('Failed to generate PDF:', error);
    }

    const metadata: CertificateMetadata = {
      courseInstructor: course.instructorId,
      courseLevel: course.level,
      completionDate: courseProgress.completedAt || undefined,
      totalStudyTime: courseProgress.timeSpentSeconds,
      grade: 'Pass',
      certificateConfig,
    };

    const certificate = await prisma.certificate.create({
      data: {
        certificateNumber,
        userId,
        courseId,
        learningPathId: null,
        courseTitle: course.title,
        userName: user.fullName,
        type: CertificateType.COURSE_COMPLETION,
        averageScore: courseProgress.averageQuizScore,
        issueDate,
        expiresAt,
        certificateUrl: pdfPath,
        verificationUrl,
        metadata,
        isVerified: true,
      },
    });

    await ActivityService.logActivity({
      userId,
      courseId,
      action: ActivityAction.CERTIFICATE_GENERATED,
      metadata: { certificateNumber, courseTitle: course.title },
    });

    return certificate;
  }

  /**
   * Generate a PATH_CERTIFICATE (chứng chỉ) for completing a learning path
   * Requires: path completed + final project score ≥ 80%
   */
  static async generatePathCertificate(userId: string, pathId: string) {
    const path = await prisma.learningPath.findUnique({ where: { id: pathId } });
    if (!path) throw new Error('Learning path not found');

    const enrollment = await prisma.userPathEnrollment.findUnique({
      where: { userId_learningPathId: { userId, learningPathId: pathId } },
    });

    if (!enrollment || enrollment.status !== 'COMPLETED') {
      throw new Error(ERROR_MESSAGES.PATH_NOT_COMPLETED);
    }

    // Check final project score
    const finalProject = await prisma.finalProject.findUnique({
      where: { learningPathId: pathId },
    });

    let finalProjectScore: number | undefined;

    if (finalProject) {
      const submission = await prisma.finalProjectSubmission.findFirst({
        where: { finalProjectId: finalProject.id, userId },
        orderBy: { attemptNumber: 'desc' }
      });

      if (!submission || submission.status !== 'GRADED') {
        throw new Error('Final project has not been graded yet');
      }

      const submissionScore = submission.totalScore ?? submission.score ?? 0;
      const scorePercent = (submissionScore / finalProject.maxScore) * 100;
      if (scorePercent < finalProject.passingScore) {
        throw new Error(ERROR_MESSAGES.PROJECT_SCORE_NOT_ENOUGH);
      }

      finalProjectScore = submissionScore;
    }

    // Check if path certificate already exists
    const existing = await prisma.certificate.findFirst({
      where: { userId, courseId: null, learningPathId: pathId },
    });
    if (existing) return existing;

    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
    let user: UserDetails;
    try {
      const userRes: AxiosResponse<{ data: UserDetails[] }> = await axios.post(`${userServiceUrl}/api/users/batch`, { ids: [userId] });
      user = userRes.data.data?.[0];
      if (!user) {
        logger.error(`User not found in batch lookup for path certificate. userId: ${userId}`);
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }
    } catch (err: any) {
      logger.error(`Failed to fetch user for path certificate generation. userId: ${userId}, URL: ${userServiceUrl}, error:`, err.message);
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const certificateNumber = this.generateCertificateNumber(userId, pathId);
    const baseUrl = process.env.BASE_URL || 'http://localhost:3006';
    const verificationUrl = `${baseUrl}/api/learning/certificates/verify/${certificateNumber}`;
    const issueDate = new Date();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 5); // Path certificates valid for 5 years

    // Get certificate config from learning path if available
    const certificateConfig = (path as any).certificateConfig || null;

    // Use validity years from config or default to 5 years
    if (certificateConfig?.validityYears) {
      expiresAt.setFullYear(expiresAt.getFullYear() - 5 + certificateConfig.validityYears);
    }

    let pdfPath = '';
    try {
      pdfPath = await CertificateGenerator.generate({
        certificateNumber,
        userName: user.fullName,
        courseTitle: path.title,
        issueDate,
        verificationUrl,
        type: 'PATH_CERTIFICATE',
        certificateConfig,
      });
    } catch (error) {
      logger.error('Failed to generate path certificate PDF:', error);
    }

    const metadata: CertificateMetadata = {
      pathTitle: path.title,
      completionDate: enrollment.completedAt || undefined,
      finalProjectScore,
      grade: 'Pass',
      certificateConfig,
    };

    const certificate = await prisma.certificate.create({
      data: {
        certificateNumber,
        userId,
        courseId: null,
        learningPathId: pathId,
        courseTitle: path.title,
        userName: user.fullName,
        type: CertificateType.PATH_CERTIFICATE,
        averageScore: finalProjectScore,
        issueDate,
        expiresAt,
        certificateUrl: pdfPath,
        verificationUrl,
        metadata,
        isVerified: true,
      },
    });

    await ActivityService.logActivity({
      userId,
      action: ActivityAction.PATH_CERTIFICATE_GENERATED,
      metadata: { certificateNumber, pathTitle: path.title },
    });

    return certificate;
  }

  private static generateCertificateNumber(userId: string, courseId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const userShort = userId.slice(-6);
    const courseShort = courseId.slice(-4);
    return `CERT-${timestamp}-${userShort}-${courseShort}-${random}`;
  }

  static async getUserCertificates(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    const [certificates, total] = await Promise.all([
      prisma.certificate.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { issueDate: 'desc' },
      }),
      prisma.certificate.count({ where: { userId } }),
    ]);

    return {
      data: certificates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Get a single certificate by ID (owned by user)
   */
  static async getCertificateById(certificateId: string, userId: string) {
    const certificate = await prisma.certificate.findUnique({
      where: { id: certificateId },
    });

    if (!certificate) throw new Error('Certificate not found');
    if (certificate.userId !== userId) throw new Error(ERROR_MESSAGES.FORBIDDEN);

    return certificate;
  }

  /**
   * Get certificate file key for download; re-generate if missing in MinIO
   */
  static async getCertificateFileKey(certificateId: string, userId: string): Promise<string> {
    const certificate = await this.getCertificateById(certificateId, userId);

    let fileKey = certificate.certificateUrl || '';

    // If file doesn't exist, try to regenerate
    let exists = false;
    if (fileKey) {
      try {
        await minioInternalClient.statObject(BUCKETS.CERTIFICATES, fileKey);
        exists = true;
      } catch (e) {
        exists = false;
      }
    }

    if (!exists) {
      logger.warn(`Certificate file missing for ${certificate.certificateNumber}, regenerating...`);
      try {
        fileKey = await CertificateGenerator.generate({
          certificateNumber: certificate.certificateNumber,
          userName: certificate.userName,
          courseTitle: certificate.courseTitle,
          issueDate: certificate.issueDate,
          verificationUrl: certificate.verificationUrl || '',
        });

        // Update DB with new path
        await prisma.certificate.update({
          where: { id: certificateId },
          data: { certificateUrl: fileKey },
        });
      } catch (error) {
        logger.error('Failed to regenerate certificate PDF:', error);
        throw new Error('Certificate file is not available');
      }
    }

    return fileKey;
  }

  static async verifyCertificate(certificateNumber: string) {
    const certificate = await prisma.certificate.findUnique({
      where: { certificateNumber },
    });

    if (!certificate) {
      return { valid: false, message: 'Certificate not found' };
    }
    if (!certificate.isVerified) {
      return { valid: false, message: 'Certificate has been revoked' };
    }
    if (certificate.expiresAt && certificate.expiresAt < new Date()) {
      return { valid: false, message: 'Certificate has expired', expiredAt: certificate.expiresAt };
    }

    return {
      valid: true,
      message: 'Certificate is valid',
      certificate: {
        certificateNumber: certificate.certificateNumber,
        userName: certificate.userName,
        courseTitle: certificate.courseTitle,
        issueDate: certificate.issueDate,
        expiresAt: certificate.expiresAt,
      },
    };
  }

  static async healthCheck() {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      return {
        service: 'certificate-service',
        status: 'active' as const,
        timestamp: new Date().toISOString(),
        database: 'connected' as const,
      };
    } catch {
      return {
        service: 'certificate-service',
        status: 'degraded' as const,
        timestamp: new Date().toISOString(),
        database: 'disconnected' as const,
      };
    }
  }
}
