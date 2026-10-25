/**
 * Admin leaderboard: reading the Learning Service answers and deciding what the page may offer (FIX DEMO RANKING 02A).
 *
 * Contract (learning-service, admin-leaderboard.controller.ts / leaderboard.controller.ts):
 *   GET  /api/learning/leaderboard/admin/overview   200 { data: { currentPeriod, finalizedPeriods, stats } }   500 { error }
 *        - takes no month/year: currentPeriod is ALWAYS the running month (Asia/Ho_Chi_Minh), live, top 10 entries only
 *   GET  /api/learning/leaderboard/history?month&year
 *        200 { data: { month, year, status, totalParticipants, entries, finalizedAt, finalizedBy, ... } }   400 / 503 / 500 { error }
 *        - FINALIZED: the stored snapshot; any other stored status (or no period row = ACTIVE): computed live
 *   POST /api/learning/leaderboard/admin/finalize { month, year, reason }
 *        200 { message, data: { status: FINALIZED | ALREADY_FINALIZED, totalParticipants, totalPointsAwarded, ... } }
 *        409 { error, message, code?: LEADERBOARD_BUSY | LEADERBOARD_LOCK_LOST, details? }   400 { error }   503 / 500 { error, message? }
 *
 * Only a PAST period whose stored status is known and not FINALIZED may be finalized from the page. The backend itself does not
 * refuse the running or a future month; the page does not offer that (no policy change in the backend here).
 */

export interface PeriodRef {
  month: number;
  year: number;
}

export type PeriodKind = 'CURRENT' | 'PAST' | 'FUTURE';

export function comparePeriods(a: PeriodRef, b: PeriodRef): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

export function classifyPeriod(selected: PeriodRef, current: PeriodRef): PeriodKind {
  const order = comparePeriods(selected, current);
  return order === 0 ? 'CURRENT' : order < 0 ? 'PAST' : 'FUTURE';
}

/** Stored statuses written by LeaderboardService.finalizeMonth; ACTIVE is what the API reports for a period without a row. */
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Chưa chốt',
  SNAPSHOT_BUILDING: 'Đang dựng snapshot (chưa xác nhận)',
  SNAPSHOT_FROZEN: 'Snapshot đã đóng băng, chưa phát thưởng',
  REWARDING: 'Đang phát thưởng (chưa hoàn tất)',
  FINALIZED: 'Đã chốt',
};

export function describeStoredStatus(status: string): string {
  return STATUS_LABELS[status] ?? `Trạng thái khác: ${status}`;
}

export interface FinalizeAvailability {
  allowed: boolean;
  reason: string;
}

/**
 * @param storedStatus the period status reported by the history API for this period; null when it is not known (not loaded, or
 *                     the request failed) - then nothing is offered, the page never guesses.
 */
export function finalizeAvailability(kind: PeriodKind, storedStatus: string | null): FinalizeAvailability {
  if (kind === 'CURRENT') {
    return { allowed: false, reason: 'Kỳ hiện tại đang diễn ra; chỉ chốt kỳ đã kết thúc (hệ thống tự chốt lúc 00:05 ngày 1 tháng sau).' };
  }
  if (kind === 'FUTURE') {
    return { allowed: false, reason: 'Kỳ này chưa bắt đầu.' };
  }
  if (storedStatus === null) {
    return { allowed: false, reason: 'Chưa xác định được trạng thái kỳ nên chưa thể chốt.' };
  }
  if (storedStatus === 'FINALIZED') {
    return { allowed: false, reason: 'Kỳ đã được chốt; dữ liệu lịch sử được giữ nguyên.' };
  }
  if (storedStatus === 'SNAPSHOT_FROZEN' || storedStatus === 'REWARDING') {
    return { allowed: true, reason: 'Kỳ chưa hoàn tất: chốt sẽ tiếp tục từ snapshot đã đóng băng, không tính lại thứ hạng.' };
  }
  return { allowed: true, reason: 'Kỳ đã kết thúc nhưng chưa được chốt.' };
}

