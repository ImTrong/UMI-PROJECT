import { PrismaClient } from '@prisma/client';
import { BadgeType, BADGE_CONFIG, ActivityAction } from '../types';
import { ActivityService } from './activity.service';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export class BadgeService {
  static async awardBadge(
    userId: string,
    badgeType: BadgeType,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const badgeConfig = BADGE_CONFIG[badgeType];
    if (!badgeConfig) return;

    const existingBadge = await prisma.badge.findUnique({
      where: {
        userId_badgeName: {
          userId,
          badgeName: badgeConfig.name,
        },
      },
    });

    if (existingBadge) return;

    await prisma.badge.create({
      data: {
        userId,
        badgeName: badgeConfig.name,
        badgeType,
        description: badgeConfig.description,
        iconUrl: badgeConfig.icon,
        metadata,
      },
    });

    await ActivityService.logActivity({
      userId,
      action: ActivityAction.BADGE_EARNED,
      metadata: { badgeName: badgeConfig.name, badgeType },
    });

    logger.info(`Badge awarded to user ${userId}: ${badgeConfig.name}`);
  }

  static async getUserBadges(userId: string) {
    return prisma.badge.findMany({
      where: { userId },
      orderBy: { earnedAt: 'desc' },
    });
  }

  static async checkCourseCompleteBadge(userId: string, courseId: string): Promise<void> {
    const completedCount = await prisma.courseProgress.count({
      where: { userId, completedAt: { not: null } },
    });
    if (completedCount === 1) {
      await this.awardBadge(userId, BadgeType.COURSE_COMPLETER, { courseId });
    }
  }

  static async checkStreakBadge(userId: string, streakDays: number): Promise<void> {
    if (streakDays === 7) {
      await this.awardBadge(userId, BadgeType.STREAK_MASTER, { streakDays });
    } else if (streakDays === 30) {
      await this.awardBadge(userId, BadgeType.CONSISTENT_LEARNER, { streakDays });
    }
  }

  static async checkSpeedLearnerBadge(
    userId: string,
    timeSpentSeconds: number,
    courseId: string,
    courseTitle: string
  ): Promise<void> {
    const hoursSpent = timeSpentSeconds / 3600;
    if (hoursSpent < 24) {
      await this.awardBadge(userId, BadgeType.SPEED_LEARNER, {
        courseId,
        courseTitle,
        hoursSpent,
      });
    }
  }

  static async checkTimeBasedBadge(userId: string, completedAt: Date): Promise<void> {
    const hour = completedAt.getHours();
    if (hour < 8) {
      await this.awardBadge(userId, BadgeType.EARLY_BIRD, { completedAt, hour });
    } else if (hour >= 22) {
      await this.awardBadge(userId, BadgeType.NIGHT_OWL, { completedAt, hour });
    }
  }
}
