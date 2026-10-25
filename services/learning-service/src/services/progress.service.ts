import { PrismaClient } from '@prisma/client';
import axios, { AxiosResponse } from 'axios';
import { ERROR_MESSAGES, HTTP_STATUS } from '../utils/constants';
import { ActivityService } from './activity.service';
import { BadgeService } from './badge.service';
import { UserNotificationClient } from './user-notification.client';
import { ActivityAction, CourseDetails, LessonDetails } from '../types';
import logger from '../utils/logger';
import {
  ACCESS_ERROR_MESSAGES,
  CourseAccessError,
  CourseAccessService,
  isVerifiedFreeCourse,
} from './course-access.service';
import { courseInternalHeaders } from './course-internal.client';

const prisma = new PrismaClient();

export interface LessonCompleteData {
  userId: string;
  courseId: string;
  lessonId: string;
  timeSpentSeconds?: number;
}

export class ProgressService {
  private static async getCurrentLessonCount(courseId: string): Promise<number> {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    try {
      const lessonsResponse: AxiosResponse<{ data: LessonDetails[] }> = await axios.get(
        `${courseServiceUrl}/api/courses/internal/${courseId}/lessons`,
        { headers: courseInternalHeaders() }
      );
      return lessonsResponse.data.data.length;
    } catch {
      return 0;
    }
  }