// ─── Reading answers ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The answer does not have the shape the page relies on (contract drift): shown as an error, never rendered as zeros. */
export class LeaderboardContractError extends Error {
  constructor(what: string) {
    super(`Phản hồi từ Learning Service không đúng định dạng mong đợi (${what}).`);
    this.name = 'LeaderboardContractError';
  }
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
/** A number the API sent, or null when it did not - the page shows "—" for null instead of a made-up 0. */
export const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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

/** One ranked learner, as the overview (topEntries) and the history API return it (entry + fullName/avatar from the User Service). */
export interface LeaderboardEntryAdmin {
  userId: string;
  rank: number;
  points: number;
  completedCourses: number;
  averageScore: number | null;
  lastCompletedAt: string | null;
  rewardPoints: number | null;
  rewardBadgeId: string | null;
  isTie: boolean;
  scoreBreakdown: CourseScoreItem[];
  fullName: string | null;
  avatar: string | null;
}

export interface OverviewCurrentPeriod {
  month: number;
  year: number;
  status: string;
  participantsCount: number;
  /** the first 10 entries only (participantsCount is the full count) */
  topEntries: LeaderboardEntryAdmin[];
}

export interface FinalizedPeriodSummary {
  id: string;
  month: number;
  year: number;
  status: string;
  finalizedAt: string | null;
  finalizedBy: string | null;
  participantsCount: number | null;
  totalPointsAwarded: number | null;
}

export interface OverviewStats {
  totalValidCompletions: number | null;
  totalRewardPointsBalance: number | null;
  totalRewardPointsAwarded: number | null;
}

export interface LeaderboardOverview {
  currentPeriod: OverviewCurrentPeriod;
  finalizedPeriods: FinalizedPeriodSummary[];
  stats: OverviewStats;
}

export interface PeriodLeaderboard {
  month: number;
  year: number;
  status: string;
  totalParticipants: number | null;
  entries: LeaderboardEntryAdmin[];
  finalizedAt: string | null;
  finalizedBy: string | null;
}

function parseEntry(raw: unknown, where: string): LeaderboardEntryAdmin {
  if (!isObject(raw) || typeof raw.userId !== 'string' || !isInt(raw.rank) || typeof raw.points !== 'number') {
    throw new LeaderboardContractError(`${where}: thiếu userId/rank/points`);
  }
  return {
    userId: raw.userId,
    rank: raw.rank,
    points: raw.points,
    completedCourses: isInt(raw.completedCourses) ? raw.completedCourses : 0,
    averageScore: numberOrNull(raw.averageScore),
    lastCompletedAt: typeof raw.lastCompletedAt === 'string' ? raw.lastCompletedAt : null,
    rewardPoints: numberOrNull(raw.rewardPoints),
    rewardBadgeId: typeof raw.rewardBadgeId === 'string' ? raw.rewardBadgeId : null,
    isTie: raw.isTie === true,
    scoreBreakdown: Array.isArray(raw.scoreBreakdown) ? raw.scoreBreakdown : [],
    fullName: typeof raw.fullName === 'string' ? raw.fullName : null,
    avatar: typeof raw.avatar === 'string' ? raw.avatar : null,
  };
}

function parseEntries(raw: unknown, where: string): LeaderboardEntryAdmin[] {
  if (!Array.isArray(raw)) throw new LeaderboardContractError(`${where} không phải danh sách`);
  return raw.map((e, i) => parseEntry(e, `${where}[${i}]`));
}

/** `data` of GET /admin/overview. */
export function parseOverview(raw: unknown): LeaderboardOverview {
  if (!isObject(raw)) throw new LeaderboardContractError('thiếu data');
  const cur = raw.currentPeriod;
  if (!isObject(cur) || !isInt(cur.month) || !isInt(cur.year)) throw new LeaderboardContractError('thiếu currentPeriod');
  if (!isInt(cur.participantsCount)) throw new LeaderboardContractError('thiếu currentPeriod.participantsCount');
  if (!Array.isArray(raw.finalizedPeriods)) throw new LeaderboardContractError('thiếu finalizedPeriods');
  const stats = isObject(raw.stats) ? raw.stats : {};

  return {
    currentPeriod: {
      month: cur.month,
      year: cur.year,
      status: typeof cur.status === 'string' ? cur.status : 'ACTIVE',
      participantsCount: cur.participantsCount,
      topEntries: parseEntries(cur.topEntries, 'currentPeriod.topEntries'),
    },
    finalizedPeriods: raw.finalizedPeriods.map((p: unknown, i: number) => {
      if (!isObject(p) || !isInt(p.month) || !isInt(p.year)) throw new LeaderboardContractError(`finalizedPeriods[${i}]`);
      return {
        id: String(p.id ?? `${p.month}-${p.year}`),
        month: p.month,
        year: p.year,
        status: typeof p.status === 'string' ? p.status : 'FINALIZED',
        finalizedAt: typeof p.finalizedAt === 'string' ? p.finalizedAt : null,
        finalizedBy: typeof p.finalizedBy === 'string' ? p.finalizedBy : null,
        participantsCount: numberOrNull(p.participantsCount),
        totalPointsAwarded: numberOrNull(p.totalPointsAwarded),
      };
    }),
    stats: {
      totalValidCompletions: numberOrNull(stats.totalValidCompletions),
      totalRewardPointsBalance: numberOrNull(stats.totalRewardPointsBalance),
      totalRewardPointsAwarded: numberOrNull(stats.totalRewardPointsAwarded),
    },
  };
}

/** `data` of GET /leaderboard/history. */
export function parsePeriodLeaderboard(raw: unknown): PeriodLeaderboard {
  if (!isObject(raw) || !isInt(raw.month) || !isInt(raw.year) || typeof raw.status !== 'string') {
    throw new LeaderboardContractError('thiếu month/year/status của kỳ');
  }
  return {
    month: raw.month,
    year: raw.year,
    status: raw.status,
    totalParticipants: numberOrNull(raw.totalParticipants),
    entries: parseEntries(raw.entries, 'entries'),
    finalizedAt: typeof raw.finalizedAt === 'string' ? raw.finalizedAt : null,
    finalizedBy: typeof raw.finalizedBy === 'string' ? raw.finalizedBy : null,
  };
}

// ─── Finalize outcome ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface FinalizeResult {
  status: 'FINALIZED' | 'ALREADY_FINALIZED' | 'BUSY';
  totalParticipants: number;
  totalPointsAwarded: number;
  notificationsPending?: number;
  rewardsSkippedIneligible?: number;
}

