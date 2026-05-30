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
    let token = authHeader && authHeader.split(' ')[1];

    if (!token && req.query.token) {
      token = req.query.token as string;
    }

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

    // Get user role from user service
    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      const userResponse = await axios.get(`${userServiceUrl}/api/users/${response.data.user.userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      req.user = {
        userId: response.data.user.userId,
        email: response.data.user.email,
        role: userResponse.data.data.role,
      };
    } catch (error) {
      // If user service fails, just set basic user info
      logger.warn(`Failed to fetch user role from user-service for userId=${response.data.user.userId}. Defaulting to STUDENT. Error: ${error instanceof Error ? error.message : String(error)}`);
      req.user = {
        userId: response.data.user.userId,
        email: response.data.user.email,
        role: 'STUDENT',
      };
    }

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      error: ERROR_MESSAGES.UNAUTHORIZED,
    });
  }
};

export const authenticateOptional = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader && authHeader.split(' ')[1];

    if (!token && req.query.token) {
      token = req.query.token as string;
    }

    if (!token) {
      return next();
    }

    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    const response = await axios.post(`${authServiceUrl}/api/auth/verify-token`, {
      token,
    });

    if (response.data && response.data.valid) {
      try {
        const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
        const userResponse = await axios.get(`${userServiceUrl}/api/users/${response.data.user.userId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        req.user = {
          userId: response.data.user.userId,
          email: response.data.user.email,
          role: userResponse.data.data.role,
        };
      } catch (error) {
        req.user = {
          userId: response.data.user.userId,
          email: response.data.user.email,
          role: 'STUDENT',
        };
      }
    }

    next();
  } catch (error) {
    next();
  }
};

export const requireRole = (roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: ERROR_MESSAGES.UNAUTHORIZED,
      });
    }

    if (!roles.includes(req.user.role || 'STUDENT')) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        error: ERROR_MESSAGES.FORBIDDEN,
      });
    }

    next();
  };
};

export const requireInstructorOrAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      error: ERROR_MESSAGES.UNAUTHORIZED,
    });
  }

  const role = req.user.role || 'STUDENT';
  if (role !== 'INSTRUCTOR' && role !== 'ADMIN') {
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      error: ERROR_MESSAGES.FORBIDDEN,
    });
  }

  next();
};
