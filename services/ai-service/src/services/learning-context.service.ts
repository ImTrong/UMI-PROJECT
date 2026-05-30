import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';

/**
 * Learner profile data aggregated from multiple services
 */
export interface LearnerContext {
  user: {
    name: string;
    email: string;
    role: string;
  } | null;
  enrolledCourses: Array<{
    courseId: string;
    title: string;
    progress: number;
    completedLessons: number;
    totalLessons: number;
    enrolledAt: string;
  }>;
  completedCourses: Array<{
    courseId: string;
    title: string;
    completedAt: string;
  }>;
  inProgressCourses: Array<{
    courseId: string;
    title: string;
    progress: number;
  }>;
  learningStats: {
    totalCoursesEnrolled: number;
    totalCoursesCompleted: number;
    totalLessonsCompleted: number;
    currentStreak: number;
    longestStreak: number;
    totalStudyTime: string;
  } | null;
  learningPaths: Array<{
    pathId: string;
    title: string;
    progress: number;
    targetRole: string;
  }>;
  weeklyReport: {
    totalMinutes: number;
    lessonsCompleted: number;
    coursesCompleted: number;
    comparedToLastWeek: string;
  } | null;
  studyReminders: Array<{
    type: string;
    message: string;
    priority: string;
  }>;
  availableCourses: Array<{
    id: string;
    title: string;
    category: string;
    level: string;
    enrollmentCount: number;
  }>;
}

