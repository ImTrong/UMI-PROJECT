import { Request, Response } from 'express';

/**
 * Health check endpoint
 */
export const healthCheck = async (req: Request, res: Response) => {
  res.status(200).json({
    service: 'user-service',
    status: 'active',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected',
  });
};

/**
 * Get all users (STUB)
 */
export const getAllUsers = async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const offset = parseInt(req.query.offset as string) || 0;

  // STUB: Mock data
  const users = Array.from({ length: limit }, (_, i) => ({
    id: `user_${offset + i}`,
    email: `user${offset + i}@example.com`,
    fullName: `User ${offset + i}`,
    role: 'student',
    createdAt: new Date().toISOString(),
  }));

  res.status(200).json({
    service: 'user-service',
    action: 'getAllUsers',
    status: 'success',
    data: {
      total: 1000, // STUB: Mock total
      limit,
      offset,
      users,
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Get user by ID (STUB)
 */
export const getUserById = async (req: Request, res: Response) => {
  const { userId } = req.params;

  // STUB: Mock user
  res.status(200).json({
    service: 'user-service',
    action: 'getUserById',
    status: 'success',
    data: {
      id: userId,
      email: `user@example.com`,
      fullName: 'John Doe',
      avatar: 'https://via.placeholder.com/150',
      bio: 'Software engineer and educator',
      role: 'instructor',
      joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      coursesCreated: 5,
      studentsEnrolled: 250,
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Create user profile (STUB)
 */
export const createUser = async (req: Request, res: Response) => {
  const { email, fullName, role } = req.body;

  const userId = `user_${Date.now()}`;

  res.status(201).json({
    service: 'user-service',
    action: 'createUser',
    status: 'success',
    data: {
      id: userId,
      email,
      fullName,
      role,
      createdAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Update user profile (STUB)
 */
export const updateUser = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const updateData = req.body;

  res.status(200).json({
    service: 'user-service',
    action: 'updateUser',
    status: 'success',
    data: {
      id: userId,
      ...updateData,
      updatedAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Delete user (STUB)
 */
export const deleteUser = async (req: Request, res: Response) => {
  const { userId } = req.params;

  res.status(200).json({
    service: 'user-service',
    action: 'deleteUser',
    status: 'success',
    message: `User ${userId} deleted successfully`,
    timestamp: new Date().toISOString(),
  });
};
