import { learningApi } from './api';
import {
  FinalizeResponse,
  LeaderboardOverview,
  PeriodLeaderboard,
  parseOverview,
  parsePeriodLeaderboard,
} from '../utils/leaderboard-period';
import {
  AdjustRequest,
  AdjustResult,
  AuditLogAdmin,
  FlagRequest,
  FlagResult,
  Pagination,
  RewardTransactionAdmin,
  StudentDetailAdmin,
  SyncResult,
  parseAdjustResult,
  parseAuditLogsPage,
  parseFlagResult,
  parseStudentDetail,
  parseSyncResult,
  parseTransactionsPage,
} from '../utils/leaderboard-admin';

// Overview / period / finalize contract: see utils/leaderboard-period.ts (FIX DEMO RANKING 02A)
export type {
  FinalizeResponse,
  FinalizeResult,
  FinalizedPeriodSummary,
  LeaderboardEntryAdmin,
  LeaderboardOverview,
  OverviewStats,
  PeriodLeaderboard,
} from '../utils/leaderboard-period';
// Admin actions contract: see utils/leaderboard-admin.ts (FIX DEMO RANKING 02B)
export type {
  AdjustRequest,
  AdjustResult,
  AuditLogAdmin,
  CompletionRecordAdmin,
  FlagRequest,
  FlagResult,
  Pagination,
  RewardTransactionAdmin,
  StudentDetailAdmin,
  SyncResult,
} from '../utils/leaderboard-admin';

export const adminLeaderboardService = {
  // The overview takes no month/year: it always describes the running period (Asia/Ho_Chi_Minh) plus the finalized ones.
  async getOverview(): Promise<LeaderboardOverview> {
    const res = await learningApi.get('/api/learning/leaderboard/admin/overview');
    return parseOverview(res.data?.data);
  },

  // Stored status + ranking of one period: the frozen snapshot when FINALIZED, otherwise computed live by the backend.
  async getPeriodLeaderboard(month: number, year: number): Promise<PeriodLeaderboard> {
    const res = await learningApi.get('/api/learning/leaderboard/history', { params: { month, year } });
    return parsePeriodLeaderboard(res.data?.data);
  },

  // The backend builds the snapshot and pays the rewards; the page only asks and reports the answer.
  async finalizeMonth(data: { month: number; year: number; reason?: string }): Promise<FinalizeResponse> {
    const res = await learningApi.post('/api/learning/leaderboard/admin/finalize', data);
    return { message: res.data?.message, data: res.data?.data };
  },

  async syncCompletions(): Promise<SyncResult> {
    const res = await learningApi.post('/api/learning/leaderboard/admin/sync-completions');
    return parseSyncResult(res.data?.data);
  },

  async getStudentDetail(userId: string, month?: number, year?: number): Promise<StudentDetailAdmin> {
    const params: Record<string, number> = {};
    if (month) params.month = month;
    if (year) params.year = year;
    const res = await learningApi.get(`/api/learning/leaderboard/admin/student-detail/${encodeURIComponent(userId)}`, { params });
    return parseStudentDetail(res.data?.data);
  },

  async flagRecord(data: FlagRequest): Promise<FlagResult> {
    const res = await learningApi.post('/api/learning/leaderboard/admin/flag-record', data);
    return parseFlagResult(res.data);
  },

  // Not idempotent on the backend: called once per confirmed click, never retried here.
  async adjustPoints(data: AdjustRequest): Promise<AdjustResult> {
    const res = await learningApi.post('/api/learning/leaderboard/admin/adjust-points', data);
    return parseAdjustResult(res.data);
  },

  async getAuditLogs(page = 1, limit = 20): Promise<{ logs: AuditLogAdmin[]; pagination: Pagination }> {
    const res = await learningApi.get('/api/learning/leaderboard/admin/audit-logs', { params: { page, limit } });
    return parseAuditLogsPage(res.data?.data);
  },

  async getRewardTransactions(page = 1, limit = 20): Promise<{ transactions: RewardTransactionAdmin[]; pagination: Pagination }> {
    const res = await learningApi.get('/api/learning/leaderboard/admin/reward-transactions', { params: { page, limit } });
    return parseTransactionsPage(res.data?.data);
  },
};
