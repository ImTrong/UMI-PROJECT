import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
        timestamp: new Date().toISOString()
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
    
    req.userId = decoded.userId;
    
    // Lấy role từ Database của user-service vì auth-service không chứa role
    const userProfile = await prisma.userProfile.findUnique({
      where: { userId: decoded.userId },
      select: { role: true }
    });
    
    req.userRole = userProfile ? userProfile.role : 'STUDENT';
    
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        timestamp: new Date().toISOString()
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
      timestamp: new Date().toISOString()
    });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole) {
      return res.status(403).json({
        success: false,
        error: 'No role found',
        timestamp: new Date().toISOString()
      });
    }

    if (!roles.includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

export const requireOwnership = (paramName: string = 'userId') => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const targetUserId = req.params[paramName];
    
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
        timestamp: new Date().toISOString()
      });
    }

    // Admin can access any user
    if (req.userRole === 'ADMIN') {
      return next();
    }

    // Users can only access their own data
    if (req.userId !== targetUserId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You can only access your own profile',
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};
