/**
 * Admin leaderboard actions: requests and answers of the Learning Service, as the controllers define them (FIX DEMO RANKING 02B).
 * Source: services/learning-service/src/controllers/admin-leaderboard.controller.ts and the services it calls.
 *
 *   POST /api/learning/leaderboard/admin/sync-completions             (no body)
 *        200 { message, data: AchievementService.syncExistingCompletions() }       500 { error }
 *   GET  /api/learning/leaderboard/admin/student-detail/:userId?month&year
 *        200 { data: { periodBreakdown, rewardPoints, allCompletions } }           500 { error }
 *        - periodBreakdown: VALID records of that period only; allCompletions: every record of the learner, any status, any month
 *        - rewardPoints is the wallet; the backend CREATES an empty wallet when the learner has none (a write behind this GET)
 *   POST /api/learning/leaderboard/admin/flag-record   { recordId, status: SUSPECT | EXCLUDED | VALID, reason }
 *        200 { message, data: updated record }   400 { error } (bad id/status, missing reason)   500 { error } (e.g. unknown record)
 *   POST /api/learning/leaderboard/admin/adjust-points { targetUserId, amount, reason }
 *        200 { message, data: { tx, newBalance } }   400 { error } for EVERY failure (validation, negative balance, database)
 *        - NOT idempotent: each accepted request writes a new ledger entry (key built from Date.now()); never resend automatically
 *   GET  /api/learning/leaderboard/admin/audit-logs?page&limit             200 { data: { logs, pagination } }          500 { error }
 *   GET  /api/learning/leaderboard/admin/reward-transactions?page&limit&type
 *        200 { data: { transactions (+ fullName, avatar), pagination } }   500 { error }
 */
import { LeaderboardContractError, Notice, numberOrNull, readApiError } from './leaderboard-period';

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// ─── Requests (validated before anything is sent) ───────────────────────────────────────────────────────────────────────

export class AdminInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminInputError';
  }
}

export const RECORD_STATUSES = ['VALID', 'SUSPECT', 'EXCLUDED'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export interface FlagRequest {
  recordId: string;
  status: RecordStatus;
  reason: string;
}

export function buildFlagRequest(recordId: string, status: string, reason: string): FlagRequest {
  if (!OBJECT_ID.test(recordId)) throw new AdminInputError('Mã bản ghi không hợp lệ.');
  if (!(RECORD_STATUSES as readonly string[]).includes(status)) throw new AdminInputError('Trạng thái phải là VALID, SUSPECT hoặc EXCLUDED.');
  const why = reason.trim();
  if (!why) throw new AdminInputError('Vui lòng nhập lý do để ghi nhật ký kiểm toán.');
  return { recordId, status: status as RecordStatus, reason: why };
}

export interface AdjustRequest {
  targetUserId: string;
  amount: number;
  reason: string;
}

/** The backend reads `amount` with parseInt, so anything but a whole number would be changed silently: refused here instead. */
export function buildAdjustRequest(targetUserId: string, amountInput: string, reason: string): AdjustRequest {
  if (!OBJECT_ID.test(targetUserId)) throw new AdminInputError('Mã học viên không hợp lệ.');
  const raw = amountInput.trim();
  if (!/^[+-]?\d+$/.test(raw)) throw new AdminInputError('Số điểm phải là số nguyên (dương để cộng, âm để trừ).');
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount === 0) throw new AdminInputError('Số điểm điều chỉnh phải là số nguyên khác 0.');
  const why = reason.trim();
  if (!why) throw new AdminInputError('Vui lòng nhập lý do điều chỉnh để ghi nhật ký kiểm toán.');
  return { targetUserId, amount, reason: why };
}

// ─── Answers ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SyncResult {
  created: number;
  skipped: number;
  needsReview: number | null;
  insufficientData: number | null;
  totalExamined: number | null;
}

export function parseSyncResult(raw: unknown): SyncResult {
  if (!isObject(raw) || typeof raw.created !== 'number' || typeof raw.skipped !== 'number') {
    throw new LeaderboardContractError('kết quả đồng bộ thiếu created/skipped');
  }
  return {
    created: raw.created,
    skipped: raw.skipped,
    needsReview: numberOrNull(raw.needsReview),
    insufficientData: numberOrNull(raw.insufficientData),
    totalExamined: numberOrNull(raw.totalExamined),
  };
}

export function describeSyncResult(r: SyncResult): string {
  const parts = [`${r.created} bản ghi thành tích mới`, `bỏ qua ${r.skipped} bản ghi đã có`];
  if (r.needsReview) parts.push(`${r.needsReview} tiến trình cần rà soát`);
  if (r.insufficientData) parts.push(`${r.insufficientData} tiến trình thiếu dữ liệu`);
  return `Đồng bộ hoàn tất: ${parts.join(', ')}${r.totalExamined !== null ? ` (đã xét ${r.totalExamined} tiến trình)` : ''}.`;
}

