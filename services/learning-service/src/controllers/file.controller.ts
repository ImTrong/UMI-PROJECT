import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { FileStorageService } from '@umi/file-storage';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import { LearningFileAccessService } from '../services/file-access.service';

// One answer for "no such file" and "not yours": whether a private file exists is not disclosed (FIX-INS-08).
// Never the bucket, the key or anything about the storage.
const NOT_FOUND = { error: 'File not found' };

export class FileController {
  /**
   * GET /api/learning/files/download?bucket=<assignments|quiz-attachments>&key=<key>   (authenticateToken)
   * FIX-INS-07 restricted it to this service's own buckets; FIX-INS-08 serves a file only when
   * LearningFileAccessService has found, in this service's records, every submission that references it and the signed-in
   * caller may read all of them. Any userId / submissionId / courseId in the query is ignored.
   */
  static async downloadFile(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const { bucket, key } = req.query as Record<string, unknown>;

      if (!bucket || !key) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Bucket and key are required' });
      }
      if (!LearningFileAccessService.isValidRequest(bucket, key)) {
        return res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND);
      }

      const allowed = await LearningFileAccessService.canDownload(bucket as string, key as string, { userId: req.user.userId, role: req.user.role });
      if (!allowed) {
        logger.warn(`File download refused for user ${req.user.userId}`);
        return res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND);
      }

      const fileStorage = new FileStorageService();
      let stream: NodeJS.ReadableStream;
      try {
        stream = await fileStorage.getFileStream(bucket as string, key as string);
      } catch (error: any) {
        logger.warn(`File download: object missing in storage (${error?.code || 'error'})`);
        return res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND);
      }

      const fileKey = key as string;
      let contentType = 'application/octet-stream';
      if (fileKey.endsWith('.pdf')) contentType = 'application/pdf';
      else if (fileKey.endsWith('.jpg') || fileKey.endsWith('.jpeg')) contentType = 'image/jpeg';
      else if (fileKey.endsWith('.png')) contentType = 'image/png';
      else if (fileKey.endsWith('.zip')) contentType = 'application/zip';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${fileKey.split('/').pop()}"`);

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
