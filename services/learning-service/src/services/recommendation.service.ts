import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface CategoryInsight {
  categoryId: string;
  categoryName: string;
  courseCount: number;
  completedCount: number;
  totalTimeHours: number;
  averageProgress: number;
}

export interface LearningInsights {
  categoryDistribution: CategoryInsight[];
  skillStrengths: Array<{
    category: string;
    score: number; // 0-100
    label: string; // 'Xuất sắc', 'Tốt', 'Đang phát triển', 'Mới bắt đầu'
  }>;
  suggestedFocusAreas: Array<{
    category: string;
    reason: string;
  }>;
  weeklyProgress: {
    lessonsThisWeek: number;
    lessonsLastWeek: number;
    trend: 'up' | 'down' | 'stable';
    trendPercentage: number;
  };
  totalStats: {
    totalCourses: number;
    completedCourses: number;
    totalHours: number;
    averageCompletionRate: number;
    activePaths: number;
  };
}

export interface SmartAction {
  id: string;
  type: 'RESUME_COURSE' | 'COMPLETE_PATH' | 'PENDING_TASK' | 'ABANDONED_COURSE' | 'NEW_PATH' | 'NEW_COURSE';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  icon: string;
  actionUrl: string;
  metadata?: {
    progressPercentage?: number;
    lastAccessedDaysAgo?: number;
    courseTitle?: string;
    pathTitle?: string;
    pathId?: string;
  };
}

export interface EnrolledPathSummary {
  pathId: string;
  pathTitle: string;
  pathDescription: string;
  pathCategory: string | null;
  pathDifficulty: string;
  pathImageUrl: string | null;
  enrolledAt: string;
  status: string;
  completedCourses: number;
  totalCourses: number;
  progressPercentage: number;
  lastActivityAt: string | null;
  nextMilestone: {
    courseId: string;
    courseTitle: string;
    progressPercentage: number;
  } | null;
}

export class RecommendationService {
  private static courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

