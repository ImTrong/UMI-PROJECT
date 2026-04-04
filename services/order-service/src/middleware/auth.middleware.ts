import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string;
  };
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: ERROR_MESSAGES.UNAUTHORIZED,
      });
    }

    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    const response = await axios.post(`${authServiceUrl}/api/auth/verify-token`, {
      token,
    });

    if (!response.data.valid) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: ERROR_MESSAGES.UNAUTHORIZED,
      });
    }

    req.user = {
      userId: response.data.user.userId,
      email: response.data.user.email,
    };

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      error: ERROR_MESSAGES.UNAUTHORIZED,
    });
  }
};

export const requireRole = (roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: ERROR_MESSAGES.UNAUTHORIZED,
      });
    }

    // Get user role from user service
    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      const response = await axios.get(`${userServiceUrl}/api/users/${req.user.userId}`);
      const userRole = response.data.data.role;

      if (!roles.includes(userRole)) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      req.user.role = userRole;
      next();
    } catch (error) {
      logger.error('Role check error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Role verification failed',
      });
    }
  };
};
