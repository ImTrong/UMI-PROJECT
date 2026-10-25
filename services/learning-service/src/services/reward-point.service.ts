import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { FenceGuard, LockLostError } from './leaderboard-lock.service';
import {
  CourseRedemptionService,
  COURSE_REDEMPTION_POINTS,
  ensureWallet,
  runTx,
  isUniqueViolation,
} from './course-redemption.service';

const prisma = new PrismaClient();

/** Actor recorded on audit rows written by the system itself (all-zero ObjectId; not a real admin). */
const SYSTEM_ACTOR_ID = '000000000000000000000000';

// Official, server-side price of redeeming ONE course (defined next to the redemption state machine).
export { COURSE_REDEMPTION_POINTS };

export class RewardPointService {
  /**
   * Get user's reward point balance. Creates record with 0 balance if not exists.
   */
  static async getUserPoints(userId: string) {
    return ensureWallet(userId);
  }

  /**
   * Award reward points for leaderboard ranking.
   *
   * ATOMIC: the duplicate check, the wallet increment and the ledger entry are ONE database
   * transaction - they all commit or all roll back. No network call happens inside it.
   * IDEMPOTENT: one reward per user per month (stable key). A retry - after a crash, a lost
   * response or a concurrent run - never adds points again; it returns the committed entry.
   * CONCURRENT: the balance is raised with an atomic increment and balanceAfter is read inside the
   * same transaction, so two awards for one wallet serialize (write conflict -> bounded retry).
   * FENCED (FIX 06B2): when `guard` (the finalize LockContext) is given, the FIRST statement of every transaction
   * attempt is the lock fence. A process that lost the period lock (expired, taken over, period finalized) gets a
   * LockLostError and writes nothing - no wallet, no ledger entry. A retried attempt fences again. Without a guard
   * the behaviour is exactly the former one.
   */
  /** Stable idempotency key of the (single) leaderboard reward of a user for a period. */
  static leaderboardRewardKey(userId: string, month: number, year: number) {
    return `reward_lb_month_${month}_year_${year}_user_${userId}`;
  }

  static async awardLeaderboardPoints(
    userId: string,
    points: number,
    leaderboardId: string,
    rank: number,
    month: number,
    year: number,
    guard?: FenceGuard
  ) {
    if (points <= 0) return null;
    if (!Number.isSafeInteger(points)) {
      throw new Error(`Invalid reward amount: ${points}`);
    }
    guard?.assertAlive();

    const monthStr = month.toString().padStart(2, '0');
    // Stable idempotency key: guaranteed 1 reward per user per month regardless of rank shifts or retries
    const idempotencyKey = this.leaderboardRewardKey(userId, month, year);
    const period = { userId, leaderboardId, month, year, idempotencyKey };

    // 1. Already awarded? (read-only fast path; re-checked inside the transaction)
    const existingTx = await prisma.rewardPointTransaction.findUnique({ where: { idempotencyKey } });
    if (existingTx) return this.acceptExistingAward(existingTx, period, guard);

    // 2. Make sure the wallet exists (race-safe creation; an empty wallet is not an inconsistency).
    //    With a guard the creation itself is fenced, so a stale owner cannot create wallets either.
    if (guard) await this.ensureWalletFenced(userId, guard);
    else await ensureWallet(userId);

    // 3. Wallet + ledger in one transaction
    try {
      const outcome = await runTx(async (tx) => {
        if (guard) await guard.fence(tx); // FIRST database statement of every attempt (also of every conflict retry)
        const dup = await tx.rewardPointTransaction.findUnique({ where: { idempotencyKey } });
        if (dup) return { existing: dup };

        const credited = await tx.userRewardPoint.updateMany({
          where: { userId },
          data: { balance: { increment: points }, totalEarned: { increment: points } },
        });
        if (credited.count !== 1) throw new Error(`Reward wallet not found for user ${userId}`);

        const wallet = await tx.userRewardPoint.findUnique({ where: { userId } });
        const created = await tx.rewardPointTransaction.create({
          data: {
            userId,
            amount: points,
            type: 'LEADERBOARD_REWARD',
            description: `Thưởng Top ${rank} Bảng xếp hạng tháng ${monthStr}/${year}`,
            balanceAfter: wallet!.balance,
            sourceId: leaderboardId,
            idempotencyKey,
            metadata: { leaderboardId, rank, month, year, points },
          },
        });
        return { created };
      });

      if (outcome.existing) return this.acceptExistingAward(outcome.existing, period, guard);
      logger.info(`🎖️ Awarded ${points} points to user ${userId} (${monthStr}/${year}). New balance: ${outcome.created!.balanceAfter}`);
      return outcome.created;
    } catch (e: any) {
      if (!isUniqueViolation(e)) throw e;
      // Lost a race on the unique key: the other run's committed entry is the answer - never a second grant
      const raced = await prisma.rewardPointTransaction.findUnique({ where: { idempotencyKey } });
      if (raced) return this.acceptExistingAward(raced, period, guard);
      throw e;
    }
  }

