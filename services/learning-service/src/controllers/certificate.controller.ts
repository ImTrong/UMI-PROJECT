import { Response } from 'express';
import { minioInternalClient, BUCKETS } from '../config/minio.config';
import { AuthRequest } from '../middleware/auth.middleware';
import { CertificateService } from '../services/certificate.service';
import { HTTP_STATUS, ERROR_MESSAGES, SUCCESS_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class CertificateController {
  static async generateCertificate(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { courseId } = req.params;
      const certificate = await CertificateService.generateCertificate(req.user.userId, courseId);
      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.CERTIFICATE_GENERATED,
        data: certificate,
      });
    } catch (error: any) {
      logger.error('Generate certificate error:', error);
      if (error.message === ERROR_MESSAGES.PROGRESS_NOT_FOUND || error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      if (error.message === ERROR_MESSAGES.COURSE_NOT_COMPLETED) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to generate certificate' });
    }
  }

  static async getUserCertificates(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = await CertificateService.getUserCertificates(req.user.userId, page, limit);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error) {
      logger.error('Get user certificates error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get certificates' });
    }
  }

  static async verifyCertificate(req: AuthRequest, res: Response) {
    try {
      const { certificateNumber } = req.params;
      const result = await CertificateService.verifyCertificate(certificateNumber);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error) {
      logger.error('Verify certificate error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to verify certificate' });
    }
  }

  static async getCertificateDetail(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { certificateId } = req.params;
      const certificate = await CertificateService.getCertificateById(certificateId, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: certificate });
    } catch (error: any) {
      logger.error('Get certificate detail error:', error);
      if (error.message === 'Certificate not found') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      if (error.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get certificate' });
    }
  }

  static async downloadCertificate(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { certificateId } = req.params;
      const fileKey = await CertificateService.getCertificateFileKey(certificateId, req.user.userId);

      try {
        const fileStream = await minioInternalClient.getObject(BUCKETS.CERTIFICATES, fileKey);
        
        const fileName = `certificate-${certificateId}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        
        fileStream.pipe(res);
      } catch (err) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Certificate file not found in storage' });
      }
    } catch (error: any) {
      logger.error('Download certificate error:', error);
      if (error.message === 'Certificate not found') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      if (error.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to download certificate' });
    }
  }

  /**
   * POST /api/learning/certificates/path/:pathId/generate
   * Generate a path certificate (chứng chỉ lộ trình)
   */
  static async generatePathCertificate(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { pathId } = req.params;
      const certificate = await CertificateService.generatePathCertificate(req.user.userId, pathId);
      res.status(HTTP_STATUS.CREATED).json({
        message: 'Chứng chỉ lộ trình đã được tạo thành công',
        data: certificate,
      });
    } catch (error: any) {
      logger.error('Generate path certificate error:', error);
      if (error.message.includes('not found') || error.message.includes('not completed')) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to generate path certificate' });
    }
  }

  static async healthCheck(req: AuthRequest, res: Response) {
    const health = await CertificateService.healthCheck();
    const statusCode = health.database === 'connected' ? HTTP_STATUS.OK : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    res.status(statusCode).json(health);
  }
}
