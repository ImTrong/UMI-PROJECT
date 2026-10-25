import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { HTTP_STATUS } from '../utils/constants';
import { CourseAccessError, CourseAccessService } from './course-access.service';
import { UserNotificationClient } from './user-notification.client';

const prisma = new PrismaClient();

/**
 * Official, server-side price of redeeming ONE course (see FIX 02). Clients can neither set nor override it.
 */
export const COURSE_REDEMPTION_POINTS = 500;

export const REDEMPTION_STATUS = {
  PENDING: 'PENDING_ENROLLMENT',
  COMPLETED: 'COMPLETED',
  REFUNDED: 'REFUNDED',
} as const;

// Value kept in RewardPointTransaction.metadata.redemptionStatus (unchanged vocabulary: FAILED == refunded).
const LEDGER_STATUS = { PENDING: 'PENDING_ENROLLMENT', COMPLETED: 'COMPLETED', FAILED: 'FAILED' } as const;

const MAX_REQUEST_ID_LENGTH = 200;
const TX_MAX_ATTEMPTS = 5;

/**
 * How long one processor (request or worker) owns a pending redemption. It must exceed the worst
 * case enrollment time (course-service calls time out after 5s each). Proposed default, override with env.
 */
export const REDEMPTION_LEASE_MS = parseInt(process.env.REDEMPTION_LEASE_MS || '60000', 10);

export const IDEMPOTENCY_CONFLICT = (key: string) =>
  `Xung đột khóa idempotency: Mã yêu cầu "${key}" đã được sử dụng cho một giao dịch khác.`;
export const INSUFFICIENT_BALANCE = (balance: number) =>
  `Số dư điểm thưởng không đủ. Cần ${COURSE_REDEMPTION_POINTS} điểm (Số dư hiện tại: ${balance} điểm).`;
const MSG = {
  ALREADY_OWNED: 'Bạn đã đăng ký hoặc sở hữu khóa học này.',
  OTHER_REQUEST_PENDING:
    'Khóa học này đang được đổi bằng một yêu cầu khác chưa hoàn tất. Vui lòng chờ hoặc thử lại sau.',
  PROCESSING:
    'Giao dịch đổi điểm đang được xử lý. Điểm của bạn được giữ an toàn; vui lòng thử lại với cùng mã yêu cầu sau ít giây.',
  UNRESOLVED:
    'Giao dịch đổi điểm chưa xác nhận được kết quả ghi danh nên chưa hoàn tất và chưa bị hoàn điểm. Vui lòng thử lại với cùng mã yêu cầu; hệ thống cũng sẽ tự đối soát.',
  CANNOT_RESOLVE: 'Không thể xác định trạng thái giao dịch đổi điểm. Vui lòng liên hệ quản trị viên.',
} as const;

// ---------------------------------------------------------------- helpers

/** Idempotency keys are stored per user so two users can never collide on the same clientRequestId. */
export const scopedIdempotencyKey = (userId: string, clientRequestId: string) =>
  `redeem:${userId}:${clientRequestId}`;
export const refundKeyFor = (debitIdempotencyKey: string) => `refund_${debitIdempotencyKey}`;

export const isUniqueViolation = (e: any) =>
  e?.code === 'P2002' || /Unique constraint|E11000/i.test(e?.message || '');
export const isTxConflict = (e: any) =>
  e?.code === 'P2034' || /write conflict|WriteConflict|TransientTransactionError/i.test(e?.message || '');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Interactive DB transaction with bounded retry on write conflicts (concurrent writers on the same wallet). */
export async function runTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= TX_MAX_ATTEMPTS; attempt++) {
    try {
      return await (prisma as any).$transaction(fn, { maxWait: 5000, timeout: 15000 });
    } catch (e: any) {
      lastErr = e;
      if (!isTxConflict(e) || attempt === TX_MAX_ATTEMPTS) throw e;
      await sleep(10 * attempt + Math.floor(Math.random() * 20));
    }
  }
  throw lastErr;
}

