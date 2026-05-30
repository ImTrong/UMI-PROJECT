import { PrismaClient, Role } from '@prisma/client';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface CreateUserData {
  userId: string;
  email: string;
  fullName: string;
  role?: Role;
}

export interface UpdateUserData {
  fullName?: string;
  avatar?: string;
  bio?: string;
  phoneNumber?: string;
  address?: string;
  dateOfBirth?: Date;
  preferences?: any;
  role?: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN';
  isActive?: boolean;
}

export interface EducationData {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: Date;
  endDate?: Date;
  grade?: string;
  description?: string;
}

export interface WorkExperienceData {
  company: string;
  position: string;
  location?: string;
  startDate: Date;
  endDate?: Date;
  current?: boolean;
  description?: string;
}

export class UserService {
  // User Profile CRUD
  static async createUserProfile(data: CreateUserData) {
    const { userId, email, fullName, role = 'STUDENT' } = data;

    // Check if profile already exists
    const existingProfile = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (existingProfile) {
      throw new Error(ERROR_MESSAGES.USER_ALREADY_EXISTS);
    }

    // Check if email is already used
    const existingEmail = await prisma.userProfile.findUnique({
      where: { email },
    });

    if (existingEmail) {
      throw new Error(ERROR_MESSAGES.EMAIL_ALREADY_EXISTS);
    }

    // Create user profile
    const userProfile = await prisma.userProfile.create({
      data: {
        userId,
        email,
        fullName,
        role: role as Role,
      },
      include: {
        education: true,
        work: true,
      },
    });

    logger.info(`User profile created: ${userId}`);
    return userProfile;
  }

  static async getUserProfile(userId: string) {
    const userProfile = await prisma.userProfile.findUnique({
      where: { userId },
      include: {
        education: {
          orderBy: { startDate: 'desc' },
        },
        work: {
          orderBy: { startDate: 'desc' },
        },
      },
    });

    if (!userProfile) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return userProfile;
  }

  static async getUserProfileById(id: string) {
    const userProfile = await prisma.userProfile.findUnique({
      where: { id },
      include: {
        education: {
          orderBy: { startDate: 'desc' },
        },
        work: {
          orderBy: { startDate: 'desc' },
        },
      },
    });

    if (!userProfile) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return userProfile;
  }

  static async getBatchUserProfiles(userIds: string[]) {
    if (!userIds || userIds.length === 0) {
      return [];
    }

    const users = await prisma.userProfile.findMany({
      where: {
        userId: { in: userIds },
      },
      select: {
        userId: true,
        fullName: true,
        email: true,
        avatar: true,
        role: true,
      },
    });

    return users;
  }