export interface FinalizeResponse {
  message: string;
  data: FinalizeResult;
}

export interface Notice {
  tone: 'success' | 'info' | 'error';
  message: string;
}

/** 200 answer of POST /admin/finalize. */
export function describeFinalizeOutcome(res: FinalizeResponse): Notice {
  const d = res?.data;
  if (d?.status === 'FINALIZED') {
    const extra: string[] = [`${d.totalParticipants} học viên`, `${d.totalPointsAwarded} điểm thưởng đã xác nhận`];
    if (d.rewardsSkippedIneligible) extra.push(`${d.rewardsSkippedIneligible} phần thưởng không phát do không đủ tư cách`);
    if (d.notificationsPending) extra.push(`${d.notificationsPending} thông báo chờ gửi lại`);
    return { tone: 'success', message: `${res.message || 'Chốt kỳ thành công.'} (${extra.join(', ')})` };
  }
  if (d?.status === 'ALREADY_FINALIZED') {
    return { tone: 'info', message: res.message || 'Kỳ đã được chốt trước đó; dữ liệu lịch sử được giữ nguyên.' };
  }
  return { tone: 'error', message: res?.message || 'Phản hồi chốt kỳ không xác định; hãy tải lại để kiểm tra trạng thái.' };
}

/** The message an API error carries (`message` first, then `error`), or the fallback. Never the request config. */
export function readApiError(err: any, fallback: string): string {
  if (err instanceof LeaderboardContractError) return err.message;
  const data = err?.response?.data;
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  if (err?.response === undefined && (err?.request !== undefined || err?.code === 'ERR_NETWORK')) {
    return 'Không kết nối được tới Learning Service. Kiểm tra dịch vụ rồi thử lại.';
  }
  return fallback;
}

/** Error answer of POST /admin/finalize. Nothing is retried automatically; every case can be repeated by the admin. */
export function describeFinalizeError(err: any): Notice {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const base = readApiError(err, 'Không thể chốt bảng xếp hạng.');
  if (status === 409 && isObject(data?.details) && typeof data.details.verifiedPoints === 'number') {
    return {
      tone: 'error',
      message: `Phát thưởng chưa hoàn tất (${data.details.verifiedPoints}/${data.details.expectedPoints} điểm đã xác nhận). Kỳ được giữ ở trạng thái đang phát thưởng; có thể chốt lại an toàn.`,
    };
  }
  return { tone: 'error', message: base };
}
