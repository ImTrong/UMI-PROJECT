import { Response } from 'express';
import fs from 'fs';
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

  static async healthCheck(req: AuthRequest, res: Response) {
    const health = await CertificateService.healthCheck();
    const statusCode = health.database === 'connected' ? HTTP_STATUS.OK : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    res.status(statusCode).json(health);
  }
}
