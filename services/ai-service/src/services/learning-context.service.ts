import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';
import { readServiceToken, SERVICE_TOKEN_HEADER } from '../utils/service-token';

/**
 * AI -> Learning credential (FIX-INS-05): the learning-service's internal per-learner routes (skill profile, learner analysis)
 * accept ONLY this token in X-Internal-Service-Token. Without a usable value nothing is sent (no fallback to INTERNAL_SERVICE_TOKEN,
 * a default or ""), and the caller degrades exactly as when the learning-service is down (null).
 */
const AI_LEARNING_TOKEN = 'AI_LEARNING_TOKEN';
function learningInternalHeaders(): Record<string, string> | null {
  const token = readServiceToken(AI_LEARNING_TOKEN);
  if (!token.ok) {
    logger.error(`Not calling the learning-service internal API: ${token.reason}`);
    return null;
  }
  return { [SERVICE_TOKEN_HEADER]: token.value };
}

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
  // Extended fields for career path analysis
  quizScores: Array<{
    courseId: string;
    quizTitle: string;
    score: number;
    passed: boolean;
  }>;
  certificates: Array<{
    courseId: string;
    courseTitle: string;
    type: string;
    issueDate: string;
  }>;
  detailedPaths: Array<{
    id: string;
    title: string;
    description: string;
    shortDescription: string;
    category: string;
    difficulty: string;
    careerGoal: string;
    skills: string[];
    courseIds: string[];
    totalDurationMinutes: number;
    certificateName: string;
    certificateConfig?: any;
    courseDetails: Array<{
      courseId: string;
      title: string;
      level: string;
    }>;
    finalProject: {
      title: string;
      description: string;
      objectives: string;
      passingScore: number;
    } | null;
  }>;
  // Phase 3A: Skill Profile from project evaluations
  skillProfile: {
    skills: Array<{
      skill: string;
      category: string;
      level: string;
      confidence: number;
    }>;
    strengths: string[];
    weaknesses: string[];
    overallLevel: string;
    profileCompleteness: number;
  } | null;
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

    const authHeaders = { 
      Authorization: `Bearer ${token}`,
      'x-internal-service': 'true'
    };

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
      // Default empty for extended fields (populated by getExtendedContext)
      quizScores: [],
      certificates: [],
      detailedPaths: [],
      skillProfile: null,
    };

    // Store in cache
    contextCache.set(userId, { data: context, expiry: Date.now() + CACHE_TTL_MS });

    return context;
  }

  /**
   * Get full learner context WITH extended data (quiz scores, certificates, detailed paths)
   * Used for career path analysis which needs richer data
   */
  static async getExtendedContext(userId: string, token: string): Promise<LearnerContext> {
    const context = await this.getContext(userId, token);
    const authHeaders = { 
      Authorization: `Bearer ${token}`,
      'x-internal-service': 'true'
    };

    // Fetch extended data in parallel
    const [
      quizScores,
      certificates,
      detailedPaths,
      skillProfile,
    ] = await Promise.all([
      this.fetchQuizScores(authHeaders),
      this.fetchCertificates(authHeaders),
      this.fetchDetailedPaths(authHeaders),
      this.fetchSkillProfile(userId),
    ]);

    // Enrich course details in paths using available courses
    const enrichedPaths = detailedPaths.map((path: any) => {
      const courseDetails = (path.courseIds || []).map((cid: string) => {
        const course = context.availableCourses.find(c => c.id === cid);
        return course
          ? { courseId: cid, title: course.title, level: course.level }
          : { courseId: cid, title: 'Khóa học', level: 'N/A' };
      });

      // Extract certificate name from finalProject instructions or shortDescription
      let certificateName = '';
      if (path.certificateConfig && path.certificateConfig.title) {
        certificateName = path.certificateConfig.title;
      } else if (path.finalProject?.instructions) {
        const certMatch = path.finalProject.instructions.match(/"([^"]*Chứng chỉ[^"]*)"/)
          || path.finalProject.instructions.match(/"([^"]*UMI Academy[^"]*)"/)
          || path.finalProject.description?.match(/"([^"]*Chứng chỉ[^"]*)"/)
          || path.finalProject.description?.match(/"([^"]*UMI Academy[^"]*)"/); 
        if (certMatch) certificateName = certMatch[1];
      }
      if (!certificateName && path.shortDescription) {
        certificateName = `Chứng chỉ hoàn thành lộ trình "${path.title}" — UMI Academy`;
      }

      return {
        id: path.id || path._id,
        title: path.title || '',
        description: path.description || '',
        shortDescription: path.shortDescription || '',
        category: path.category || '',
        difficulty: path.difficulty || 'ALL',
        careerGoal: path.careerGoal || '',
        skills: path.skills || [],
        courseIds: path.courseIds || [],
        totalDurationMinutes: path.totalDurationMinutes || 0,
        certificateName,
        certificateConfig: path.certificateConfig || null,
        courseDetails,
        finalProject: path.finalProject ? {
          title: path.finalProject.title || '',
          description: path.finalProject.description || '',
          objectives: path.finalProject.objectives || '',
          passingScore: path.finalProject.passingScore || 80,
        } : null,
      };
    });

    return {
      ...context,
      quizScores: (quizScores || []).map((q: any) => ({
        courseId: q.courseId || '',
        quizTitle: q.title || q.quizTitle || '',
        score: q.score || 0,
        passed: q.passed || false,
      })),
      certificates: (certificates || []).map((c: any) => ({
        courseId: c.courseId || '',
        courseTitle: c.courseTitle || '',
        type: c.type || 'COURSE_COMPLETION',
        issueDate: c.issueDate || c.createdAt || '',
      })),
      detailedPaths: enrichedPaths,
      skillProfile: skillProfile ? {
        skills: ((skillProfile.skills as any[]) || []).map((s: any) => ({
          skill: s.displayName || s.skill,
          category: s.category || '',
          level: s.level || 'NO_EVIDENCE',
          confidence: s.confidence || 0,
        })),
        strengths: skillProfile.strengths || [],
        weaknesses: skillProfile.weaknesses || [],
        overallLevel: skillProfile.overallLevel || 'NO_EVIDENCE',
        profileCompleteness: skillProfile.profileCompleteness || 0,
      } : null,
    };
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

    // Skill Profile (Phase 3A)
    const sp = (ctx as any).skillProfile;
    if (sp && sp.skills && sp.skills.length > 0) {
      lines.push(`\n## Hồ sơ Kỹ năng (từ đánh giá đồ án)`);
      lines.push(`- Trình độ tổng thể: ${sp.overallLevel}`);
      lines.push(`- Độ hoàn thiện: ${sp.profileCompleteness}%`);
      if (sp.skills.length > 0) {
        lines.push(`- Kỹ năng:`);
        sp.skills.forEach((s: any) => {
          lines.push(`  • ${s.skill} (${s.category}): ${s.level} (confidence: ${s.confidence})`);
        });
      }
      if (sp.strengths.length > 0) {
        lines.push(`- Điểm mạnh: ${sp.strengths.join(', ')}`);
      }
      if (sp.weaknesses.length > 0) {
        lines.push(`- Cần cải thiện: ${sp.weaknesses.join(', ')}`);
      }
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

  // ==================== Extended Fetchers for Career Path ====================

  private static async fetchQuizScores(headers: any): Promise<any[]> {
    try {
      // Fetch quiz attempts from learning service via enrolled courses progress
      const res = await this.learningApi.get('/api/learning/progress/me', { headers });
      const data = res.data?.data || res.data;
      const courses = data?.courses || [];
      // Extract quiz-related data from course progress
      return courses
        .filter((c: any) => c.averageQuizScore !== undefined && c.averageQuizScore !== null)
        .map((c: any) => ({
          courseId: c.courseId,
          quizTitle: `Quiz - ${c.courseTitle || c.title || 'Khóa học'}`,
          score: c.averageQuizScore || 0,
          passed: c.passed || (c.averageQuizScore >= (c.passingScore || 60)),
        }));
    } catch (err: any) {
      logger.warn('Failed to fetch quiz scores:', err.message);
      return [];
    }
  }

  private static async fetchCertificates(headers: any): Promise<any[]> {
    try {
      const res = await this.learningApi.get('/api/learning/certificates/me', { headers });
      const data = res.data?.data || res.data;
      return data?.certificates || (Array.isArray(data) ? data : []);
    } catch (err: any) {
      logger.warn('Failed to fetch certificates:', err.message);
      return [];
    }
  }

  private static async fetchDetailedPaths(headers: any): Promise<any[]> {
    try {
      const res = await this.learningApi.get('/api/learning/paths', { headers });
      const data = res.data?.data || res.data;
      const paths = data?.paths || (Array.isArray(data) ? data : []);

      // Enrich each path with its finalProject data
      const enrichedPaths = await Promise.all(
        paths.map(async (path: any) => {
          try {
            const detailRes = await this.learningApi.get(`/api/learning/paths/${path.id || path._id}`, { headers });
            const detail = detailRes.data?.data || detailRes.data;
            return {
              ...path,
              finalProject: detail?.finalProject || null,
              shortDescription: detail?.path?.shortDescription || path.shortDescription || '',
            };
          } catch {
            return { ...path, finalProject: null };
          }
        })
      );

      return enrichedPaths;
    } catch (err: any) {
      logger.warn('Failed to fetch detailed paths:', err.message);
      return [];
    }
  }

  /**
   * Fetch skill profile from learning-service internal endpoint
   * Phase 3A — non-blocking, returns null on failure
   */
  private static async fetchSkillProfile(userId: string): Promise<any> {
    // userId is the signed-in user this context is built for (getExtendedContext)
    const headers = learningInternalHeaders();
    if (!headers) return null;
    try {
      const res = await this.learningApi.get(`/api/learning/internal/skill-profile/${userId}`, { headers });
      return res.data?.data || null;
    } catch (err: any) {
      logger.debug(`No skill profile found for user ${userId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch LearnerCompetencyProfile from learning-service internal endpoint
   * GĐ2 — used by CompetencyAnalysisService
   */
  static async fetchLearnerAnalysis(userId: string): Promise<any> {
    // userId is the signed-in user (CompetencyAnalysisService.generateFullAnalysis <- req.user.userId)
    const headers = learningInternalHeaders();
    if (!headers) return null;
    try {
      const res = await this.learningApi.get(`/api/learning/internal/learner-analysis/${userId}`, { headers });
      return res.data?.data || null;
    } catch (err: any) {
      logger.warn(`Failed to fetch learner analysis for user ${userId}: ${err.message}`);
      return null;
    }
  }

  // ==================== Page-Aware Review Context ====================

  /**
   * Fetch course review context for AI prompt injection
   * Returns aggregate data only (no raw comments)
   */
  static async fetchCourseReviewContext(courseId: string): Promise<{
    courseTitle: string;
    courseLevel: string;
    courseCategory: string;
    rating: number;
    totalReviews: number;
    enrolledCount: number;
    ratingDistribution: Record<number, number>;
    instructorId: string;
  } | null> {
    try {
      const courseUrl = process.env.COURSE_SERVICE_URL || 'http://course-service:3003';

      // Fetch course info and rating distribution in parallel
      const [courseRes, distRes] = await Promise.all([
        axios.get(`${courseUrl}/api/courses/${courseId}`, { timeout: 5000 }),
        axios.get(`${courseUrl}/api/courses/${courseId}/reviews/distribution`, { timeout: 5000 }),
      ]);

      const course = courseRes.data?.data || courseRes.data;
      const distribution = distRes.data?.data || distRes.data || {};

      if (!course) return null;

      return {
        courseTitle: course.title || '',
        courseLevel: course.level || 'N/A',
        courseCategory: course.category?.name || '',
        rating: course.rating || 0,
        totalReviews: course.totalReviews || 0,
        enrolledCount: course.enrolledCount || 0,
        ratingDistribution: distribution,
        instructorId: course.instructorId || '',
      };
    } catch (err: any) {
      logger.warn(`Failed to fetch course review context for ${courseId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch actual review contents for AI sentiment analysis
   */
  static async fetchCourseReviews(courseId: string, limit: number = 20): Promise<{
    courseId: string;
    reviews: Array<{ rating: number; content: string; createdAt: string }>;
  } | null> {
    try {
      const courseUrl = process.env.COURSE_SERVICE_URL || 'http://course-service:3003';
      
      const res = await axios.get(`${courseUrl}/api/courses/${courseId}/reviews?limit=${limit}`, { timeout: 5000 });
      const data = res.data?.data || res.data;
      
      if (!data || !data.reviews) return null;
      
      // Filter out PII, keep only useful data for AI
      const filteredReviews = data.reviews
        .filter((r: any) => r.comment && r.comment.trim() !== '') // only reviews with comments
        .map((r: any) => ({
          rating: r.rating,
          content: r.comment,
          createdAt: r.createdAt
        }));

      return {
        courseId,
        reviews: filteredReviews
      };
    } catch (err: any) {
      logger.warn(`Failed to fetch course reviews for ${courseId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch instructor review context for AI prompt injection
   * Aggregated from all courses of the instructor
   */
  static async fetchInstructorReviewContext(instructorId: string): Promise<{
    instructorName: string;
    totalCourses: number;
    totalStudents: number;
    totalReviews: number;
    averageRating: number;
    ratingDistribution: Record<number, number>;
  } | null> {
    try {
      const courseUrl = process.env.COURSE_SERVICE_URL || 'http://course-service:3003';
      const userUrl = process.env.USER_SERVICE_URL || 'http://user-service:3002';

      // Fetch instructor stats, rating distribution, and profile in parallel
      const [statsRes, distRes, profileRes] = await Promise.all([
        axios.get(`${courseUrl}/api/courses/instructor/${instructorId}/stats`, { timeout: 5000 }),
        axios.get(`${courseUrl}/api/courses/instructor/${instructorId}/rating-distribution`, { timeout: 5000 }),
        axios.get(`${userUrl}/api/users/${instructorId}/public`, { timeout: 5000 }).catch(() => null),
      ]);

      const stats = statsRes.data?.data || statsRes.data;
      const distribution = distRes.data?.data || distRes.data || {};
      const profile = profileRes?.data?.data || profileRes?.data || null;

      return {
        instructorName: profile?.fullName || 'Giảng viên',
        totalCourses: stats?.totalCourses || 0,
        totalStudents: stats?.totalStudents || 0,
        totalReviews: stats?.totalReviews || 0,
        averageRating: stats?.averageRating || 0,
        ratingDistribution: distribution,
      };
    } catch (err: any) {
      logger.warn(`Failed to fetch instructor review context for ${instructorId}: ${err.message}`);
      return null;
    }
  }

  static async searchCourse(query: string, token: string): Promise<Array<{ id: string; title: string; instructorId: string }> | null> {
    try {
      const courseUrl = process.env.COURSE_SERVICE_URL || 'http://course-service:3003';
      const res = await axios.get(`${courseUrl}/api/courses`, {
        params: { search: query, limit: 5 },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });

      const courses = res.data?.data?.courses || res.data?.courses || [];
      return courses.map((c: any) => ({
        id: c.id,
        title: c.title,
        instructorId: c.instructorId,
      }));
    } catch (err: any) {
      logger.warn(`Failed to search courses for query "${query}": ${err.message}`);
      return null;
    }
  }

  static async searchInstructor(query: string, token: string): Promise<Array<{ id: string; fullName: string }> | null> {
    try {
      const userUrl = process.env.USER_SERVICE_URL || 'http://user-service:3002';
      // using the generic users endpoint to search for instructors
      const res = await axios.get(`${userUrl}/api/users`, {
        params: { search: query, role: 'INSTRUCTOR', limit: 5 },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });

      const users = res.data?.data?.users || res.data?.users || [];
      return users.map((u: any) => ({
        id: u.id,
        fullName: u.fullName || u.email,
      }));
    } catch (err: any) {
      logger.warn(`Failed to search instructors for query "${query}": ${err.message}`);
      return null;
    }
  }

  /**
   * Build page context string for AI prompt injection
   * Converts fetched review data into a Markdown text block
   */
  static buildPageContextString(pageContext: { type: string; id: string } | null, reviewData: any): string {
    if (!pageContext || !reviewData) {
      return '';
    }

    const lines: string[] = [];

    if (pageContext.type === 'COURSE') {
      const data = reviewData as {
        courseTitle: string;
        courseLevel: string;
        courseCategory: string;
        rating: number;
        totalReviews: number;
        enrolledCount: number;
        ratingDistribution: Record<number, number>;
      };

      lines.push(`\n## Ngữ cảnh trang hiện tại — Khóa học`);
      lines.push(`- Tên khóa học: "${data.courseTitle}"`);
      lines.push(`- Danh mục: ${data.courseCategory || 'N/A'}`);
      lines.push(`- Cấp độ: ${data.courseLevel}`);
      lines.push(`- Số học viên: ${data.enrolledCount}`);
      lines.push(`- Đánh giá trung bình: ${data.rating.toFixed(1)}/5`);
      lines.push(`- Tổng lượt đánh giá: ${data.totalReviews}`);

      if (data.ratingDistribution && Object.keys(data.ratingDistribution).length > 0) {
        lines.push(`- Phân bố đánh giá:`);
        for (let i = 5; i >= 1; i--) {
          const count = data.ratingDistribution[i] || 0;
          lines.push(`  + ${i} sao: ${count} lượt`);
        }
      }
    } else if (pageContext.type === 'INSTRUCTOR') {
      const data = reviewData as {
        instructorName: string;
        totalCourses: number;
        totalStudents: number;
        totalReviews: number;
        averageRating: number;
        ratingDistribution: Record<number, number>;
      };

      lines.push(`\n## Ngữ cảnh trang hiện tại — Giảng viên`);
      lines.push(`- Tên giảng viên: "${data.instructorName}"`);
      lines.push(`- Tổng khóa học: ${data.totalCourses}`);
      lines.push(`- Tổng học viên: ${data.totalStudents}`);
      lines.push(`- Đánh giá trung bình: ${data.averageRating.toFixed(1)}/5`);
      lines.push(`- Tổng lượt đánh giá: ${data.totalReviews}`);

      if (data.ratingDistribution && Object.keys(data.ratingDistribution).length > 0) {
        lines.push(`- Phân bố đánh giá:`);
        for (let i = 5; i >= 1; i--) {
          const count = data.ratingDistribution[i] || 0;
          lines.push(`  + ${i} sao: ${count} lượt`);
        }
      }
    }

    return lines.join('\n');
  }
}