/** Wallet creation that is safe under concurrency (duplicate create falls back to a read). */
export async function ensureWallet(userId: string) {
  const existing = await prisma.userRewardPoint.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    return await prisma.userRewardPoint.create({
      data: { userId, balance: 0, totalEarned: 0, totalSpent: 0 },
    });
  } catch (e: any) {
    if (isUniqueViolation(e)) {
      const raced = await prisma.userRewardPoint.findUnique({ where: { userId } });
      if (raced) return raced;
    }
    throw e;
  }
}

type DebitTx = NonNullable<Awaited<ReturnType<typeof prisma.rewardPointTransaction.findUnique>>>;
type RedemptionRow = NonNullable<Awaited<ReturnType<typeof prisma.courseRedemption.findUnique>>>;

/**
 * Finds the debit ledger entry for (user, request id): new scoped key first, then the legacy
 * un-scoped key - accepted ONLY if it is this user's own COURSE_REDEMPTION entry.
 */
async function findDebitTx(userId: string, clientRequestId: string): Promise<DebitTx | null> {
  const scoped = await prisma.rewardPointTransaction.findUnique({
    where: { idempotencyKey: scopedIdempotencyKey(userId, clientRequestId) },
  });
  if (scoped) return scoped;

  const legacy = await prisma.rewardPointTransaction.findUnique({ where: { idempotencyKey: clientRequestId } });
  if (legacy && legacy.userId === userId && legacy.type === 'COURSE_REDEMPTION') return legacy;
  return null; // someone else's / unrelated entry is never visible to this user
}

const ledgerMeta = (tx: { metadata: unknown }) => ((tx.metadata as any) || {}) as Record<string, any>;

type ProcessOutcome =
  | { state: 'COMPLETED'; enrollment: any; newlyCompleted: boolean }
  | { state: 'REFUNDED'; error: string }
  | { state: 'BUSY' }
  | { state: 'UNRESOLVED'; error: string };

// ---------------------------------------------------------------- service

export class CourseRedemptionService {
  /**
   * Redeem points for a course. Order of operations:
   *  1. replay/idempotency lookup (per-user key)        - read only
   *  2. ownership + course eligibility (FIX 02)         - read only, before any wallet change
   *  3. ONE db transaction: claim (user,course) + conditional debit + PENDING ledger entry
   *  4. enrollment (official flow), reconciled against the database, under a processing lease
   *  5. ONE db transaction: mark COMPLETED  -or-  (only on a verified final failure) refund once
   */
  static async redeem(userId: string, courseId: string, clientRequestId?: string) {
    if (!clientRequestId || typeof clientRequestId !== 'string' || !clientRequestId.trim()) {
      throw new Error('Mã yêu cầu (clientRequestId) là bắt buộc cho thao tác đổi điểm.');
    }
    const requestId = clientRequestId.trim();
    if (requestId.length > MAX_REQUEST_ID_LENGTH) {
      throw new Error(`Mã yêu cầu (clientRequestId) tối đa ${MAX_REQUEST_ID_LENGTH} ký tự.`);
    }

    // 1. Same user + same request id -> resume the existing business transaction (never a new debit)
    const existing = await findDebitTx(userId, requestId);
    if (existing) return this.resume(userId, courseId, existing, requestId);

    // 2a. Another request (different id) already owns this course?
    const claim = await prisma.courseRedemption.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (claim && claim.status === REDEMPTION_STATUS.COMPLETED) throw new Error(MSG.ALREADY_OWNED);
    if (claim && claim.status === REDEMPTION_STATUS.PENDING) {
      throw new CourseAccessError(MSG.OTHER_REQUEST_PENDING, HTTP_STATUS.CONFLICT);
    }
    const owned = await CourseAccessService.findEnrollment(userId, courseId);
    if (owned) throw new Error(MSG.ALREADY_OWNED);

    // 2b. Course must be redeemable (published + APPROVED, valid metadata) BEFORE the wallet is touched
    await CourseAccessService.fetchRedeemableCourse(courseId);
    await ensureWallet(userId);

    // 3. Atomic: claim + conditional debit + ledger
    let created;
    try {
      created = await this.reserveAndDebit(userId, courseId, requestId);
    } catch (e: any) {
      if (!isUniqueViolation(e)) throw e;
      // Lost a race on the unique idempotency key or the (user, course) claim: re-read, never double-charge
      const raced = await findDebitTx(userId, requestId);
      if (raced) return this.resume(userId, courseId, raced, requestId);
      throw new CourseAccessError(MSG.OTHER_REQUEST_PENDING, HTTP_STATUS.CONFLICT);
    }

    if (created.kind === 'existing') return this.resume(userId, courseId, created.tx, requestId);
    if (created.kind === 'blocked') {
      if (created.row.status === REDEMPTION_STATUS.COMPLETED) throw new Error(MSG.ALREADY_OWNED);
      throw new CourseAccessError(MSG.OTHER_REQUEST_PENDING, HTTP_STATUS.CONFLICT);
    }
    if (created.kind === 'insufficient') throw new Error(INSUFFICIENT_BALANCE(created.balance));

    // 4-5. We hold the processing lease from creation
    const outcome = await this.processPending(userId, courseId, created.row, created.tx, { leaseHeld: true });
    return this.respondToOutcome(userId, courseId, created.tx, outcome, {
      fresh: true,
      remainingBalance: created.balance,
    });
  }