  /** Wallet creation for a fenced award: the (rare) create happens inside a fenced transaction. */
  private static async ensureWalletFenced(userId: string, guard: FenceGuard) {
    if (await prisma.userRewardPoint.findUnique({ where: { userId } })) return;
    try {
      await runTx(async (tx) => {
        await guard.fence(tx);
        if (await tx.userRewardPoint.findUnique({ where: { userId } })) return;
        await tx.userRewardPoint.create({ data: { userId, balance: 0, totalEarned: 0, totalSpent: 0 } });
      });
    } catch (e: any) {
      if (!isUniqueViolation(e)) throw e; // another process created the wallet first: that wallet is the one
    }
  }

  /**
   * Writes an audit row at most once per (action, user, period). With a guard the check and the insert happen in one
   * fenced transaction. Best effort EXCEPT for losing the lock, which is never swallowed.
   */
  private static async writeAuditOnce(
    action: string,
    userId: string,
    month: number,
    year: number,
    data: Record<string, any>,
    guard?: FenceGuard
  ) {
    try {
      if (!guard) {
        const already = await prisma.leaderboardAuditLog.findFirst({ where: { action, targetUserId: userId, month, year } });
        if (already) return;
        await prisma.leaderboardAuditLog.create({ data: data as any });
        return;
      }
      await runTx(async (tx) => {
        await guard.fence(tx);
        const already = await tx.leaderboardAuditLog.findFirst({ where: { action, targetUserId: userId, month, year } });
        if (already) return;
        await tx.leaderboardAuditLog.create({ data: data as any });
      });
    } catch (e) {
      if (e instanceof LockLostError) throw e;
      logger.error(`Failed to record ${action}:`, e);
    }
  }

  /**
   * A ledger entry with our idempotency key exists. It must be this user's leaderboard reward for
   * this period; otherwise it is a data-integrity problem and is NOT treated as success.
   * Entries written by older code (ledger first, wallet second) may not be reflected in the wallet:
   * that is detected read-only and recorded - balances are never changed here.
   */
  private static async acceptExistingAward(
    entry: any,
    period: { userId: string; leaderboardId: string; month: number; year: number; idempotencyKey: string },
    guard?: FenceGuard
  ) {
    const meta = (entry.metadata as any) || {};
    const matches =
      entry.userId === period.userId &&
      entry.type === 'LEADERBOARD_REWARD' &&
      entry.sourceId === period.leaderboardId &&
      meta.month === period.month &&
      meta.year === period.year;
    if (!matches) {
      logger.error(`🎖️ Ledger entry ${entry.id} holds key ${period.idempotencyKey} but is not this user's reward for ${period.month}/${period.year}`);
      await this.recordRewardIntegrityIssue(period.userId, period.month, period.year, entry.id, "Entry holding the reward key is not this user's leaderboard reward for this period (user/type/leaderboard/period differs)", guard);
      throw new Error(`Ledger integrity error: entry ${entry.id} does not match the reward for ${period.idempotencyKey}`);
    }

    logger.info(`🎖️ Reward already awarded to user ${period.userId} for ${period.month}/${period.year} (tx: ${entry.id}). Skipping.`);
    await this.flagIfWalletDisagrees(period.userId, period.month, period.year, entry.id, guard);
    return entry;
  }

