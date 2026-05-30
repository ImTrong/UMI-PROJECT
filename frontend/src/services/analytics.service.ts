import { learningApi } from './api';

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

// ==================== Service ====================

export const analyticsService = {
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