  // -------------------------------------------------------- step 3: atomic claim + debit + ledger

  private static async reserveAndDebit(userId: string, courseId: string, requestId: string) {
    const key = scopedIdempotencyKey(userId, requestId);
    const price = COURSE_REDEMPTION_POINTS;

    return runTx(async (tx) => {
      const dup = await tx.rewardPointTransaction.findUnique({ where: { idempotencyKey: key } });
      if (dup) return { kind: 'existing' as const, tx: dup as DebitTx };

      const claim = await tx.courseRedemption.findUnique({ where: { userId_courseId: { userId, courseId } } });
      if (claim && claim.status !== REDEMPTION_STATUS.REFUNDED) return { kind: 'blocked' as const, row: claim as RedemptionRow };

      // Balance check + decrement in ONE conditional write (no read-modify-write, no negative balance)
      const debited = await tx.userRewardPoint.updateMany({
        where: { userId, balance: { gte: price } },
        data: { balance: { decrement: price }, totalSpent: { increment: price } },
      });
      if (debited.count === 0) {
        const wallet = await tx.userRewardPoint.findUnique({ where: { userId } });
        return { kind: 'insufficient' as const, balance: wallet?.balance ?? 0 };
      }
      const wallet = await tx.userRewardPoint.findUnique({ where: { userId } });
      const balanceAfter = wallet!.balance;

      const ledger = await tx.rewardPointTransaction.create({
        data: {
          userId,
          amount: -price,
          type: 'COURSE_REDEMPTION',
          description: `Đổi điểm lấy khóa học (ID: ${courseId})`,
          balanceAfter,
          sourceId: courseId,
          idempotencyKey: key,
          metadata: { courseId, pointsRequired: price, redemptionStatus: LEDGER_STATUS.PENDING },
        },
      });

      const lease = new Date(Date.now() + REDEMPTION_LEASE_MS);
      let row: RedemptionRow;
      if (claim) {
        // previous attempt was refunded: reopen the same (user, course) claim for this new request
        const reopened = await tx.courseRedemption.updateMany({
          where: { id: claim.id, status: REDEMPTION_STATUS.REFUNDED },
          data: {
            status: REDEMPTION_STATUS.PENDING,
            pointsCharged: price,
            transactionId: ledger.id,
            refundTransactionId: null,
            leaseUntil: lease,
            lastError: null,
            attempts: 1,
          },
        });
        if (reopened.count !== 1) throw new Error('Redemption claim changed concurrently'); // rolls everything back
        row = (await tx.courseRedemption.findUnique({ where: { id: claim.id } }))!;
      } else {
        row = await tx.courseRedemption.create({
          data: {
            userId,
            courseId,
            status: REDEMPTION_STATUS.PENDING,
            pointsCharged: price,
            transactionId: ledger.id,
            leaseUntil: lease,
            attempts: 1,
          },
        });
      }
      return { kind: 'created' as const, tx: ledger as DebitTx, row, balance: balanceAfter };
    });
  }

