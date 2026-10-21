import { PrismaClient, CertificateType } from '@prisma/client';
import axios, { AxiosResponse } from 'axios';
import { ERROR_MESSAGES } from '../utils/constants';
import { CertificateGenerator } from '../utils/certificate-generator';
import { ActivityService } from './activity.service';
import { blockchainCertificateService } from './blockchain-certificate.service';
import { ActivityAction, CourseDetails, UserDetails, CertificateMetadata, BlockchainMetadata } from '../types';
import logger from '../utils/logger';
import { minioInternalClient, BUCKETS } from '../config/minio.config';

const prisma = new PrismaClient();

export class CertificateService {
  static async generateCertificate(userId: string, courseId: string, fullNameFallback?: string) {
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
      if (!user && fullNameFallback) {
        user = { userId, fullName: fullNameFallback } as unknown as UserDetails;
      } else if (!user) {
        logger.error(`User not found in batch lookup for userId: ${userId}`);
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }
    } catch (err: any) {
      if (fullNameFallback) {
        user = { userId, fullName: fullNameFallback } as unknown as UserDetails;
      } else {
        logger.error(`Failed to fetch user for certificate generation. userId: ${userId}, URL: ${userServiceUrl}, error:`, err.message);
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }
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
    let pdfBuffer: Buffer | null = null;
    try {
      const result = await CertificateGenerator.generate({
        certificateNumber,
        userName: user.fullName,
        courseTitle: course.title,
        issueDate,
        verificationUrl,
        type: 'COURSE_COMPLETION',
        certificateConfig,
      });
      pdfPath = result.filename;
      pdfBuffer = result.pdfBuffer;
    } catch (error) {
      logger.error('Failed to generate PDF:', error);
    }

    // Build metadata with blockchain info
    const metadata: CertificateMetadata = {
      courseInstructor: course.instructorId,
      courseLevel: course.level,
      completionDate: courseProgress.completedAt || undefined,
      totalStudyTime: courseProgress.timeSpentSeconds,
      grade: 'Pass',
      certificateConfig,
    };

    // Hash PDF and prepare blockchain metadata (if enabled and PDF was generated)
    if (blockchainCertificateService.isEnabled() && pdfBuffer && pdfBuffer.length > 0) {
      const documentHash = blockchainCertificateService.hashPdfBuffer(pdfBuffer);
      metadata.blockchain = blockchainCertificateService.createPendingMetadata(
        certificateNumber,
        documentHash
      );
    }

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

    // Background blockchain registration (non-blocking)
    if (metadata.blockchain && pdfBuffer) {
      this.registerOnBlockchain(certificate.id, certificateNumber, metadata.blockchain.documentHash, issueDate)
        .catch(err => logger.error(`Background blockchain registration failed for ${certificateNumber}:`, err));
    }

    return certificate;
  }

