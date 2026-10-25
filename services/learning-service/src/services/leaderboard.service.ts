/**
 * Leaderboard Service (Production-Ready)
 *
 * Implements the Monthly Learner Leaderboard:
 * - Calculates rankings from immutable CourseCompletionRecord (server-recorded completedAt)
 * - Timezone: Asia/Ho_Chi_Minh (UTC+7)
 * - Ranking:
 *   1. points DESC (Total achievement points)
 *   2. completedCourses DESC (Number of valid completed courses)
 *   3. averageQuizScore DESC (Average quiz score of courses WITH quizzes, excluding quiz-less courses)
 *   4. lastCompletedAt ASC (Earliest final completion time)
 * - Consistent tie handling (shared ranks, equal reward distribution, isTie flag)
 * - Rewards:
 *   - Rank 1: 1,000 points + "Nhà vô địch tháng MM/YYYY" (🥇)
 *   - Rank 2: 700 points + "Á quân tháng MM/YYYY" (🥈)
 *   - Rank 3: 500 points + "Top 3 tháng MM/YYYY" (🥉)
 *   - Rank 4-10: 200 points + "Top 10 tháng MM/YYYY" (🎖️)
 * - Concurrency protection: a distributed per-period lock (atomic acquire, server-clock lease, heartbeat) plus
 *   fencing - every write of the finalization is a fenced transaction or a claim-conditioned CAS, so a process that
 *   lost the lock can no longer change anything (see leaderboard-lock.service.ts)
 * - Chronological multi-month catch-up
 * - Detailed score breakdown saved per entry for complete auditability
 */

import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  getCurrentVietnamMonthYear,
  getRewardForRank,
  SCORING_POLICY_VERSION,
} from '../config/scoring-policy';
import { AchievementService } from './achievement.service';
import { runTx, isTxConflict } from './course-redemption.service';
import { FenceGuard, LeaderboardLockService, LockContext, LockLostError } from './leaderboard-lock.service';
import { RewardPointService } from './reward-point.service';
import { UserEligibilityService } from './user-eligibility.service';
import { UserNotificationClient } from './user-notification.client';
import { buildRewardNotificationContent, FrozenRewardFacts, rewardNotificationKey } from './leaderboard-notification';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/** Lock service used by finalizeMonth (created on first use; tests inject their own via LeaderboardService.useLockService). */
let lockService: LeaderboardLockService | null = null;
const getLockService = () => (lockService ??= new LeaderboardLockService({ prisma }));

/** Conflicts on the period row are retried at most this many times; every attempt fences again. */
const FENCED_TX_MAX_ATTEMPTS = 5;
/** Upper bound for the one transaction that replaces the snapshot (MongoDB's own transaction lifetime limit is 60 s). */
const SNAPSHOT_TX_TIMEOUT_MS = 55_000;
/** How long a notification claim lasts before a crashed sender can be replaced (HTTP timeout is 5 s). */
const NOTIFY_CLAIM_TTL_MS = 60_000;

// ─── Interfaces ───────────────────────────────────────────────────────────────

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
  completedAt: Date;
}

export interface ComputedLeaderboardEntry {
  userId: string;
  rank: number;
  points: number;
  completedCourses: number;
  averageScore: number | null;
  lastCompletedAt: Date;
  rewardPoints: number;
  rewardBadgeId?: string | null;
  scoreBreakdown: CourseScoreItem[];
  isTie: boolean;
}

export interface LeaderboardResponse {
  month: number;
  year: number;
  status: string;
  policyVersion: string;
  totalParticipants: number;
  entries: ComputedLeaderboardEntry[];
  finalizedAt?: Date | null;
  finalizedBy?: string | null;
}

export interface UserRankResponse {
  rank: number | null;
  isTie: boolean;
  points: number;
  completedCourses: number;
  averageScore: number | null;
  lastCompletedAt: Date | null;
  totalParticipants: number;
  scoreBreakdown: CourseScoreItem[];
}

export interface FinalizeOptions {
  /** Test hook: crash at a given point to exercise recovery. */
  simulateFailureAt?: 'BEFORE_SNAPSHOT_CONFIRM' | 'AFTER_FIRST_REWARD' | 'BEFORE_FINALIZED';
}

/**
 * FINALIZED ........ this call completed the period
 * ALREADY_FINALIZED  the period was final already (read-only answer)
 * BUSY ............. another live process owns the period right now; nothing was touched
 */
export interface FinalizeResult {
  status: 'FINALIZED' | 'ALREADY_FINALIZED' | 'BUSY';
  totalParticipants: number;
  totalPointsAwarded: number;
  notificationsPending?: number;
  rewardsSkippedIneligible?: number;
}

/** A snapshot entry as the reward phase works with it. */
interface SnapshotEntry {
  userId: string;
  rank: number;
  points: number;
  completedCourses: number;
  averageScore: number | null;
  lastCompletedAt: Date;
  rewardPoints: number;
  rewardBadgeId: string | null;
  scoreBreakdown: any;
  isTie: boolean;
  rewardNotifiedAt?: Date | null;
}

export interface RewardFailure {
  userId: string;
  rank: number;
  step: 'POINTS' | 'BADGE';
  message: string;
}

/**
 * Thrown by finalizeMonth when at least one required reward (points or badge) could not be confirmed.
 * The period stays REWARDING (frozen snapshot untouched) and finalizeMonth can simply be run again.
 */
export class LeaderboardRewardIncompleteError extends Error {
  constructor(
    public readonly month: number,
    public readonly year: number,
    public readonly failures: RewardFailure[],
    public readonly verifiedPoints: number,
    public readonly expectedPoints: number
  ) {
    super(
      `Leaderboard ${month}/${year} rewards incomplete: ${failures.length} failed step(s) ` +
        `(${failures.map((f) => `#${f.rank}/${f.userId}:${f.step}`).join(', ')}); ` +
        `verified ${verifiedPoints}/${expectedPoints} points. Period kept in REWARDING; retry is safe.`
    );
    this.name = 'LeaderboardRewardIncompleteError';
  }
}

/**
 * The stored state of a period does not allow the requested operation (e.g. a frozen snapshot that fails its
 * integrity check, or an unconfirmed period that already holds entries). Nothing is changed when this is thrown.
 */
export class LeaderboardStateError extends Error {
  constructor(
    message: string,
    public readonly month: number,
    public readonly year: number,
    public readonly status: string
  ) {
    super(message);
    this.name = 'LeaderboardStateError';
  }
}

// ─── Ranking (pure, shared by the live view, the snapshot and the reward selection) ─────────────

/** Two learners can only share a rank when their final completion times differ by LESS than this. */
export const TIE_WINDOW_MS = 1000;

const scoreKey = (e: { averageScore: number | null }) => e.averageScore ?? -1; // null ranks below any real quiz score

/**
 * Ranking order (unchanged):
 *   1) points DESC  2) completedCourses DESC  3) averageScore DESC (null = -1)  4) lastCompletedAt ASC
 * The final userId comparison only makes the order of otherwise identical entries deterministic
 * (stable display, independent of input order); it never decides a rank.
 */