  // -------------------------------------------------------- replay / resume of an existing business transaction

  private static async resume(userId: string, courseId: string, debit: DebitTx, requestId: string) {
    if (debit.userId !== userId || debit.sourceId !== courseId) {
      throw new Error(IDEMPOTENCY_CONFLICT(requestId));
    }

    const { state, row } = await this.resolveState(userId, courseId, debit);

    if (state === REDEMPTION_STATUS.COMPLETED) {
      return this.respondToOutcome(userId, courseId, debit, { state: 'COMPLETED', enrollment: null, newlyCompleted: false }, { fresh: false });
    }
    if (state === REDEMPTION_STATUS.REFUNDED) {
      return this.respondRefundedReplay(userId, debit);
    }

    // PENDING_ENROLLMENT: never reported as completed without evidence -> verify / finish it now
    if (!row) throw new CourseAccessError(MSG.CANNOT_RESOLVE, HTTP_STATUS.SERVICE_UNAVAILABLE);
    const outcome = await this.processPending(userId, courseId, row, debit, { leaseHeld: false });
    return this.respondToOutcome(userId, courseId, debit, outcome, { fresh: false });
  }

  /**
   * Source of truth: the CourseRedemption row if it points at this debit. For ledger entries written
   * before FIX 03 (no row), the state is derived from the ledger and an open one is adopted.
   */
  private static async resolveState(userId: string, courseId: string, debit: DebitTx) {
    const row = await prisma.courseRedemption.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (row && row.transactionId === debit.id) return { state: row.status, row };

    // legacy (or superseded) entry: derive from the ledger itself
    const refund = debit.idempotencyKey
      ? await prisma.rewardPointTransaction.findUnique({ where: { idempotencyKey: refundKeyFor(debit.idempotencyKey) } })
      : null;
    const status = ledgerMeta(debit).redemptionStatus;
    if (refund || status === LEDGER_STATUS.FAILED) return { state: REDEMPTION_STATUS.REFUNDED as string, row: null };
    if (status === LEDGER_STATUS.COMPLETED) return { state: REDEMPTION_STATUS.COMPLETED as string, row: null };

    // legacy PENDING: adopt into the new state machine (needs a free (user, course) slot)
    if (row) return { state: REDEMPTION_STATUS.PENDING as string, row: null }; // slot used by another redemption -> unresolved
    const adopted = await this.adoptLegacyPending(debit);
    return { state: REDEMPTION_STATUS.PENDING as string, row: adopted.row };
  }

  private static async adoptLegacyPending(debit: DebitTx): Promise<{ row: RedemptionRow | null; created: boolean }> {
    if (!debit.sourceId) return { row: null, created: false };
    try {
      const row = await prisma.courseRedemption.create({
        data: {
          userId: debit.userId,
          courseId: debit.sourceId,
          status: REDEMPTION_STATUS.PENDING,
          pointsCharged: Math.abs(debit.amount),
          transactionId: debit.id,
          leaseUntil: null,
        },
      });
      return { row, created: true };
    } catch (e: any) {
      if (!isUniqueViolation(e)) throw e;
      const row = await prisma.courseRedemption.findUnique({
        where: { userId_courseId: { userId: debit.userId, courseId: debit.sourceId } },
      });
      return { row: row && row.transactionId === debit.id ? row : null, created: false };
    }
  }

  // -------------------------------------------------------- steps 4-5: enrollment, completion, refund

