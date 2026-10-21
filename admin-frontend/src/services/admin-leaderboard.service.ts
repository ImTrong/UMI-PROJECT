import { learningApi } from './api';

export interface LeaderboardEntryAdmin {
  id: string;
  userId: string;
  rank: number;
  points: number;
  coursesCompleted: number;
  averageQuizScore: number | null;
  totalDurationSeconds: number;
  rewardPoints: number;
  badgeAwarded?: string;
  isTie?: boolean;
  scoreBreakdown?: {
    courseCount: number;
    quizCount: number;
    avgQuizScore: number | null;
    totalBasePoints: number;
    totalEarnedPoints: number;
  };
  user?: {
    id: string;
    fullName: string;
    email: string;
    avatar?: string;
  };
}

export interface MonthlyLeaderboardAdmin {
  id: string;
  month: number;
  year: number;
  status: 'ACTIVE' | 'FINALIZING' | 'FINALIZED';
  finalizedAt?: string;
  finalizedBy?: string;
  policyVersion: string;
  entries: LeaderboardEntryAdmin[];
}

export interface OverviewResponse {
  month: number;
  year: number;
  isCurrentMonth: boolean;
  activeLeaderboard: {
    month: number;
    year: number;
    status: string;
    totalParticipants: number;
    entries: LeaderboardEntryAdmin[];
  } | null;
  finalizedLeaderboard: MonthlyLeaderboardAdmin | null;
  totals: {
    totalCompletionRecords: number;
    totalRewardPointsAwarded: number;
    totalRedemptions: number;
  };
  policy: {
    version: string;
    durationTiers: Array<{ label: string; maxMinutes: number; points: number }>;
    levelMultipliers: Record<string, number>;
    rewardTiers: Array<{ rank: string; points: number; badgeName: string }>;
  };
}

export interface CompletionRecordAdmin {
  id: string;
  userId: string;
  courseId: string;
  completedAt: string;
  passed: boolean;
  timeSpentSeconds: number;
  courseDurationSeconds: number;
  courseLevel: string;
  basePoints: number;
  levelMultiplier: number;
  earnedPoints: number;
  policyVersion: string;
  isFlagged: boolean;
  flagReason?: string;
}

export interface StudentDetailAdmin {
  userId: string;
  user?: {
    id: string;
    fullName: string;
    email: string;
    avatar?: string;
  };
  month: number;
  year: number;
  totalMonthlyPoints: number;
  completedCoursesCount: number;
  averageQuizScore: number | null;
  rewardWallet: {
    totalEarned: number;
    totalSpent: number;
    currentBalance: number;
  } | null;
  records: CompletionRecordAdmin[];
}

export interface AuditLogAdmin {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  details?: any;
  createdAt: string;
}

export interface RewardTransactionAdmin {
  id: string;
  userId: string;
  points: number;
  type: string;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
}

export const adminLeaderboardService = {
  async getOverview(month?: number, year?: number): Promise<OverviewResponse> {
    const params: any = {};
    if (month) params.month = month;
    if (year) params.year = year;
    const res = await learningApi.get('/api/learning/leaderboard/admin/overview', { params });
    return res.data.data;
  },

  async finalizeMonth(data: { month: number; year: number; reason?: string }): Promise<any> {
    const res = await learningApi.post('/api/learning/leaderboard/admin/finalize', data);
    return res.data.data;
  },

  async syncCompletions(): Promise<{ syncedCount: number; skippedCount: number }> {
    const res = await learningApi.post('/api/learning/leaderboard/admin/sync-completions');
    return res.data.data;
  },

  async getStudentDetail(userId: string, month?: number, year?: number): Promise<StudentDetailAdmin> {
    const params: any = {};
    if (month) params.month = month;
    if (year) params.year = year;
    const res = await learningApi.get(`/api/learning/leaderboard/admin/student-detail/${userId}`, { params });
    return res.data.data;
  },

  async flagRecord(data: { recordId: string; isFlagged: boolean; reason: string }): Promise<any> {
    const res = await learningApi.post('/api/learning/leaderboard/admin/flag-record', data);
    return res.data.data;
  },

  async adjustPoints(data: { userId: string; points: number; reason: string }): Promise<any> {
    const res = await learningApi.post('/api/learning/leaderboard/admin/adjust-points', data);
    return res.data.data;
  },

  async getAuditLogs(page = 1, limit = 20): Promise<{ logs: AuditLogAdmin[]; pagination: any }> {
    const res = await learningApi.get('/api/learning/leaderboard/admin/audit-logs', { params: { page, limit } });
    return res.data.data;
  },

  async getRewardTransactions(page = 1, limit = 20): Promise<{ transactions: RewardTransactionAdmin[]; pagination: any }> {
    const res = await learningApi.get('/api/learning/leaderboard/admin/reward-transactions', { params: { page, limit } });
    return res.data.data;
  },
};
