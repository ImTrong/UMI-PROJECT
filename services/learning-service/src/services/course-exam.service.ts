import { PrismaClient, QuizAttemptStatus } from '@prisma/client';
import { ERROR_MESSAGES } from '../utils/constants';
import { ActivityService } from './activity.service';
import { ActivityAction, CourseExamResult } from '../types';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export class CourseExamService {
  /**
   * Calculate and return the course exam result.
   * Computes average quiz score across all quizzes in the course.
   */
  static async getCourseExamResult(userId: string, courseId: string): Promise<CourseExamResult> {
    const courseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (!courseProgress) throw new Error(ERROR_MESSAGES.PROGRESS_NOT_FOUND);

    // Get all quizzes for this course
    const quizzes = await prisma.quiz.findMany({
      where: { courseId },
      include: {
        attempts: {
          where: { userId, status: QuizAttemptStatus.SUBMITTED },
          orderBy: { score: 'desc' },
        },
      },
    });

    // Calculate per-quiz best scores
    const quizResults = await Promise.all(
      quizzes.map(async (quiz) => {
        // Get lesson title
        let lessonTitle = 'Unknown Lesson';
        try {
          const lessonProgress = await prisma.lessonProgress.findFirst({
            where: { userId, courseId, lessonId: quiz.lessonId },
          });
          if (lessonProgress) {
            lessonTitle = lessonProgress.lessonTitle;
          }
        } catch {
          // ignore
        }

        const bestAttempt = quiz.attempts[0]; // sorted by score desc
        return {
          quizId: quiz.id,
          lessonId: quiz.lessonId,
          lessonTitle,
          bestScore: bestAttempt?.score ?? 0,
          passed: bestAttempt ? bestAttempt.score >= quiz.passingScore : false,
          attempts: quiz.attempts.length,
        };
      })
    );

    const totalQuizzes = quizzes.length;
    const completedQuizzes = quizResults.filter((q) => q.attempts > 0).length;

    // Average of best scores across all quizzes
    const averageQuizScore =
      completedQuizzes > 0
        ? quizResults.reduce((sum, q) => sum + q.bestScore, 0) / totalQuizzes
        : 0;

    const passingScore = courseProgress.passingScore ?? 60;
    const passed = courseProgress.progressPercentage >= 100 && averageQuizScore >= passingScore;

    // Update course progress with exam result
    if (courseProgress.progressPercentage >= 100 && courseProgress.passed === null) {
      await prisma.courseProgress.update({
        where: { id: courseProgress.id },
        data: {
          averageQuizScore,
          passed,
          allowRetake: !passed,
        },
      });
    }

    return {
      courseId,
      courseTitle: courseProgress.courseTitle,
      averageQuizScore: Math.round(averageQuizScore * 100) / 100,
      passingScore,
      passed,
      totalQuizzes,
      completedQuizzes,
      quizResults,
      allowRetake: !passed && courseProgress.progressPercentage >= 100,
      retakeCount: courseProgress.retakeCount ?? 0,
    };
  }

  /**
   * Allow a student to retake a course for free.
   * Resets: lesson progress, quiz attempts, course progress percentage.
   * Keeps: enrollment, courseProgress record (increments retakeCount).
   */
  static async retakeCourse(userId: string, courseId: string) {
    const courseProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (!courseProgress) throw new Error(ERROR_MESSAGES.PROGRESS_NOT_FOUND);

    // Only allow retake if course was completed and NOT passed
    if (courseProgress.passed === true) {
      throw new Error(ERROR_MESSAGES.RETAKE_NOT_ALLOWED);
    }

    if (courseProgress.progressPercentage < 100) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_COMPLETED);
    }

    // 1. Delete all lesson progress for this course
    await prisma.lessonProgress.deleteMany({
      where: { userId, courseId },
    });

    // 2. Delete all quiz attempts for this course
    const quizzes = await prisma.quiz.findMany({
      where: { courseId },
      select: { id: true },
    });
    const quizIds = quizzes.map((q) => q.id);
    if (quizIds.length > 0) {
      await prisma.quizAttempt.deleteMany({
        where: { userId, quizId: { in: quizIds } },
      });
    }

    // 3. Reset course progress
    await prisma.courseProgress.update({
      where: { id: courseProgress.id },
      data: {
        progressPercentage: 0,
        completedLessons: 0,
        completedAt: null,
        timeSpentSeconds: 0,
        averageQuizScore: null,
        passed: null,
        allowRetake: false,
        retakeCount: (courseProgress.retakeCount ?? 0) + 1,
        lastAccessedAt: new Date(),
      },
    });

    // 4. Update user progress totals
    const completedCourses = await prisma.courseProgress.count({
      where: { userId, completedAt: { not: null } },
    });
    const totalLessonsCompleted = await prisma.lessonProgress.count({
      where: { userId, completed: true },
    });

    await prisma.userProgress.update({
      where: { userId },
      data: {
        totalCoursesCompleted: completedCourses,
        totalLessonsCompleted,
      },
    });

    // 5. Log activity
    await ActivityService.logActivity({
      userId,
      courseId,
      action: ActivityAction.COURSE_RETAKE,
      metadata: {
        courseTitle: courseProgress.courseTitle,
        retakeCount: (courseProgress.retakeCount ?? 0) + 1,
      },
    });

    logger.info(`User ${userId} retaking course ${courseId} (retake #${(courseProgress.retakeCount ?? 0) + 1})`);

    return {
      message: 'Course progress has been reset. You can start learning again for free.',
      retakeCount: (courseProgress.retakeCount ?? 0) + 1,
    };
  }
}
