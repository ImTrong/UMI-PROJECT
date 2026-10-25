import { learningApi } from './api';
import { RewardHistoryPage, parseRewardHistory } from '../utils/leaderboard-view';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CourseScoreItem {
  courseId: string;
  courseTitle: string;
  durationSeconds: number;
  durationHours: number;
  level: string;
  basePoints: number;
  levelMultiplier: number;
  achievementPoints: number;
  averageQuizScore: number | null;
  hasQuiz: boolean;
  completedAt: string;
}

export interface LeaderboardEntry {
  userId: string;
  rank: number;
  points: number;
  completedCourses: number;
  averageScore: number | null;
  lastCompletedAt: string;
  rewardPoints?: number;
  rewardBadgeId?: string | null;
  fullName: string;
  avatar?: string | null;
  isTie?: boolean;
  scoreBreakdown?: CourseScoreItem[];
}

export interface LeaderboardData {
  month: number;
  year: number;
  status: string;
  policyVersion?: string;
  totalParticipants?: number;
  entries: LeaderboardEntry[];
  finalizedAt?: string | null;
  finalizedBy?: string | null;
}

export interface UserRank {
  rank: number | null;
  isTie: boolean;
  points: number;
  completedCourses: number;
  averageScore: number | null;
  lastCompletedAt: string | null;
  totalParticipants: number;
  scoreBreakdown: CourseScoreItem[];
}

export interface AvailableMonth {
  month: number;
  year: number;
  status: string;
}

export interface UserRewardPoints {
  id: string;
  userId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  /** Official redemption price decided by the backend (display only, never sent back) */
  courseRedemptionPoints?: number;
}

export interface RewardTransaction {
  id: string;
  userId: string;
  amount: number;
  type: string;
  description: string;
  balanceAfter: number;
  createdAt: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const leaderboardService = {
  async getCurrentLeaderboard(): Promise<LeaderboardData> {
    const response = await learningApi.get('/api/learning/leaderboard/current');
    return response.data.data;
  },

  async getHistoryLeaderboard(month: number, year: number): Promise<LeaderboardData> {
    const response = await learningApi.get('/api/learning/leaderboard/history', {
      params: { month, year },
    });
    return response.data.data;
  },

  async getMyRank(): Promise<UserRank> {
    const response = await learningApi.get('/api/learning/leaderboard/me');
    return response.data.data;
  },

  async getMyBreakdown(month?: number, year?: number) {
    const response = await learningApi.get('/api/learning/leaderboard/me/breakdown', {
      params: { month, year },
    });
    return response.data.data;
  },

  async getAvailableMonths(): Promise<AvailableMonth[]> {
    const response = await learningApi.get('/api/learning/leaderboard/months');
    return response.data.data;
  },

  async getMyRewardPoints(): Promise<UserRewardPoints> {
    const response = await learningApi.get('/api/learning/reward-points/me');
    return response.data.data;
  },

  // The learner's own ledger, newest first (balance / totals / pagination come with it)
  async getRewardTransactions(page: number = 1, limit: number = 20): Promise<RewardHistoryPage> {
    const response = await learningApi.get('/api/learning/reward-points/transactions', {
      params: { page, limit },
    });
    return parseRewardHistory(response.data?.data);
  },

  // The price is decided by the backend; the client only sends the course and an idempotency key.
  async redeemCourse(courseId: string, clientRequestId?: string) {
    const finalRequestId =
      clientRequestId ||
      `redeem_req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const response = await learningApi.post(
      '/api/learning/reward-points/redeem',
      {
        courseId,
        clientRequestId: finalRequestId,
        requestId: finalRequestId,
      },
      {
        headers: {
          'X-Idempotency-Key': finalRequestId,
        },
      }
    );
    return response.data;
  },
};
