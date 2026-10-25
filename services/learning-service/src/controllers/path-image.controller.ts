import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { PathImageService, PathImageError, PathImageKind } from '../services/path-image.service';
import { HTTP_STATUS } from '../utils/constants';
import logger from '../utils/logger';

const NOT_FOUND = { error: 'File not found' };

export class PathImageController {
  /** POST /api/learning/admin/paths/upload-url   (authenticateToken + requireRole ADMIN, FIX-INS-14) */
  static async getUploadUrl(req: AuthRequest, res: Response) {
    try {
      const { fileName, contentType } = req.body || {};
      const data = await PathImageService.createUploadUrl(fileName, contentType);
      res.status(HTTP_STATUS.OK).json({ data });
    } catch (error: any) {
      if (error instanceof PathImageError) return res.status(error.statusCode).json({ error: error.message });
      logger.error(`Learning-path image upload URL error: ${error?.code || error?.message || 'error'}`);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get upload URL' });
    }
  }

  /** GET /api/learning/path-images/:key and /api/learning/path-images/legacy/:key   (no session: <img>; see PathImageService) */
  static serve(kind: PathImageKind) {
    return async (req: Request, res: Response) => {
      try {
        const target = await PathImageService.resolveRead(kind, req.params.key, req.query.exp, req.query.sig);
        if (!target) return res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND);
        let stream: NodeJS.ReadableStream;
        try {
          stream = await PathImageService.openStream(target.bucket, target.key);
        } catch {
          return res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND);
        }
        res.setHeader('Content-Type', target.contentType);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', req.query.sig ? 'private, max-age=300' : 'public, max-age=300');
        stream.on('error', () => { if (!res.headersSent) res.status(HTTP_STATUS.NOT_FOUND).json(NOT_FOUND); else res.end(); });
        stream.pipe(res);
      } catch (error: any) {
        logger.error(`Learning-path image read error: ${error?.code || error?.message || 'error'}`);
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to read image' });
      }
    };
  }
}
