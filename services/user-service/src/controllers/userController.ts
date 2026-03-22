import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import {
  CreateUserDTO,
  UpdateUserDTO,
  AddEducationDTO,
  AddWorkExperienceDTO,
  UpdatePreferencesDTO
} from '../types';

const prisma = new PrismaClient();

// Get all users (paginated)
export const getAllUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.userProfile.findMany({
        skip,
        take: limit,
        include: {
          education: true,
          workExperience: true,
          preferences: true
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.userProfile.count()
    ]);

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

// Get user by ID
export const getUserById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;

    const user = await prisma.userProfile.findUnique({
      where: { userId },
      include: {
        education: true,
        workExperience: true,
        preferences: true
      }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.status(200).json({
      success: true,
      data: user,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

// Create user profile
export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId, email, fullName, role = 'STUDENT' }: CreateUserDTO = req.body;

    // Check if user already exists
    const existingUser = await prisma.userProfile.findFirst({
      where: {
        OR: [
          { userId },
          { email }
        ]
      }
    });

    if (existingUser) {
      throw new AppError('User already exists', 400);
    }

    // Create user profile with default preferences
    const user = await prisma.userProfile.create({
      data: {
        userId,
        email,
        fullName,
        role,
        badges: [],
        preferences: {
          create: {
            emailNotifications: true,
            language: 'en',
            theme: 'light'
          }
        }
      },
      include: {
        education: true,
        workExperience: true,
        preferences: true
      }
    });

    res.status(201).json({
      success: true,
      data: user,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

// Update user profile
export const updateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;
    const updateData: UpdateUserDTO = req.body;

    const user = await prisma.userProfile.update({
      where: { userId },
      data: updateData,
      include: {
        education: true,
        workExperience: true,
        preferences: true
      }
    });

    res.status(200).json({
      success: true,
      data: user,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      next(new AppError('User not found', 404));
    } else {
      next(error);
    }
  }
};

// Delete user profile
export const deleteUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;

    await prisma.userProfile.delete({
      where: { userId }
    });

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      next(new AppError('User not found', 404));
    } else {
      next(error);
    }
  }
};

// Add education background
export const addEducation = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;
    const educationData: AddEducationDTO = req.body;

    // Verify user exists
    const user = await prisma.userProfile.findUnique({
      where: { userId }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const education = await prisma.educationBackground.create({
      data: {
        ...educationData,
        userId: user.id
      }
    });

    res.status(201).json({
      success: true,
      data: education,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

// Update education background
export const updateEducation = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { educationId } = req.params;
    const updateData = req.body;

    const education = await prisma.educationBackground.update({
      where: { id: educationId },
      data: updateData
    });

    res.status(200).json({
      success: true,
      data: education,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      next(new AppError('Education record not found', 404));
    } else {
      next(error);
    }
  }
};

// Delete education background
export const deleteEducation = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { educationId } = req.params;

    await prisma.educationBackground.delete({
      where: { id: educationId }
    });

    res.status(200).json({
      success: true,
      message: 'Education record deleted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      next(new AppError('Education record not found', 404));
    } else {
      next(error);
    }
  }
};

// Add work experience
export const addWorkExperience = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;
    const workData: AddWorkExperienceDTO = req.body;

    // Verify user exists
    const user = await prisma.userProfile.findUnique({
      where: { userId }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const work = await prisma.workExperience.create({
      data: {
        ...workData,
        userId: user.id,
        current: workData.current || false
      }
    });

    res.status(201).json({
      success: true,
      data: work,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

// Update work experience
export const updateWorkExperience = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { workId } = req.params;
    const updateData = req.body;

    const work = await prisma.workExperience.update({
      where: { id: workId },
      data: updateData
    });

    res.status(200).json({
      success: true,
      data: work,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      next(new AppError('Work experience not found', 404));
    } else {
      next(error);
    }
  }
};

// Delete work experience
export const deleteWorkExperience = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { workId } = req.params;

    await prisma.workExperience.delete({
      where: { id: workId }
    });

    res.status(200).json({
      success: true,
      message: 'Work experience deleted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      next(new AppError('Work experience not found', 404));
    } else {
      next(error);
    }
  }
};

// Update user preferences
export const updatePreferences = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;
    const preferencesData: UpdatePreferencesDTO = req.body;

    const user = await prisma.userProfile.findUnique({
      where: { userId },
      include: { preferences: true }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.preferences) {
      // Create preferences if not exists
      const updatedUser = await prisma.userProfile.update({
        where: { id: user.id },
        data: {
          preferences: {
            create: preferencesData
          }
        },
        include: { preferences: true }
      });
      
      return res.status(200).json({
        success: true,
        data: updatedUser.preferences,
        timestamp: new Date().toISOString()
      });
    }

    const preferences = await prisma.preferences.update({
      where: { id: user.preferences.id },
      data: preferencesData
    });

    res.status(200).json({
      success: true,
      data: preferences,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

// Add badge to user
export const addBadge = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;
    const { name, description, icon } = req.body;

    const user = await prisma.userProfile.findUnique({
      where: { userId }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const updatedUser = await prisma.userProfile.update({
      where: { userId },
      data: {
        badges: {
          push: {
            name,
            description,
            icon,
            awardedAt: new Date()
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: updatedUser.badges,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

// Health check
export const healthCheck = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Check database connection
    await prisma.$runCommandRaw({ ping: 1 });

    res.status(200).json({
      service: 'user-service',
      status: 'active',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      service: 'user-service',
      status: 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'disconnected'
    });
  }
};
