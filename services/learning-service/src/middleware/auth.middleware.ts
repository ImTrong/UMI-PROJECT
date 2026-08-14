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

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader?.split(' ')[1];
    
    // Fallback to query param token (used for video streaming)
    if (!token && req.query.token) {
      token = req.query.token as string;
    }

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

    // Fetch role from user-service so controllers can check req.user.role
    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      const userResponse = await axios.get(`${userServiceUrl}/api/users/${req.user.userId}`, {
        headers: { Authorization: authHeader || `Bearer ${token}` },
      });
      req.user.role = userResponse.data.data?.role || userResponse.data.role;
    } catch (roleErr: any) {
      logger.warn('Could not fetch user role, proceeding without it. Status:', roleErr?.response?.status);
    }

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
  }
};

/**
 * Optional authentication middleware.
 * Tries to verify the JWT token if present, but proceeds without auth
 * if the token is missing, expired, or invalid.
 * This prevents 401 errors on endpoints that should work for both
 * authenticated and unauthenticated users.
 */
export const authenticateOptional = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader?.split(' ')[1];

    // Fallback to query param token
    if (!token && req.query.token) {
      token = req.query.token as string;
    }

    // No token present — proceed without auth
    if (!token) {
      return next();
    }

    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    const response: AxiosResponse<{ valid: boolean; user: { userId: string; email: string } }> =
      await axios.post(`${authServiceUrl}/api/auth/verify-token`, { token });

    if (response.data.valid) {
      req.user = {
        userId: response.data.user.userId,
        email: response.data.user.email,
      };

      // Try to fetch role but don't block if it fails
      try {
        const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
        const userResponse = await axios.get(`${userServiceUrl}/api/users/${req.user.userId}`, {
          headers: { Authorization: authHeader || `Bearer ${token}` },
        });
        req.user.role = userResponse.data.data?.role || userResponse.data.role;
      } catch (roleErr: any) {
        logger.warn('Optional auth: Could not fetch user role:', roleErr?.response?.status);
      }
    }

    next();
  } catch (error) {
    // Token verification failed (expired, invalid, etc.) — proceed without auth
    logger.debug('Optional auth: Token verification failed, proceeding without auth');
    next();
  }
};

export const requireRole = (roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      return;
    }

    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      const authHeader = req.headers.authorization;
      const token = authHeader?.split(' ')[1] || req.query.token;
      const response: AxiosResponse<{ data: { role: string } }> = 
        await axios.get(`${userServiceUrl}/api/users/${req.user.userId}`, {
          headers: { Authorization: authHeader || `Bearer ${token}` },
        });
      const userRole = response.data.data.role;

      if (!roles.includes(userRole)) {
        res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
        return;
      }

      req.user.role = userRole;
      next();
    } catch (error) {
      logger.error('Role check error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Role verification failed' });
    }
  };
};