  /**
   * Drives one PENDING redemption to a terminal state. Safe to call from requests and from the
   * recovery worker at the same time: a DB lease admits a single processor.
   */
  static async processPending(
    userId: string,
    courseId: string,
    row: RedemptionRow,
    debit: DebitTx,
    opts: { leaseHeld: boolean }
  ): Promise<ProcessOutcome> {
    if (!opts.leaseHeld && !(await this.acquireLease(row.id))) return { state: 'BUSY' };

    try {
      // Reconcile against the real enrollment first: it is the only evidence that matters.
      let enrollment: any = await CourseAccessService.findEnrollment(userId, courseId);
      let failure: any = null;

      if (!enrollment) {
        try {
          const { ProgressService } = require('./progress.service');
          enrollment = await ProgressService.enrollInCourse(userId, courseId, true);
        } catch (err: any) {
          failure = err;
          // The call may have succeeded server-side (timeout, lost response...): re-check before judging.
          enrollment = await CourseAccessService.findEnrollment(userId, courseId);
        }
      }

      if (enrollment) {
        const done = await this.markCompleted(row, debit);
        if (done.newlyCompleted) void this.notifyCompleted(userId, courseId);
        return { state: 'COMPLETED', enrollment, newlyCompleted: done.newlyCompleted };
      }

      if (this.isFinalEnrollmentFailure(failure)) {
        await this.refund(row, debit, failure.message);
        return { state: 'REFUNDED', error: failure.message };
      }

      // Unknown outcome (service down, transient DB error...): keep PENDING, never refund on a guess.
      const message = failure?.message || 'enrollment not confirmed';
      await prisma.courseRedemption
        .updateMany({ where: { id: row.id, status: REDEMPTION_STATUS.PENDING }, data: { lastError: String(message).slice(0, 500) } })
        .catch(() => undefined);
      return { state: 'UNRESOLVED', error: message };
    } catch (e: any) {
      // e.g. enrollment OK but the status update failed: stay PENDING, no refund, retry reconciles.
      logger.error(`Redemption ${row.id} left PENDING after processing error: ${e?.message}`);
      await prisma.courseRedemption
        .updateMany({ where: { id: row.id, status: REDEMPTION_STATUS.PENDING }, data: { lastError: String(e?.message).slice(0, 500) } })
        .catch(() => undefined);
      return { state: 'UNRESOLVED', error: e?.message || 'processing error' };
    } finally {
      await this.releaseLease(row.id);
    }
  }

  /** Only a definitive "no such / not enrollable course" answer from course-service permits a refund. */
  private static isFinalEnrollmentFailure(err: any): boolean {
    return (
      err instanceof CourseAccessError &&
      (err.statusCode === HTTP_STATUS.NOT_FOUND || err.statusCode === HTTP_STATUS.FORBIDDEN)
    );
  }

  private static async acquireLease(rowId: string): Promise<boolean> {
    const now = new Date();
    const res = await prisma.courseRedemption.updateMany({
      where: {
        id: rowId,
        status: REDEMPTION_STATUS.PENDING,
        // `null` only matches an explicit null in Mongo; `isSet: false` matches rows where the field is absent
        OR: [{ leaseUntil: null }, { leaseUntil: { isSet: false } }, { leaseUntil: { lt: now } }],
      },
      data: { leaseUntil: new Date(now.getTime() + REDEMPTION_LEASE_MS), attempts: { increment: 1 } },
    });
    return res.count === 1;
  }

  private static async releaseLease(rowId: string) {
    await prisma.courseRedemption
      .updateMany({ where: { id: rowId, status: REDEMPTION_STATUS.PENDING }, data: { leaseUntil: null } })
      .catch(() => undefined);
  }

  /** PENDING -> COMPLETED and ledger status, in one DB transaction. Idempotent. */
  private static async markCompleted(row: RedemptionRow, debit: DebitTx) {
    return runTx(async (tx) => {
      const flipped = await tx.courseRedemption.updateMany({
        where: { id: row.id, status: REDEMPTION_STATUS.PENDING },
        data: { status: REDEMPTION_STATUS.COMPLETED, leaseUntil: null, lastError: null },
      });
      if (flipped.count === 0) {
        const current = await tx.courseRedemption.findUnique({ where: { id: row.id } });
        if (current?.status === REDEMPTION_STATUS.COMPLETED) return { newlyCompleted: false };
        throw new Error(`Redemption ${row.id} is ${current?.status}, cannot mark COMPLETED`);
      }
      const ledger = await tx.rewardPointTransaction.findUnique({ where: { id: debit.id } });
      await tx.rewardPointTransaction.update({
        where: { id: debit.id },
        data: {
          metadata: {
            ...ledgerMeta(ledger || debit),
            courseId: row.courseId,
            redemptionStatus: LEDGER_STATUS.COMPLETED,
            enrolledAt: new Date().toISOString(),
          },
        },
      });
      return { newlyCompleted: true };
    });
  }

