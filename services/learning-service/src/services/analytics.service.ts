import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// ==================== Interfaces ====================

export interface StudyPatternHour {
  hour: number;       // 0-23
  dayOfWeek: number;  // 0=Sun, 1=Mon, ..., 6=Sat
  totalMinutes: number;
  sessionCount: number;
  intensity: number;   // 0-1 normalized
}

export interface StudyPatterns {
  hourlyDistribution: StudyPatternHour[];
  peakHours: { hour: number; label: string; avgMinutes: number }[];
  peakDays: { dayOfWeek: number; label: string; avgMinutes: number }[];
  averageDailyMinutes: number;
  averageSessionMinutes: number;
  totalSessions: number;
  preferredTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
}

export interface StudyReminder {
  id: string;
  type: 'STREAK_WARNING' | 'ABANDONED_COURSE' | 'SPACED_REPETITION' | 'QUIZ_DUE' | 'DAILY_GOAL' | 'PATH_MILESTONE';
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  icon: string;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, any>;
  expiresAt?: string;
}

export interface HeatmapDay {
  date: string;       // YYYY-MM-DD
  totalMinutes: number;
  lessonsCompleted: number;
  intensity: number;   // 0-4 level
}

export interface WeeklyReport {
  period: { start: string; end: string };
  thisWeek: {
    totalMinutes: number;
    lessonsCompleted: number;
    coursesProgressed: number;
    quizzesTaken: number;
    averageDailyMinutes: number;
    activeDays: number;
  };
  lastWeek: {
    totalMinutes: number;
    lessonsCompleted: number;
    coursesProgressed: number;
    quizzesTaken: number;
    averageDailyMinutes: number;
    activeDays: number;
  };
  trends: {
    studyTimeChange: number;   // percentage
    lessonsChange: number;     // percentage
    consistencyChange: number; // percentage
  };
  dailyBreakdown: { date: string; minutes: number; lessons: number }[];
  achievements: string[];
}

export interface OptimalScheduleSlot {
  dayOfWeek: number;
  dayLabel: string;
  startHour: number;
  startMinute?: number;
  endHour: number;
  endMinute?: number;
  activityType: 'NEW_LESSON' | 'REVIEW' | 'QUIZ' | 'PRACTICE';
  activityLabel: string;
  confidence: number;  // 0-100
  suggestedCourseId?: string;
  suggestedCourseName?: string;
}

export interface OptimalSchedule {
  slots: OptimalScheduleSlot[];
  weeklyTargetHours: number;
  dailyTargetMinutes: number;
  reasoning: string;
}

export interface ContentRecommendation {
  id: string;
  type: 'REVIEW_NEEDED' | 'SKILL_UP' | 'TRENDING_MATCH' | 'PATH_NEXT';
  title: string;
  description: string;
  reason: string;
  confidence: number;   // 0-100
  courseId?: string;
  courseTitle?: string;
  lessonId?: string;
  lessonTitle?: string;
  actionUrl: string;
  icon: string;
  metadata?: Record<string, any>;
}

// ==================== Service ====================

export class AnalyticsService {
  private static courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

  // ────────────────────────────────────────────────
  // 1. STUDY PATTERNS
  // ────────────────────────────────────────────────

  static async getStudyPatterns(userId: string): Promise<StudyPatterns> {
    try {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const activities = await prisma.activityLog.findMany({
        where: {
          userId,
          createdAt: { gte: ninetyDaysAgo },
          durationSeconds: { gt: 0 },
        },
        select: { createdAt: true, durationSeconds: true },
        orderBy: { createdAt: 'asc' },
      });

      // Build 7x24 matrix
      const matrix: Record<string, { totalMinutes: number; sessionCount: number }> = {};
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          matrix[`${d}-${h}`] = { totalMinutes: 0, sessionCount: 0 };
        }
      }

      let totalMinutesAll = 0;
      let totalSessions = 0;

      activities.forEach((a) => {
        const dt = new Date(a.createdAt);
        const dow = dt.getDay();
        const hour = dt.getHours();
        const mins = Math.round(a.durationSeconds / 60);
        const key = `${dow}-${hour}`;
        matrix[key].totalMinutes += mins;
        matrix[key].sessionCount++;
        totalMinutesAll += mins;
        totalSessions++;
      });

