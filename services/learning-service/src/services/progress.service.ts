import { PrismaClient } from '@prisma/client';
import axios, { AxiosResponse } from 'axios';
import { ERROR_MESSAGES } from '../utils/constants';
import { ActivityService } from './activity.service';
import { BadgeService } from './badge.service';
import { ActivityAction, CourseDetails, LessonDetails } from '../types';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface LessonCompleteData {
  userId: string;
  courseId: string;
  lessonId: string;
  timeSpentSeconds?: number;
}

export class ProgressService {
  static async initializeUserProgress(userId: string) {
    const existing = await prisma.userProgress.findUnique({ where: { userId } });
    if (!existing) {
      return prisma.userProgress.create({
        data: {
          userId,
          totalCoursesEnrolled: 0,
          totalCoursesCompleted: 0,
          totalLessonsCompleted: 0,
          totalStudyTime: 0,
          streakDays: 0,
        },
      });
    }
    return existing;
  }

  static async getUserProgress(userId: string) {
    const progress = await prisma.userProgress.findUnique({
      where: { userId },
      include: {
        courses: { orderBy: { lastAccessedAt: 'desc' } },
        certificates: { orderBy: { issueDate: 'desc' } },
        badges: { orderBy: { earnedAt: 'desc' } },
      },
    });
    return progress || this.initializeUserProgress(userId);
  }

