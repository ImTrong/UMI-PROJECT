import { Request, Response, NextFunction } from 'express';
import { HTTP_STATUS } from '../utils/constants';
import logger from '../utils/logger';

/**
 * Middleware xác thực service-to-service cho learning-service.
 * Endpoint nội bộ phải gửi header X-Internal-Service-Token.
 */
export const verifyInternalService = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = req.headers['x-internal-service-token'] as string;
  const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;

  if (!expectedToken) {
    logger.error('INTERNAL_SERVICE_TOKEN is not configured');
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: 'Internal service authentication not configured',
    });
  }

  if (!token || token !== expectedToken) {
    logger.warn(`Unauthorized internal service call from ${req.ip} to ${req.path}`);
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      error: 'Forbidden: Invalid internal service token',
    });
  }

  next();
};
