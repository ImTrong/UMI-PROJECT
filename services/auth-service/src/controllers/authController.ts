import { Request, Response } from 'express';

/**
 * Health check endpoint
 * Returns the service status
 */
export const healthCheck = async (req: Request, res: Response) => {
  res.status(200).json({
    service: 'auth-service',
    status: 'active',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected', // STUB: In production, check actual DB connection
  });
};

/**
 * User registration endpoint (STUB)
 * Expected payload: { email, password, fullName }
 */
export const register = async (req: Request, res: Response) => {
  const { email, password, fullName } = req.body;

  // STUB: No actual password hashing, No actual DB insert
  const userId = `user_${Date.now()}`;
  const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  res.status(201).json({
    service: 'auth-service',
    action: 'register',
    status: 'success',
    data: {
      userId,
      email,
      fullName,
      token,
      expiresIn: '7d',
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * User login endpoint (STUB)
 * Expected payload: { email, password }
 */
export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // STUB: No actual password verification
  const userId = `user_${email.hashCode()}`; // Simple mock hash
  const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  res.status(200).json({
    service: 'auth-service',
    action: 'login',
    status: 'success',
    data: {
      userId,
      email,
      token,
      expiresIn: '7d',
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Verify JWT token (STUB)
 * Expected header: Authorization: Bearer <token>
 */
export const verifyToken = async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(' ')[1];

  // STUB: No actual JWT verification
  const isValid = token && token.startsWith('token_');

  res.status(200).json({
    service: 'auth-service',
    action: 'verifyToken',
    status: 'success',
    data: {
      isValid,
      token,
      decoded: isValid ? { userId: 'user_123', email: 'user@example.com' } : null,
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Refresh JWT token (STUB)
 * Expected payload: { token }
 */
export const refreshToken = async (req: Request, res: Response) => {
  const { token } = req.body;

  // STUB: No actual token refresh
  const newToken = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  res.status(200).json({
    service: 'auth-service',
    action: 'refreshToken',
    status: 'success',
    data: {
      newToken,
      expiresIn: '7d',
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Logout endpoint (STUB)
 */
export const logout = async (req: Request, res: Response) => {
  res.status(200).json({
    service: 'auth-service',
    action: 'logout',
    status: 'success',
    message: 'Logged out successfully',
    timestamp: new Date().toISOString(),
  });
};
