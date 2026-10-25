/**
 * Learner leaderboard page: the scoring policy as the Learning Service applies it, and readers for the wallet / history answers
 * (FIX DEMO RANKING 02C.2).
 *
 * Policy source: services/learning-service/src/config/scoring-policy.ts (SCORING_POLICY_VERSION '1.1') and
 * services/learning-service/src/services/leaderboard.service.ts (ranking, ties, rewards). The API does not return the policy,
 * only its version (`policyVersion` on a leaderboard), so the page compares that version with the one described here.
 *
 *   GET /api/learning/reward-points/me            200 { data: { balance, totalEarned, totalSpent, courseRedemptionPoints, ... } }
 *   GET /api/learning/reward-points/transactions?page&limit
 *        200 { data: { balance, totalEarned, totalSpent, transactions: RewardPointTransaction[], pagination } }   500 { error }
 */

export const DESCRIBED_POLICY_VERSION = '1.1';

/** basePoints = min(40, durationSeconds / 1800), rounded to 2 decimals: 1 point per 30 minutes, at most 40 (20 hours). */
export const BASE_POINTS_PER_SECONDS = 1800;
export const BASE_POINTS_CAP = 40;

/** Level multipliers; a course that is not approved or has no known level counts 1.0. */
export const LEVEL_MULTIPLIERS: Array<{ level: string; label: string; multiplier: number }> = [
  { level: 'BEGINNER', label: 'Cơ bản', multiplier: 1.0 },
  { level: 'INTERMEDIATE', label: 'Trung cấp', multiplier: 1.1 },
  { level: 'ADVANCED', label: 'Nâng cao', multiplier: 1.2 },
];

export const REWARD_TIERS: Array<{ ranks: string; points: number; badge: string; icon: string }> = [
  { ranks: 'Hạng 1', points: 1000, badge: 'Nhà vô địch tháng', icon: '🥇' },
  { ranks: 'Hạng 2', points: 700, badge: 'Á quân tháng', icon: '🥈' },
  { ranks: 'Hạng 3', points: 500, badge: 'Top 3 tháng', icon: '🥉' },
  { ranks: 'Hạng 4 - 10', points: 200, badge: 'Top 10 tháng', icon: '🎖️' },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Same arithmetic as calculateCourseAchievementPoints in the backend (used for the worked examples in the policy dialog). */
export function courseAchievementPoints(durationSeconds: number, level: string | null, approved = true) {
  const seconds = Number.isFinite(durationSeconds) ? Math.max(0, Math.floor(durationSeconds)) : 0;
  const basePoints = seconds > 0 ? round2(Math.min(BASE_POINTS_CAP, seconds / BASE_POINTS_PER_SECONDS)) : 0;
  const normalized = (level || '').toUpperCase().trim();
  const multiplier = approved ? LEVEL_MULTIPLIERS.find((l) => l.level === normalized)?.multiplier ?? 1.0 : 1.0;
  return { basePoints, multiplier, achievementPoints: round2(basePoints * multiplier) };
}

// ─── Rewards shown in the table ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A FINALIZED period comes from the stored snapshot: its reward column is what was awarded (an ineligible learner's reward is 0).
 * Any other period is computed live: the column is what the current rank WOULD earn - nothing has been credited yet.
 */
export type RewardColumnMode = 'AWARDED' | 'PROJECTED';
export const rewardColumnMode = (status: string | null | undefined): RewardColumnMode => (status === 'FINALIZED' ? 'AWARDED' : 'PROJECTED');

// ─── Errors ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export class LeaderboardContractError extends Error {
  constructor(what: string) {
    super(`Phản hồi từ máy chủ không đúng định dạng (${what}).`);
    this.name = 'LeaderboardContractError';
  }
}

/** The message an API error carries, or a fallback; a request that got no answer says so. */
export function readApiError(err: any, fallback: string): string {
  if (err instanceof LeaderboardContractError) return err.message;
  const data = err?.response?.data;
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  if (err?.response === undefined && (err?.request !== undefined || err?.code === 'ERR_NETWORK')) {
    return 'Không kết nối được tới máy chủ. Vui lòng thử lại.';
  }
  return fallback;
}

// ─── Reward point history ───────────────────────────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface RewardHistoryItem {
  id: string;
  amount: number;
  type: string;
  description: string;
  balanceAfter: number | null;
  createdAt: string;
}

export interface RewardHistoryPage {
  balance: number | null;
  totalEarned: number | null;
  totalSpent: number | null;
  transactions: RewardHistoryItem[];
  page: number | null;
  totalPages: number | null;
  total: number | null;
}

export function parseRewardHistory(raw: unknown): RewardHistoryPage {
  if (!isObject(raw) || !Array.isArray(raw.transactions)) throw new LeaderboardContractError('thiếu danh sách giao dịch');
  const p = isObject(raw.pagination) ? raw.pagination : {};
  return {
    balance: numberOrNull(raw.balance),
    totalEarned: numberOrNull(raw.totalEarned),
    totalSpent: numberOrNull(raw.totalSpent),
    transactions: raw.transactions.map((t: unknown, i: number) => {
      if (!isObject(t) || typeof t.id !== 'string' || typeof t.amount !== 'number' || typeof t.type !== 'string') {
        throw new LeaderboardContractError(`giao dịch thứ ${i + 1} thiếu id/amount/type`);
      }
      return {
        id: t.id,
        amount: t.amount,
        type: t.type,
        description: typeof t.description === 'string' ? t.description : '',
        balanceAfter: numberOrNull(t.balanceAfter),
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
      };
    }),
    page: numberOrNull(p.page),
    totalPages: numberOrNull(p.totalPages),
    total: numberOrNull(p.total),
  };
}

const TRANSACTION_LABELS: Record<string, string> = {
  LEADERBOARD_REWARD: 'Thưởng xếp hạng',
  COURSE_REDEMPTION: 'Đổi khóa học',
  COURSE_REDEMPTION_REFUND: 'Hoàn điểm đổi khóa',
  ADMIN_ADJUSTMENT: 'Điều chỉnh bởi quản trị viên',
};
export const describeTransactionType = (type: string) => TRANSACTION_LABELS[type] ?? type;

/** Positive amounts are points received, negative ones points used (the ledger stores the sign). */
export const transactionDirection = (amount: number): 'RECEIVED' | 'USED' => (amount >= 0 ? 'RECEIVED' : 'USED');
