import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import { describeHttpError } from '../utils/log-redaction';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    fullName?: string;
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

    // Verify token with auth service
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
      fullName: response.data.user.fullName,
      role: response.data.user.role,
    };

    next();
  } catch (error: any) {
    // RAG-SEC-LOG-01: never the axios error itself - its config carries the token (request body) being verified
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      logger.info(`Authentication refused by auth-service (HTTP ${status})`);
    } else {
      logger.error(`Authentication error: ${describeHttpError(error)}`);
    }
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      error: ERROR_MESSAGES.UNAUTHORIZED,
    });
  }
};

/**
 * Sets req.user.role from the user's own profile row (a user without a profile is a STUDENT). It never rejects by role: the
 * handler decides what each role may see. The database is authoritative - a role value coming with the token is overwritten.
 */
export const attachUserRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
  }
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: req.user.userId },
      select: { role: true },
    });
    req.user.role = profile?.role || 'STUDENT';
    next();
  } catch (error) {
    logger.error('Role lookup error:', error);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Role verification failed' });
  }
};

export const requireRole = (roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: ERROR_MESSAGES.UNAUTHORIZED,
      });
    }

    try {
      // The database is authoritative: a role value that came with the token is never trusted (FIX-INS-01).
      const profile = await prisma.userProfile.findUnique({
        where: { userId: req.user.userId },
        select: { role: true },
      });
      const userRole = profile?.role || 'STUDENT';
      req.user.role = userRole;
      
      if (!roles.includes(userRole)) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }
      
      next();
    } catch (error) {
      logger.error('Role check error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Role verification failed',
      });
    }
  };
};