  /**
   * Refund exactly what was charged, exactly once: the PENDING->REFUNDED flip, the wallet credit,
   * the refund ledger entry (unique key derived from the debit) and the debit's FAILED status
   * commit together or not at all.
   */
  private static async refund(row: RedemptionRow, debit: DebitTx, reason: string) {
    const refundKey = refundKeyFor(debit.idempotencyKey || `tx_${debit.id}`);
    const amount = Math.abs(debit.amount);

    await runTx(async (tx) => {
      const flipped = await tx.courseRedemption.updateMany({
        where: { id: row.id, status: REDEMPTION_STATUS.PENDING },
        data: { status: REDEMPTION_STATUS.REFUNDED, leaseUntil: null, lastError: String(reason).slice(0, 500) },
      });
      if (flipped.count === 0) return; // someone else already finished it: nothing to do

      // Last guard inside the transaction: never refund a learner who actually has access
      const enrolled = await tx.courseProgress.findUnique({
        where: { userId_courseId: { userId: row.userId, courseId: row.courseId } },
      });
      if (enrolled) throw new Error('Enrollment appeared during refund; refund aborted');

      const already = await tx.rewardPointTransaction.findUnique({ where: { idempotencyKey: refundKey } });
      let refundTxId: string | undefined = already?.id;
      if (!already) {
        await tx.userRewardPoint.updateMany({
          where: { userId: row.userId },
          data: { balance: { increment: amount }, totalSpent: { decrement: amount } },
        });
        const wallet = await tx.userRewardPoint.findUnique({ where: { userId: row.userId } });
        const refundTx = await tx.rewardPointTransaction.create({
          data: {
            userId: row.userId,
            amount,
            type: 'COURSE_REDEMPTION_REFUND',
            description: `Hoàn điểm đổi khóa học do lỗi ghi danh (Khóa: ${row.courseId})`,
            balanceAfter: wallet!.balance,
            sourceId: row.courseId,
            idempotencyKey: refundKey,
            metadata: { courseId: row.courseId, originalTxId: debit.id, error: reason },
          },
        });
        refundTxId = refundTx.id;
      }
      await tx.courseRedemption.update({ where: { id: row.id }, data: { refundTransactionId: refundTxId } });
      await tx.rewardPointTransaction.update({
        where: { id: debit.id },
        data: {
          metadata: {
            ...ledgerMeta(debit),
            courseId: row.courseId,
            redemptionStatus: LEDGER_STATUS.FAILED,
            refundIdempotencyKey: refundKey,
            error: reason,
          },
        },
      });
    });
  }

  // -------------------------------------------------------- responses

