import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { HTTP_STATUS } from '../utils/constants';
import logger from '../utils/logger';

/**
 * Service-to-service authentication for internal endpoints.
 * The caller must send the shared secret in the X-Internal-Service-Token header
 * (same contract as the learning / order services). With no token configured every call is refused.
 */
export const verifyInternalService = (req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected) {
    logger.error('INTERNAL_SERVICE_TOKEN is not configured');
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: 'Internal service authentication not configured',
    });
  }

  const provided = req.headers['x-internal-service-token'];
  const a = Buffer.from(typeof provided === 'string' ? provided : '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    logger.warn(`Unauthorized internal service call from ${req.ip} to ${req.path}`);
    return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Forbidden: Invalid internal service token' });
  }

  next();
};
