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
 * Then fetch user role from user-service (same pattern as course-service)
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

    // Get user role from user-service (same pattern as course-service)
    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      const userResponse = await axios.get(
        `${userServiceUrl}/api/users/${response.data.user.userId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      req.user = {
        userId: response.data.user.userId,
        email: response.data.user.email,
        role: userResponse.data.data.role,
      };
    } catch (error) {
      // If user-service fails, default to STUDENT (non-privileged)
      logger.warn(
        `Failed to fetch user role from user-service for userId=${response.data.user.userId}. Defaulting to STUDENT.`,
      );
      req.user = {
        userId: response.data.user.userId,
        email: response.data.user.email,
        role: 'STUDENT',
      };
    }

    next();
  } catch (error: any) {
    // RAG-P0: never log the axios error itself - its config carries the token (request body) being verified
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      logger.info(`Authentication refused by auth-service (HTTP ${status})`);
    } else {
      logger.error(`Authentication error: ${status ? `HTTP ${status}` : error?.code || error?.name || 'error'}`);
    }
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
  }
};

/**
 * Require admin role. Must be used AFTER authenticateToken.
 * Returns 403 Forbidden if user is not ADMIN or INSTRUCTOR.
 */
export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
    return;
  }

  const role = req.user.role || 'STUDENT';
  if (role !== 'ADMIN' && role !== 'INSTRUCTOR') {
    res.status(HTTP_STATUS.FORBIDDEN).json({
      error: 'Forbidden: admin or instructor role required',
    });
    return;
  }

  next();
};