  static async getAllUserProfiles(page: number = 1, limit: number = 10, filters?: any) {
    const skip = (page - 1) * limit;
    
    const where: any = {};
    if (filters?.role) where.role = filters.role;
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;
    if (filters?.search) {
      where.OR = [
        { fullName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.userProfile.findMany({
        where,
        skip,
        take: limit,
        include: {
          education: true,
          work: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.userProfile.count({ where }),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async updateUserProfile(userId: string, data: UpdateUserData) {
    // Check if user exists
    const existingUser = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (!existingUser) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Convert date strings to Date objects if necessary
    const updateData: any = { ...data };
    if (typeof updateData.dateOfBirth === 'string') {
      if (updateData.dateOfBirth.trim() === '') {
        updateData.dateOfBirth = null; // Set to null if empty string
      } else {
        const date = new Date(updateData.dateOfBirth);
        if (isNaN(date.getTime())) {
          throw new Error('Invalid date format for dateOfBirth');
        }
        updateData.dateOfBirth = date;
      }
    }

    const updatedUser = await prisma.userProfile.update({
      where: { userId },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
      include: {
        education: true,
        work: true,
      },
    });

    logger.info(`User profile updated: ${userId}`);
    return updatedUser;
  }

  static async deleteUserProfile(userId: string) {
    // Check if user exists
    const existingUser = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (!existingUser) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Delete user profile (education and work will be cascaded)
    await prisma.userProfile.delete({
      where: { userId },
    });

    logger.info(`User profile deleted: ${userId}`);
    return { success: true };
  }

  /**
   * Soft delete — deactivate user instead of removing from DB
   */
  static async softDeleteUserProfile(userId: string) {
    const existingUser = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (!existingUser) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const updatedUser = await prisma.userProfile.update({
      where: { userId },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });

    logger.info(`User soft-deleted (deactivated): ${userId}`);
    return updatedUser;
  }

  // Education Management
  static async addEducation(userId: string, data: EducationData) {
    // Check if user exists
    const user = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Convert date strings to Date objects if necessary
    const educationData: any = { ...data };
    if (typeof educationData.startDate === 'string') {
      educationData.startDate = new Date(educationData.startDate);
    }
    if (typeof educationData.endDate === 'string') {
      educationData.endDate = new Date(educationData.endDate);
    }

    const education = await prisma.educationBackground.create({
      data: {
        userId: user.id,
        ...educationData,
      },
    });

    logger.info(`Education added for user: ${userId}`);
    return education;
  }

  static async updateEducation(educationId: string, userId: string, data: Partial<EducationData>) {
    // Check if education belongs to user
    const education = await prisma.educationBackground.findFirst({
      where: {
        id: educationId,
        user: { userId },
      },
    });

    if (!education) {
      throw new Error(ERROR_MESSAGES.EDUCATION_NOT_FOUND);
    }

    // Convert date strings to Date objects if necessary
    const updateData: any = { ...data };
    if (typeof updateData.startDate === 'string') {
      updateData.startDate = new Date(updateData.startDate);
    }
    if (typeof updateData.endDate === 'string') {
      updateData.endDate = new Date(updateData.endDate);
    }

    const updatedEducation = await prisma.educationBackground.update({
      where: { id: educationId },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
    });

    logger.info(`Education updated: ${educationId}`);
    return updatedEducation;
  }

  static async deleteEducation(educationId: string, userId: string) {
    // Check if education belongs to user
    const education = await prisma.educationBackground.findFirst({
      where: {
        id: educationId,
        user: { userId },
      },
    });

    if (!education) {
      throw new Error(ERROR_MESSAGES.EDUCATION_NOT_FOUND);
    }

    await prisma.educationBackground.delete({
      where: { id: educationId },
    });

    logger.info(`Education deleted: ${educationId}`);
    return { success: true };
  }

  // Work Experience Management
  static async addWorkExperience(userId: string, data: WorkExperienceData) {
    // Check if user exists
    const user = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // If this is current job, set all other current jobs to false
    if (data.current) {
      await prisma.workExperience.updateMany({
        where: { userId: user.id, current: true },
        data: { current: false },
      });
    }

    // Convert date strings to Date objects if necessary
    const workData: any = { ...data };
    if (typeof workData.startDate === 'string') {
      workData.startDate = new Date(workData.startDate);
    }
    if (typeof workData.endDate === 'string') {
      workData.endDate = new Date(workData.endDate);
    }

    const work = await prisma.workExperience.create({
      data: {
        userId: user.id,
        ...workData,
      },
    });

    logger.info(`Work experience added for user: ${userId}`);
    return work;
  }

  static async updateWorkExperience(workId: string, userId: string, data: Partial<WorkExperienceData>) {
    // Check if work belongs to user
    const work = await prisma.workExperience.findFirst({
      where: {
        id: workId,
        user: { userId },
      },
    });

    if (!work) {
      throw new Error(ERROR_MESSAGES.WORK_EXPERIENCE_NOT_FOUND);
    }

    // If setting as current, update other current jobs
    if (data.current) {
      await prisma.workExperience.updateMany({
        where: { userId: work.userId, current: true, NOT: { id: workId } },
        data: { current: false },
      });
    }

    // Convert date strings to Date objects if necessary
    const updateData: any = { ...data };
    if (typeof updateData.startDate === 'string') {
      updateData.startDate = new Date(updateData.startDate);
    }
    if (typeof updateData.endDate === 'string') {
      updateData.endDate = new Date(updateData.endDate);
    }

    const updatedWork = await prisma.workExperience.update({
      where: { id: workId },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
    });

    logger.info(`Work experience updated: ${workId}`);
    return updatedWork;
  }

  static async deleteWorkExperience(workId: string, userId: string) {
    // Check if work belongs to user
    const work = await prisma.workExperience.findFirst({
      where: {
        id: workId,
        user: { userId },
      },
    });

    if (!work) {
      throw new Error(ERROR_MESSAGES.WORK_EXPERIENCE_NOT_FOUND);
    }

    await prisma.workExperience.delete({
      where: { id: workId },
    });

    logger.info(`Work experience deleted: ${workId}`);
    return { success: true };
  }

  // Statistics
  static async getUserStats(userId: string) {
    const user = await prisma.userProfile.findUnique({
      where: { userId },
      include: {
        education: true,
        work: true,
      },
    });

    if (!user) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return {
      totalEducation: user.education.length,
      totalWorkExperience: user.work.length,
      currentWork: user.work.find(w => w.current),
      badges: user.badges,
      role: user.role,
      createdAt: user.createdAt,
    };
  }

  static async getUserAnalytics() {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [total, students, instructors, admins, active, newThisMonth] = await Promise.all([
      prisma.userProfile.count(),
      prisma.userProfile.count({ where: { role: 'STUDENT' } }),
      prisma.userProfile.count({ where: { role: 'INSTRUCTOR' } }),
      prisma.userProfile.count({ where: { role: 'ADMIN' } }),
      prisma.userProfile.count({ where: { isActive: true } }),
      prisma.userProfile.count({ where: { createdAt: { gte: monthAgo } } }),
    ]);

    return {
      total,
      students,
      instructors,
      admins,
      active,
      newThisMonth,
    };
  }

  static async updateToInstructor(userId: string) {
    const user = await prisma.userProfile.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const updatedUser = await prisma.userProfile.update({
      where: { userId },
      data: {
        role: 'INSTRUCTOR',
        updatedAt: new Date(),
      },
      include: {
        education: true,
        work: true,
      },
    });

    // Create a notification for the user
    await prisma.notification.create({
      data: {
        userId: updatedUser.id,
        title: 'Chào mừng bạn gia nhập đội ngũ Giảng viên UMI!',
        message: 'Đăng ký trở thành giảng viên thành công. Bạn có thể bắt đầu tạo khóa học ngay bây giờ.',
        type: 'SUCCESS',
        link: '/instructor/dashboard',
      },
    });

    logger.info(`User ${userId} upgraded to INSTRUCTOR`);
    return updatedUser;
  }

  static async healthCheck() {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      return {
        service: 'user-service',
        status: 'active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
      };
    } catch (error) {
      return {
        service: 'user-service',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
      };
    }
  }
}
