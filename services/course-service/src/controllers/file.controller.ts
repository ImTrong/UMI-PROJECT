import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { FileStorageService } from '@umi/file-storage';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import prisma from '../utils/prisma';

export class FileController {
  static async downloadFile(req: AuthRequest, res: Response) {
    try {
      const { bucket, key, courseId } = req.query as { bucket: string; key: string; courseId?: string };

      if (!bucket || !key) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Bucket and key are required' });
      }

      // Check authorization (if courseId is provided, verify enrollment or instructor)
      if (courseId && req.user) {
        const isAdmin = req.user.role === 'ADMIN';
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        
        if (!course) {
          return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.COURSE_NOT_FOUND });
        }
        
        const isInstructor = course.instructorId === req.user.userId;
        let isEnrolled = false;
        
        if (!isAdmin && !isInstructor) {
          try {
            const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
            const response = await require('axios').get(
              `${learningServiceUrl}/api/learning/progress/course/${courseId}`,
              { headers: { Authorization: req.headers.authorization } }
            );
            if (response.data && response.data.data) {
              isEnrolled = true;
            }
          } catch (error) {
            logger.warn(`Failed to check enrollment for file download: ${(error as any).message}`);
          }
        }
        
        if (!isAdmin && !isInstructor && !isEnrolled) {
          return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
        }
      }

      const fileStorage = new FileStorageService();
      
      // Instead of streaming which can block event loop for large files on heavy load,
      // generate a short-lived presigned URL and redirect (since frontend often uses this in <a> tags or <iframe>).
      // Or we can pipe the stream. Let's pipe the stream to completely hide MinIO.
      
      const stream = await fileStorage.getFileStream(bucket, key);
      
      // Try to determine content type from extension
      let contentType = 'application/octet-stream';
      if (key.endsWith('.pdf')) contentType = 'application/pdf';
      else if (key.endsWith('.jpg') || key.endsWith('.jpeg')) contentType = 'image/jpeg';
      else if (key.endsWith('.png')) contentType = 'image/png';
      
      res.setHeader('Content-Type', contentType);
      // For images, allow caching. For documents, inline.
      res.setHeader('Content-Disposition', `inline; filename="${key.split('/').pop()}"`);
      
      stream.pipe(res);
      
      stream.on('error', (err) => {
        logger.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to stream file' });
        }
      });

    } catch (error: any) {
      logger.error('Download file error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to process file download' });
    }
  }
}
