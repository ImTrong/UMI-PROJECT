import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RecommendedCourse {
  id: string;
  title: string;
  slug: string;
  thumbnail?: string;
  price: number;
  rating: number;
  totalReviews: number;
  enrolledCount: number;
  level: string;
  category?: { id: string; name: string };
  recommendationReason?: string;
  // For "Continue Learning" section
  progressPercentage?: number;
  lastAccessedAt?: string;
  completedLessons?: number;
  totalLessons?: number;
}

export interface RecommendationSection {
  title: string;
  subtitle?: string;
  courses: RecommendedCourse[];
  type: string;
  viewedCourseTitle?: string;
}

export interface HomeRecommendations {
  continueLearning: RecommendationSection | null;
  becauseYouViewed: RecommendationSection[];
  forYou: RecommendationSection | null;
  pathBased: RecommendationSection | null;
  skillUpgrade: RecommendationSection | null;
  trendingInField: RecommendationSection | null;
  learnersLikeYou: RecommendationSection | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class HomeRecommendationService {
  private static courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

  /**
   * Helper: fetch courses from course-service by IDs
   */
  private static async fetchCoursesByIds(ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    try {
      const response = await axios.post(`${this.courseServiceUrl}/api/courses/recommendations/batch`, {
        excludeIds: [],
        limit: ids.length,
      });
      const allCourses: any[] = response.data.data || [];
      // Filter to only requested IDs
      return allCourses.filter((c: any) => ids.includes(c.id));
    } catch {
      // Fallback: fetch individually
      const results: any[] = [];
      for (const id of ids.slice(0, 10)) {
        try {
          const r = await axios.get(`${this.courseServiceUrl}/api/courses/${id}`);
          if (r.data.data) results.push(r.data.data);
        } catch { /* skip */ }
      }
      return results;
    }
  }

  /**
   * Helper: fetch courses by filter via batch endpoint
   */
  private static async fetchCoursesBatch(params: {
    categoryIds?: string[];
    excludeIds?: string[];
    levels?: string[];
    sortBy?: 'rating' | 'enrolledCount';
    limit?: number;
  }): Promise<any[]> {
    try {
      const response = await axios.post(
        `${this.courseServiceUrl}/api/courses/recommendations/batch`,
        params
      );
      return response.data.data || [];
    } catch (err) {
      logger.warn('fetchCoursesBatch failed:', err);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. TIẾP TỤC HỌC TẬP
  // ═══════════════════════════════════════════════════════════════════════════

  static async getContinueLearning(userId: string): Promise<RecommendationSection | null> {
    try {
      const inProgress = await prisma.courseProgress.findMany({
        where: {
          userId,
          completedAt: null,
          progressPercentage: { gt: 0 },
        },
        orderBy: { lastAccessedAt: 'desc' },
        take: 10,
      });

      if (!inProgress.length) return null;

      const courseDetails = await this.fetchCoursesByIds(inProgress.map(p => p.courseId));

      const courses: RecommendedCourse[] = inProgress
        .map(p => {
          const detail = courseDetails.find((c: any) => c.id === p.courseId);
          if (!detail) return null;
          return {
            id: detail.id,
            title: detail.title,
            slug: detail.slug,
            thumbnail: detail.thumbnail,
            price: detail.price,
            rating: detail.rating,
            totalReviews: detail.totalReviews,
            enrolledCount: detail.enrolledCount,
            level: detail.level,
            category: detail.category,
            progressPercentage: p.progressPercentage,
            lastAccessedAt: p.lastAccessedAt.toISOString(),
            completedLessons: p.completedLessons,
            totalLessons: p.totalLessons,
          };
        })
        .filter(Boolean) as RecommendedCourse[];

      if (!courses.length) return null;

      return {
        title: 'Tiếp tục học tập',
        subtitle: 'Quay lại nơi bạn đã dừng lại',
        courses,
        type: 'CONTINUE_LEARNING',
      };
    } catch (error) {
      logger.error('getContinueLearning error:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. VÌ BẠN ĐÃ XEM
  // ═══════════════════════════════════════════════════════════════════════════

  static async getBecauseYouViewed(userId: string): Promise<RecommendationSection[]> {
    try {
      // Get 3 most recently accessed courses
      const recentCourses = await prisma.courseProgress.findMany({
        where: { userId },
        orderBy: { lastAccessedAt: 'desc' },
        take: 3,
      });

      if (!recentCourses.length) return [];

      const enrolledCourseIds = (await prisma.courseProgress.findMany({
        where: { userId },
        select: { courseId: true },
      })).map(p => p.courseId);

      const sections: RecommendationSection[] = [];

      for (const recent of recentCourses) {
        // Get the course detail to find its category
        let courseDetail: any = null;
        try {
          const r = await axios.get(`${this.courseServiceUrl}/api/courses/${recent.courseId}`);
          courseDetail = r.data.data;
        } catch { continue; }

        if (!courseDetail?.categoryId) continue;

        // Find related courses in same category, excluding enrolled ones
        const related = await this.fetchCoursesBatch({
          categoryIds: [courseDetail.categoryId],
          excludeIds: enrolledCourseIds,
          sortBy: 'rating',
          limit: 10,
        });

        if (!related.length) continue;

        const courses: RecommendedCourse[] = related.map((c: any) => ({
          id: c.id,
          title: c.title,
          slug: c.slug,
          thumbnail: c.thumbnail,
          price: c.price,
          rating: c.rating,
          totalReviews: c.totalReviews,
          enrolledCount: c.enrolledCount,
          level: c.level,
          category: c.category,
          recommendationReason: `Liên quan đến "${courseDetail.title}"`,
        }));

        sections.push({
          title: `Vì bạn đã xem "${courseDetail.title}"`,
          subtitle: `Các khóa học tương tự trong ${courseDetail.category?.name || 'cùng chủ đề'}`,
          courses,
          type: 'BECAUSE_YOU_VIEWED',
          viewedCourseTitle: courseDetail.title,
        });

        if (sections.length >= 2) break; // Max 2 "because you viewed" sections
      }

      return sections;
    } catch (error) {
      logger.error('getBecauseYouViewed error:', error);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DÀNH CHO BẠN
  // ═══════════════════════════════════════════════════════════════════════════

  static async getForYou(userId: string): Promise<RecommendationSection | null> {
    try {
      const progresses = await prisma.courseProgress.findMany({
        where: { userId },
        select: { courseId: true, timeSpentSeconds: true, progressPercentage: true },
      });

      if (!progresses.length) return null;

      const enrolledIds = progresses.map(p => p.courseId);

      // Analyze category preferences from enrolled courses
      const courseDetails = await this.fetchCoursesByIds(enrolledIds);
      const categoryWeights: Record<string, number> = {};

      courseDetails.forEach((c: any, idx: number) => {
        if (c.categoryId) {
          const timeWeight = (progresses[idx]?.timeSpentSeconds || 0) / 3600;
          categoryWeights[c.categoryId] = (categoryWeights[c.categoryId] || 0) + timeWeight + 1;
        }
      });

      // Get top 3 categories
      const topCategories = Object.entries(categoryWeights)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([catId]) => catId);

      if (!topCategories.length) return null;

      const recommended = await this.fetchCoursesBatch({
        categoryIds: topCategories,
        excludeIds: enrolledIds,
        sortBy: 'rating',
        limit: 10,
      });

      if (!recommended.length) return null;

      const courses: RecommendedCourse[] = recommended.map((c: any) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        thumbnail: c.thumbnail,
        price: c.price,
        rating: c.rating,
        totalReviews: c.totalReviews,
        enrolledCount: c.enrolledCount,
        level: c.level,
        category: c.category,
        recommendationReason: 'Dựa trên sở thích học tập của bạn',
      }));

      return {
        title: 'Dành cho bạn',
        subtitle: 'Đề xuất dựa trên toàn bộ hành vi học tập của bạn',
        courses,
        type: 'FOR_YOU',
      };
    } catch (error) {
      logger.error('getForYou error:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. PHÙ HỢP VỚI LỘ TRÌNH HỌC TẬP
  // ═══════════════════════════════════════════════════════════════════════════

  static async getPathRecommendations(userId: string): Promise<RecommendationSection | null> {
    try {
      const enrollments = await prisma.userPathEnrollment.findMany({
        where: { userId, status: 'IN_PROGRESS' },
        include: { learningPath: true },
      });

      if (!enrollments.length) return null;

      const allNextCourseIds: string[] = [];

      for (const enrollment of enrollments) {
        const path = enrollment.learningPath;
        if (!path.courseIds.length) continue;

        // Find courses in this path that user hasn't completed
        const pathProgresses = await prisma.courseProgress.findMany({
          where: { userId, courseId: { in: path.courseIds } },
        });

        const completedIds = pathProgresses
          .filter(p => p.progressPercentage >= 100)
          .map(p => p.courseId);

        // Next courses = not completed ones (in order)
        const nextIds = path.courseIds.filter(id => !completedIds.includes(id));
        allNextCourseIds.push(...nextIds.slice(0, 5));
      }

      if (!allNextCourseIds.length) return null;

      const uniqueIds = [...new Set(allNextCourseIds)];
      const courseDetails = await this.fetchCoursesByIds(uniqueIds);

      const courses: RecommendedCourse[] = courseDetails.map((c: any) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        thumbnail: c.thumbnail,
        price: c.price,
        rating: c.rating,
        totalReviews: c.totalReviews,
        enrolledCount: c.enrolledCount,
        level: c.level,
        category: c.category,
        recommendationReason: 'Khóa tiếp theo trong lộ trình của bạn',
      }));

      if (!courses.length) return null;

      const pathTitle = enrollments[0].learningPath.title;

      return {
        title: 'Phù hợp với lộ trình học tập',
        subtitle: `Hoàn thành lộ trình "${pathTitle}" nhanh hơn`,
        courses,
        type: 'PATH_BASED',
      };
    } catch (error) {
      logger.error('getPathRecommendations error:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. NÂNG CAO KỸ NĂNG HIỆN TẠI
  // ═══════════════════════════════════════════════════════════════════════════

  static async getSkillUpgrade(userId: string): Promise<RecommendationSection | null> {
    try {
      // Get completed courses
      const completedProgresses = await prisma.courseProgress.findMany({
        where: { userId, progressPercentage: { gte: 100 } },
        select: { courseId: true },
      });

      if (!completedProgresses.length) return null;

      const enrolledIds = (await prisma.courseProgress.findMany({
        where: { userId },
        select: { courseId: true },
      })).map(p => p.courseId);

      const completedDetails = await this.fetchCoursesByIds(completedProgresses.map(p => p.courseId));

      // Group by category + find max level completed
      const categoryMaxLevel: Record<string, string> = {};
      const levelOrder: Record<string, number> = { 'BEGINNER': 1, 'INTERMEDIATE': 2, 'ADVANCED': 3 };

      completedDetails.forEach((c: any) => {
        if (!c.categoryId) return;
        const currentMax = categoryMaxLevel[c.categoryId];
        const currentLevel = c.level || 'BEGINNER';
        if (!currentMax || (levelOrder[currentLevel] || 0) > (levelOrder[currentMax] || 0)) {
          categoryMaxLevel[c.categoryId] = currentLevel;
        }
      });

      // For each category, find next-level courses
      const allUpgradeCourses: any[] = [];

      for (const [catId, maxLevel] of Object.entries(categoryMaxLevel)) {
        const nextLevels: string[] = [];
        if (maxLevel === 'BEGINNER') nextLevels.push('INTERMEDIATE', 'ADVANCED');
        else if (maxLevel === 'INTERMEDIATE') nextLevels.push('ADVANCED');
        else continue; // Already at ADVANCED

        const courses = await this.fetchCoursesBatch({
          categoryIds: [catId],
          excludeIds: enrolledIds,
          levels: nextLevels,
          sortBy: 'rating',
          limit: 5,
        });

        allUpgradeCourses.push(...courses);
        if (allUpgradeCourses.length >= 10) break;
      }

      if (!allUpgradeCourses.length) return null;

      const courses: RecommendedCourse[] = allUpgradeCourses.slice(0, 10).map((c: any) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        thumbnail: c.thumbnail,
        price: c.price,
        rating: c.rating,
        totalReviews: c.totalReviews,
        enrolledCount: c.enrolledCount,
        level: c.level,
        category: c.category,
        recommendationReason: 'Nâng cao kỹ năng từ khóa đã hoàn thành',
      }));

      return {
        title: 'Nâng cao kỹ năng hiện tại',
        subtitle: 'Tiến lên cấp độ tiếp theo dựa trên khóa bạn đã hoàn thành',
        courses,
        type: 'SKILL_UPGRADE',
      };
    } catch (error) {
      logger.error('getSkillUpgrade error:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. XU HƯỚNG TRONG LĨNH VỰC BẠN QUAN TÂM
  // ═══════════════════════════════════════════════════════════════════════════

  static async getTrendingInYourField(userId: string): Promise<RecommendationSection | null> {
    try {
      const progresses = await prisma.courseProgress.findMany({
        where: { userId },
        select: { courseId: true, timeSpentSeconds: true },
      });

      if (!progresses.length) return null;

      const enrolledIds = progresses.map(p => p.courseId);
      const courseDetails = await this.fetchCoursesByIds(enrolledIds);

      // Find top categories
      const categoryWeights: Record<string, { weight: number; name: string }> = {};
      courseDetails.forEach((c: any) => {
        if (c.categoryId) {
          if (!categoryWeights[c.categoryId]) {
            categoryWeights[c.categoryId] = { weight: 0, name: c.category?.name || '' };
          }
          categoryWeights[c.categoryId].weight++;
        }
      });

      const topCategories = Object.entries(categoryWeights)
        .sort(([, a], [, b]) => b.weight - a.weight)
        .slice(0, 2);

      if (!topCategories.length) return null;

      const topCatIds = topCategories.map(([id]) => id);

      const trending = await this.fetchCoursesBatch({
        categoryIds: topCatIds,
        excludeIds: enrolledIds,
        sortBy: 'enrolledCount',
        limit: 10,
      });

      if (!trending.length) return null;

      const fieldName = topCategories[0][1].name;

      const courses: RecommendedCourse[] = trending.map((c: any) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        thumbnail: c.thumbnail,
        price: c.price,
        rating: c.rating,
        totalReviews: c.totalReviews,
        enrolledCount: c.enrolledCount,
        level: c.level,
        category: c.category,
        recommendationReason: `Xu hướng trong ${c.category?.name || fieldName}`,
      }));

      return {
        title: `Xu hướng trong lĩnh vực bạn quan tâm`,
        subtitle: `Khóa học đang được nhiều người học trong ${fieldName}`,
        courses,
        type: 'TRENDING_IN_FIELD',
      };
    } catch (error) {
      logger.error('getTrendingInYourField error:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. NGƯỜI HỌC GIỐNG BẠN CŨNG HỌC (Collaborative Filtering)
  // ═══════════════════════════════════════════════════════════════════════════

  static async getLearnersLikeYou(userId: string): Promise<RecommendationSection | null> {
    try {
      // Step 1: Get user's enrolled course IDs
      const myProgresses = await prisma.courseProgress.findMany({
        where: { userId },
        select: { courseId: true },
      });

      const myCourseIds = myProgresses.map(p => p.courseId);
      if (myCourseIds.length < 2) return null; // Need at least 2 courses for CF

      // Step 2: Find other users who also enrolled in at least 2 of these courses
      const similarUserProgresses = await prisma.courseProgress.findMany({
        where: {
          courseId: { in: myCourseIds },
          userId: { not: userId },
        },
        select: { userId: true, courseId: true },
      });

      // Count overlap per user
      const userOverlap: Record<string, Set<string>> = {};
      similarUserProgresses.forEach(p => {
        if (!userOverlap[p.userId]) userOverlap[p.userId] = new Set();
        userOverlap[p.userId].add(p.courseId);
      });

      // Filter users with >= 2 overlap, sort by overlap count
      const similarUsers = Object.entries(userOverlap)
        .filter(([, courses]) => courses.size >= 2)
        .sort(([, a], [, b]) => b.size - a.size)
        .slice(0, 20)
        .map(([uid]) => uid);

      if (!similarUsers.length) return null;

      // Step 3: Get courses those similar users learned but I haven't
      const otherCourses = await prisma.courseProgress.findMany({
        where: {
          userId: { in: similarUsers },
          courseId: { notIn: myCourseIds },
        },
        select: { courseId: true },
      });

      // Count frequency of each course
      const courseFrequency: Record<string, number> = {};
      otherCourses.forEach(p => {
        courseFrequency[p.courseId] = (courseFrequency[p.courseId] || 0) + 1;
      });

      // Sort by frequency and take top 10
      const topCourseIds = Object.entries(courseFrequency)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([id]) => id);

      if (!topCourseIds.length) return null;

      const courseDetails = await this.fetchCoursesByIds(topCourseIds);

      const courses: RecommendedCourse[] = courseDetails.map((c: any) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        thumbnail: c.thumbnail,
        price: c.price,
        rating: c.rating,
        totalReviews: c.totalReviews,
        enrolledCount: c.enrolledCount,
        level: c.level,
        category: c.category,
        recommendationReason: 'Người học có sở thích tương tự cũng chọn khóa này',
      }));

      if (!courses.length) return null;

      return {
        title: 'Người học giống bạn cũng học',
        subtitle: 'Dựa trên học viên có sở thích tương tự',
        courses,
        type: 'COLLABORATIVE_FILTERING',
      };
    } catch (error) {
      logger.error('getLearnersLikeYou error:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COLD START - For unauthenticated or new users
  // ═══════════════════════════════════════════════════════════════════════════

  static async getColdStartRecommendations(): Promise<RecommendationSection[]> {
    const sections: RecommendationSection[] = [];

    try {
      // 1. Most popular
      const popular = await this.fetchCoursesBatch({
        sortBy: 'enrolledCount',
        limit: 10,
      });
      if (popular.length) {
        sections.push({
          title: 'Khóa học nổi bật',
          subtitle: 'Được đăng ký nhiều nhất trên hệ thống',
          courses: popular.map((c: any) => ({
            id: c.id, title: c.title, slug: c.slug, thumbnail: c.thumbnail,
            price: c.price, rating: c.rating, totalReviews: c.totalReviews,
            enrolledCount: c.enrolledCount, level: c.level, category: c.category,
          })),
          type: 'POPULAR',
        });
      }

      // 2. Highest rated
      const topRated = await this.fetchCoursesBatch({
        excludeIds: popular.map((c: any) => c.id),
        sortBy: 'rating',
        limit: 10,
      });
      if (topRated.length) {
        sections.push({
          title: 'Được đánh giá cao nhất',
          subtitle: 'Những khóa học nhận được đánh giá xuất sắc từ học viên',
          courses: topRated.map((c: any) => ({
            id: c.id, title: c.title, slug: c.slug, thumbnail: c.thumbnail,
            price: c.price, rating: c.rating, totalReviews: c.totalReviews,
            enrolledCount: c.enrolledCount, level: c.level, category: c.category,
          })),
          type: 'TOP_RATED',
        });
      }

      // 3. Newest
      try {
        const response = await axios.get(
          `${this.courseServiceUrl}/api/courses?sortBy=newest&limit=10`
        );
        const newest = response.data.courses || [];
        if (newest.length) {
          sections.push({
            title: 'Mới cập nhật',
            subtitle: 'Khóa học vừa được đăng tải trên nền tảng',
            courses: newest.map((c: any) => ({
              id: c.id, title: c.title, slug: c.slug, thumbnail: c.thumbnail,
              price: c.price, rating: c.rating, totalReviews: c.totalReviews,
              enrolledCount: c.enrolledCount, level: c.level, category: c.category,
            })),
            type: 'NEWEST',
          });
        }
      } catch { /* skip */ }
    } catch (error) {
      logger.error('getColdStartRecommendations error:', error);
    }

    return sections;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TỔNG HỢP — Gọi tất cả methods trên
  // ═══════════════════════════════════════════════════════════════════════════

  static async getHomeRecommendations(userId: string | null): Promise<HomeRecommendations | { coldStart: RecommendationSection[] }> {
    if (!userId) {
      const coldStart = await this.getColdStartRecommendations();
      return { coldStart };
    }

    // Check if user has any learning data
    const progressCount = await prisma.courseProgress.count({ where: { userId } });

    if (progressCount === 0) {
      const coldStart = await this.getColdStartRecommendations();
      return { coldStart };
    }

    // Fetch all sections in parallel for performance
    const [
      continueLearning,
      becauseYouViewed,
      forYou,
      pathBased,
      skillUpgrade,
      trendingInField,
      learnersLikeYou,
    ] = await Promise.all([
      this.getContinueLearning(userId),
      this.getBecauseYouViewed(userId),
      this.getForYou(userId),
      this.getPathRecommendations(userId),
      this.getSkillUpgrade(userId),
      this.getTrendingInYourField(userId),
      this.getLearnersLikeYou(userId),
    ]);

    return {
      continueLearning,
      becauseYouViewed,
      forYou,
      pathBased,
      skillUpgrade,
      trendingInField,
      learnersLikeYou,
    };
  }
}