export function compareEntries(a: ComputedLeaderboardEntry, b: ComputedLeaderboardEntry): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.completedCourses !== a.completedCourses) return b.completedCourses - a.completedCourses;
  if (scoreKey(b) !== scoreKey(a)) return scoreKey(b) - scoreKey(a);
  const dt = a.lastCompletedAt.getTime() - b.lastCompletedAt.getTime();
  if (dt !== 0) return dt;
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

/**
 * Standard competition ranking (1, 1, 3 ...). A tie group is opened by its LEADER (the best-placed member)
 * and a following entry joins only if points, courses and quiz average are equal AND its completion time is
 * within TIE_WINDOW_MS of the LEADER - never of the previous entry, so the window cannot chain
 * (0 ms, 900 ms, 1800 ms -> 1, 1, 3). Every member of a group of two or more gets isTie = true.
 * Returns a new, sorted array; the same entry objects are updated in place (rank, isTie).
 */
export function rankEntries(entries: ComputedLeaderboardEntry[]): ComputedLeaderboardEntry[] {
  const sorted = [...entries].sort(compareEntries);

  let leader: ComputedLeaderboardEntry | null = null;
  let group: ComputedLeaderboardEntry[] = [];
  const closeGroup = () => {
    const tied = group.length > 1;
    for (const member of group) member.isTie = tied;
  };

  sorted.forEach((entry, index) => {
    const joinsGroup =
      leader !== null &&
      leader.points === entry.points &&
      leader.completedCourses === entry.completedCourses &&
      scoreKey(leader) === scoreKey(entry) &&
      Math.abs(entry.lastCompletedAt.getTime() - leader.lastCompletedAt.getTime()) < TIE_WINDOW_MS;

    if (joinsGroup) {
      entry.rank = leader!.rank;
      group.push(entry);
    } else {
      closeGroup();
      leader = entry;
      entry.rank = index + 1;
      group = [entry];
    }
  });
  closeGroup();

  return sorted;
}

// ─── Internal Computation Engine ──────────────────────────────────────────────

/**
 * Aggregate completion data from CourseCompletionRecord for a specific month and year.
 * Ensures initial sync of any completed CourseProgress records if needed.
 */
