import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { FileStorageService } from '@umi/file-storage';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import { FileAccessService, DOWNLOAD_BUCKET } from '../services/file-access.service';

// generic answers: never the bucket, the key or anything about the storage (FIX-INS-07)
const NOT_FOUND = { error: 'File not found' };

export class FileController {
  /**
   * GET /api/courses/files/download?bucket=courses&key=<key>[&courseId=<id>][&token=<jwt>]
   * Streams a course file only after FileAccessService has resolved, from this service's own records, which course resource
   * the file belongs to and that the caller may read it (FIX-INS-07). The query string only names the file.
   */
  static async downloadFile(req: AuthRequest, res: Response) {
    try {
      const { bucket, key, courseId } = req.query as Record<string, unknown>;

      if (!bucket || !key) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Bucket and key are required' });
      }
      if (!FileAccessService.isValidRequest(bucket, key)) {
        return res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND);
      }
      if (courseId !== undefined && (typeof courseId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(courseId))) {
        return res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND);
      }

      // the caller's own token (header, or ?token= for <video>/<iframe> sources) is what the enrollment check forwards
      const headerToken = req.headers.authorization?.split(' ')[1];
      const token = headerToken || (typeof req.query.token === 'string' ? req.query.token : undefined);
      const requester = req.user ? { userId: req.user.userId, role: req.user.role, token } : undefined;

      const decision = await FileAccessService.decide(key, requester, courseId as string | undefined);
      if (!decision.allowed) {
        logger.warn(`File download refused (${decision.reason}) for ${requester ? `user ${requester.userId}` : 'an anonymous caller'}`);
        if (decision.status === 401) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
        if (decision.status === 403) return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
        return res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND);
      }

      const fileStorage = new FileStorageService();
      let stream: NodeJS.ReadableStream;
      try {
        stream = await fileStorage.getFileStream(DOWNLOAD_BUCKET, key);
      } catch (error: any) {
        logger.warn(`File download: object missing in storage (${error?.code || 'error'})`);
        return res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND);
      }

      // Try to determine content type from extension
      let contentType = 'application/octet-stream';
      if (key.endsWith('.pdf')) contentType = 'application/pdf';
      else if (key.endsWith('.jpg') || key.endsWith('.jpeg')) contentType = 'image/jpeg';
      else if (key.endsWith('.png')) contentType = 'image/png';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${key.split('/').pop()}"`);

      stream.pipe(res);

      stream.on('error', (err: any) => {
        logger.error(`Stream error: ${err?.code || err?.message || 'error'}`);
        if (!res.headersSent) {
          res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to stream file' });
        }
      });
    } catch (error: any) {
      logger.error(`Download file error: ${error?.code || error?.message || 'error'}`);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to process file download' });
    }
  }
}