  /**
   * Confirms from the DATABASE (not from a return value) that the reward ledger entry of a snapshot
   * recipient exists and matches exactly: user, type, leaderboard, period, key and amount.
   * Mismatches are recorded (once) as an integrity issue; history is never modified.
   */
  static async verifyLeaderboardAward(p: {
    userId: string;
    points: number;
    leaderboardId: string;
    month: number;
    year: number;
  }, guard?: FenceGuard): Promise<
    | { ok: true; entry: any }
    | { ok: false; reason: 'MISSING' | 'MISMATCH'; detail: string }
  > {
    const key = this.leaderboardRewardKey(p.userId, p.month, p.year);
    const entry = await prisma.rewardPointTransaction.findUnique({ where: { idempotencyKey: key } });
    if (!entry) return { ok: false, reason: 'MISSING', detail: `no ledger entry for key ${key}` };

    const meta = (entry.metadata as any) || {};
    const problems: string[] = [];
    if (entry.userId !== p.userId) problems.push(`userId ${entry.userId} != ${p.userId}`);
    if (entry.type !== 'LEADERBOARD_REWARD') problems.push(`type ${entry.type}`);
    if (entry.sourceId !== p.leaderboardId) problems.push(`sourceId ${entry.sourceId} != ${p.leaderboardId}`);
    if (meta.month !== p.month || meta.year !== p.year) problems.push(`period ${meta.month}/${meta.year} != ${p.month}/${p.year}`);
    if (entry.amount !== p.points) problems.push(`amount ${entry.amount} != snapshot reward ${p.points}`);
    if (entry.idempotencyKey !== key) problems.push('idempotencyKey differs');

    if (problems.length > 0) {
      const detail = problems.join('; ');
      logger.error(`🎖️ Reward ledger entry ${entry.id} does not match the frozen snapshot: ${detail}`);
      await this.recordRewardIntegrityIssue(p.userId, p.month, p.year, entry.id, detail, guard);
      return { ok: false, reason: 'MISMATCH', detail };
    }
    return { ok: true, entry };
  }

  /** Records (once per user + period) a ledger/snapshot integrity problem. Never changes balances or ledger. */
  private static async recordRewardIntegrityIssue(userId: string, month: number, year: number, entryId: string, detail: string, guard?: FenceGuard) {
    const action = 'REWARD_INTEGRITY_ERROR';
    await this.writeAuditOnce(
      action,
      userId,
      month,
      year,
      {
        adminId: SYSTEM_ACTOR_ID,
        adminEmail: 'system@umi.local',
        action,
        targetUserId: userId,
        month,
        year,
        reason: 'A reward ledger entry conflicts with the frozen leaderboard snapshot. The period stays unfinished until this is reviewed; nothing was changed automatically.',
        details: { ledgerEntryId: entryId, detail },
      },
      guard
    );
  }

  /**
   * Read-only reconciliation of one wallet against its own ledger. Invariants (all entry types):
   *   balance     = sum(amount)
   *   totalEarned = sum(LEADERBOARD_REWARD) + sum(positive ADMIN_ADJUSTMENT)
   *   totalSpent  = sum(COURSE_REDEMPTION) + sum(negative ADMIN_ADJUSTMENT) - sum(COURSE_REDEMPTION_REFUND)
   * Never modifies anything.
   */
  static async auditWalletConsistency(userId: string) {
    const [wallet, entries] = await Promise.all([
      prisma.userRewardPoint.findUnique({ where: { userId } }),
      prisma.rewardPointTransaction.findMany({ where: { userId } }),
    ]);

    let balance = 0;
    let totalEarned = 0;
    let totalSpent = 0;
    for (const e of entries) {
      balance += e.amount;
      if (e.type === 'LEADERBOARD_REWARD') totalEarned += e.amount;
      else if (e.type === 'ADMIN_ADJUSTMENT') {
        if (e.amount > 0) totalEarned += e.amount;
        else totalSpent += -e.amount;
      } else if (e.type === 'COURSE_REDEMPTION') totalSpent += -e.amount;
      else if (e.type === 'COURSE_REDEMPTION_REFUND') totalSpent -= e.amount;
    }

    const expected = { balance, totalEarned, totalSpent };
    const actual = wallet
      ? { balance: wallet.balance, totalEarned: wallet.totalEarned, totalSpent: wallet.totalSpent }
      : null;
    const consistent =
      !!actual &&
      actual.balance === expected.balance &&
      actual.totalEarned === expected.totalEarned &&
      actual.totalSpent === expected.totalSpent;

    return {
      userId,
      consistent,
      expected,
      actual,
      difference: actual
        ? {
            balance: actual.balance - expected.balance,
            totalEarned: actual.totalEarned - expected.totalEarned,
            totalSpent: actual.totalSpent - expected.totalSpent,
          }
        : null,
      ledgerEntries: entries.length,
    };
  }