      // Find max for normalization
      const maxMinutes = Math.max(...Object.values(matrix).map((v) => v.totalMinutes), 1);

      const hourlyDistribution: StudyPatternHour[] = [];
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          const v = matrix[`${d}-${h}`];
          hourlyDistribution.push({
            dayOfWeek: d,
            hour: h,
            totalMinutes: v.totalMinutes,
            sessionCount: v.sessionCount,
            intensity: v.totalMinutes / maxMinutes,
          });
        }
      }

      // Peak hours (aggregate across all days)
      const hourAgg: Record<number, number> = {};
      for (let h = 0; h < 24; h++) hourAgg[h] = 0;
      hourlyDistribution.forEach((item) => {
        hourAgg[item.hour] += item.totalMinutes;
      });
      const peakHours = Object.entries(hourAgg)
        .map(([h, mins]) => ({
          hour: parseInt(h),
          label: `${h.padStart(2, '0')}:00`,
          avgMinutes: Math.round(mins / 90), // avg per day over 90 days
        }))
        .sort((a, b) => b.avgMinutes - a.avgMinutes)
        .slice(0, 3);

      // Peak days
      const dayLabels = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
      const dayAgg: Record<number, number> = {};
      for (let d = 0; d < 7; d++) dayAgg[d] = 0;
      hourlyDistribution.forEach((item) => {
        dayAgg[item.dayOfWeek] += item.totalMinutes;
      });
      const peakDays = Object.entries(dayAgg)
        .map(([d, mins]) => ({
          dayOfWeek: parseInt(d),
          label: dayLabels[parseInt(d)],
          avgMinutes: Math.round(mins / 13), // ~13 weeks in 90 days
        }))
        .sort((a, b) => b.avgMinutes - a.avgMinutes)
        .slice(0, 3);

      // Preferred time of day
      const morning = Object.entries(hourAgg).filter(([h]) => parseInt(h) >= 5 && parseInt(h) < 12).reduce((s, [, v]) => s + v, 0);
      const afternoon = Object.entries(hourAgg).filter(([h]) => parseInt(h) >= 12 && parseInt(h) < 17).reduce((s, [, v]) => s + v, 0);
      const evening = Object.entries(hourAgg).filter(([h]) => parseInt(h) >= 17 && parseInt(h) < 21).reduce((s, [, v]) => s + v, 0);
      const night = Object.entries(hourAgg).filter(([h]) => parseInt(h) >= 21 || parseInt(h) < 5).reduce((s, [, v]) => s + v, 0);
      const maxPeriod = Math.max(morning, afternoon, evening, night);
      let preferredTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'night' = 'morning';
      if (maxPeriod === afternoon) preferredTimeOfDay = 'afternoon';
      else if (maxPeriod === evening) preferredTimeOfDay = 'evening';
      else if (maxPeriod === night) preferredTimeOfDay = 'night';

      return {
        hourlyDistribution,
        peakHours,
        peakDays,
        averageDailyMinutes: Math.round(totalMinutesAll / 90),
        averageSessionMinutes: totalSessions > 0 ? Math.round(totalMinutesAll / totalSessions) : 0,
        totalSessions,
        preferredTimeOfDay,
      };
    } catch (error) {
      logger.error('Error getting study patterns:', error);
      return {
        hourlyDistribution: [],
        peakHours: [],
        peakDays: [],
        averageDailyMinutes: 0,
        averageSessionMinutes: 0,
        totalSessions: 0,
        preferredTimeOfDay: 'morning',
      };
    }
  }

  // ────────────────────────────────────────────────
  // 2. STUDY REMINDERS
  // ────────────────────────────────────────────────

  static async getStudyReminders(userId: string): Promise<StudyReminder[]> {
    const reminders: StudyReminder[] = [];
    const now = new Date();

    try {
      // --- A. Streak warning ---
      const userProgress = await prisma.userProgress.findUnique({ where: { userId } });
      if (userProgress) {
        const lastActivity = userProgress.lastActivityDate;
        if (lastActivity) {
          const lastDate = new Date(lastActivity);
          lastDate.setHours(0, 0, 0, 0);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const diffDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

          if (diffDays >= 1 && userProgress.streakDays > 0) {
            reminders.push({
              id: 'streak-warning',
              type: 'STREAK_WARNING',
              urgency: diffDays === 1 ? 'CRITICAL' : 'HIGH',
              title: diffDays === 1
                ? `🔥 Chuỗi ${userProgress.streakDays} ngày sắp mất!`
                : `😢 Chuỗi học đã bị gián đoạn ${diffDays} ngày`,
              description: diffDays === 1
                ? 'Hãy hoàn thành ít nhất 1 bài học hôm nay để giữ chuỗi ngày học liên tục!'
                : `Bạn đã nghỉ ${diffDays} ngày. Hãy quay lại học để bắt đầu chuỗi mới!`,
              icon: '🔥',
              actionUrl: '/my-learning',
              actionLabel: 'Học ngay',
            });
          }
        }

        // --- B. Daily goal reminder ---
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayActivities = await prisma.activityLog.aggregate({
          where: { userId, createdAt: { gte: todayStart } },
          _sum: { durationSeconds: true },
        });
        const todayMinutes = Math.round((todayActivities._sum.durationSeconds || 0) / 60);
        const dailyGoal = 30; // 30 minutes default

        if (todayMinutes < dailyGoal) {
          reminders.push({
            id: 'daily-goal',
            type: 'DAILY_GOAL',
            urgency: todayMinutes === 0 ? 'MEDIUM' : 'LOW',
            title: todayMinutes === 0
              ? '📚 Chưa học hôm nay'
              : `📊 Đã học ${todayMinutes}/${dailyGoal} phút hôm nay`,
            description: todayMinutes === 0
              ? `Mục tiêu hôm nay: ${dailyGoal} phút. Hãy bắt đầu ngay!`
              : `Còn ${dailyGoal - todayMinutes} phút nữa để đạt mục tiêu hôm nay.`,
            icon: '🎯',
            actionUrl: '/my-learning',
            actionLabel: 'Tiếp tục học',
            metadata: { todayMinutes, dailyGoal },
          });
        }
      }

      // --- C. Abandoned courses (>3 days no activity) ---
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const abandonedCourses = await prisma.courseProgress.findMany({
        where: {
          userId,
          completedAt: null,
          progressPercentage: { gt: 0 },
          lastAccessedAt: { lt: threeDaysAgo },
        },
        orderBy: { progressPercentage: 'desc' },
        take: 5,
      });

      abandonedCourses.forEach((course) => {
        const daysAgo = Math.floor((now.getTime() - new Date(course.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24));
        reminders.push({
          id: `abandoned-${course.courseId}`,
          type: 'ABANDONED_COURSE',
          urgency: course.progressPercentage > 70 ? 'HIGH' : 'MEDIUM',
          title: `📖 Quay lại "${course.courseTitle}"`,
          description: `Đã ${daysAgo} ngày kể từ lần học cuối. Tiến độ ${Math.round(course.progressPercentage)}% — còn ${course.totalLessons - course.completedLessons} bài nữa!`,
          icon: '📖',
          actionUrl: `/learning/${course.courseId}`,
          actionLabel: 'Tiếp tục',
          metadata: {
            progressPercentage: course.progressPercentage,
            daysAgo,
            courseTitle: course.courseTitle,
          },
        });
      });

      // --- D. Spaced repetition reminders ---
      // Find lessons completed at specific intervals (1d, 3d, 7d, 14d, 30d ago)
      const spacedIntervals = [
        { days: 1, label: 'hôm qua' },
        { days: 3, label: '3 ngày trước' },
        { days: 7, label: '1 tuần trước' },
        { days: 14, label: '2 tuần trước' },
        { days: 30, label: '1 tháng trước' },
      ];

      for (const interval of spacedIntervals) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - interval.days);
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const lessonsToReview = await prisma.lessonProgress.findMany({
          where: {
            userId,
            completed: true,
            completedAt: { gte: startOfDay, lte: endOfDay },
          },
          take: 2,
        });

        if (lessonsToReview.length > 0) {
          const lesson = lessonsToReview[0];
          reminders.push({
            id: `review-${interval.days}d-${lesson.lessonId}`,
            type: 'SPACED_REPETITION',
            urgency: interval.days <= 3 ? 'MEDIUM' : 'LOW',
            title: `🧠 Ôn tập: "${lesson.lessonTitle}"`,
            description: `Bài học hoàn thành ${interval.label}. Ôn tập theo phương pháp Spaced Repetition để nhớ lâu hơn!`,
            icon: '🧠',
            actionUrl: `/learning/${lesson.courseId}`,
            actionLabel: 'Ôn tập ngay',
            metadata: {
              lessonId: lesson.lessonId,
              courseId: lesson.courseId,
              intervalDays: interval.days,
            },
          });
        }
      }

      // --- E. Path milestone approaching ---
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

        if (pathProgress >= 50 && pathProgress < 100) {
          const remaining = path.courseIds.length - completedInPath;
          reminders.push({
            id: `path-${path.id}`,
            type: 'PATH_MILESTONE',
            urgency: pathProgress >= 80 ? 'HIGH' : 'MEDIUM',
            title: `🗺️ Lộ trình "${path.title}" — ${Math.round(pathProgress)}%`,
            description: `Chỉ còn ${remaining} khóa học nữa! Bạn đã đi được hơn nửa chặng đường.`,
            icon: '🗺️',
            actionUrl: '/learning-paths',
            actionLabel: 'Xem lộ trình',
            metadata: {
              pathId: path.id,
              progressPercentage: pathProgress,
              remaining,
            },
          });
        }
      }

      // Sort by urgency
      const urgencyOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      reminders.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

      return reminders;
    } catch (error) {
      logger.error('Error getting study reminders:', error);
      return [];
    }
  }

  // ────────────────────────────────────────────────
  // 3. STUDY HEATMAP
  // ────────────────────────────────────────────────

  static async getStudyHeatmap(userId: string, year?: number): Promise<HeatmapDay[]> {
    try {
      const targetYear = year || new Date().getFullYear();
      const startDate = new Date(targetYear, 0, 1);
      const endDate = new Date(targetYear, 11, 31, 23, 59, 59);

      // Get all activities for the year
      const activities = await prisma.activityLog.findMany({
        where: {
          userId,
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { createdAt: true, durationSeconds: true, action: true },
      });

      // Get lessons completed
      const lessonsCompleted = await prisma.lessonProgress.findMany({
        where: {
          userId,
          completed: true,
          completedAt: { gte: startDate, lte: endDate },
        },
        select: { completedAt: true },
      });

      // Build day map
      const dayMap: Record<string, { minutes: number; lessons: number }> = {};

      activities.forEach((a) => {
        const dateKey = new Date(a.createdAt).toISOString().split('T')[0];
        if (!dayMap[dateKey]) dayMap[dateKey] = { minutes: 0, lessons: 0 };
        dayMap[dateKey].minutes += Math.round(a.durationSeconds / 60);
      });

      lessonsCompleted.forEach((l) => {
        if (l.completedAt) {
          const dateKey = new Date(l.completedAt).toISOString().split('T')[0];
          if (!dayMap[dateKey]) dayMap[dateKey] = { minutes: 0, lessons: 0 };
          dayMap[dateKey].lessons++;
        }
      });

      // Generate all days in year
      const heatmap: HeatmapDay[] = [];
      const current = new Date(startDate);
      const today = new Date();

      while (current <= endDate && current <= today) {
        const dateKey = current.toISOString().split('T')[0];
        const data = dayMap[dateKey] || { minutes: 0, lessons: 0 };

        // Intensity levels: 0=none, 1=light, 2=moderate, 3=high, 4=very high
        let intensity = 0;
        if (data.minutes > 0) intensity = 1;
        if (data.minutes >= 15) intensity = 2;
        if (data.minutes >= 30) intensity = 3;
        if (data.minutes >= 60) intensity = 4;

        heatmap.push({
          date: dateKey,
          totalMinutes: data.minutes,
          lessonsCompleted: data.lessons,
          intensity,
        });

        current.setDate(current.getDate() + 1);
      }

      return heatmap;
    } catch (error) {
      logger.error('Error getting study heatmap:', error);
      return [];
    }
  }

  // ────────────────────────────────────────────────
  // 4. WEEKLY REPORT
  // ────────────────────────────────────────────────

  static async getWeeklyReport(userId: string): Promise<WeeklyReport> {
    try {
      const now = new Date();
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
      thisWeekStart.setHours(0, 0, 0, 0);

      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);

      const lastWeekEnd = new Date(thisWeekStart);
      lastWeekEnd.setMilliseconds(-1);

      // Helper to get week stats
      const getWeekStats = async (start: Date, end: Date) => {
        const [activities, lessons, quizAttempts] = await Promise.all([
          prisma.activityLog.findMany({
            where: { userId, createdAt: { gte: start, lte: end } },
            select: { createdAt: true, durationSeconds: true },
          }),
          prisma.lessonProgress.count({
            where: { userId, completed: true, completedAt: { gte: start, lte: end } },
          }),
          prisma.quizAttempt.count({
            where: { userId, status: 'SUBMITTED', submittedAt: { gte: start, lte: end } },
          }),
        ]);

        const totalMinutes = activities.reduce((sum, a) => sum + Math.round(a.durationSeconds / 60), 0);
        const activeDaysSet = new Set(activities.map((a) => new Date(a.createdAt).toISOString().split('T')[0]));
        const coursesProgressedRaw = await prisma.courseProgress.count({
          where: { userId, lastAccessedAt: { gte: start, lte: end } },
        });

        return {
          totalMinutes,
          lessonsCompleted: lessons,
          coursesProgressed: coursesProgressedRaw,
          quizzesTaken: quizAttempts,
          averageDailyMinutes: Math.round(totalMinutes / 7),
          activeDays: activeDaysSet.size,
        };
      };

      const thisWeekStats = await getWeekStats(thisWeekStart, now);
      const lastWeekStats = await getWeekStats(lastWeekStart, lastWeekEnd);

      // Trends
      const calcChange = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
      };

      const trends = {
        studyTimeChange: calcChange(thisWeekStats.totalMinutes, lastWeekStats.totalMinutes),
        lessonsChange: calcChange(thisWeekStats.lessonsCompleted, lastWeekStats.lessonsCompleted),
        consistencyChange: calcChange(thisWeekStats.activeDays, lastWeekStats.activeDays),
      };

      // Daily breakdown for this week
      const dailyBreakdown: { date: string; minutes: number; lessons: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const dayStart = new Date(thisWeekStart);
        dayStart.setDate(dayStart.getDate() + i);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);

        if (dayStart > now) {
          dailyBreakdown.push({ date: dayStart.toISOString().split('T')[0], minutes: 0, lessons: 0 });
          continue;
        }

        const [dayActivities, dayLessons] = await Promise.all([
          prisma.activityLog.aggregate({
            where: { userId, createdAt: { gte: dayStart, lte: dayEnd } },
            _sum: { durationSeconds: true },
          }),
          prisma.lessonProgress.count({
            where: { userId, completed: true, completedAt: { gte: dayStart, lte: dayEnd } },
          }),
        ]);

        dailyBreakdown.push({
          date: dayStart.toISOString().split('T')[0],
          minutes: Math.round((dayActivities._sum.durationSeconds || 0) / 60),
          lessons: dayLessons,
        });
      }

      // Achievements
      const achievements: string[] = [];
      if (thisWeekStats.activeDays >= 7) achievements.push('🏆 Học đủ 7 ngày trong tuần!');
      if (thisWeekStats.lessonsCompleted >= 10) achievements.push('📚 Hoàn thành 10+ bài học!');
      if (thisWeekStats.totalMinutes >= 300) achievements.push('⏱️ Học hơn 5 giờ trong tuần!');
      if (trends.studyTimeChange > 20) achievements.push('📈 Thời gian học tăng đáng kể!');
      if (thisWeekStats.quizzesTaken >= 3) achievements.push('📝 Hoàn thành 3+ bài kiểm tra!');

      return {
        period: {
          start: thisWeekStart.toISOString(),
          end: now.toISOString(),
        },
        thisWeek: thisWeekStats,
        lastWeek: lastWeekStats,
        trends,
        dailyBreakdown,
        achievements,
      };
    } catch (error) {
      logger.error('Error getting weekly report:', error);
      return {
        period: { start: '', end: '' },
        thisWeek: { totalMinutes: 0, lessonsCompleted: 0, coursesProgressed: 0, quizzesTaken: 0, averageDailyMinutes: 0, activeDays: 0 },
        lastWeek: { totalMinutes: 0, lessonsCompleted: 0, coursesProgressed: 0, quizzesTaken: 0, averageDailyMinutes: 0, activeDays: 0 },
        trends: { studyTimeChange: 0, lessonsChange: 0, consistencyChange: 0 },
        dailyBreakdown: [],
        achievements: [],
      };
    }
  }

  // ────────────────────────────────────────────────
  // 5. OPTIMAL SCHEDULE
  // ────────────────────────────────────────────────

  static async getOptimalSchedule(userId: string): Promise<OptimalSchedule> {
    try {
      const patterns = await this.getStudyPatterns(userId);
      const dayLabels = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

      // Get courses in progress for scheduling
      const inProgressCourses = await prisma.courseProgress.findMany({
        where: { userId, completedAt: null, progressPercentage: { gt: 0, lt: 100 } },
        orderBy: { lastAccessedAt: 'desc' },
        take: 5,
      });

      // Find top 2 peak hours per peak day
      const slots: OptimalScheduleSlot[] = [];

      // Build per-day peak hours from patterns
      const dayHourScores: Record<number, { hour: number; score: number }[]> = {};
      for (let d = 0; d < 7; d++) {
        const dayData = patterns.hourlyDistribution.filter((h) => h.dayOfWeek === d);
        dayHourScores[d] = dayData
          .map((h) => ({ hour: h.hour, score: h.intensity }))
          .sort((a, b) => b.score - a.score);
      }

      const activityTypes: Array<{ type: OptimalScheduleSlot['activityType']; label: string }> = [
        { type: 'NEW_LESSON', label: 'Học bài mới' },
        { type: 'REVIEW', label: 'Ôn tập' },
        { type: 'QUIZ', label: 'Làm bài kiểm tra' },
        { type: 'PRACTICE', label: 'Thực hành' },
      ];

      let courseIdx = 0;

      for (let d = 0; d < 7; d++) {
        const topHours = dayHourScores[d].filter((h) => h.score > 0).slice(0, 2);

        if (topHours.length === 0) {
          // If no data, suggest based on global peak
          if (patterns.peakHours.length > 0) {
            const suggestedHour = patterns.peakHours[0].hour;
            const course = inProgressCourses[courseIdx % Math.max(inProgressCourses.length, 1)];
            slots.push({
              dayOfWeek: d,
              dayLabel: dayLabels[d],
              startHour: suggestedHour,
              endHour: suggestedHour + 1,
              activityType: 'NEW_LESSON',
              activityLabel: 'Học bài mới',
              confidence: 30,
              suggestedCourseId: course?.courseId,
              suggestedCourseName: course?.courseTitle,
            });
          }
          continue;
        }

        topHours.forEach((peak, idx) => {
          const actType = activityTypes[idx % activityTypes.length];
          const course = inProgressCourses[courseIdx % Math.max(inProgressCourses.length, 1)];
          courseIdx++;

          slots.push({
            dayOfWeek: d,
            dayLabel: dayLabels[d],
            startHour: peak.hour,
            endHour: Math.min(peak.hour + 1, 23),
            activityType: actType.type,
            activityLabel: actType.label,
            confidence: Math.round(peak.score * 100),
            suggestedCourseId: course?.courseId,
            suggestedCourseName: course?.courseTitle,
          });
        });
      }

      // Calculate targets
      const weeklyTargetHours = Math.max(Math.round(patterns.averageDailyMinutes * 7 / 60 * 1.1), 3); // 10% more than current
      const dailyTargetMinutes = Math.max(Math.round(patterns.averageDailyMinutes * 1.1), 20);

      const timeLabels: Record<string, string> = {
        morning: 'buổi sáng',
        afternoon: 'buổi chiều',
        evening: 'buổi tối',
        night: 'ban đêm',
      };

      const reasoning = patterns.totalSessions > 0
        ? `Dựa trên ${patterns.totalSessions} phiên học tập trong 90 ngày qua, bạn học hiệu quả nhất vào ${timeLabels[patterns.preferredTimeOfDay]}. Giờ vàng của bạn là ${patterns.peakHours.map((h) => h.label).join(', ')}. Lịch này được tối ưu theo thói quen học tập thực tế của bạn.`
        : 'Hãy bắt đầu học để hệ thống phân tích và gợi ý lịch tối ưu cho bạn.';

      return {
        slots,
        weeklyTargetHours,
        dailyTargetMinutes,
        reasoning,
      };
    } catch (error) {
      logger.error('Error getting optimal schedule:', error);
      return {
        slots: [],
        weeklyTargetHours: 5,
        dailyTargetMinutes: 30,
        reasoning: 'Không thể tạo lịch tối ưu. Hãy bắt đầu học để hệ thống phân tích thói quen của bạn.',
      };
    }
  }

  // ────────────────────────────────────────────────
  // 6. CONTENT RECOMMENDATIONS
  // ────────────────────────────────────────────────

  static async getContentRecommendations(userId: string): Promise<ContentRecommendation[]> {
    const recommendations: ContentRecommendation[] = [];

    try {
      // --- A. Review needed: quiz with low scores ---
      const lowScoreQuizzes = await prisma.quizAttempt.findMany({
        where: {
          userId,
          status: 'SUBMITTED',
          passed: false,
        },
        include: { quiz: true },
        orderBy: { submittedAt: 'desc' },
        take: 3,
      });

      lowScoreQuizzes.forEach((attempt) => {
        recommendations.push({
          id: `review-quiz-${attempt.quizId}`,
          type: 'REVIEW_NEEDED',
          title: `Ôn tập: ${attempt.quiz.title}`,
          description: `Bạn đạt ${Math.round(attempt.score)}% — cần ôn lại kiến thức trước khi thử lại.`,
          reason: `Điểm kiểm tra dưới ngưỡng đạt (${attempt.quiz.passingScore}%). Hãy xem lại bài học liên quan.`,
          confidence: 90,
          courseId: attempt.courseId,
          lessonId: attempt.quiz.lessonId,
          lessonTitle: attempt.quiz.title,
          actionUrl: `/learning/${attempt.courseId}`,
          icon: '🔄',
          metadata: { score: attempt.score, passingScore: attempt.quiz.passingScore },
        });
      });

      // --- B. Skill up: completed basic → suggest advanced ---
      const completedCourses = await prisma.courseProgress.findMany({
        where: { userId, progressPercentage: { gte: 100 } },
        select: { courseId: true, courseTitle: true },
      });

      if (completedCourses.length > 0) {
        const enrolledCourseIds = (await prisma.courseProgress.findMany({
          where: { userId },
          select: { courseId: true },
        })).map((c) => c.courseId);

        // Fetch course details for completed courses to get categories
        for (const completed of completedCourses.slice(0, 3)) {
          try {
            const response = await axios.get(`${this.courseServiceUrl}/api/courses/${completed.courseId}`);
            const courseDetail = response.data.data;
            if (!courseDetail?.categoryId) continue;

            // Find other courses in same category not enrolled
            const sameCategoryResponse = await axios.get(
              `${this.courseServiceUrl}/api/courses?categoryId=${courseDetail.categoryId}&limit=3`
            );
            const sameCategoryCourses = (sameCategoryResponse.data.courses || [])
              .filter((c: any) => !enrolledCourseIds.includes(c.id));

            if (sameCategoryCourses.length > 0) {
              const suggested = sameCategoryCourses[0];
              recommendations.push({
                id: `skillup-${suggested.id}`,
                type: 'SKILL_UP',
                title: suggested.title,
                description: `Nâng cao kỹ năng "${courseDetail.category?.name || 'chủ đề này'}" sau khi hoàn thành "${completed.courseTitle}"`,
                reason: `Bạn đã hoàn thành tốt khóa "${completed.courseTitle}". Đây là khóa tiếp theo phù hợp.`,
                confidence: 75,
                courseId: suggested.id,
                courseTitle: suggested.title,
                actionUrl: `/courses/${suggested.slug}`,
                icon: '🚀',
              });
            }
          } catch {
            // Skip if course service unavailable
          }
        }
      }

      // --- C. Courses almost done (>70%) — push to finish ---
      const almostDoneCourses = await prisma.courseProgress.findMany({
        where: {
          userId,
          completedAt: null,
          progressPercentage: { gte: 70, lt: 100 },
        },
        orderBy: { progressPercentage: 'desc' },
        take: 3,
      });

      almostDoneCourses.forEach((course) => {
        recommendations.push({
          id: `finish-${course.courseId}`,
          type: 'REVIEW_NEEDED',
          title: `Hoàn thành "${course.courseTitle}"`,
          description: `Bạn đã đạt ${Math.round(course.progressPercentage)}% — chỉ cần thêm ${course.totalLessons - course.completedLessons} bài nữa!`,
          reason: 'Hoàn thành khóa học để nhận chứng chỉ và mở khóa các đề xuất mới.',
          confidence: 95,
          courseId: course.courseId,
          courseTitle: course.courseTitle,
          actionUrl: `/learning/${course.courseId}`,
          icon: '🏁',
        });
      });

      // --- D. Path next: next course in enrolled learning paths ---
      const pathEnrollments = await prisma.userPathEnrollment.findMany({
        where: { userId, status: 'IN_PROGRESS' },
        include: { learningPath: true },
        take: 2,
      });

      for (const enrollment of pathEnrollments) {
        const path = enrollment.learningPath;
        const pathProgresses = await prisma.courseProgress.findMany({
          where: { userId, courseId: { in: path.courseIds } },
        });

        // Find first non-completed course in path order
        for (const courseId of path.courseIds) {
          const prog = pathProgresses.find((p) => p.courseId === courseId);
          if (!prog || prog.progressPercentage < 100) {
            try {
              const courseResponse = await axios.get(`${this.courseServiceUrl}/api/courses/${courseId}`);
              const courseData = courseResponse.data.data;
              recommendations.push({
                id: `path-next-${courseId}`,
                type: 'PATH_NEXT',
                title: courseData?.title || 'Khóa học tiếp theo',
                description: `Bước tiếp theo trong lộ trình "${path.title}"`,
                reason: `Đây là khóa tiếp theo trong lộ trình "${path.title}" mà bạn đang theo dõi.`,
                confidence: 85,
                courseId,
                courseTitle: courseData?.title,
                actionUrl: prog ? `/learning/${courseId}` : `/courses/${courseData?.slug || courseId}`,
                icon: '🗺️',
              });
            } catch {
              // Skip
            }
            break;
          }
        }
      }

      // Sort by confidence
      recommendations.sort((a, b) => b.confidence - a.confidence);

      return recommendations.slice(0, 8);
    } catch (error) {
      logger.error('Error getting content recommendations:', error);
      return [];
    }
  }

  // ────────────────────────────────────────────────
  // 7. STUDY SCHEDULE (DATABASE)
  // ────────────────────────────────────────────────

  static async getMySchedule(userId: string): Promise<OptimalSchedule | null> {
    try {
      const schedule = await prisma.studySchedule.findUnique({
        where: { userId },
      });

      if (!schedule) return null;

      return {
        slots: schedule.slots as unknown as OptimalScheduleSlot[],
        weeklyTargetHours: schedule.weeklyTargetHours,
        dailyTargetMinutes: schedule.dailyTargetMinutes,
        reasoning: 'Lịch học tùy chỉnh của bạn.',
      };
    } catch (error) {
      logger.error('Error getting my schedule:', error);
      return null;
    }
  }

  static async saveMySchedule(userId: string, data: OptimalSchedule): Promise<void> {
    try {
      await prisma.studySchedule.upsert({
        where: { userId },
        update: {
          slots: data.slots as any,
          weeklyTargetHours: data.weeklyTargetHours,
          dailyTargetMinutes: data.dailyTargetMinutes,
        },
        create: {
          userId,
          slots: data.slots as any,
          weeklyTargetHours: data.weeklyTargetHours,
          dailyTargetMinutes: data.dailyTargetMinutes,
        },
      });
    } catch (error) {
      logger.error('Error saving my schedule:', error);
      throw error;
    }
  }
}