  /**
   * Get personalized course recommendations based on user study behaviors and history
   */
  static async getPersonalizedRecommendations(userId: string, limit: number = 4) {
    try {
      // 1. Get user's course progress history
      const progresses = await prisma.courseProgress.findMany({
        where: { userId },
        select: { courseId: true, courseTitle: true, progressPercentage: true, timeSpentSeconds: true },
      });

      const enrolledCourseIds = progresses.map((p) => p.courseId);

      // 2. Fetch details of enrolled courses to analyze category preferences
      const enrolledDetails = await Promise.all(
        enrolledCourseIds.map(async (id) => {
          try {
            const response = await axios.get(`${this.courseServiceUrl}/api/courses/${id}`);
            return response.data.data;
          } catch {
            return null;
          }
        })
      );

      // Analyze which categories user spends time on (weighted by study time)
      const validCourses = enrolledDetails.filter(Boolean);
      const categoryWeights: Record<string, { count: number; totalTime: number; completedCount: number }> = {};
      
      validCourses.forEach((c, idx) => {
        if (c.categoryId) {
          if (!categoryWeights[c.categoryId]) {
            categoryWeights[c.categoryId] = { count: 0, totalTime: 0, completedCount: 0 };
          }
          categoryWeights[c.categoryId].count++;
          categoryWeights[c.categoryId].totalTime += progresses[idx]?.timeSpentSeconds || 0;
          if ((progresses[idx]?.progressPercentage || 0) >= 100) {
            categoryWeights[c.categoryId].completedCount++;
          }
        }
      });

      // Sort categories by weighted preference (time * count)
      const favoriteCategories = Object.keys(categoryWeights).sort(
        (a, b) => {
          const scoreA = categoryWeights[a].totalTime * 0.7 + categoryWeights[a].count * 0.3 * 3600;
          const scoreB = categoryWeights[b].totalTime * 0.7 + categoryWeights[b].count * 0.3 * 3600;
          return scoreB - scoreA;
        }
      );

      // Determine user's difficulty level from completed courses
      const completedDifficulties = validCourses
        .filter((_, idx) => (progresses[idx]?.progressPercentage || 0) >= 100)
        .map((c) => c.level || c.difficulty || 'BEGINNER');
      
      const shouldSuggestAdvanced = completedDifficulties.includes('INTERMEDIATE') || completedDifficulties.includes('ADVANCED');
      const shouldSuggestIntermediate = completedDifficulties.includes('BEGINNER') || completedDifficulties.length > 0;

      let recommendedCourses: any[] = [];
      const recommendedCourseIds = new Set<string>();

      // 3. Strategy A: Category-based + difficulty progression
      if (favoriteCategories.length > 0) {
        for (const catId of favoriteCategories) {
          try {
            const response = await axios.get(
              `${this.courseServiceUrl}/api/courses?categoryId=${catId}&limit=10`
            );
            const courses = response.data.courses || [];
            
            const newCourses = courses.filter(
              (c: any) => !enrolledCourseIds.includes(c.id) && !recommendedCourseIds.has(c.id)
            );

            // Sort by difficulty progression
            newCourses.sort((a: any, b: any) => {
              const diffOrder: Record<string, number> = { 'BEGINNER': 1, 'INTERMEDIATE': 2, 'ADVANCED': 3 };
              const aLevel = diffOrder[a.level || a.difficulty || 'BEGINNER'] || 1;
              const bLevel = diffOrder[b.level || b.difficulty || 'BEGINNER'] || 1;
              
              if (shouldSuggestAdvanced) return bLevel - aLevel;
              if (shouldSuggestIntermediate) return aLevel === 2 ? -1 : bLevel === 2 ? 1 : 0;
              return aLevel - bLevel;
            });

            newCourses.forEach((c: any) => {
              const catInfo = categoryWeights[catId];
              const reason = catInfo.completedCount > 0
                ? `Nâng cao kỹ năng sau khi hoàn thành ${catInfo.completedCount} khóa "${c.category?.name || 'chủ đề này'}"`
                : `Gợi ý dựa trên sở thích học tập của bạn về "${c.category?.name || 'chủ đề này'}"`;
              c.recommendationReason = reason;
              c.recommendationType = 'CATEGORY_BASED';
              recommendedCourses.push(c);
              recommendedCourseIds.add(c.id);
            });

            if (recommendedCourses.length >= limit) break;
          } catch (err) {
            logger.warn(`Failed to fetch recommendations for category ${catId}:`, err);
          }
        }
      }

      // 4. Strategy B: Hot & Trending courses
      if (recommendedCourses.length < limit) {
        try {
          const response = await axios.get(
            `${this.courseServiceUrl}/api/courses?sortBy=enrolledCount&sortOrder=desc&limit=10`
          );
          const popularCourses = response.data.courses || [];
          
          const newPopular = popularCourses.filter(
            (c: any) => !enrolledCourseIds.includes(c.id) && !recommendedCourseIds.has(c.id)
          );

          newPopular.forEach((c: any) => {
            c.recommendationReason = 'Khóa học nổi bật được đăng ký nhiều nhất trên hệ thống';
            c.recommendationType = 'TRENDING';
            recommendedCourses.push(c);
            recommendedCourseIds.add(c.id);
          });
        } catch (err) {
          logger.warn('Failed to fetch popular courses:', err);
        }
      }

      // 5. Strategy C: Top rated courses
      if (recommendedCourses.length < limit) {
        try {
          const response = await axios.get(
            `${this.courseServiceUrl}/api/courses?sortBy=rating&sortOrder=desc&limit=10`
          );
          const topRatedCourses = response.data.courses || [];
          
          const newTopRated = topRatedCourses.filter(
            (c: any) => !enrolledCourseIds.includes(c.id) && !recommendedCourseIds.has(c.id)
          );

          newTopRated.forEach((c: any) => {
            c.recommendationReason = 'Khóa học được học viên xếp hạng và đánh giá cao nhất';
            c.recommendationType = 'TOP_RATED';
            recommendedCourses.push(c);
            recommendedCourseIds.add(c.id);
          });
        } catch (err) {
          logger.warn('Failed to fetch top rated courses:', err);
        }
      }

      return recommendedCourses.slice(0, limit);
    } catch (error) {
      logger.error('Error calculating personalized recommendations:', error);
      return [];
    }
  }

