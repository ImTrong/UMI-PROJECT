import { PrismaClient } from '@prisma/client';
import axios, { AxiosResponse } from 'axios';
import { ERROR_MESSAGES } from '../utils/constants';
import { CertificateGenerator } from '../utils/certificate-generator';
import { ActivityService } from './activity.service';
import { ActivityAction, CourseDetails, UserDetails, CertificateMetadata } from '../types';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export class CertificateService {
  static async generateCertificate(userId: string, courseId: string) {
    const courseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (!courseProgress) throw new Error(ERROR_MESSAGES.PROGRESS_NOT_FOUND);
    if (courseProgress.progressPercentage < 100) throw new Error(ERROR_MESSAGES.COURSE_NOT_COMPLETED);

    const existing = await prisma.certificate.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) return existing;

    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001';
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

    let user: UserDetails;
    let course: CourseDetails;

    try {
      const userRes: AxiosResponse<{ data: UserDetails[] }> = await axios.post(`${userServiceUrl}/api/users/batch`, { ids: [userId] });
      user = userRes.data.data?.[0];
      if (!user) {
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }
    } catch {
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
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    let pdfPath = '';
    try {
      pdfPath = await CertificateGenerator.generate({
        certificateNumber,
        userName: user.fullName,
        courseTitle: course.title,
        issueDate,
        verificationUrl,
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
    };

    const certificate = await prisma.certificate.create({
      data: {
        certificateNumber,
        userId,
        courseId,
        courseTitle: course.title,
        userName: user.fullName,
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
   * Get certificate file path for download; re-generate if missing
   */
  static async getCertificateFilePath(certificateId: string, userId: string): Promise<string> {
    const certificate = await this.getCertificateById(certificateId, userId);

    let filePath = certificate.certificateUrl || '';

    // If file doesn't exist, try to regenerate
    const fs = await import('fs');
    if (!filePath || !fs.existsSync(filePath)) {
      logger.warn(`Certificate file missing for ${certificate.certificateNumber}, regenerating...`);
      try {
        filePath = await CertificateGenerator.generate({
          certificateNumber: certificate.certificateNumber,
          userName: certificate.userName,
          courseTitle: certificate.courseTitle,
          issueDate: certificate.issueDate,
          verificationUrl: certificate.verificationUrl || '',
        });

        // Update DB with new path
        await prisma.certificate.update({
          where: { id: certificateId },
          data: { certificateUrl: filePath },
        });
      } catch (error) {
        logger.error('Failed to regenerate certificate PDF:', error);
        throw new Error('Certificate file is not available');
      }
    }

    return filePath;
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
