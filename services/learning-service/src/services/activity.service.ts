import { PrismaClient } from '@prisma/client';
import { ActivityAction, ActivityMetadata } from '../types';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface ActivityData {
  userId: string;
  courseId?: string;
  lessonId?: string;
  action: ActivityAction;
  durationSeconds?: number;
  metadata?: ActivityMetadata;
}

export class ActivityService {
  static async logActivity(data: ActivityData): Promise<void> {
    try {
      await prisma.activityLog.create({
        data: {
          userId: data.userId,
          courseId: data.courseId,
          lessonId: data.lessonId,
          action: data.action,
          durationSeconds: data.durationSeconds || 0,
          metadata: data.metadata || {},
        },
      });
      logger.debug(`Activity logged: ${data.action} for user ${data.userId}`);
    } catch (error) {
      logger.error('Failed to log activity:', error);
    }
  }

  static async getUserActivities(
    userId: string,
    page: number = 1,
    limit: number = 20
  ) {
    const skip = (page - 1) * limit;

    const [activities, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.activityLog.count({ where: { userId } }),
    ]);

    return {
      data: activities,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }
}