export interface Pagination {
  page: number | null;
  limit: number | null;
  total: number | null;
  totalPages: number | null;
}

const parsePagination = (raw: unknown): Pagination => {
  const p = isObject(raw) ? raw : {};
  return { page: numberOrNull(p.page), limit: numberOrNull(p.limit), total: numberOrNull(p.total), totalPages: numberOrNull(p.totalPages) };
};

/** One ledger entry (RewardPointTransaction) plus the name the User Service gave (null when it could not). */
export interface RewardTransactionAdmin {
  id: string;
  userId: string;
  amount: number;
  type: string;
  description: string;
  balanceAfter: number | null;
  sourceId: string | null;
  createdAt: string;
  fullName: string | null;
}

export function parseTransactionsPage(raw: unknown): { transactions: RewardTransactionAdmin[]; pagination: Pagination } {
  if (!isObject(raw) || !Array.isArray(raw.transactions)) throw new LeaderboardContractError('thiếu danh sách transactions');
  return {
    transactions: raw.transactions.map((t: unknown, i: number) => {
      if (!isObject(t) || typeof t.id !== 'string' || typeof t.userId !== 'string' || typeof t.amount !== 'number' || typeof t.type !== 'string') {
        throw new LeaderboardContractError(`transactions[${i}] thiếu id/userId/amount/type`);
      }
      return {
        id: t.id,
        userId: t.userId,
        amount: t.amount,
        type: t.type,
        description: str(t.description) ?? '',
        balanceAfter: numberOrNull(t.balanceAfter),
        sourceId: str(t.sourceId),
        createdAt: str(t.createdAt) ?? '',
        // enrichEntriesWithUserInfo writes this placeholder when the User Service does not know the id or cannot be reached
        fullName: str(t.fullName) && t.fullName !== 'Học viên ẩn' ? t.fullName : null,
      };
    }),
    pagination: parsePagination(raw.pagination),
  };
}

const TRANSACTION_LABELS: Record<string, string> = {
  LEADERBOARD_REWARD: 'Thưởng xếp hạng',
  COURSE_REDEMPTION: 'Đổi khóa học',
  COURSE_REDEMPTION_REFUND: 'Hoàn điểm đổi khóa',
  ADMIN_ADJUSTMENT: 'Quản trị viên điều chỉnh',
};
export const describeTransactionType = (type: string) => TRANSACTION_LABELS[type] ?? type;

/** One LeaderboardAuditLog row. targetUserId / month / year are set only by the actions that have them. */
export interface AuditLogAdmin {
  id: string;
  adminId: string;
  adminEmail: string | null;
  action: string;
  targetUserId: string | null;
  month: number | null;
  year: number | null;
  reason: string;
  createdAt: string;
}

export function parseAuditLogsPage(raw: unknown): { logs: AuditLogAdmin[]; pagination: Pagination } {
  if (!isObject(raw) || !Array.isArray(raw.logs)) throw new LeaderboardContractError('thiếu danh sách logs');
  return {
    logs: raw.logs.map((l: unknown, i: number) => {
      if (!isObject(l) || typeof l.id !== 'string' || typeof l.action !== 'string') throw new LeaderboardContractError(`logs[${i}] thiếu id/action`);
      return {
        id: l.id,
        adminId: str(l.adminId) ?? '',
        adminEmail: str(l.adminEmail),
        action: l.action,
        targetUserId: str(l.targetUserId),
        month: numberOrNull(l.month),
        year: numberOrNull(l.year),
        reason: str(l.reason) ?? '',
        createdAt: str(l.createdAt) ?? '',
      };
    }),
    pagination: parsePagination(raw.pagination),
  };
}

const AUDIT_LABELS: Record<string, string> = {
  MANUAL_FINALIZE: 'Chốt kỳ thủ công',
  RETRY_NOTIFICATIONS: 'Gửi lại thông báo thưởng',
  SYNC_COMPLETIONS: 'Đồng bộ thành tích',
  FLAG_STUDENT: 'Gắn cờ bản ghi',
  RESTORE_STUDENT: 'Khôi phục bản ghi',
  ADJUST_POINTS: 'Điều chỉnh điểm thưởng',
  REWARD_SKIPPED_INELIGIBLE: 'Không phát thưởng (không đủ tư cách)',
  FINALIZE_REWARDS_INCOMPLETE: 'Phát thưởng chưa hoàn tất',
  REWARD_INTEGRITY_ERROR: 'Lỗi toàn vẹn sổ thưởng',
  REWARD_LEDGER_MISMATCH: 'Ví lệch sổ thưởng',
};
export const describeAuditAction = (action: string) => AUDIT_LABELS[action] ?? action;

