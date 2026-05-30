import { Request, Response, NextFunction } from 'express';
import axios, { AxiosResponse } from 'axios';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string;
  };
}

/**
 * Authenticate JWT token by verifying with auth-service
 * Pattern matches learning-service auth middleware
 */
export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      return;
    }

    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    const response: AxiosResponse<{ valid: boolean; user: { userId: string; email: string } }> = 
      await axios.post(`${authServiceUrl}/api/auth/verify-token`, { token });

    if (!response.data.valid) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      return;
    }

    req.user = {
      userId: response.data.user.userId,
      email: response.data.user.email,
    };

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
  }
};