  /**
   * Get learning insights — category distribution, skill analysis, focus areas
   */
  static async getLearningInsights(userId: string): Promise<LearningInsights> {
    try {
      const progresses = await prisma.courseProgress.findMany({
        where: { userId },
        select: {
          courseId: true,
          courseTitle: true,
          progressPercentage: true,
          timeSpentSeconds: true,
          completedAt: true,
          enrolledAt: true,
        },
      });

      // Fetch course details for category info
      const courseDetails = await Promise.all(
        progresses.map(async (p) => {
          try {
            const response = await axios.get(`${this.courseServiceUrl}/api/courses/${p.courseId}`);
            return { ...response.data.data, progress: p };
          } catch {
            return null;
          }
        })
      );

      const validCourses = courseDetails.filter(Boolean);

      // Build category distribution
      const categoryMap: Record<string, CategoryInsight> = {};

      validCourses.forEach((c: any) => {
        const catId = c.categoryId || 'unknown';
        const catName = c.category?.name || 'Khác';

        if (!categoryMap[catId]) {
          categoryMap[catId] = {
            categoryId: catId,
            categoryName: catName,
            courseCount: 0,
            completedCount: 0,
            totalTimeHours: 0,
            averageProgress: 0,
          };
        }

        categoryMap[catId].courseCount++;
        categoryMap[catId].totalTimeHours += (c.progress.timeSpentSeconds || 0) / 3600;
        if (c.progress.progressPercentage >= 100) {
          categoryMap[catId].completedCount++;
        }
      });

      // Calculate average progress per category
      Object.values(categoryMap).forEach((cat) => {
        const categoryCourses = validCourses.filter(
          (c: any) => (c.categoryId || 'unknown') === cat.categoryId
        );
        const totalProgress = categoryCourses.reduce(
          (sum: number, c: any) => sum + (c.progress.progressPercentage || 0),
          0
        );
        cat.averageProgress = categoryCourses.length > 0 ? totalProgress / categoryCourses.length : 0;
      });

      const categoryDistribution = Object.values(categoryMap).sort(
        (a, b) => b.totalTimeHours - a.totalTimeHours
      );

      // Build skill strengths (0-100 score based on completion rate and progress)
      const skillStrengths = categoryDistribution.map((cat) => {
        const completionScore = cat.courseCount > 0 ? (cat.completedCount / cat.courseCount) * 60 : 0;
        const progressScore = (cat.averageProgress / 100) * 40;
        const score = Math.round(completionScore + progressScore);
        
        let label = 'Mới bắt đầu';
        if (score >= 80) label = 'Xuất sắc';
        else if (score >= 60) label = 'Tốt';
        else if (score >= 30) label = 'Đang phát triển';

        return {
          category: cat.categoryName,
          score,
          label,
        };
      });

      // Suggested focus areas
      const suggestedFocusAreas: Array<{ category: string; reason: string }> = [];
      
      // Areas with high time but low completion
      categoryDistribution.forEach((cat) => {
        if (cat.courseCount > 0 && cat.completedCount === 0 && cat.totalTimeHours > 1) {
          suggestedFocusAreas.push({
            category: cat.categoryName,
            reason: `Bạn đã đầu tư ${cat.totalTimeHours.toFixed(1)}h nhưng chưa hoàn thành khóa nào — hãy cố gắng hoàn thành!`,
          });
        }
        if (cat.averageProgress > 50 && cat.averageProgress < 100 && cat.completedCount === 0) {
          suggestedFocusAreas.push({
            category: cat.categoryName,
            reason: `Tiến độ trung bình ${Math.round(cat.averageProgress)}% — chỉ cần thêm một chút nữa thôi!`,
          });
        }
      });

      // Weekly progress trend
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const [lessonsThisWeek, lessonsLastWeek] = await Promise.all([
        prisma.lessonProgress.count({
          where: { userId, completed: true, completedAt: { gte: oneWeekAgo } },
        }),
        prisma.lessonProgress.count({
          where: {
            userId,
            completed: true,
            completedAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
          },
        }),
      ]);

      let trend: 'up' | 'down' | 'stable' = 'stable';
      let trendPercentage = 0;
      if (lessonsLastWeek > 0) {
        trendPercentage = Math.round(((lessonsThisWeek - lessonsLastWeek) / lessonsLastWeek) * 100);
        trend = trendPercentage > 10 ? 'up' : trendPercentage < -10 ? 'down' : 'stable';
      } else if (lessonsThisWeek > 0) {
        trend = 'up';
        trendPercentage = 100;
      }

      // Total stats
      const enrolledPaths = await prisma.userPathEnrollment.count({
        where: { userId, status: 'IN_PROGRESS' },
      });

      const totalCourses = progresses.length;
      const completedCourses = progresses.filter((p) => p.progressPercentage >= 100).length;
      const totalHours = progresses.reduce((sum, p) => sum + (p.timeSpentSeconds || 0), 0) / 3600;
      const averageCompletionRate =
        totalCourses > 0
          ? progresses.reduce((sum, p) => sum + p.progressPercentage, 0) / totalCourses
          : 0;

      return {
        categoryDistribution,
        skillStrengths,
        suggestedFocusAreas,
        weeklyProgress: {
          lessonsThisWeek,
          lessonsLastWeek,
          trend,
          trendPercentage,
        },
        totalStats: {
          totalCourses,
          completedCourses,
          totalHours: Math.round(totalHours * 10) / 10,
          averageCompletionRate: Math.round(averageCompletionRate),
          activePaths: enrolledPaths,
        },
      };
    } catch (error) {
      logger.error('Error getting learning insights:', error);
      return {
        categoryDistribution: [],
        skillStrengths: [],
        suggestedFocusAreas: [],
        weeklyProgress: { lessonsThisWeek: 0, lessonsLastWeek: 0, trend: 'stable', trendPercentage: 0 },
        totalStats: { totalCourses: 0, completedCourses: 0, totalHours: 0, averageCompletionRate: 0, activePaths: 0 },
      };
    }
  }

