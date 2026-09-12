import { learningApi } from './api';
import type { LearnerAnalyticsDashboardData } from '../components/learner-analytics/learner-analytics.types';

// ==================== Interfaces ====================

export interface StudyPatternHour {
  hour: number;
  dayOfWeek: number;
  totalMinutes: number;
  sessionCount: number;
  intensity: number;
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
  date: string;
  totalMinutes: number;
  lessonsCompleted: number;
  intensity: number;
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
    studyTimeChange: number;
    lessonsChange: number;
    consistencyChange: number;
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
  confidence: number;
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
  confidence: number;
  courseId?: string;
  courseTitle?: string;
  lessonId?: string;
  lessonTitle?: string;
  actionUrl: string;
  icon: string;
  metadata?: Record<string, any>;
}

// ==================== Response Mapping ====================

/**
 * Maps backend API response to frontend LearnerAnalyticsDashboardData.
 */
function mapBackendToFrontend(apiData: any): LearnerAnalyticsDashboardData {
  // ── Overview ──
  const overview = apiData.overview ?? null;

  // ── Timeline ──
  const timeline = apiData.timeline ?? null;

  // ── Progress → TrendChartData ──
  const progressTrend = apiData.progressTrend
    ? {
        status: apiData.progressTrend.status ?? 'INSUFFICIENT_DATA',
        dataPoints: apiData.progressTrend.dataPoints ?? [],
        trend: apiData.progressTrend.trend ?? 'STABLE',
        trendLabel: apiData.progressTrend.trendLabel ?? 'Ổn định',
        currentProgress: apiData.progressTrend.currentProgress,
        confidence: apiData.progressTrend.confidence ?? 1,
      }
    : null;

  // ── Performance → TrendChartData ──
  const performanceTrend = apiData.performanceTrend
    ? {
        status: apiData.performanceTrend.status ?? 'INSUFFICIENT_DATA',
        dataPoints: apiData.performanceTrend.dataPoints ?? [],
        trend: apiData.performanceTrend.trend ?? 'STABLE',
        trendLabel: apiData.performanceTrend.trendLabel ?? 'Ổn định',
        currentScore: apiData.performanceTrend.currentScore,
        confidence: apiData.performanceTrend.confidence ?? 1,
      }
    : null;

  // ── Engagement ──
  const engagement = apiData.engagement ?? null;

  // ── Skills ──
  const skills = apiData.skills ?? null;

  // ── Knowledge Gaps ──
  const knowledgeGaps = apiData.knowledgeGaps ?? null;

  // ── Bottlenecks ──
  const bottlenecks = apiData.bottlenecks ?? null;

  // ── Recovery ──
  const recovery = apiData.recovery ?? null;

  // ── Learning State ──
  const learningState = apiData.learningState ?? null;

  // ── Effectiveness ──
  const effectiveness = apiData.effectiveness ?? null;

  // ── Recommendations ──
  const recommendations = Array.isArray(apiData.recommendations)
    ? apiData.recommendations
    : [];

  // ── AI Summary ──
  const aiSummary = apiData.aiSummary ?? null;

  // ── Data Quality ──
  const dataQuality = apiData.dataQuality ?? null;

  return {
    overview,
    timeline,
    progressTrend,
    performanceTrend,
    engagement,
    skills,
    knowledgeGaps,
    bottlenecks,
    recovery,
    learningState,
    effectiveness,
    recommendations,
    aiSummary,
    dataQuality,
  };
}

// ==================== Service ====================

export const analyticsService = {
  /**
   * Fetch the complete Learner Analytics Dashboard data.
   * Calls GET /api/learning/analytics/dashboard and maps
   * the backend response to frontend types.
   */
  async getLearnerDashboard(): Promise<LearnerAnalyticsDashboardData> {
    const response = await learningApi.get('/api/learning/analytics/dashboard');
    return mapBackendToFrontend(response.data.data);
  },

  async getStudyPatterns(): Promise<StudyPatterns> {
    const response = await learningApi.get('/api/learning/analytics/study-patterns');
    return response.data.data;
  },

  async getStudyReminders(): Promise<StudyReminder[]> {
    const response = await learningApi.get('/api/learning/analytics/reminders');
    return response.data.data;
  },

  async getStudyHeatmap(year?: number): Promise<HeatmapDay[]> {
    const url = year
      ? `/api/learning/analytics/heatmap?year=${year}`
      : '/api/learning/analytics/heatmap';
    const response = await learningApi.get(url);
    return response.data.data;
  },

  async getWeeklyReport(): Promise<WeeklyReport> {
    const response = await learningApi.get('/api/learning/analytics/weekly-report');
    return response.data.data;
  },

  async getOptimalSchedule(): Promise<OptimalSchedule> {
    const response = await learningApi.get('/api/learning/analytics/optimal-schedule');
    return response.data.data;
  },

  async getContentRecommendations(): Promise<ContentRecommendation[]> {
    const response = await learningApi.get('/api/learning/analytics/content-recommendations');
    return response.data.data;
  },

  async getMySchedule(): Promise<OptimalSchedule | null> {
    const response = await learningApi.get('/api/learning/analytics/my-schedule');
    return response.data.data;
  },

  async saveMySchedule(schedule: OptimalSchedule): Promise<void> {
    await learningApi.post('/api/learning/analytics/my-schedule', schedule);
  },
};