  static async getCourseProgress(userId: string, courseId: string) {
    const courseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
      include: { lessons: { orderBy: { lastWatchedAt: 'desc' } } },
    });
    if (!courseProgress) throw new Error(ERROR_MESSAGES.PROGRESS_NOT_FOUND);
    return courseProgress;
  }

  static async getEnrolledCourses(userId: string, page: number = 1, limit: number = 10, filter?: string) {
    const skip = (page - 1) * limit;

    // Filter logic can be added here if needed in future (e.g., filter by 'completed' or 'in-progress')
    const whereClause: any = { userId };
    if (filter === 'completed') {
      whereClause.completedAt = { not: null };
    } else if (filter === 'in-progress') {
      whereClause.completedAt = null;
    }

    const total = await prisma.courseProgress.count({
      where: whereClause
    });

    const courses = await prisma.courseProgress.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { lastAccessedAt: 'desc' }
    });

    return {
      courses,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  static async markLessonComplete(data: LessonCompleteData) {
    const { userId, courseId, lessonId, timeSpentSeconds = 0 } = data;

    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    let course: CourseDetails;
    try {
      const response: AxiosResponse<{ data: CourseDetails }> = await axios.get(
        `${courseServiceUrl}/api/courses/${courseId}`
      );
      course = response.data.data;
    } catch {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    const lesson = course.lessons?.find((l: LessonDetails) => l.id === lessonId);
    if (!lesson) throw new Error(ERROR_MESSAGES.LESSON_NOT_FOUND);

    await this.initializeUserProgress(userId);

    let courseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (!courseProgress) {
      courseProgress = await prisma.courseProgress.create({
        data: {
          userId,
          courseId,
          courseTitle: course.title,
          totalLessons: course.lessons?.length || 0,
        },
      });
    }

    let lessonProgress = await prisma.lessonProgress.findUnique({
      where: { userId_courseId_lessonId: { userId, courseId, lessonId } },
    });

    const wasCompleted = lessonProgress?.completed || false;

    if (!lessonProgress) {
      lessonProgress = await prisma.lessonProgress.create({
        data: {
          userId,
          courseId,
          lessonId,
          lessonTitle: lesson.title,
          timeSpentSeconds,
          watchCount: 1,
          completed: true,
          completedAt: new Date(),
        },
      });
    } else if (!wasCompleted) {
      lessonProgress = await prisma.lessonProgress.update({
        where: { id: lessonProgress.id },
        data: {
          timeSpentSeconds: lessonProgress.timeSpentSeconds + timeSpentSeconds,
          watchCount: lessonProgress.watchCount + 1,
          lastWatchedAt: new Date(),
          completed: true,
          completedAt: new Date(),
        },
      });
    }

    if (!wasCompleted) {
      const completedLessons = await prisma.lessonProgress.count({
        where: { userId, courseId, completed: true },
      });

      const progressPercentage = (completedLessons / courseProgress.totalLessons) * 100;

      await prisma.courseProgress.update({
        where: { id: courseProgress.id },
        data: {
          completedLessons,
          progressPercentage,
          timeSpentSeconds: courseProgress.timeSpentSeconds + timeSpentSeconds,
          lastAccessedAt: new Date(),
          ...(progressPercentage === 100 && { completedAt: new Date() }),
        },
      });

      await this.updateUserProgress(userId);

      await ActivityService.logActivity({
        userId,
        courseId,
        lessonId,
        action: ActivityAction.LESSON_COMPLETE,
        durationSeconds: timeSpentSeconds,
        metadata: { lessonTitle: lesson.title, courseTitle: course.title, progressPercentage },
      });

      if (progressPercentage === 100) {
        await ActivityService.logActivity({
          userId,
          courseId,
          action: ActivityAction.COURSE_COMPLETE,
          metadata: { courseTitle: course.title },
        });
        await BadgeService.checkCourseCompleteBadge(userId, courseId);
        await BadgeService.checkSpeedLearnerBadge(
          userId,
          courseProgress.timeSpentSeconds + timeSpentSeconds,
          courseId,
          course.title
        );
        await BadgeService.checkTimeBasedBadge(userId, new Date());
      }
    }

    await this.updateStreak(userId);

    const updatedCourseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    return {
      lessonProgress,
      courseProgress: updatedCourseProgress,
      isNewCompletion: !wasCompleted,
      courseCompleted: updatedCourseProgress?.progressPercentage === 100,
    };
  }

  private static async updateUserProgress(userId: string): Promise<void> {
    const completedCourses = await prisma.courseProgress.count({
      where: { userId, completedAt: { not: null } },
    });
    const totalLessonsCompleted = await prisma.lessonProgress.count({
      where: { userId, completed: true },
    });
    const totalStudyTime = await prisma.lessonProgress.aggregate({
      where: { userId },
      _sum: { timeSpentSeconds: true },
    });
    const totalEnrolled = await prisma.courseProgress.count({ where: { userId } });

    await prisma.userProgress.update({
      where: { userId },
      data: {
        totalCoursesCompleted: completedCourses,
        totalLessonsCompleted,
        totalStudyTime: totalStudyTime._sum.timeSpentSeconds || 0,
        totalCoursesEnrolled: totalEnrolled,
      },
    });
  }

  private static async updateStreak(userId: string): Promise<void> {
    const userProgress = await prisma.userProgress.findUnique({ where: { userId } });
    if (!userProgress) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastActivity = userProgress.lastActivityDate;

    if (!lastActivity) {
      await prisma.userProgress.update({
        where: { userId },
        data: { streakDays: 1, lastActivityDate: today },
      });
      return;
    }

    const lastDate = new Date(lastActivity);
    lastDate.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    let newStreak = userProgress.streakDays;
    if (diffDays === 1) newStreak++;
    else if (diffDays > 1) newStreak = 1;

    await prisma.userProgress.update({
      where: { userId },
      data: { streakDays: newStreak, lastActivityDate: today },
    });

    if (newStreak === 7 || newStreak === 30) {
      await BadgeService.checkStreakBadge(userId, newStreak);
    }
  }

  static async enrollInCourse(userId: string, courseId: string) {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    let course: CourseDetails;
    try {
      const response: AxiosResponse<{ data: CourseDetails }> = await axios.get(
        `${courseServiceUrl}/api/courses/${courseId}`
      );
      course = response.data.data;
      if (!course.published) throw new Error('Course is not published');
    } catch {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    await this.initializeUserProgress(userId);

    const existing = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) return existing;

    const lessonsResponse: AxiosResponse<{ data: LessonDetails[] }> = await axios.get(
      `${courseServiceUrl}/api/courses/${courseId}/lessons`
    );

    const enrollment = await prisma.courseProgress.create({
      data: {
        userId,
        courseId,
        courseTitle: course.title,
        totalLessons: lessonsResponse.data.data.length,
        enrolledAt: new Date(),
        lastAccessedAt: new Date(),
      },
    });

    await prisma.userProgress.update({
      where: { userId },
      data: { totalCoursesEnrolled: { increment: 1 } },
    });

    await ActivityService.logActivity({
      userId,
      courseId,
      action: ActivityAction.COURSE_ENROLL,
      metadata: { courseTitle: course.title },
    });

    return enrollment;
  }

  static async healthCheck() {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      return {
        service: 'learning-service',
        status: 'active' as const,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected' as const,
      };
    } catch {
      return {
        service: 'learning-service',
        status: 'degraded' as const,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected' as const,
      };
    }
  }
}