/** A CourseCompletionRecord as student-detail returns it in allCompletions. */
export interface CompletionRecordAdmin {
  id: string;
  courseId: string;
  courseTitle: string;
  completedAt: string;
  totalDurationSeconds: number | null;
  level: string;
  baseDurationPoints: number | null;
  levelMultiplier: number | null;
  achievementPoints: number | null;
  averageQuizScore: number | null;
  status: string;
  month: number | null;
  year: number | null;
}

export interface StudentDetailAdmin {
  userId: string;
  month: number;
  year: number;
  /** VALID records of the selected period only */
  periodPoints: number | null;
  periodCourses: number | null;
  wallet: { balance: number | null; totalEarned: number | null; totalSpent: number | null } | null;
  /** every record of the learner (any status, any period), newest first */
  records: CompletionRecordAdmin[];
}

export function parseStudentDetail(raw: unknown): StudentDetailAdmin {
  if (!isObject(raw)) throw new LeaderboardContractError('thiếu data chi tiết học viên');
  const b = raw.periodBreakdown;
  if (!isObject(b) || typeof b.userId !== 'string' || !Number.isInteger(b.month) || !Number.isInteger(b.year)) {
    throw new LeaderboardContractError('thiếu periodBreakdown');
  }
  if (!Array.isArray(raw.allCompletions)) throw new LeaderboardContractError('thiếu allCompletions');
  const w = raw.rewardPoints;
  return {
    userId: b.userId,
    month: b.month,
    year: b.year,
    periodPoints: numberOrNull(b.totalAchievementPoints),
    periodCourses: numberOrNull(b.completedCoursesCount),
    wallet: isObject(w)
      ? { balance: numberOrNull(w.balance), totalEarned: numberOrNull(w.totalEarned), totalSpent: numberOrNull(w.totalSpent) }
      : null,
    records: raw.allCompletions.map((r: unknown, i: number) => {
      if (!isObject(r) || typeof r.id !== 'string' || typeof r.status !== 'string') throw new LeaderboardContractError(`allCompletions[${i}] thiếu id/status`);
      return {
        id: r.id,
        courseId: str(r.courseId) ?? '',
        courseTitle: str(r.courseTitle) ?? '',
        completedAt: str(r.completedAt) ?? '',
        totalDurationSeconds: numberOrNull(r.totalDurationSeconds),
        level: str(r.level) ?? '',
        baseDurationPoints: numberOrNull(r.baseDurationPoints),
        levelMultiplier: numberOrNull(r.levelMultiplier),
        achievementPoints: numberOrNull(r.achievementPoints),
        averageQuizScore: numberOrNull(r.averageQuizScore),
        status: r.status,
        month: numberOrNull(r.month),
        year: numberOrNull(r.year),
      };
    }),
  };
}

const RECORD_STATUS_LABELS: Record<string, string> = { VALID: 'Hợp lệ', SUSPECT: 'Nghi vấn', EXCLUDED: 'Loại trừ' };
export const describeRecordStatus = (status: string) => RECORD_STATUS_LABELS[status] ?? status;

export interface FlagResult {
  message: string;
  status: string | null;
}

export function parseFlagResult(raw: unknown): FlagResult {
  if (!isObject(raw) || typeof raw.message !== 'string') throw new LeaderboardContractError('phản hồi gắn cờ thiếu message');
  return { message: raw.message, status: isObject(raw.data) ? str(raw.data.status) : null };
}

export interface AdjustResult {
  message: string;
  newBalance: number | null;
}

export function parseAdjustResult(raw: unknown): AdjustResult {
  if (!isObject(raw) || typeof raw.message !== 'string') throw new LeaderboardContractError('phản hồi điều chỉnh điểm thiếu message');
  return { message: raw.message, newBalance: isObject(raw.data) ? numberOrNull(raw.data.newBalance) : null };
}

/** No readable answer to a writing request: the write may have happened. The page then blocks a resend from the same dialog. */
export function isOutcomeUnknown(err: any): boolean {
  if (err instanceof AdminInputError) return false;
  return err instanceof LeaderboardContractError || err?.response === undefined;
}

/**
 * Error of a writing request. When no answer arrived (network, timeout) or the answer could not be read, the write may or may not
 * have happened: that is said explicitly - in particular for adjust-points, which is not idempotent, so a blind resend could
 * apply the adjustment twice.
 */
export function describeWriteError(err: any, fallback: string): Notice {
  if (err instanceof AdminInputError) return { tone: 'error', message: err.message };
  if (err instanceof LeaderboardContractError) {
    return { tone: 'error', message: `${err.message} Kết quả thao tác chưa xác định: tải lại dữ liệu để kiểm tra trước khi thử lại.` };
  }
  if (err?.response === undefined) {
    return { tone: 'error', message: 'Không nhận được phản hồi từ Learning Service; kết quả thao tác chưa xác định. Tải lại dữ liệu để kiểm tra trước khi thử lại.' };
  }
  return { tone: 'error', message: readApiError(err, fallback) };
}