  /**
   * Get smart next actions — specific actionable items for the user
   */
  static async getSmartNextActions(userId: string): Promise<SmartAction[]> {
    const actions: SmartAction[] = [];

    try {
      const now = new Date();

      // 1. Abandoned courses (>7 days no activity, progress < 100%)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const abandonedCourses = await prisma.courseProgress.findMany({
        where: {
          userId,
          completedAt: null,
          progressPercentage: { gt: 0 },
          lastAccessedAt: { lt: sevenDaysAgo },
        },
        orderBy: { progressPercentage: 'desc' },
        take: 3,
      });

      abandonedCourses.forEach((course) => {
        const daysAgo = Math.floor((now.getTime() - new Date(course.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24));
        actions.push({
          id: `abandoned-${course.courseId}`,
          type: 'ABANDONED_COURSE',
          priority: course.progressPercentage > 60 ? 'HIGH' : 'MEDIUM',
          title: `Quay lại "${course.courseTitle}"`,
          description: `Đã ${daysAgo} ngày kể từ lần học cuối — bạn đã hoàn thành ${Math.round(course.progressPercentage)}%`,
          icon: '⏰',
          actionUrl: `/learning/${course.courseId}`,
          metadata: {
            progressPercentage: course.progressPercentage,
            lastAccessedDaysAgo: daysAgo,
            courseTitle: course.courseTitle,
          },
        });
      });

      // 2. Courses in progress that need resuming (recently active, not completed)
      const recentInProgress = await prisma.courseProgress.findMany({
        where: {
          userId,
          completedAt: null,
          progressPercentage: { gt: 0, lt: 100 },
          lastAccessedAt: { gte: sevenDaysAgo },
        },
        orderBy: { lastAccessedAt: 'desc' },
        take: 2,
      });

      recentInProgress.forEach((course) => {
        actions.push({
          id: `resume-${course.courseId}`,
          type: 'RESUME_COURSE',
          priority: 'HIGH',
          title: `Tiếp tục "${course.courseTitle}"`,
          description: `Tiến độ ${Math.round(course.progressPercentage)}% — còn ${course.totalLessons - course.completedLessons} bài học`,
          icon: '▶️',
          actionUrl: `/learning/${course.courseId}`,
          metadata: {
            progressPercentage: course.progressPercentage,
            courseTitle: course.courseTitle,
          },
        });
      });

      // 3. Learning paths almost complete (>70%)
      const pathEnrollments = await prisma.userPathEnrollment.findMany({
        where: { userId, status: 'IN_PROGRESS' },
        include: { learningPath: true },
      });

      for (const enrollment of pathEnrollments) {
        const path = enrollment.learningPath;
        if (!path.courseIds.length) continue;

        const pathProgresses = await prisma.courseProgress.findMany({
          where: { userId, courseId: { in: path.courseIds } },
        });

        const completedInPath = pathProgresses.filter((p) => p.progressPercentage >= 100).length;
        const pathProgress = (completedInPath / path.courseIds.length) * 100;

        if (pathProgress >= 70 && pathProgress < 100) {
          const remaining = path.courseIds.length - completedInPath;
          actions.push({
            id: `path-${path.id}`,
            type: 'COMPLETE_PATH',
            priority: 'HIGH',
            title: `Sắp hoàn thành lộ trình "${path.title}"`,
            description: `Chỉ còn ${remaining} khóa học nữa — đã ${Math.round(pathProgress)}% lộ trình`,
            icon: '🏆',
            actionUrl: `/learning-paths`,
            metadata: {
              progressPercentage: pathProgress,
              pathTitle: path.title,
              pathId: path.id,
            },
          });
        }
      }

      // 4. Pending quizzes and assignments
      try {
        const pendingQuizAttempts = await prisma.quizAttempt.findMany({
          where: { userId, status: 'IN_PROGRESS' },
          include: { quiz: true },
          take: 2,
        });

        pendingQuizAttempts.forEach((attempt) => {
          actions.push({
            id: `quiz-${attempt.quizId}`,
            type: 'PENDING_TASK',
            priority: 'MEDIUM',
            title: `Hoàn thành trắc nghiệm "${attempt.quiz.title}"`,
            description: 'Bạn có bài trắc nghiệm đang làm dở',
            icon: '📝',
            actionUrl: `/tasks/${attempt.id}/quiz`,
          });
        });
      } catch {
        // Quiz system might not be active
      }

      if (pathEnrollments.length < 2) {
        // Fetch up to 20 paths to have a good pool for randomization
        const allPaths = await prisma.learningPath.findMany({ 
          where: { status: 'PUBLISHED' },
          take: 20 
        });
        const enrolledPathIds = pathEnrollments.map((e) => e.learningPathId);
        const newPaths = allPaths.filter((p) => !enrolledPathIds.includes(p.id));

        if (newPaths.length > 0) {
          // Pick a random path from the available new paths
          const randomIndex = Math.floor(Math.random() * newPaths.length);
          const suggestedPath = newPaths[randomIndex];
          actions.push({
            id: `new-path-${suggestedPath.id}`,
            type: 'NEW_PATH',
            priority: 'LOW',
            title: `Khám phá lộ trình "${suggestedPath.title}"`,
            description: `${suggestedPath.courseIds.length} khóa học — ${suggestedPath.description.slice(0, 80)}...`,
            icon: '🗺️',
            actionUrl: `/learning-paths`,
            metadata: {
              pathTitle: suggestedPath.title,
              pathId: suggestedPath.id,
            },
          });
        }
      }

      // Sort by priority
      const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      return actions.slice(0, 8);
    } catch (error) {
      logger.error('Error getting smart next actions:', error);
      return [];
    }
  }

  /**
   * Get enrolled learning paths with real-time progress
   */
  static async getMyEnrolledPaths(userId: string): Promise<EnrolledPathSummary[]> {
    try {
      const enrollments = await prisma.userPathEnrollment.findMany({
        where: { userId },
        include: { learningPath: true },
        orderBy: { enrolledAt: 'desc' },
      });

      const results: EnrolledPathSummary[] = [];

      for (const enrollment of enrollments) {
        const path = enrollment.learningPath;

        // Get progress for each course in the path
        const courseProgresses = await prisma.courseProgress.findMany({
          where: { userId, courseId: { in: path.courseIds } },
        });

        const completedCourses = courseProgresses.filter((p) => p.progressPercentage >= 100).length;
        const progressPercentage =
          path.courseIds.length > 0 ? (completedCourses / path.courseIds.length) * 100 : 0;

        // Find last activity across all courses in this path
        const lastActivity = courseProgresses.reduce<Date | null>((latest, p) => {
          const accessDate = new Date(p.lastAccessedAt);
          return !latest || accessDate > latest ? accessDate : latest;
        }, null);

        // Find next milestone (first non-completed course)
        let nextMilestone: EnrolledPathSummary['nextMilestone'] = null;
        for (const courseId of path.courseIds) {
          const prog = courseProgresses.find((p) => p.courseId === courseId);
          if (!prog || prog.progressPercentage < 100) {
            // Fetch course info
            try {
              const response = await axios.get(`${this.courseServiceUrl}/api/courses/${courseId}`);
              const course = response.data.data;
              nextMilestone = {
                courseId,
                courseTitle: course?.title || prog?.courseTitle || 'Khóa học tiếp theo',
                progressPercentage: prog?.progressPercentage || 0,
              };
            } catch {
              nextMilestone = {
                courseId,
                courseTitle: prog?.courseTitle || 'Khóa học tiếp theo',
                progressPercentage: prog?.progressPercentage || 0,
              };
            }
            break;
          }
        }

        results.push({
          pathId: path.id,
          pathTitle: path.title,
          pathDescription: path.description,
          pathCategory: path.category,
          pathDifficulty: path.difficulty,
          pathImageUrl: path.imageUrl,
          enrolledAt: enrollment.enrolledAt.toISOString(),
          status: enrollment.status,
          completedCourses,
          totalCourses: path.courseIds.length,
          progressPercentage: Math.round(progressPercentage),
          lastActivityAt: lastActivity?.toISOString() || null,
          nextMilestone,
        });
      }

      return results;
    } catch (error) {
      logger.error('Error getting enrolled paths:', error);
      return [];
    }
  }
}