  /**
   * Generate a PATH_CERTIFICATE (chứng chỉ) for completing a learning path
   * Requires: path completed + final project score ≥ 80%
   */
  static async generatePathCertificate(userId: string, pathId: string, fullNameFallback?: string) {
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
      if (!user && fullNameFallback) {
        user = { userId, fullName: fullNameFallback } as unknown as UserDetails;
      } else if (!user) {
        logger.error(`User not found in batch lookup for path certificate. userId: ${userId}`);
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }
    } catch (err: any) {
      if (fullNameFallback) {
        user = { userId, fullName: fullNameFallback } as unknown as UserDetails;
      } else {
        logger.error(`Failed to fetch user for path certificate generation. userId: ${userId}, URL: ${userServiceUrl}, error:`, err.message);
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }
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
    let pdfBuffer: Buffer | null = null;
    try {
      const result = await CertificateGenerator.generate({
        certificateNumber,
        userName: user.fullName,
        courseTitle: path.title,
        issueDate,
        verificationUrl,
        type: 'PATH_CERTIFICATE',
        certificateConfig,
      });
      pdfPath = result.filename;
      pdfBuffer = result.pdfBuffer;
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

    // Hash PDF and prepare blockchain metadata (if enabled and PDF was generated)
    if (blockchainCertificateService.isEnabled() && pdfBuffer && pdfBuffer.length > 0) {
      const documentHash = blockchainCertificateService.hashPdfBuffer(pdfBuffer);
      metadata.blockchain = blockchainCertificateService.createPendingMetadata(
        certificateNumber,
        documentHash
      );
    }

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

    // Background blockchain registration (non-blocking)
    if (metadata.blockchain && pdfBuffer) {
      this.registerOnBlockchain(certificate.id, certificateNumber, metadata.blockchain.documentHash, issueDate)
        .catch(err => logger.error(`Background blockchain registration failed for ${certificateNumber}:`, err));
    }

    return certificate;
  }

  /**
   * Background blockchain registration.
   * Updates certificate metadata with txHash on success, or FAILED status on error.
   */
  private static async registerOnBlockchain(
    certificateId: string,
    certificateNumber: string,
    documentHash: string,
    issuedAt: Date
  ): Promise<void> {
    try {
      const result = await blockchainCertificateService.registerCertificate(
        certificateNumber,
        documentHash,
        issuedAt
      );

      if (result) {
        // Update metadata with confirmed transaction
        const certificate = await prisma.certificate.findUnique({ where: { id: certificateId } });
        if (!certificate) return;

        const existingMetadata = (certificate.metadata as CertificateMetadata) || {};
        const blockchainMeta: BlockchainMetadata = {
          ...(existingMetadata.blockchain as BlockchainMetadata),
          transactionHash: result.transactionHash,
          status: 'CONFIRMED',
          registeredAt: new Date().toISOString(),
        };

        await prisma.certificate.update({
          where: { id: certificateId },
          data: {
            metadata: {
              ...existingMetadata,
              blockchain: blockchainMeta,
            } as any,
          },
        });

        logger.info(`⛓️  Certificate ${certificateNumber} blockchain registration CONFIRMED: ${result.transactionHash}`);
      } else {
        // Mark as FAILED
        await this.updateBlockchainStatus(certificateId, 'FAILED');
        logger.warn(`⛓️  Certificate ${certificateNumber} blockchain registration returned null`);
      }
    } catch (error: any) {
      await this.updateBlockchainStatus(certificateId, 'FAILED');
      logger.error(`⛓️  Certificate ${certificateNumber} blockchain registration error:`, error.message);
    }
  }

  /**
   * Update just the blockchain status in certificate metadata.
   */
  static async updateBlockchainStatus(certificateId: string, status: string): Promise<void> {
    try {
      const certificate = await prisma.certificate.findUnique({ where: { id: certificateId } });
      if (!certificate) return;

      const existingMetadata = (certificate.metadata as CertificateMetadata) || {};
      if (existingMetadata.blockchain) {
        existingMetadata.blockchain.status = status as any;
        await prisma.certificate.update({
          where: { id: certificateId },
          data: { metadata: existingMetadata },
        });
      }
    } catch (error) {
      logger.error(`Failed to update blockchain status for certificate ${certificateId}:`, error);
    }
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
        const result = await CertificateGenerator.generate({
          certificateNumber: certificate.certificateNumber,
          userName: certificate.userName,
          courseTitle: certificate.courseTitle,
          issueDate: certificate.issueDate,
          verificationUrl: certificate.verificationUrl || '',
        });
        fileKey = result.filename;

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

  /**
   * Verify certificate — enhanced with blockchain verification.
   * 
   * Cases handled:
   * 1. DB valid + blockchain hash MATCH → VALID + BLOCKCHAIN VERIFIED
   * 2. DB valid + blockchain hash NOT MATCH → Certificate Integrity Failed
   * 3. DB revoked + blockchain REVOKED → Certificate Revoked
   * 4. DB expired → Certificate Expired
   * 5. Blockchain PENDING → Valid but not yet blockchain confirmed
   * 6. No blockchain metadata → Legacy certificate (still valid by DB)
   */
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

    const metadata = certificate.metadata as CertificateMetadata;
    const blockchainMeta = metadata?.blockchain as BlockchainMetadata | undefined;

    // Base response (DB-verified)
    const response: any = {
      valid: true,
      message: 'Certificate is valid',
      certificate: {
        certificateNumber: certificate.certificateNumber,
        userName: certificate.userName,
        courseTitle: certificate.courseTitle,
        type: certificate.type,
        issueDate: certificate.issueDate,
        expiresAt: certificate.expiresAt,
      },
    };

    // Blockchain verification
    if (blockchainMeta && blockchainMeta.status === 'CONFIRMED' && blockchainCertificateService.isEnabled()) {
      try {
        // Download PDF from MinIO and hash it
        const fileKey = certificate.certificateUrl;
        if (fileKey) {
          const stream = await minioInternalClient.getObject(BUCKETS.CERTIFICATES, fileKey);
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const pdfBuffer = Buffer.concat(chunks);

          const integrityResult = await blockchainCertificateService.verifyDocumentIntegrity(
            certificateNumber,
            pdfBuffer
          );

          response.blockchain = {
            verified: integrityResult.verified,
            network: blockchainMeta.network,
            chainId: blockchainMeta.chainId,
            contractAddress: blockchainMeta.contractAddress,
            transactionHash: blockchainMeta.transactionHash,
            documentHash: blockchainMeta.documentHash,
            explorerUrl: blockchainMeta.transactionHash
              ? blockchainCertificateService.getExplorerUrl(blockchainMeta.transactionHash)
              : undefined,
          };

          if (!integrityResult.verified) {
            response.message = 'Certificate is valid but document integrity check failed';
            response.integrityWarning = true;
          }

          // Check on-chain status for revocation
          if (integrityResult.onChainStatus === 2) {
            response.valid = false;
            response.message = 'Certificate has been revoked on blockchain';
            response.blockchain.verified = false;
          }
        }
      } catch (error: any) {
        logger.error('Blockchain verification error during certificate verify:', error.message);
        // Non-fatal: certificate is still valid by DB, just can't verify blockchain
        response.blockchain = {
          verified: false,
          network: blockchainMeta.network,
          chainId: blockchainMeta.chainId,
          error: 'Blockchain verification temporarily unavailable',
        };
      }
    } else if (blockchainMeta && blockchainMeta.status === 'PENDING') {
      response.blockchain = {
        verified: false,
        status: 'PENDING',
        network: blockchainMeta.network,
        chainId: blockchainMeta.chainId,
        message: 'Blockchain confirmation pending',
      };
    } else if (blockchainMeta && blockchainMeta.status === 'FAILED') {
      response.blockchain = {
        verified: false,
        status: 'FAILED',
        network: blockchainMeta.network,
        chainId: blockchainMeta.chainId,
        message: 'Blockchain registration failed',
      };
    } else if (blockchainMeta && blockchainMeta.status === 'REVOKED') {
      response.valid = false;
      response.message = 'Certificate has been revoked';
      response.blockchain = {
        verified: false,
        status: 'REVOKED',
        network: blockchainMeta.network,
        chainId: blockchainMeta.chainId,
        revokeTransactionHash: blockchainMeta.revokeTransactionHash,
        explorerUrl: blockchainMeta.revokeTransactionHash
          ? blockchainCertificateService.getExplorerUrl(blockchainMeta.revokeTransactionHash)
          : undefined,
      };
    }
    // No blockchain metadata → legacy certificate, no blockchain section in response

    return response;
  }

  /**
   * Revoke a certificate — blockchain-first approach.
   * 
   * Flow:
   * 1. Validate certificate exists
   * 2. If blockchain enabled + CONFIRMED: revoke on-chain FIRST
   * 3. Only after blockchain confirms: update DB isVerified = false
   * 4. If blockchain fails: keep isVerified = true, status = REVOKE_FAILED
   */
  static async revokeCertificate(certificateId: string, adminUserId: string) {
    const certificate = await prisma.certificate.findUnique({
      where: { id: certificateId },
    });

    if (!certificate) throw new Error('Certificate not found');
    if (!certificate.isVerified) throw new Error('Certificate is already revoked');

    const metadata = (certificate.metadata as CertificateMetadata) || {};
    const blockchainMeta = metadata.blockchain as BlockchainMetadata | undefined;

    // Step 1: If blockchain is enabled and certificate is CONFIRMED, revoke on-chain first
    if (blockchainCertificateService.isEnabled() && blockchainMeta && blockchainMeta.status === 'CONFIRMED') {
      // Set REVOKE_PENDING
      metadata.blockchain = { ...blockchainMeta, status: 'REVOKE_PENDING' };
      await prisma.certificate.update({
        where: { id: certificateId },
        data: { metadata },
      });

      // Blockchain revocation
      const result = await blockchainCertificateService.revokeCertificate(certificate.certificateNumber);

      if (result) {
        // Blockchain confirmed → NOW update DB
        metadata.blockchain = {
          ...blockchainMeta,
          status: 'REVOKED',
          revokeTransactionHash: result.transactionHash,
          revokedAt: new Date().toISOString(),
        };
        metadata.revokedAt = new Date().toISOString();
        metadata.revokedBy = adminUserId;

        const updated = await prisma.certificate.update({
          where: { id: certificateId },
          data: {
            isVerified: false,
            metadata,
          },
        });

        logger.info(`⛓️  Certificate ${certificate.certificateNumber} revoked on blockchain + DB`);
        return updated;
      } else {
        // Blockchain failed → keep isVerified = true, mark as REVOKE_FAILED
        metadata.blockchain = { ...blockchainMeta, status: 'REVOKE_FAILED' };
        await prisma.certificate.update({
          where: { id: certificateId },
          data: { metadata },
        });

        throw new Error('Blockchain revocation failed. Certificate NOT revoked. Please retry.');
      }
    }

    // Step 2: No blockchain or not CONFIRMED — just update DB
    metadata.revokedAt = new Date().toISOString();
    metadata.revokedBy = adminUserId;
    if (blockchainMeta) {
      metadata.blockchain = { ...blockchainMeta, status: 'REVOKED', revokedAt: new Date().toISOString() };
    }

    const updated = await prisma.certificate.update({
      where: { id: certificateId },
      data: {
        isVerified: false,
        metadata,
      },
    });

    logger.info(`Certificate ${certificate.certificateNumber} revoked in DB by admin ${adminUserId}`);
    return updated;
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