async function aggregateCompletions(
  month: number,
  year: number,
  options: { fresh?: boolean } = {}
): Promise<ComputedLeaderboardEntry[]> {
  // 1. Fetch all VALID completion records for this month and year
  let records = await prisma.courseCompletionRecord.findMany({
    where: {
      month,
      year,
      status: 'VALID',
    },
    orderBy: { completedAt: 'asc' },
  });

  // If no records found, try a quick sync from CourseProgress in case completions happened before backfill
  if (records.length === 0) {
    await AchievementService.syncExistingCompletions();
    records = await prisma.courseCompletionRecord.findMany({
      where: {
        month,
        year,
        status: 'VALID',
      },
      orderBy: { completedAt: 'asc' },
    });
  }

  // 2. Group by userId
  const userMap = new Map<string, {
    courses: CourseScoreItem[];
  }>();

  for (const r of records) {
    if (!userMap.has(r.userId)) {
      userMap.set(r.userId, { courses: [] });
    }

    userMap.get(r.userId)!.courses.push({
      courseId: r.courseId,
      courseTitle: r.courseTitle,
      durationSeconds: r.totalDurationSeconds,
      durationHours: Math.round((r.totalDurationSeconds / 3600) * 10) / 10,
      level: r.level,
      basePoints: r.baseDurationPoints,
      levelMultiplier: r.levelMultiplier,
      achievementPoints: r.achievementPoints,
      averageQuizScore: r.averageQuizScore,
      hasQuiz: r.hasQuiz,
      completedAt: r.completedAt,
    });
  }

  // 2b. Only eligible learners compete (role STUDENT, account active - verified by the User Service).
  //     Fail-closed: if eligibility cannot be established this throws UserEligibilityError, so no live view,
  //     snapshot or reward is ever produced from an unverified population. `fresh` bypasses the short cache
  //     and is required for the snapshot build.
  const verdicts = await UserEligibilityService.check([...userMap.keys()], { fresh: options.fresh });
  for (const userId of [...userMap.keys()]) {
    if (!verdicts.get(userId)?.eligible) userMap.delete(userId);
  }

  // 3. Build preliminary aggregated entries
  const result: ComputedLeaderboardEntry[] = [];

  for (const [userId, data] of userMap) {
    const completedCourses = data.courses.length;
    const totalPoints = data.courses.reduce((sum, c) => sum + c.achievementPoints, 0);
    const roundedPoints = Math.round(totalPoints * 100) / 100;

    // Calculate quiz average strictly for courses that HAVE quizzes
    const quizCourses = data.courses.filter(c => c.hasQuiz && c.averageQuizScore != null);
    const averageScore = quizCourses.length > 0
      ? Math.round((quizCourses.reduce((sum, c) => sum + (c.averageQuizScore ?? 0), 0) / quizCourses.length) * 100) / 100
      : null;

    const lastCompletedAt = data.courses.reduce(
      (latest, c) => (c.completedAt > latest ? c.completedAt : latest),
      data.courses[0].completedAt
    );

    result.push({
      userId,
      rank: 0,
      points: roundedPoints,
      completedCourses,
      averageScore,
      lastCompletedAt,
      rewardPoints: 0,
      rewardBadgeId: null,
      scoreBreakdown: data.courses,
      isTie: false,
    });
  }

  // 4+5. Sort and assign ranks / ties (single shared implementation, see rankEntries)
  const ranked = rankEntries(result);

  // 6. Assign prospective reward points
  for (const entry of ranked) {
    const reward = getRewardForRank(entry.rank, month, year);
    if (reward) {
      entry.rewardPoints = reward.rewardPoints;
    }
  }

  return ranked;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class LeaderboardService {
  /**
   * Get leaderboard for the current calendar month in Vietnam timezone (computed on-the-fly).
   */
  static async getCurrentLeaderboard(): Promise<LeaderboardResponse> {
    const { month, year } = getCurrentVietnamMonthYear();
    const entries = await aggregateCompletions(month, year);

    return {
      month,
      year,
      status: 'ACTIVE',
      policyVersion: SCORING_POLICY_VERSION,
      totalParticipants: entries.length,
      entries,
      finalizedAt: null,
      finalizedBy: null,
    };
  }

  /**
   * Get leaderboard for a specific month and year.
   * If FINALIZED: returns the snapshot from database.
   * If ACTIVE: computes on-the-fly.
   */
  static async getLeaderboard(month: number, year: number): Promise<LeaderboardResponse> {
    if (month < 1 || month > 12) throw new Error('Invalid month');
    if (year < 2020 || year > 2100) throw new Error('Invalid year');

    const snapshot = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month, year } },
      include: { entries: { orderBy: { rank: 'asc' } } },
    });

    if (snapshot && snapshot.status === 'FINALIZED') {
      return {
        month: snapshot.month,
        year: snapshot.year,
        status: snapshot.status,
        policyVersion: snapshot.policyVersion,
        totalParticipants: snapshot.totalParticipants || snapshot.entries.length,
        entries: snapshot.entries.map(e => ({
          userId: e.userId,
          rank: e.rank,
          points: e.points,
          completedCourses: e.completedCourses,
          averageScore: e.averageScore,
          lastCompletedAt: e.lastCompletedAt,
          rewardPoints: e.rewardPoints,
          rewardBadgeId: e.rewardBadgeId,
          scoreBreakdown: (e.scoreBreakdown as any) || [],
          isTie: e.isTie,
        })),
        finalizedAt: snapshot.finalizedAt,
        finalizedBy: snapshot.finalizedBy,
      };
    }

    // Not finalized -> compute on-the-fly
    const entries = await aggregateCompletions(month, year);

    return {
      month,
      year,
      status: snapshot?.status || 'ACTIVE',
      policyVersion: SCORING_POLICY_VERSION,
      totalParticipants: entries.length,
      entries,
      finalizedAt: null,
      finalizedBy: null,
    };
  }

  /**
   * Get student's rank and achievement in the current month.
   */
  static async getUserRank(userId: string): Promise<UserRankResponse> {
    const { month, year } = getCurrentVietnamMonthYear();
    const entries = await aggregateCompletions(month, year);
    const userEntry = entries.find(e => e.userId === userId);

    return {
      rank: userEntry?.rank ?? null,
      isTie: userEntry?.isTie ?? false,
      points: userEntry?.points ?? 0,
      completedCourses: userEntry?.completedCourses ?? 0,
      averageScore: userEntry?.averageScore ?? null,
      lastCompletedAt: userEntry?.lastCompletedAt ?? null,
      totalParticipants: entries.length,
      scoreBreakdown: userEntry?.scoreBreakdown ?? [],
    };
  }

  /**
   * Replaces the lock service used by finalizeMonth (tests inject one backed by a fake store and a manual clock).
   * Pass null to go back to the default MongoDB-backed service.
   */
  static useLockService(service: LeaderboardLockService | null) {
    lockService = service;
  }

  /**
   * Finalize a month's leaderboard: snapshot to DB, award Badges and Reward Points.
   *
   * OWNERSHIP (FIX 06B2). Only the holder of the period lock may do any of this. The lock is acquired first
   * (atomic, server-clock lease, fencing token); a heartbeat keeps it alive while the run works; and EVERY write
   * below is either a fenced transaction (the lock fence is the first statement of the transaction, so a process
   * that lost the lock - lease lapsed, taken over, period finalized - writes nothing) or a compare-and-set on a
   * claim of its own. There is no other way in: no `force`, no `takeOver`. A period that is being processed by a
   * live owner answers BUSY; only an EXPIRED lease can be taken over, and that is the same plain acquire used by
   * the startup catch-up, the cron job and the reconciliation loop.
   *
   * HISTORY IS IMMUTABLE. A FINALIZED period is never touched by this method: its entries are not deleted or
   * recomputed, no reward is re-issued, totals and status stay as written.
   *
   * Per stored status (after the lock was acquired):
   *   (none) / ACTIVE ......... build the snapshot (normal first run)
   *   SNAPSHOT_BUILDING ....... the snapshot was never confirmed: rebuilt in ONE fenced transaction that deletes
   *                             any leftovers of an older (pre-lock) run, inserts the new entries and moves the
   *                             status to SNAPSHOT_FROZEN together - all or nothing
   *   SNAPSHOT_FROZEN ......... continue from the frozen entries, never recompute
   *   REWARDING ............... continue from the frozen entries, verify/finish each reward
   *   FINALIZED ............... nothing happens (ALREADY_FINALIZED)
   *   anything else holding entries (e.g. FAILED / FINALIZING with entries) -> LeaderboardStateError,
   *   never deleted automatically (manual review).
   *
   * Results: FINALIZED | ALREADY_FINALIZED | BUSY (another live owner). Throws LockLostError when this run lost
   * the lock (it stops at once and writes nothing more; the new owner continues from the stored state) and
   * LockStoreError when the lock itself cannot be reached.
   */
  static async finalizeMonth(
    month: number,
    year: number,
    finalizedBy: string = 'SYSTEM_CRON',
    options?: FinalizeOptions
  ): Promise<FinalizeResult> {
    logger.info(`🏆 [Finalize] Checking leaderboard for ${month}/${year} (initiator: ${finalizedBy})...`);

    const locks = getLockService();
    const acquired = await locks.acquire(month, year, { owner: `${finalizedBy} @ ${LeaderboardLockService.defaultOwner()}` });

    if (acquired.status === 'FINALIZED') {
      const board = await prisma.monthlyLeaderboard.findUnique({ where: { month_year: { month, year } } });
      if (!board) throw new Error(`Leaderboard ${month}/${year} is FINALIZED but could not be read`);
      return LeaderboardService.alreadyFinalized(board);
    }
    if (acquired.status === 'BUSY') {
      const board = await prisma.monthlyLeaderboard.findUnique({ where: { month_year: { month, year } } });
      logger.warn(`🏆 [Finalize] ${month}/${year} is being processed by another owner (${acquired.expiresInMs ?? '?'} ms of lease left). Not touching it.`);
      return {
        status: 'BUSY',
        totalParticipants: board?.totalParticipants ?? 0,
        totalPointsAwarded: board?.totalPointsAwarded ?? 0,
      };
    }

    const handle = acquired.handle;
    const ctx = locks.createContext(handle);
    const heartbeat = locks.startHeartbeat(handle);
    ctx.attachHeartbeat(heartbeat);
    try {
      return await LeaderboardService.finalizeOwned(ctx, finalizedBy, options);
    } finally {
      heartbeat.stop();
      try {
        await locks.release(handle); // exact token + fencing token: never releases a newer owner's lock
      } catch (releaseErr) {
        // The original outcome (result or error) must not be masked; the lease simply lapses on its own.
        logger.error(`🏆 [Finalize] Could not release the lock on ${month}/${year} (it will expire by itself):`, releaseErr);
      }
    }
  }

  /** The finalization proper. Runs only while holding the period lock; `ctx` is passed to every writing step. */
  private static async finalizeOwned(ctx: LockContext, finalizedBy: string, options?: FinalizeOptions): Promise<FinalizeResult> {
    const { month, year } = ctx;
    try {
      const board = await prisma.monthlyLeaderboard.findUnique({ where: { id: ctx.periodId } });
      if (!board) throw new Error(`Leaderboard ${month}/${year} could not be found`);
      if (board.status === 'FINALIZED') return LeaderboardService.alreadyFinalized(board);

      // PHASE 1: the frozen snapshot. If it was already confirmed in a previous run it is NEVER recalculated.
      let entriesToProcess: SnapshotEntry[];
      if (board.status === 'SNAPSHOT_FROZEN' || board.status === 'REWARDING') {
        entriesToProcess = await LeaderboardService.loadFrozenEntries(board);
        logger.info(
          `🏆 [Finalize] Resuming ${month}/${year} from the confirmed frozen snapshot (${entriesToProcess.length} entries, ${board.status}). Rankings are not recomputed.`
        );
      } else {
        entriesToProcess = await LeaderboardService.buildSnapshot(ctx, board, finalizedBy, options);
      }

      // PHASE 2 + 3: rewards, then FINALIZED
      return await LeaderboardService.rewardPhase(ctx, entriesToProcess, finalizedBy, options);
    } catch (error: any) {
      if (error instanceof LockLostError) {
        if (error.reason === 'FINALIZED') {
          // Somebody else completed the period while this run was stalled: their stored result stands (read-only answer).
          const now = await prisma.monthlyLeaderboard.findUnique({ where: { month_year: { month, year } } });
          if (now?.status === 'FINALIZED') return LeaderboardService.alreadyFinalized(now);
        }
        logger.error(`🏆 [Finalize] ${month}/${year}: lock lost (${error.reason}). This run stops and writes nothing more; the current owner continues from the stored state.`);
      } else {
        logger.error(`🏆 [Finalize] Error finalizing month ${month}/${year}:`, error);
      }
      // Progress status (SNAPSHOT_BUILDING / REWARDING) is preserved so the next owner can resume exactly there
      throw error;
    }
  }

  // ─── Phase 1: snapshot ───────────────────────────────────────────────────────

  /** Entries of a snapshot that was already confirmed. A damaged snapshot is never paid from. */
  private static async loadFrozenEntries(board: { id: string; month: number; year: number; status: string; totalParticipants: number }): Promise<SnapshotEntry[]> {
    const existingEntries = await prisma.leaderboardEntry.findMany({
      where: { leaderboardId: board.id },
      orderBy: { rank: 'asc' },
    });
    if (existingEntries.length !== board.totalParticipants) {
      throw new LeaderboardStateError(
        `Frozen snapshot of ${board.month}/${board.year} holds ${existingEntries.length} entries but ${board.totalParticipants} were confirmed. Manual review required; nothing was changed.`,
        board.month, board.year, board.status
      );
    }
    return existingEntries.map((e) => ({
      userId: e.userId,
      rank: e.rank,
      points: e.points,
      completedCourses: e.completedCourses,
      averageScore: e.averageScore,
      lastCompletedAt: e.lastCompletedAt,
      rewardPoints: e.rewardPoints,
      rewardBadgeId: e.rewardBadgeId,
      scoreBreakdown: e.scoreBreakdown,
      isTie: e.isTie,
      rewardNotifiedAt: e.rewardNotifiedAt ?? null,
    }));
  }

  /**
   * Builds and freezes the snapshot of a period whose snapshot was never confirmed.
   *   1. claim (fenced CAS): ACTIVE / SNAPSHOT_BUILDING ... -> SNAPSHOT_BUILDING
   *   2. compute rankings from fresh data - includes the User Service eligibility call - OUTSIDE any transaction
   *   3. ONE short fenced transaction: CAS SNAPSHOT_BUILDING -> SNAPSHOT_FROZEN (source state AND ownership), delete
   *      leftovers of an unconfirmed older run, insert the entries, verify the count - committed together or not at all
   * A failure anywhere leaves the previous stored state untouched (the period just stays SNAPSHOT_BUILDING).
   */
  private static async buildSnapshot(
    ctx: LockContext,
    board: { id: string; status: string },
    finalizedBy: string,
    options?: FinalizeOptions
  ): Promise<SnapshotEntry[]> {
    const { month, year } = ctx;

    // Entries may be discarded ONLY when the snapshot is known to be unconfirmed: status SNAPSHOT_BUILDING (a
    // confirmed snapshot always moves on to SNAPSHOT_FROZEN) or no entries at all.
    const existingEntryCount = await prisma.leaderboardEntry.count({ where: { leaderboardId: board.id } });
    if (board.status !== 'SNAPSHOT_BUILDING' && existingEntryCount > 0) {
      throw new LeaderboardStateError(
        `Leaderboard ${month}/${year} is ${board.status} and already holds ${existingEntryCount} entries; it will not be rebuilt automatically. Manual review required.`,
        month, year, board.status
      );
    }

    const claimed = await LeaderboardService.fencedTransition(ctx, [board.status], 'SNAPSHOT_BUILDING', { finalizedBy });
    if (!claimed) {
      throw new LeaderboardStateError(
        `Leaderboard ${month}/${year} changed while it was being claimed for a rebuild; nothing was deleted. Retry.`,
        month, year, board.status
      );
    }

    // Rankings first, with freshly verified eligibility: if the User Service cannot be reached this throws before
    // anything is written, so the period simply stays SNAPSHOT_BUILDING for a later retry.
    ctx.assertAlive();
    const computed = await aggregateCompletions(month, year, { fresh: true });
    ctx.assertAlive();
    const expectedCount = computed.length;

    await LeaderboardService.fencedTx(
      ctx,
      async (tx) => {
        // CAS on the source state AND ownership. Nothing is deleted unless this succeeds.
        const frozen = await tx.monthlyLeaderboard.updateMany({
          where: { id: ctx.periodId, status: 'SNAPSHOT_BUILDING', ...LeaderboardService.owned(ctx) },
          data: { status: 'SNAPSHOT_FROZEN', totalParticipants: expectedCount },
        });
        if (frozen.count !== 1) {
          const now = await tx.monthlyLeaderboard.findUnique({ where: { id: ctx.periodId } });
          throw new LeaderboardStateError(
            `Leaderboard ${month}/${year} left SNAPSHOT_BUILDING while the snapshot was being written (now ${now?.status}).`,
            month, year, now?.status || 'UNKNOWN'
          );
        }

        // Discard what an unconfirmed older run left behind (the transaction rolls this back if anything below fails)
        await tx.leaderboardEntry.deleteMany({ where: { leaderboardId: ctx.periodId } });

        if (options?.simulateFailureAt === 'BEFORE_SNAPSHOT_CONFIRM') {
          if (computed.length > 0) {
            await tx.leaderboardEntry.create({
              data: {
                leaderboardId: ctx.periodId,
                userId: computed[0].userId,
                rank: computed[0].rank,
                points: computed[0].points,
                completedCourses: computed[0].completedCourses,
                averageScore: computed[0].averageScore,
                lastCompletedAt: computed[0].lastCompletedAt,
                rewardPoints: computed[0].rewardPoints,
                scoreBreakdown: computed[0].scoreBreakdown as any,
                isTie: computed[0].isTie,
              },
            });
          }
          throw new Error('[SIMULATION] Crash occurred while writing snapshot entries (partial write simulated)');
        }

        if (computed.length > 0) {
          await tx.leaderboardEntry.createMany({
            data: computed.map((e) => ({
              leaderboardId: ctx.periodId,
              userId: e.userId,
              rank: e.rank,
              points: e.points,
              completedCourses: e.completedCourses,
              averageScore: e.averageScore,
              lastCompletedAt: e.lastCompletedAt,
              rewardPoints: e.rewardPoints,
              rewardBadgeId: e.rewardBadgeId ?? null,
              scoreBreakdown: e.scoreBreakdown as any,
              isTie: e.isTie,
            })),
          });
        }

        // Integrity check inside the same transaction: a mismatch rolls the whole snapshot back
        const actualCount = await tx.leaderboardEntry.count({ where: { leaderboardId: ctx.periodId } });
        if (actualCount !== expectedCount) {
          throw new Error(`Snapshot integrity check failed: expected ${expectedCount} entries, but found ${actualCount} in database.`);
        }
      },
      { timeoutMs: SNAPSHOT_TX_TIMEOUT_MS }
    );

    return computed.map((e) => ({ ...e, rewardBadgeId: e.rewardBadgeId ?? null }));
  }

  // ─── Phase 2 + 3: rewards and FINALIZED ──────────────────────────────────────

  /**
   * Disburses rewards strictly from the confirmed frozen snapshot. A period may only become FINALIZED when EVERY
   * required reward (points + badge) is confirmed. Points are confirmed by reading the ledger back and matching it
   * against the snapshot (user, leaderboard, period, key, amount) - a call that merely did not throw is not
   * evidence. A failure for one student never stops the others; the period then stays REWARDING and the run can be
   * repeated safely (idempotent per student). Losing the lock, however, stops the whole run at once.
   * Notifications are NOT required for FINALIZED: they are tracked per entry (claimed, then recorded) and retried.
   */
  private static async rewardPhase(
    ctx: LockContext,
    entriesToProcess: SnapshotEntry[],
    finalizedBy: string,
    options?: FinalizeOptions
  ): Promise<FinalizeResult> {
    const { month, year } = ctx;
    const leaderboardId = ctx.periodId;

    // Eligibility is re-verified (fresh) for everyone who would be paid now. Snapshots frozen before this check
    // existed, or accounts changed after the freeze, must not receive NEW rewards. Fail-closed: if the User
    // Service cannot answer this throws and the period stays as it is (SNAPSHOT_FROZEN / REWARDING).
    ctx.assertAlive();
    const payable = entriesToProcess.filter((e) => getRewardForRank(e.rank, month, year));
    const eligibility = await UserEligibilityService.check(payable.map((e) => e.userId), { fresh: true });
    ctx.assertAlive();

    const rewarding = await LeaderboardService.fencedTransition(ctx, ['SNAPSHOT_FROZEN', 'REWARDING'], 'REWARDING', { finalizedBy });
    if (!rewarding) {
      const now = await prisma.monthlyLeaderboard.findUnique({ where: { id: leaderboardId } });
      if (now?.status === 'FINALIZED') return LeaderboardService.alreadyFinalized(now);
      throw new LeaderboardStateError(
        `Leaderboard ${month}/${year} cannot enter REWARDING from ${now?.status}.`,
        month, year, now?.status || 'UNKNOWN'
      );
    }

    const failures: RewardFailure[] = [];
    const skippedIneligible: Array<{ userId: string; rank: number; reason: string }> = [];
    let expectedPoints = 0; // what the frozen snapshot says should be paid
    let verifiedPoints = 0; // what the ledger confirms was paid (the value stored as totalPointsAwarded)
    let notificationsPending = 0;
    let rewardIndex = 0;

    for (const entry of entriesToProcess) {
      rewardIndex++;
      const reward = getRewardForRank(entry.rank, month, year);
      if (!reward) continue;
      ctx.assertAlive(); // no new step (and no HTTP call) once the lock may be gone

      // An ineligible learner receives nothing NEW. A reward that was already paid stays paid (history is not
      // reversed); the frozen rank of this and every other entry is left exactly as it is.
      const verdict = eligibility.get(entry.userId);
      if (!verdict?.eligible) {
        const alreadyPaid = await RewardPointService.verifyLeaderboardAward(
          { userId: entry.userId, points: reward.rewardPoints, leaderboardId, month, year },
          ctx
        );
        if (!alreadyPaid.ok && alreadyPaid.reason === 'MISSING') {
          logger.warn(`🏆 [Finalize] ${month}/${year}: rank #${entry.rank} user ${entry.userId} is not eligible (${verdict?.reason || 'PROFILE_NOT_FOUND'}); reward not issued.`);
          skippedIneligible.push({ userId: entry.userId, rank: entry.rank, reason: verdict?.reason || 'PROFILE_NOT_FOUND' });
          entry.rewardPoints = 0;
          continue;
        }
      }

      entry.rewardPoints = reward.rewardPoints;
      expectedPoints += reward.rewardPoints;

      // A. Points: idempotent, fenced award, then confirm from the ledger. The ledger is read back even when the
      //    award call threw: the failure may have happened after the commit (lost response), in which case the
      //    committed entry is the evidence and must be counted - and never paid again.
      let pointsVerified = false;
      let awardError: any = null;
      try {
        await RewardPointService.awardLeaderboardPoints(entry.userId, reward.rewardPoints, leaderboardId, entry.rank, month, year, ctx);
      } catch (pointErr: any) {
        if (pointErr instanceof LockLostError) throw pointErr; // never swallowed: the run stops here
        awardError = pointErr;
        logger.error(`Award call failed for user ${entry.userId}; checking the ledger before deciding:`, pointErr);
      }
      try {
        const check = await RewardPointService.verifyLeaderboardAward(
          { userId: entry.userId, points: reward.rewardPoints, leaderboardId, month, year },
          ctx
        );
        if (check.ok) {
          pointsVerified = true;
          verifiedPoints += reward.rewardPoints;
        } else {
          failures.push({
            userId: entry.userId,
            rank: entry.rank,
            step: 'POINTS',
            message: awardError ? `${awardError?.message || awardError} (ledger: ${check.reason}: ${check.detail})` : `${check.reason}: ${check.detail}`,
          });
        }
      } catch (verifyErr: any) {
        if (verifyErr instanceof LockLostError) throw verifyErr;
        failures.push({ userId: entry.userId, rank: entry.rank, step: 'POINTS', message: awardError?.message || verifyErr?.message || String(verifyErr) });
      }

      // B. Badge (idempotent, fenced; a missing badge is created on retry, an existing one is never duplicated)
      let badgeOk = false;
      try {
        entry.rewardBadgeId = await LeaderboardService.ensureRewardBadge(entry, reward, month, year, ctx);
        badgeOk = true;
      } catch (badgeErr: any) {
        if (badgeErr instanceof LockLostError) throw badgeErr;
        logger.error(`Failed to award badge to user ${entry.userId}:`, badgeErr);
        failures.push({ userId: entry.userId, rank: entry.rank, step: 'BADGE', message: badgeErr?.message || String(badgeErr) });
      }

      // C. Notification: only after points + badge are confirmed, once per entry, never required for FINALIZED
      if (pointsVerified && badgeOk && !entry.rewardNotifiedAt) {
        const sent = await LeaderboardService.sendRewardNotification(leaderboardId, entry, { month, year }, ctx);
        if (!sent) notificationsPending++;
      }

      // Simulated failure after first reward
      if (options?.simulateFailureAt === 'AFTER_FIRST_REWARD' && rewardIndex === 1) {
        throw new Error('[SIMULATION] Crash occurred immediately after rewarding first student');
      }
    }

    // Persist what is known to be true so far (badge links) - also when the period is incomplete
    await LeaderboardService.persistEntryRewards(ctx, entriesToProcess);
    await LeaderboardService.recordIneligibleSkips(ctx, skippedIneligible);

    if (failures.length > 0) {
      // The period is NOT finalized. totalPointsAwarded shows the verified amount only.
      await LeaderboardService.fencedTx(ctx, (tx) =>
        tx.monthlyLeaderboard.updateMany({
          where: { id: leaderboardId, status: 'REWARDING', ...LeaderboardService.owned(ctx) },
          data: { totalParticipants: entriesToProcess.length, totalPointsAwarded: verifiedPoints },
        })
      );
      await LeaderboardService.recordIncompleteRewards(ctx, failures, verifiedPoints, expectedPoints);
      throw new LeaderboardRewardIncompleteError(month, year, failures, verifiedPoints, expectedPoints);
    }

    // Simulated failure before finalized
    if (options?.simulateFailureAt === 'BEFORE_FINALIZED') {
      throw new Error('[SIMULATION] Crash occurred right before marking FINALIZED');
    }

    // PHASE 3: mark FINALIZED (every required reward is confirmed) - fenced, and only out of REWARDING
    ctx.assertAlive();
    const finalized = await LeaderboardService.fencedTransition(ctx, ['REWARDING'], 'FINALIZED', {
      finalizedAt: new Date(),
      totalParticipants: entriesToProcess.length,
      totalPointsAwarded: verifiedPoints,
      policyVersion: SCORING_POLICY_VERSION,
    });
    if (!finalized) {
      const now = await prisma.monthlyLeaderboard.findUnique({ where: { id: leaderboardId } });
      if (now?.status === 'FINALIZED') return LeaderboardService.alreadyFinalized(now);
      throw new LeaderboardStateError(
        `Leaderboard ${month}/${year} could not be finalized from ${now?.status}.`,
        month, year, now?.status || 'UNKNOWN'
      );
    }

    logger.info(
      `🏆 [Finalize] Month ${month}/${year} finalized successfully: ${entriesToProcess.length} participants, ${verifiedPoints} verified reward points granted` +
        (notificationsPending > 0 ? ` (${notificationsPending} notification(s) pending retry)` : '.')
    );

    return {
      status: 'FINALIZED',
      totalParticipants: entriesToProcess.length,
      totalPointsAwarded: verifiedPoints,
      notificationsPending,
      rewardsSkippedIneligible: skippedIneligible.length,
    };
  }

  // ─── Fenced writes ───────────────────────────────────────────────────────────

  /** Ownership condition added to every compare-and-set on the period row (the fence already proved it; this keeps the CAS self-describing). */
  private static owned(ctx: LockContext) {
    return { lockToken: ctx.lockToken, fencingToken: ctx.fencingToken };
  }

  /**
   * A short interactive transaction whose FIRST statement is the lock fence. Conflicts are retried a bounded number
   * of times, and every attempt fences again. LockLostError (and any other error) is final: never retried.
   * No network call may happen inside `fn`.
   */
  private static async fencedTx<T>(guard: FenceGuard, fn: (tx: any) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= FENCED_TX_MAX_ATTEMPTS; attempt++) {
      try {
        return await (prisma as any).$transaction(
          async (tx: any) => {
            await guard.fence(tx);
            return fn(tx);
          },
          { maxWait: 5000, timeout: opts.timeoutMs ?? 15000 }
        );
      } catch (e: any) {
        lastErr = e;
        if (e instanceof LockLostError || !isTxConflict(e) || attempt === FENCED_TX_MAX_ATTEMPTS) throw e;
        await new Promise((resolve) => setTimeout(resolve, 10 * attempt + Math.floor(Math.random() * 20)));
      }
    }
    throw lastErr;
  }

  /** Compare-and-set on the stored status, fenced: moves the period only if it is in one of `from` AND this run still owns it. */
  private static fencedTransition(ctx: LockContext, from: string[], to: string, data: Record<string, any> = {}): Promise<boolean> {
    return LeaderboardService.fencedTx(ctx, async (tx) => {
      const res = await tx.monthlyLeaderboard.updateMany({
        where: { id: ctx.periodId, status: { in: from }, ...LeaderboardService.owned(ctx) },
        data: { status: to, ...data },
      });
      return res.count === 1;
    });
  }

  /**
   * Result for a period that is already FINALIZED. Strictly read-only: it reports what was stored and how
   * many notifications still await a retry; it never changes the snapshot, rewards or totals.
   */
  private static async alreadyFinalized(board: {
    id: string;
    month: number;
    year: number;
    finalizedAt: Date | null;
    totalParticipants: number;
    totalPointsAwarded: number;
  }): Promise<FinalizeResult> {
    logger.info(`🏆 [Finalize] Leaderboard ${board.month}/${board.year} already finalized at ${board.finalizedAt?.toISOString()}. Nothing to do.`);
    const notificationsPending = await prisma.leaderboardEntry
      .count({ where: { leaderboardId: board.id, OR: [{ rewardNotifyError: { not: null } }, { rewardNotifyClaimToken: { not: null } }] } })
      .catch(() => undefined);
    return {
      status: 'ALREADY_FINALIZED',
      totalParticipants: board.totalParticipants,
      totalPointsAwarded: board.totalPointsAwarded,
      notificationsPending,
    };
  }

  // ─── Reward helpers ──────────────────────────────────────────────────────────

  /**
   * Badge for a rewarded rank. Idempotent (unique per user + badge name): an existing badge is reused,
   * a concurrent create is resolved by re-reading. A same-named badge of another type is an integrity
   * error - it is never overwritten or deleted. The read-and-create is ONE fenced transaction.
   */
  private static async ensureRewardBadge(
    entry: { userId: string; rank: number; isTie: boolean; points: number; completedCourses: number },
    reward: { rewardPoints: number; badgeName: string; icon: string; description: string },
    month: number,
    year: number,
    guard: FenceGuard
  ): Promise<string> {
    const where = { userId_badgeName: { userId: entry.userId, badgeName: reward.badgeName } };
    const accept = (badge: { id: string; badgeType: string }) => {
      if (badge.badgeType !== 'LEADERBOARD_REWARD') {
        throw new Error(`Badge integrity error: "${reward.badgeName}" of user ${entry.userId} has type ${badge.badgeType}`);
      }
      return badge.id;
    };
    guard.assertAlive();

    try {
      return await runTx(async (tx) => {
        await guard.fence(tx); // first statement of every attempt
        const existing = await tx.badge.findUnique({ where });
        if (existing) return accept(existing);
        const badge = await tx.badge.create({
          data: {
            userId: entry.userId,
            badgeName: reward.badgeName,
            badgeType: 'LEADERBOARD_REWARD',
            description: reward.description,
            iconUrl: reward.icon,
            metadata: {
              month,
              year,
              rank: entry.rank,
              isTie: entry.isTie,
              points: entry.points,
              completedCourses: entry.completedCourses,
              rewardPoints: reward.rewardPoints,
            },
          },
        });
        return badge.id;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // Created by someone else between our read and our create: that badge is the one
        const raced = await prisma.badge.findUnique({ where });
        if (raced) return accept(raced);
      }
      throw e;
    }
  }

  // ─── Notifications ───────────────────────────────────────────────────────────
  //
  // Delivery is AT-LEAST-ONCE, never exactly-once. What is guaranteed:
  //   * a notification is only sent by the process that holds the entry's CLAIM (atomic compare-and-set on the entry);
  //     two processes (finalize, the admin retry API, the cron/reconcile retry) can never send the same claim
  //     concurrently, and a claim that lapsed (crashed sender) can be taken again;
  //   * no database transaction is open while the HTTP call is made;
  //   * the outcome (delivered / error) is recorded by a CAS conditioned on the claim token.
  // If the process dies AFTER the User Service accepted the message but BEFORE the outcome is recorded, the claim lapses
  // and a later retry sends the REQUEST again. Every attempt carries the same X-Idempotency-Key
  // (`reward_lb_notify_<month>_<year>_<user>`, FIX 06C-4B2B2) and the same text (built from frozen data only), so the
  // User Service (FIX 06C-4B2B1) keeps ONE notification and does not push a replay again: requests are at-least-once,
  // the stored notification is deduplicated. The real-time push itself is not exactly-once (a push lost after the
  // commit is not repeated).
  // Claim timestamps come from the claiming process' clock; with a 60 s claim and a 5 s HTTP timeout, ordinary clock
  // skew cannot make two senders overlap.

  /**
   * Atomically claims the right to send one entry's notification. Returns the claim token, or null when the
   * notification was already delivered or another sender holds a live claim. With a guard the claim is a fenced
   * transaction, so a process that lost the period lock cannot start a new send.
   */
  private static async claimNotification(leaderboardId: string, userId: string, guard?: FenceGuard): Promise<string | null> {
    const token = randomBytes(16).toString('hex');
    const now = new Date();
    const where = {
      leaderboardId,
      userId,
      // not delivered yet (the field is absent on rows that never got a marker, null after a cleared one) ...
      AND: [
        { OR: [{ rewardNotifiedAt: null }, { rewardNotifiedAt: { isSet: false } }] },
        // ... and nobody holds a live claim
        { OR: [{ rewardNotifyClaimExpiresAt: null }, { rewardNotifyClaimExpiresAt: { isSet: false } }, { rewardNotifyClaimExpiresAt: { lt: now } }] },
      ],
    };
    const data = { rewardNotifyClaimToken: token, rewardNotifyClaimExpiresAt: new Date(now.getTime() + NOTIFY_CLAIM_TTL_MS) };
    const count = guard
      ? await LeaderboardService.fencedTx(guard, async (tx) => (await tx.leaderboardEntry.updateMany({ where, data })).count)
      : (await prisma.leaderboardEntry.updateMany({ where, data })).count;
    return count === 1 ? token : null;
  }

  /** Records the outcome of a send, only while the claim is still ours. */
  private static async finishNotification(leaderboardId: string, userId: string, token: string, error: string | null) {
    const cleared = { rewardNotifyClaimToken: null, rewardNotifyClaimExpiresAt: null };
    const data = error === null ? { rewardNotifiedAt: new Date(), rewardNotifyError: null, ...cleared } : { rewardNotifyError: error.slice(0, 500), ...cleared };
    try {
      const res = await prisma.leaderboardEntry.updateMany({ where: { leaderboardId, userId, rewardNotifyClaimToken: token }, data });
      if (res.count !== 1) {
        logger.warn(`Notification outcome for user ${userId} was not recorded: the claim lapsed and was taken over (another send may repeat the message).`);
      }
    } catch (e) {
      logger.error(`Failed to record notification outcome for user ${userId} (a retry may repeat the message):`, e);
    }
  }

  /**
   * Sends the reward notification and records the outcome on the snapshot entry (see the notes above).
   * Never throws except LockLostError (finalize path); a failure is recorded for later retry.
   */
  private static async sendRewardNotification(
    leaderboardId: string,
    entry: { userId: string; rank: number; points: number; rewardPoints?: number | null; rewardNotifiedAt?: Date | null; rewardBadgeId?: string | null },
    period: { month: number; year: number },
    guard?: FenceGuard
  ): Promise<boolean> {
    let token: string | null;
    try {
      token = await LeaderboardService.claimNotification(leaderboardId, entry.userId, guard);
    } catch (claimErr) {
      if (claimErr instanceof LockLostError) throw claimErr;
      logger.warn(`Could not claim the reward notification of user ${entry.userId}:`, claimErr);
      return false;
    }
    if (!token) {
      logger.info(`Reward notification of user ${entry.userId} is already delivered or being sent by another process; not sending it again.`);
      return false;
    }

    let sendError: any = null;
    try {
      // the same event for every attempt of every process: the key names it, the text comes from frozen data only
      const idempotencyKey = rewardNotificationKey(period.month, period.year, entry.userId);
      guard?.assertAlive(); // a process that lost the period lock reads nothing more and sends nothing
      const facts = await LeaderboardService.frozenRewardFacts(entry, period.month, period.year);
      const { title, message } = buildRewardNotificationContent(period.month, period.year, facts);
      guard?.assertAlive(); // the lock owner must still be valid at the moment the message goes out
      await UserNotificationClient.send(
        { userId: entry.userId, title, message, type: 'SUCCESS', link: '/leaderboard' },
        { timeoutMs: 5000, idempotencyKey }
      );
    } catch (e) {
      sendError = e;
    }

    if (sendError instanceof LockLostError) {
      // Nothing was sent: hand the claim back so the new owner is not made to wait for it to lapse
      await prisma.leaderboardEntry
        .updateMany({
          where: { leaderboardId, userId: entry.userId, rewardNotifyClaimToken: token },
          data: { rewardNotifyClaimToken: null, rewardNotifyClaimExpiresAt: null },
        })
        .catch(() => undefined);
      throw sendError;
    }
    if (sendError) {
      logger.warn(`Failed to send reward notification to user ${entry.userId}:`, sendError);
      await LeaderboardService.finishNotification(leaderboardId, entry.userId, token, String(sendError?.message || sendError));
      return false;
    }

    entry.rewardNotifiedAt = new Date();
    await LeaderboardService.finishNotification(leaderboardId, entry.userId, token, null);
    return true;
  }

  /**
   * What the reward notification says, read from what is FROZEN for the period - never from the live scoring policy, so a retry
   * months later (or after a policy change) carries the same text as the first attempt: the snapshot entry's rank and points, the
   * entry's verified reward points (set by the payout step and persisted with the badge link), and the badge that was awarded for
   * this period (its stored name and icon). Without them nothing is sent (the failure is recorded and retried): no amount is guessed.
   * The ledger is deliberately not touched: a notification retry never reaches the reward code.
   */
  private static async frozenRewardFacts(
    entry: { userId: string; rank: number; points: number; rewardPoints?: number | null; rewardBadgeId?: string | null },
    month: number,
    year: number
  ): Promise<FrozenRewardFacts> {
    if (!(typeof entry.rewardPoints === 'number' && entry.rewardPoints > 0)) {
      throw new Error('the entry has no verified reward points; notification not sent');
    }
    let badge: any = entry.rewardBadgeId ? await prisma.badge.findUnique({ where: { id: entry.rewardBadgeId } }) : null;
    if (!badge) {
      const awarded = await prisma.badge.findMany({ where: { userId: entry.userId, badgeType: 'LEADERBOARD_REWARD' } });
      badge = awarded.find((b: any) => b?.metadata?.month === month && b?.metadata?.year === year) ?? null;
    }
    if (!badge || badge.badgeType !== 'LEADERBOARD_REWARD' || badge.userId !== entry.userId) {
      throw new Error('the reward badge of this period was not found; notification not sent');
    }
    return { rank: entry.rank, points: entry.points, rewardPoints: entry.rewardPoints, badgeName: badge.badgeName, icon: badge.iconUrl ?? '' };
  }

  /**
   * Re-sends notifications that failed earlier for a period (also a FINALIZED one - no period lock is needed: the
   * per-entry claim is what keeps senders apart, so this is safe next to a running finalize, the cron retry and
   * other instances). Only entries that recorded a failure, or whose sender crashed holding a claim, are touched, so
   * historical periods (no marker at all) are never re-notified. Returns how many are still undelivered.
   */
  static async retryFailedNotifications(month: number, year: number): Promise<number> {
    const board = await prisma.monthlyLeaderboard.findUnique({ where: { month_year: { month, year } } });
    if (!board) return 0;

    // Success clears both the error and the claim, so a remaining marker means "not delivered". (`null` filters do
    // not match an absent field in Mongo, hence the delivery marker is checked in memory.)
    const undelivered = (
      await prisma.leaderboardEntry.findMany({
        where: { leaderboardId: board.id, OR: [{ rewardNotifyError: { not: null } }, { rewardNotifyClaimToken: { not: null } }] },
      })
    ).filter((e) => !e.rewardNotifiedAt);
    // the same key and the same frozen text as the finalize attempt (no live scoring policy is consulted here)
    let remaining = 0;
    for (const entry of undelivered) {
      const ok = await LeaderboardService.sendRewardNotification(board.id, entry, { month, year });
      if (!ok) remaining++;
    }
    return remaining;
  }

  /** Persists badge links / reward points of snapshot entries (never touches rank or points). One fenced transaction. */
  private static async persistEntryRewards(
    ctx: LockContext,
    entries: Array<{ userId: string; rewardBadgeId: string | null; rewardPoints: number }>
  ) {
    const linked = entries.filter((e) => e.rewardBadgeId);
    if (linked.length === 0) return;
    await LeaderboardService.fencedTx(ctx, async (tx) => {
      for (const entry of linked) {
        await tx.leaderboardEntry.updateMany({
          where: { leaderboardId: ctx.periodId, userId: entry.userId },
          data: { rewardBadgeId: entry.rewardBadgeId, rewardPoints: entry.rewardPoints },
        });
      }
    });
  }

  /** Entries that were not rewarded because the learner is not eligible: reflect it on the entry and in the audit log (fenced). */
  private static async recordIneligibleSkips(ctx: LockContext, skipped: Array<{ userId: string; rank: number; reason: string }>) {
    const { month, year } = ctx;
    for (const s of skipped) {
      try {
        await LeaderboardService.fencedTx(ctx, async (tx) => {
          await tx.leaderboardEntry.updateMany({ where: { leaderboardId: ctx.periodId, userId: s.userId }, data: { rewardPoints: 0 } });
          const action = 'REWARD_SKIPPED_INELIGIBLE';
          const already = await tx.leaderboardAuditLog.findFirst({ where: { action, targetUserId: s.userId, month, year } });
          if (already) return;
          await tx.leaderboardAuditLog.create({
            data: {
              adminId: '000000000000000000000000',
              adminEmail: 'system@umi.local',
              action,
              targetUserId: s.userId,
              month,
              year,
              reason: `Rank #${s.rank} reward not issued: learner is not eligible (${s.reason}). The frozen ranking was not changed and the reward was not redistributed.`,
              details: { rank: s.rank, reason: s.reason } as any,
            },
          });
        });
      } catch (e) {
        if (e instanceof LockLostError) throw e;
        logger.error('Failed to record skipped ineligible reward:', e);
      }
    }
  }

  /**
   * Durable record of an unfinished period (visible in the admin audit log). Best effort, fenced, and written once
   * per distinct set of failures (a reconciliation loop that keeps retrying must not flood the log).
   */
  private static async recordIncompleteRewards(ctx: LockContext, failures: RewardFailure[], verifiedPoints: number, expectedPoints: number) {
    const { month, year } = ctx;
    const action = 'FINALIZE_REWARDS_INCOMPLETE';
    const signature = `${[...failures].map((f) => `${f.userId}:${f.step}`).sort().join(',')}|${verifiedPoints}|${expectedPoints}`;
    try {
      await LeaderboardService.fencedTx(ctx, async (tx) => {
        const previous = await tx.leaderboardAuditLog.findMany({ where: { action, month, year } });
        if (previous.some((p: any) => p.details?.signature === signature)) return;
        await tx.leaderboardAuditLog.create({
          data: {
            adminId: '000000000000000000000000',
            adminEmail: 'system@umi.local',
            action,
            month,
            year,
            reason: `${failures.length} required reward step(s) failed; the period stays REWARDING and can be retried safely.`,
            details: { failures, verifiedPoints, expectedPoints, signature } as any,
          },
        });
      });
    } catch (e) {
      if (e instanceof LockLostError) throw e;
      logger.error('Failed to record incomplete rewards:', e);
    }
  }

  /**
   * Check and finalize all missing unfinalized past months in chronological order.
   * Called on startup, by the monthly cron job and by the periodic reconciliation. Every call goes through the same
   * plain lock acquire as an admin request: a month owned by a live process is skipped (BUSY), a month whose owner
   * died becomes available as soon as its lease has lapsed, and FINALIZED months are never touched.
   */
  static async checkAndFinalizeAllPastMonths(options: { initiator?: string } = {}): Promise<{ finalizedMonths: string[]; busyMonths: string[] }> {
    const initiator = options.initiator ?? 'SYSTEM_STARTUP_CATCHUP';
    const { month: curMonth, year: curYear } = getCurrentVietnamMonthYear();
    const finalizedMonths: string[] = [];
    const busyMonths: string[] = [];

    // Find all past months from the last 12 months up to previous month
    const pastMonths: { month: number; year: number }[] = [];
    let checkMonth = curMonth - 1;
    let checkYear = curYear;
    if (checkMonth < 1) {
      checkMonth = 12;
      checkYear = curYear - 1;
    }

    // Go back up to 6 past months (Semester period) to ensure no missed months
    for (let i = 0; i < 6; i++) {
      pastMonths.unshift({ month: checkMonth, year: checkYear });
      checkMonth--;
      if (checkMonth < 1) {
        checkMonth = 12;
        checkYear--;
      }
    }

    // Process past months strictly in chronological order (one at a time: concurrency 1 per process; across
    // processes the per-period lock keeps owners apart)
    for (const { month, year } of pastMonths) {
      const existing = await prisma.monthlyLeaderboard.findUnique({
        where: { month_year: { month, year } },
      });

      if (!existing || existing.status !== 'FINALIZED') {
        logger.info(`🏆 Past month ${month}/${year} not finalized. Finalizing now...`);
        try {
          const res = await this.finalizeMonth(month, year, initiator);
          if (res.status === 'FINALIZED') {
            finalizedMonths.push(`${month}/${year}`);
          } else if (res.status === 'BUSY') {
            busyMonths.push(`${month}/${year}`);
          }
        } catch (err) {
          logger.error(`Failed to catch-up finalize month ${month}/${year}:`, err);
        }
      } else {
        await this.retryFailedNotifications(month, year).catch((err) =>
          logger.warn(`Failed to retry notifications for ${month}/${year}:`, err)
        );
      }
    }

    return { finalizedMonths, busyMonths };
  }

  /**
   * Get available finalized months for history navigation.
   */
  static async getAvailableMonths(): Promise<{ month: number; year: number; status: string }[]> {
    const leaderboards = await prisma.monthlyLeaderboard.findMany({
      where: { status: 'FINALIZED' },
      select: { month: true, year: true, status: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return leaderboards;
  }
}