  /** Records (once per user + period) that the wallet does not match the ledger. Never adjusts balances. */
  private static async flagIfWalletDisagrees(userId: string, month: number, year: number, entryId: string, guard?: FenceGuard) {
    let audit: Awaited<ReturnType<typeof RewardPointService.auditWalletConsistency>>;
    try {
      audit = await this.auditWalletConsistency(userId);
    } catch (e) {
      // Risk recording must never turn a committed award into a failure
      logger.error('Failed to check wallet/ledger consistency:', e);
      return;
    }
    if (audit.consistent) return;

    logger.error(`🎖️ WALLET/LEDGER MISMATCH for user ${userId}: ${JSON.stringify({ expected: audit.expected, actual: audit.actual })}`);
    const action = 'REWARD_LEDGER_MISMATCH';
    await this.writeAuditOnce(
      action,
      userId,
      month,
      year,
      {
        adminId: SYSTEM_ACTOR_ID,
        adminEmail: 'system@umi.local',
        action,
        targetUserId: userId,
        month,
        year,
        reason: 'Reward ledger entry exists but the wallet does not agree with the ledger. Manual reconciliation required; no balance was changed.',
        details: { ledgerEntryId: entryId, expected: audit.expected, actual: audit.actual, difference: audit.difference },
      },
      guard
    );
  }

  /**
   * Get transaction history for a user
   */
  static async getTransactionHistory(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.rewardPointTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.rewardPointTransaction.count({ where: { userId } }),
    ]);

    const userPoints = await this.getUserPoints(userId);

    return {
      balance: userPoints.balance,
      totalEarned: userPoints.totalEarned,
      totalSpent: userPoints.totalSpent,
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Redeem points to enroll in a course.
   * The price is ALWAYS COURSE_REDEMPTION_POINTS (decided by the backend); callers cannot supply it.
   * Debit + ledger are one DB transaction; enrollment/refund are idempotent and crash-recoverable
   * (see CourseRedemptionService for the state machine).
   */
  static async redeemCourseWithPoints(
    userId: string,
    courseId: string,
    clientRequestId?: string
  ) {
    return CourseRedemptionService.redeem(userId, courseId, clientRequestId);
  }

  /**
   * Admin point adjustment with audit logging
   */
  static async adminAdjustPoints(
    adminId: string,
    adminEmail: string,
    targetUserId: string,
    amount: number,
    reason: string
  ) {
    if (amount === 0) throw new Error('Số điểm điều chỉnh không thể bằng 0');

    const userPoints = await this.getUserPoints(targetUserId);
    const newBalance = userPoints.balance + amount;
    if (newBalance < 0) {
      throw new Error(`Số dư sau điều chỉnh không thể âm (Hiện tại: ${userPoints.balance}, Điều chỉnh: ${amount})`);
    }

    const idempotencyKey = `admin_adj_${adminId}_${targetUserId}_${Date.now()}`;

    const tx = await prisma.rewardPointTransaction.create({
      data: {
        userId: targetUserId,
        amount,
        type: 'ADMIN_ADJUSTMENT',
        description: `Quản trị viên điều chỉnh: ${reason}`,
        balanceAfter: newBalance,
        sourceId: adminId,
        idempotencyKey,
        metadata: { adminId, adminEmail, reason },
      },
    });

    await prisma.userRewardPoint.update({
      where: { userId: targetUserId },
      data: {
        balance: newBalance,
        totalEarned: amount > 0 ? userPoints.totalEarned + amount : userPoints.totalEarned,
        totalSpent: amount < 0 ? userPoints.totalSpent + Math.abs(amount) : userPoints.totalSpent,
      },
    });

    // Record audit log
    await prisma.leaderboardAuditLog.create({
      data: {
        adminId,
        adminEmail,
        action: 'ADJUST_POINTS',
        targetUserId,
        reason,
        details: { amount, newBalance, txId: tx.id },
      },
    });

    return { tx, newBalance };
  }
}