  private static async respondToOutcome(
    userId: string,
    courseId: string,
    debit: DebitTx,
    outcome: ProcessOutcome,
    ctx: { fresh: boolean; remainingBalance?: number }
  ) {
    switch (outcome.state) {
      case 'COMPLETED': {
        const wallet = await ensureWallet(userId);
        const transaction = (await prisma.rewardPointTransaction.findUnique({ where: { id: debit.id } })) || debit;
        if (ctx.fresh) {
          return {
            success: true,
            transaction,
            pointsCharged: Math.abs(debit.amount),
            remainingBalance: ctx.remainingBalance ?? wallet.balance,
            enrollment: outcome.enrollment,
          };
        }
        return {
          success: true,
          transaction,
          pointsCharged: Math.abs(debit.amount),
          remainingBalance: wallet.balance,
          isIdempotentReplay: true,
          status: 'ALREADY_COMPLETED',
          message: 'Khóa học đã được đổi thành công trong yêu cầu trước đó.',
        };
      }
      case 'REFUNDED':
        if (ctx.fresh) {
          throw new Error(`Đổi điểm thất bại khi ghi danh khóa học: ${outcome.error}. Điểm đã được hoàn lại ví của bạn.`);
        }
        return this.respondRefundedReplay(userId, debit);
      case 'BUSY':
        throw new CourseAccessError(MSG.PROCESSING, HTTP_STATUS.SERVICE_UNAVAILABLE);
      default:
        throw new CourseAccessError(MSG.UNRESOLVED, HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
  }

  private static async respondRefundedReplay(userId: string, debit: DebitTx) {
    const wallet = await ensureWallet(userId);
    const transaction = (await prisma.rewardPointTransaction.findUnique({ where: { id: debit.id } })) || debit;
    const refundTransaction = debit.idempotencyKey
      ? await prisma.rewardPointTransaction.findUnique({ where: { idempotencyKey: refundKeyFor(debit.idempotencyKey) } })
      : null;
    return {
      success: false,
      transaction,
      refundTransaction,
      remainingBalance: wallet.balance,
      isIdempotentReplay: true,
      status: 'ALREADY_REFUNDED',
      message:
        'Yêu cầu đổi điểm này trước đó đã thất bại và số điểm đã được hoàn lại ví. Vui lòng tạo yêu cầu mới nếu muốn thử lại.',
    };
  }

  private static async notifyCompleted(userId: string, courseId: string) {
    try {
      await UserNotificationClient.send({
        userId,
        title: '🎁 Đổi khóa học thành công!',
        message: `Bạn đã dùng ${COURSE_REDEMPTION_POINTS} điểm thưởng để đổi thành công khóa học. Hãy bắt đầu học ngay!`,
        type: 'SUCCESS',
        link: `/learn/${courseId}`,
      });
    } catch (notifErr) {
      logger.warn('Failed to send redemption notification:', notifErr);
    }
  }

  // -------------------------------------------------------- recovery (used by the worker)

  /**
   * Re-drives redemptions that have been PENDING and idle for longer than `staleMs`. Never refunds
   * unless enrollment is verified as definitively impossible; safe with several instances.
   */
  static async recoverStale(staleMs: number, limit = 25) {
    const cutoff = new Date(Date.now() - staleMs);
    const rows = await prisma.courseRedemption.findMany({
      where: { status: REDEMPTION_STATUS.PENDING, updatedAt: { lt: cutoff } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });

    const summary = { examined: rows.length, completed: 0, refunded: 0, unresolved: 0, busy: 0 };
    for (const row of rows) {
      try {
        const debit = await prisma.rewardPointTransaction.findUnique({ where: { id: row.transactionId } });
        if (!debit) {
          logger.error(`Redemption ${row.id} references missing ledger entry ${row.transactionId}; manual review needed`);
          summary.unresolved++;
          continue;
        }
        const outcome = await this.processPending(row.userId, row.courseId, row, debit, { leaseHeld: false });
        if (outcome.state === 'COMPLETED') summary.completed++;
        else if (outcome.state === 'REFUNDED') summary.refunded++;
        else if (outcome.state === 'BUSY') summary.busy++;
        else summary.unresolved++;
      } catch (e: any) {
        summary.unresolved++;
        logger.error(`Redemption recovery failed for ${row.id}: ${e?.message}`);
      }
    }
    return summary;
  }

  /**
   * One-off sweep for PENDING ledger entries written before FIX 03 (no CourseRedemption row yet):
   * adopts them so the normal recovery path can finish them. Read-mostly; creates rows only.
   */
  static async adoptLegacyPendingEntries(pageSize = 500) {
    let cursor: string | undefined;
    let adopted = 0;
    for (;;) {
      const page = await prisma.rewardPointTransaction.findMany({
        where: { type: 'COURSE_REDEMPTION' },
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;

      for (const entry of page) {
        if (ledgerMeta(entry).redemptionStatus !== LEDGER_STATUS.PENDING) continue;
        const { created } = await this.adoptLegacyPending(entry);
        if (created) adopted++;
      }
      if (page.length < pageSize) break;
    }
    return { adopted };
  }
}