  private static async syncCourseProgressTotals(userId: string, courseId: string) {
    const [courseProgress, totalLessonsFromCourseService] = await Promise.all([
      prisma.courseProgress.findUnique({
        where: { userId_courseId: { userId, courseId } },
      }),
      this.getCurrentLessonCount(courseId),
    ]);

    if (!courseProgress) return null;

    const completedLessons = await prisma.lessonProgress.count({
      where: { userId, courseId, completed: true },
    });

    const safeTotalLessons = Math.max(totalLessonsFromCourseService, 0);
    const safeCompletedLessons = Math.min(completedLessons, safeTotalLessons);
    const progressPercentage = safeTotalLessons > 0 ? (safeCompletedLessons / safeTotalLessons) * 100 : 0;

    if (
      courseProgress.totalLessons !== safeTotalLessons ||
      courseProgress.completedLessons !== safeCompletedLessons ||
      Math.round(courseProgress.progressPercentage * 100) !== Math.round(progressPercentage * 100)
    ) {
      return prisma.courseProgress.update({
        where: { id: courseProgress.id },
        data: {
          totalLessons: safeTotalLessons,
          completedLessons: safeCompletedLessons,
          progressPercentage,
          completedAt: progressPercentage === 100 ? (courseProgress.completedAt || new Date()) : null,
          lastAccessedAt: new Date(),
        },
      });
    }

    return courseProgress;
  }
  static async initializeUserProgress(userId: string) {
    try {
      return await prisma.userProgress.upsert({
        where: { userId },
        update: {},
        create: {
          userId,
          totalCoursesEnrolled: 0,
          totalCoursesCompleted: 0,
          totalLessonsCompleted: 0,
          totalStudyTime: 0,
          streakDays: 0,
        },
      });
    } catch (error: any) {
      // Fallback in case of extreme concurrency where even upsert throws
      if (error.code === 'P2002') {
        const existing = await prisma.userProgress.findUnique({ where: { userId } });
        if (existing) return existing;
      }
      throw error;
    }
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
    await this.syncCourseProgressTotals(userId, courseId);
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

    await Promise.all(courses.map((course) => this.syncCourseProgressTotals(userId, course.courseId)));

    const refreshedCourses = await prisma.courseProgress.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { lastAccessedAt: 'desc' }
    });

    return {
      courses: refreshedCourses,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  static async getCourseStudents(courseId: string) {
    const courseProgresses = await prisma.courseProgress.findMany({
      where: { courseId },
      orderBy: { lastAccessedAt: 'desc' }
    });
    return courseProgresses;
  }

  static async getStudentCourseProgress(courseId: string, userId: string) {
    const courseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
      include: {
        lessons: {
          orderBy: { lastWatchedAt: 'desc' },
        },
      },
    });

    if (!courseProgress) {
      throw new Error(ERROR_MESSAGES.PROGRESS_NOT_FOUND);
    }

    return courseProgress;
  }

  /**
   * Single gate for "may this user learn this course" used by progress and quiz flows.
   * - Already enrolled (server-side CourseProgress) -> allowed, progress untouched.
   * - Not enrolled + course verifiably free (published, price === 0) -> enroll through the
   *   official enrollInCourse flow (which re-validates).
   * - Anything else (paid, null/missing price, lookup failure) -> refused, nothing written.
   */
  static async ensureLearningAccess(userId: string, courseId: string, knownCourse?: CourseDetails) {
    const existing = await CourseAccessService.findEnrollment(userId, courseId);
    if (existing) return existing;

    const course = knownCourse ?? await CourseAccessService.fetchCourse(courseId);
    if (!isVerifiedFreeCourse(course)) {
      logger.warn(`Learning access denied: user=${userId} course=${courseId} (not enrolled, course not verifiably free)`);
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.ENROLLMENT_REQUIRED, HTTP_STATUS.FORBIDDEN);
    }

    return this.enrollInCourse(userId, courseId, false);
  }

  static async markLessonComplete(data: LessonCompleteData) {
    const { userId, courseId, lessonId, timeSpentSeconds = 0 } = data;

    // 1. Resolve course + lessons from course-service (trusted source). Fails closed.
    const [course, allLessons] = await Promise.all([
      CourseAccessService.fetchCourse(courseId),
      CourseAccessService.fetchCourseLessons(courseId),
    ]);

    const lesson = allLessons.find((l: LessonDetails) => l.id === lessonId);
    if (!lesson) throw new Error(ERROR_MESSAGES.LESSON_NOT_FOUND);

    // 2. Authorize BEFORE any write. Never auto-creates enrollment for paid/unverified courses.
    await this.ensureLearningAccess(userId, courseId, course);

    await this.initializeUserProgress(userId);

    let courseProgress = await CourseAccessService.findEnrollment(userId, courseId);
    if (!courseProgress) {
      // Defensive: enrollment must exist by now; never fabricate one here.
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.ENROLLMENT_REQUIRED, HTTP_STATUS.FORBIDDEN);
    }

    courseProgress = await this.syncCourseProgressTotals(userId, courseId) || courseProgress;

    let lessonProgress = await prisma.lessonProgress.findUnique({
      where: { userId_courseId_lessonId: { userId, courseId, lessonId } },
    });

    let wasCompleted = lessonProgress?.completed || false;

    if (!lessonProgress) {
      try {
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
      } catch (createError: any) {
        // Concurrent duplicate request: the other request already recorded this completion.
        if (createError?.code !== 'P2002') throw createError;
        lessonProgress = await prisma.lessonProgress.findUnique({
          where: { userId_courseId_lessonId: { userId, courseId, lessonId } },
        });
        if (!lessonProgress) throw createError;
        wasCompleted = lessonProgress.completed;
      }
    } else if (!wasCompleted) {
      // Atomic claim: only one concurrent request may flip completed false -> true.
      const claimed = await prisma.lessonProgress.updateMany({
        where: { id: lessonProgress.id, completed: false },
        data: {
          timeSpentSeconds: lessonProgress.timeSpentSeconds + timeSpentSeconds,
          watchCount: lessonProgress.watchCount + 1,
          lastWatchedAt: new Date(),
          completed: true,
          completedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        wasCompleted = true;
      }
      lessonProgress = (await prisma.lessonProgress.findUnique({
        where: { id: lessonProgress.id },
      })) || lessonProgress;
    }

    if (!wasCompleted) {
      const completedLessons = await prisma.lessonProgress.count({
        where: { userId, courseId, completed: true },
      });

      const progressPercentage = courseProgress.totalLessons > 0
        ? (completedLessons / courseProgress.totalLessons) * 100
        : 0;

      await prisma.courseProgress.update({
        where: { id: courseProgress.id },
        data: {
          completedLessons,
          progressPercentage,
          timeSpentSeconds: courseProgress.timeSpentSeconds + timeSpentSeconds,
          lastAccessedAt: new Date(),
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

      let completionResult = { isComplete: false, reason: '' };
      if (progressPercentage === 100) {
        completionResult = await this.checkAndCompleteCourse(userId, courseId, course.title) as any;
      }

      await this.updateStreak(userId);

      const updatedCourseProgress = await prisma.courseProgress.findUnique({
        where: { userId_courseId: { userId, courseId } },
      });

      return {
        lessonProgress,
        courseProgress: updatedCourseProgress,
        isNewCompletion: !wasCompleted,
        courseCompleted: completionResult.isComplete,
        missingQuizzes: completionResult.reason === 'QUIZZES_INCOMPLETE',
      };
    }

    await this.updateStreak(userId);

    const updatedCourseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    return {
      lessonProgress,
      courseProgress: updatedCourseProgress,
      isNewCompletion: !wasCompleted,
      courseCompleted: updatedCourseProgress?.progressPercentage === 100 && !!updatedCourseProgress?.completedAt,
      missingQuizzes: false,
    };
  }

  static async checkAndCompleteCourse(userId: string, courseId: string, courseTitle: string) {
    const courseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (!courseProgress) return { isComplete: false, reason: 'NO_PROGRESS' };
    if (courseProgress.completedAt) return { isComplete: true, alreadyCompleted: true };
    if (courseProgress.progressPercentage < 100) return { isComplete: false, reason: 'LESSONS_INCOMPLETE' };

    // Check for uncompleted quizzes
    const quizzes = await prisma.quiz.findMany({
      where: { courseId },
      select: { id: true }
    });

    for (const quiz of quizzes) {
      const attempt = await prisma.quizAttempt.findFirst({
        where: { quizId: quiz.id, userId, status: 'SUBMITTED' }
      });
      if (!attempt) {
        return { isComplete: false, reason: 'QUIZZES_INCOMPLETE' };
      }
    }

    // All lessons 100% and all quizzes submitted -> Complete course!
    await ActivityService.logActivity({
      userId,
      courseId,
      action: ActivityAction.COURSE_COMPLETE,
      metadata: { courseTitle },
    });
    
    await BadgeService.checkCourseCompleteBadge(userId, courseId);
    await BadgeService.checkSpeedLearnerBadge(
      userId,
      courseProgress.timeSpentSeconds,
      courseId,
      courseTitle
    );
    await BadgeService.checkTimeBasedBadge(userId, new Date());

    // Auto-calculate quiz scores and determine pass/fail
    try {
      const quizzesWithScore = await prisma.quiz.findMany({
        where: { courseId },
        select: { id: true, passingScore: true },
      });

      if (quizzesWithScore.length > 0) {
        const quizScores = await Promise.all(
          quizzesWithScore.map(async (quiz) => {
            const bestAttempt = await prisma.quizAttempt.findFirst({
              where: { quizId: quiz.id, userId, status: 'SUBMITTED' },
              orderBy: { score: 'desc' },
            });
            return bestAttempt?.score ?? 0;
          })
        );

        const avgScore = quizScores.reduce((a, b) => a + b, 0) / quizzesWithScore.length;
        const currentPassingScore = courseProgress.passingScore ?? 80;
        const passed = avgScore >= currentPassingScore;

        await prisma.courseProgress.update({
          where: { userId_courseId: { userId, courseId } },
          data: {
            averageQuizScore: Math.round(avgScore * 100) / 100,
            passed,
            allowRetake: !passed,
            completedAt: new Date(),
          },
        });
      } else {
        // No quizzes → auto-pass, but do NOT fake 100% quiz score
        await prisma.courseProgress.update({
          where: { userId_courseId: { userId, courseId } },
          data: {
            averageQuizScore: null,
            passed: true,
            allowRetake: false,
            completedAt: new Date(),
          },
        });
      }
    } catch (examErr) {
      logger.error('Failed to calculate course exam result:', examErr);
    }

    // Reload to get latest pass/fail status
    const latestProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    const isPassed = latestProgress?.passed;

    // Record achievement points in CourseCompletionRecord
    if (isPassed && latestProgress?.completedAt) {
      try {
        const { AchievementService } = require('./achievement.service');
        await AchievementService.recordCourseCompletion(
          userId,
          courseId,
          latestProgress.completedAt,
          courseTitle,
          latestProgress.averageQuizScore
        );
      } catch (achieveErr) {
        logger.error('Failed to record achievement for course completion:', achieveErr);
      }
    }

    // Send real-time course completion notification
    try {
      if (isPassed) {
        const scoreText = latestProgress?.averageQuizScore != null
          ? ` với điểm ${latestProgress.averageQuizScore.toFixed(1)}%`
          : '';
        await UserNotificationClient.send({
          userId,
          title: '🎉 Khóa học hoàn thành!',
          message: `Chúc mừng bạn đã hoàn thành xuất sắc khóa học "${courseTitle}"${scoreText}. Bạn có thể nhận chứng nhận ngay!`,
          type: 'SUCCESS',
          link: `/course-exam/${courseId}`,
        });
      } else {
        await UserNotificationClient.send({
          userId,
          title: '📝 Khóa học hoàn thành - Chưa đạt điểm',
          message: `Bạn đã hoàn thành khóa học "${courseTitle}" nhưng điểm trung bình quiz (${latestProgress?.averageQuizScore?.toFixed(1)}%) chưa đạt ngưỡng. Bạn có thể học lại miễn phí!`,
          type: 'WARNING',
          link: `/course-exam/${courseId}`,
        });
      }
    } catch (err) {
      logger.error('Failed to send course completion notification:', err);
    }

    // Update path progress
    try {
      const { PathService } = require('./path.service');
      await PathService.updatePathProgress(userId, courseId);
    } catch (err) {
      logger.error('Failed to update path progress:', err);
    }

    // Invalidate LearnerAnalysis cache — course completion changes analysis
    try {
      const { LearnerAnalysisService } = require('./learner-analysis.service');
      await LearnerAnalysisService.invalidateCache(userId, 'COURSE_COMPLETED');
    } catch (err) {
      logger.debug('Failed to invalidate learner analysis cache:', err);
    }

    return { isComplete: true, newlyCompleted: true };
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

  static async enrollInCourse(userId: string, courseId: string, isInternal: boolean = false) {
    const course = await CourseAccessService.fetchCourse(courseId);
    if (!course.published) {
      throw new CourseAccessError(ACCESS_ERROR_MESSAGES.NOT_PUBLISHED, HTTP_STATUS.FORBIDDEN);
    }

    // Bảo mật: chỉ luồng nội bộ (đã xác thực service token) mới được ghi danh khóa học có phí.
    // Endpoint công khai chỉ ghi danh khi course-service xác nhận rõ price === 0;
    // price thiếu / null / không hợp lệ KHÔNG được coi là miễn phí.
    if (!isInternal && !isVerifiedFreeCourse(course)) {
      const priceIsPaid = typeof course.price === 'number' && Number.isFinite(course.price) && course.price > 0;
      throw new CourseAccessError(
        priceIsPaid ? ACCESS_ERROR_MESSAGES.PAID_COURSE : ACCESS_ERROR_MESSAGES.PRICE_UNVERIFIED,
        HTTP_STATUS.FORBIDDEN
      );
    }

    await this.initializeUserProgress(userId);

    const existing = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) return existing;

    const lessons = await CourseAccessService.fetchCourseLessons(courseId);

    try {
      const enrollment = await prisma.courseProgress.create({
        data: {
          userId,
          courseId,
          courseTitle: course.title,
          totalLessons: lessons.length,
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
    } catch (createError: any) {
      // Race condition idempotency: nếu 2 request đến cùng lúc, trả về bản ghi đã tạo
      if (createError.code === 'P2002' || createError.message?.includes('duplicate') || createError.message?.includes('Unique constraint')) {
        const raceExisting = await prisma.courseProgress.findUnique({
          where: { userId_courseId: { userId, courseId } },
        });
        if (raceExisting) return raceExisting;
      }
      throw createError;
    }
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

  static async getLearningStats(userId: string) {
    const userProgress = await this.getUserProgress(userId);

    const completionRate = userProgress.totalCoursesEnrolled > 0 
      ? (userProgress.totalCoursesCompleted / userProgress.totalCoursesEnrolled) * 100 
      : 0;

    const overall = {
      totalCoursesEnrolled: userProgress.totalCoursesEnrolled,
      totalCoursesCompleted: userProgress.totalCoursesCompleted,
      totalLessonsCompleted: userProgress.totalLessonsCompleted,
      totalStudyTimeHours: userProgress.totalStudyTime / 3600,
      streakDays: userProgress.streakDays,
      completionRate,
    };

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const weeklyActivityRaw = await prisma.activityLog.groupBy({
      by: ['action'],
      where: {
        userId,
        createdAt: {
          gte: oneWeekAgo
        }
      },
      _count: true
    });

    return {
      overall,
      weeklyActivity: weeklyActivityRaw,
      dailyActivity: []
    };
  }

  static async syncEnrollments(userId: string) {
    const courses = await prisma.courseProgress.findMany({
      where: { userId }
    });
    
    await Promise.all(courses.map((course) => this.syncCourseProgressTotals(userId, course.courseId)));
    
    return { syncedCount: courses.length };
  }
}