// In-memory cache: userId -> { data, expiry }
const contextCache = new Map<string, { data: LearnerContext; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Learning Context Service
 * Aggregates learner data from internal microservices
 * Uses JWT token forwarding for authentication
 */
export class LearningContextService {
  private static learningApi: AxiosInstance;
  private static courseApi: AxiosInstance;
  private static userApi: AxiosInstance;

  static initialize() {
    const learningUrl = process.env.LEARNING_SERVICE_URL || 'http://learning-service:3006';
    const courseUrl = process.env.COURSE_SERVICE_URL || 'http://course-service:3003';
    const userUrl = process.env.USER_SERVICE_URL || 'http://user-service:3002';

    const timeout = 8000; // 8s timeout for internal calls

    this.learningApi = axios.create({ baseURL: learningUrl, timeout });
    this.courseApi = axios.create({ baseURL: courseUrl, timeout });
    this.userApi = axios.create({ baseURL: userUrl, timeout });

    logger.info('LearningContextService initialized', { learningUrl, courseUrl, userUrl });
  }

  /**
   * Get full learner context for a user
   * Uses cache to avoid redundant internal API calls
   */
  static async getContext(userId: string, token: string): Promise<LearnerContext> {
    // Check cache
    const cached = contextCache.get(userId);
    if (cached && cached.expiry > Date.now()) {
      logger.debug(`Using cached context for user ${userId}`);
      return cached.data;
    }

    logger.info(`Fetching fresh learning context for user ${userId}`);

    const authHeaders = { Authorization: `Bearer ${token}` };

    // Fetch all data in parallel for speed
    const [
      userProfile,
      progressData,
      statsData,
      enrolledCourses,
      learningPaths,
      weeklyReport,
      reminders,
      availableCourses,
    ] = await Promise.all([
      this.fetchUserProfile(authHeaders),
      this.fetchProgress(authHeaders),
      this.fetchStats(authHeaders),
      this.fetchEnrolledCourses(authHeaders),
      this.fetchLearningPaths(authHeaders),
      this.fetchWeeklyReport(authHeaders),
      this.fetchReminders(authHeaders),
      this.fetchAvailableCourses(),
    ]);

    // Process and categorize courses
    const allProgress = progressData || [];
    const completed = allProgress.filter((c: any) => (c.progressPercentage || c.completionPercentage || 0) >= 100);
    const inProgress = allProgress.filter((c: any) => {
      const p = (c.progressPercentage || c.completionPercentage || 0);
      return p > 0 && p < 100;
    });

    const context: LearnerContext = {
      user: userProfile ? {
        name: userProfile.fullName || userProfile.email?.split('@')[0] || 'Học viên',
        email: userProfile.email || '',
        role: userProfile.role || 'STUDENT',
      } : null,
      enrolledCourses: (enrolledCourses || []).map((c: any) => ({
        courseId: c.courseId || c.id,
        title: c.title || c.courseTitle || 'Khóa học',
        progress: c.progressPercentage || c.completionPercentage || c.progress || 0,
        completedLessons: c.completedLessons || 0,
        totalLessons: c.totalLessons || 0,
        enrolledAt: c.enrolledAt || c.createdAt || '',
      })),
      completedCourses: completed.map((c: any) => ({
        courseId: c.courseId,
        title: c.title || c.courseTitle || 'Khóa học',
        completedAt: c.completedAt || c.lastAccessedAt || c.updatedAt || '',
      })),
      inProgressCourses: inProgress.map((c: any) => ({
        courseId: c.courseId,
        title: c.title || c.courseTitle || 'Khóa học',
        progress: c.progressPercentage || c.completionPercentage || 0,
      })),
      learningStats: statsData ? {
        totalCoursesEnrolled: statsData.overall?.totalCoursesEnrolled || statsData.totalCoursesEnrolled || statsData.totalCourses || 0,
        totalCoursesCompleted: statsData.overall?.totalCoursesCompleted || statsData.totalCoursesCompleted || statsData.completedCourses || 0,
        totalLessonsCompleted: statsData.overall?.totalLessonsCompleted || statsData.totalLessonsCompleted || 0,
        currentStreak: statsData.overall?.streakDays || statsData.currentStreak || statsData.streak || 0,
        longestStreak: statsData.longestStreak || 0,
        totalStudyTime: statsData.overall?.totalStudyTimeHours !== undefined ? `${statsData.overall.totalStudyTimeHours.toFixed(1)} giờ` : (statsData.totalStudyTime || statsData.totalTime || '0 giờ'),
      } : null,
      learningPaths: (learningPaths || []).map((p: any) => ({
        pathId: p.pathId || p.id,
        title: p.title || p.pathTitle || '',
        progress: p.progress || p.completionPercentage || 0,
        targetRole: p.targetRole || p.careerGoal || '',
      })),
      weeklyReport: weeklyReport ? {
        totalMinutes: weeklyReport.totalMinutes || weeklyReport.totalStudyMinutes || 0,
        lessonsCompleted: weeklyReport.lessonsCompleted || weeklyReport.completedLessons || 0,
        coursesCompleted: weeklyReport.coursesCompleted || 0,
        comparedToLastWeek: weeklyReport.comparedToLastWeek || weeklyReport.trend || 'N/A',
      } : null,
      studyReminders: (reminders || []).map((r: any) => ({
        type: r.type || 'info',
        message: r.message || r.text || '',
        priority: r.priority || 'medium',
      })),
      availableCourses: (availableCourses || []).slice(0, 100).map((c: any) => ({
        id: c.id || c._id,
        title: c.title || '',
        category: c.category?.name || c.categoryName || '',
        level: c.level || 'beginner',
        enrollmentCount: c.enrollmentCount || 0,
      })),
    };

    // Store in cache
    contextCache.set(userId, { data: context, expiry: Date.now() + CACHE_TTL_MS });

    return context;
  }

  /**
   * Build a text summary of learner context for injection into system prompt
   */
  static buildContextString(ctx: LearnerContext): string {
    const lines: string[] = [];

    // User info
    if (ctx.user) {
      lines.push(`## Thông tin người học`);
      lines.push(`- Tên: ${ctx.user.name}`);
      lines.push(`- Vai trò: ${ctx.user.role}`);
    }

    // Learning stats
    if (ctx.learningStats) {
      lines.push(`\n## Thống kê học tập`);
      lines.push(`- Tổng khóa đã đăng ký: ${ctx.learningStats.totalCoursesEnrolled}`);
      lines.push(`- Khóa đã hoàn thành: ${ctx.learningStats.totalCoursesCompleted}`);
      lines.push(`- Bài học đã hoàn thành: ${ctx.learningStats.totalLessonsCompleted}`);
      lines.push(`- Chuỗi ngày học liên tiếp: ${ctx.learningStats.currentStreak} ngày`);
      lines.push(`- Chuỗi dài nhất: ${ctx.learningStats.longestStreak} ngày`);
      lines.push(`- Tổng thời gian học: ${ctx.learningStats.totalStudyTime}`);
    }

    // In-progress courses
    if (ctx.inProgressCourses.length > 0) {
      lines.push(`\n## Khóa học đang học (${ctx.inProgressCourses.length})`);
      ctx.inProgressCourses.forEach(c => {
        lines.push(`- "${c.title}" — ${c.progress}% hoàn thành`);
      });
    }

    // Completed courses
    if (ctx.completedCourses.length > 0) {
      lines.push(`\n## Khóa học đã hoàn thành (${ctx.completedCourses.length})`);
      ctx.completedCourses.forEach(c => {
        lines.push(`- "${c.title}"`);
      });
    }

    // Learning paths
    if (ctx.learningPaths.length > 0) {
      lines.push(`\n## Lộ trình đang theo đuổi`);
      ctx.learningPaths.forEach(p => {
        lines.push(`- "${p.title}" (Mục tiêu: ${p.targetRole || 'N/A'}) — ${p.progress}% hoàn thành`);
      });
    }

    // Weekly report
    if (ctx.weeklyReport) {
      lines.push(`\n## Báo cáo tuần`);
      lines.push(`- Tổng thời gian: ${ctx.weeklyReport.totalMinutes} phút`);
      lines.push(`- Bài học hoàn thành: ${ctx.weeklyReport.lessonsCompleted}`);
      lines.push(`- So với tuần trước: ${ctx.weeklyReport.comparedToLastWeek}`);
    }

    // Reminders
    if (ctx.studyReminders.length > 0) {
      lines.push(`\n## Nhắc nhở`);
      ctx.studyReminders.forEach(r => {
        lines.push(`- [${r.priority}] ${r.message}`);
      });
    }

    // Available courses (for recommendations)
    if (ctx.availableCourses.length > 0) {
      lines.push(`\n## Khóa học có sẵn trên nền tảng (để gợi ý)`);
      ctx.availableCourses.slice(0, 100).forEach(c => {
        lines.push(`- "${c.title}" (${c.category}, ${c.level}, ${c.enrollmentCount} đã đăng ký)`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Clear cache for a specific user (useful after actions that change data)
   */
  static clearCache(userId: string) {
    contextCache.delete(userId);
  }

  // ==================== Internal API Fetchers ====================

  private static async fetchUserProfile(headers: any): Promise<any> {
    try {
      const res = await this.userApi.get('/api/users/me', { headers });
      return res.data?.data || res.data;
    } catch (err: any) {
      logger.warn('Failed to fetch user profile:', err.message);
      return null;
    }
  }

  private static async fetchProgress(headers: any): Promise<any[]> {
    try {
      const res = await this.learningApi.get('/api/learning/progress/me', { headers });
      return res.data?.data?.courses || res.data?.courses || [];
    } catch (err: any) {
      logger.warn('Failed to fetch progress:', err.message);
      return [];
    }
  }

  private static async fetchStats(headers: any): Promise<any> {
    try {
      const res = await this.learningApi.get('/api/learning/stats', { headers });
      return res.data?.data || res.data;
    } catch (err: any) {
      logger.warn('Failed to fetch stats:', err.message);
      return null;
    }
  }

  private static async fetchEnrolledCourses(headers: any): Promise<any[]> {
    try {
      const res = await this.learningApi.get('/api/learning/courses/enrolled', { headers });
      const data = res.data?.data || res.data;
      return data?.courses || (Array.isArray(data) ? data : []);
    } catch (err: any) {
      logger.warn('Failed to fetch enrolled courses:', err.message);
      return [];
    }
  }

  private static async fetchLearningPaths(headers: any): Promise<any[]> {
    try {
      const res = await this.learningApi.get('/api/learning/paths/my-paths', { headers });
      const data = res.data?.data || res.data;
      return data?.paths || (Array.isArray(data) ? data : []);
    } catch (err: any) {
      logger.warn('Failed to fetch learning paths:', err.message);
      return [];
    }
  }

  private static async fetchWeeklyReport(headers: any): Promise<any> {
    try {
      const res = await this.learningApi.get('/api/learning/analytics/weekly-report', { headers });
      return res.data?.data || res.data;
    } catch (err: any) {
      logger.warn('Failed to fetch weekly report:', err.message);
      return null;
    }
  }

  private static async fetchReminders(headers: any): Promise<any[]> {
    try {
      const res = await this.learningApi.get('/api/learning/analytics/reminders', { headers });
      const data = res.data?.data || res.data;
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      logger.warn('Failed to fetch reminders:', err.message);
      return [];
    }
  }

  private static async fetchAvailableCourses(): Promise<any[]> {
    try {
      const res = await this.courseApi.get('/api/courses?limit=100&status=PUBLISHED');
      const data = res.data?.data || res.data;
      return data?.courses || (Array.isArray(data) ? data : []);
    } catch (err: any) {
      logger.warn('Failed to fetch available courses:', err.message);
      return [];
    }
  }

  static async fetchAvailablePaths(headers?: any): Promise<any[]> {
    try {
      const res = await this.learningApi.get('/api/learning/paths', { headers });
      const data = res.data?.data || res.data;
      return data?.paths || (Array.isArray(data) ? data : []);
    } catch (err: any) {
      logger.warn('Failed to fetch available paths:', err.message);
      return [];
    }
  }
}
