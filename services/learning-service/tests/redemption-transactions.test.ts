/**
 * FIX 03 regression tests: atomic redemption, idempotency and crash recovery.
 * Real service code against the in-memory transactional Prisma fake (rollback on throw, serialized
 * transactions, failure injection) and a stubbed course-service. The same invariants are checked on
 * a real MongoDB replica set by tests/integration/redemption.mongo.test.ts.
 *
 * Run: npm test
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePrisma, db } from './helpers/fake-prisma';
import { useRandomInternalToken, useRandomCourseLearningToken } from './helpers/internal-token';

installFakePrisma();
useRandomCourseLearningToken(); // FIX-INS-06: the learning -> course lessons lookup needs COURSE_LEARNING_TOKEN
// the completion notification is sent through the shared client, which refuses to send without the internal service token
const INTERNAL_TOKEN = useRandomInternalToken();

/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require('axios').default || require('axios');
const logger = require('../src/utils/logger').default;
const { RewardPointService } = require('../src/services/reward-point.service');
const { CourseRedemptionService, scopedIdempotencyKey, refundKeyFor } = require('../src/services/course-redemption.service');

logger.transports.forEach((t: any) => { t.silent = true; });

const ALICE = 'a1'.repeat(12);
const BOB = 'b2'.repeat(12);
const COURSE = 'd4'.repeat(12);
const COURSE_B = 'e5'.repeat(12);
const PRICE = 500;

// ---------- course-service stub ----------
type CourseStub = {
  course?: any; networkError?: boolean; status?: number; lessonsStatus?: number;
  vanishAfterFetches?: number; fetches?: number;
};
const courses = new Map<string, CourseStub>();
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const goodCourse = (id: string, over: Record<string, any> = {}) => ({
  id, title: `Course ${id}`, price: 1_200_000, published: true, approvalStatus: 'APPROVED', ...over,
});
let notifications = 0;
let notificationCalls: Array<{ url: string; body: any; config: any }> = [];

beforeEach(() => {
  db.reset();
  courses.clear();
  notifications = 0;
  notificationCalls = [];
  courses.set(COURSE, { course: goodCourse(COURSE) });
  courses.set(COURSE_B, { course: goodCourse(COURSE_B) });
  mock.method(axios, 'get', async (url: string) => {
    const m = url.match(/\/api\/courses\/(?:internal\/)?([^/]+?)(\/lessons)?$/);
    const stub = m ? courses.get(m[1]) : undefined;
    if (!stub) throw httpError(404);
    if (stub.networkError) throw Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' });
    if (stub.status && stub.status >= 400) throw httpError(stub.status);
    if (!m![2] && stub.vanishAfterFetches !== undefined) {
      stub.fetches = (stub.fetches ?? 0) + 1;
      if (stub.fetches > stub.vanishAfterFetches) throw httpError(404);
    }
    if (m![2]) {
      if (stub.lessonsStatus) throw httpError(stub.lessonsStatus);
      return { data: { data: [{ id: 'L1', title: 'Lesson 1' }] } };
    }
    return { data: { data: stub.course } };
  });
  mock.method(axios, 'post', async (url: string, body: any, config: any) => { notifications++; notificationCalls.push({ url, body, config }); return { data: {} }; });
});
afterEach(() => mock.restoreAll());

// ---------- helpers ----------
let seq = 0;
const key = () => `tx_req_${++seq}_${Date.now()}`;
const wallet = (u: string) => db.tables.userRewardPoint.find((w) => w.userId === u);
const seedWallet = (u: string, balance: number, totalSpent = 0) =>
  db.seed('userRewardPoint', { userId: u, balance, totalEarned: balance + totalSpent, totalSpent });
const ledger = (u: string, type?: string) =>
  db.tables.rewardPointTransaction.filter((t) => t.userId === u && (!type || t.type === type));
const rows = (u: string, c = COURSE) => db.tables.courseRedemption.filter((r) => r.userId === u && r.courseId === c);
const enrolled = (u: string, c = COURSE) => db.tables.courseProgress.filter((p) => p.userId === u && p.courseId === c);
const enrollLogs = () => db.tables.activityLog.filter((a) => a.action === 'COURSE_ENROLL').length;

const redeem = async (userId: string, courseId: string, requestId: string) => {
  try {
    return { ok: true as const, value: await RewardPointService.redeemCourseWithPoints(userId, courseId, requestId) };
  } catch (error: any) {
    return { ok: false as const, error };
  }
};

/** A debit that was written but whose enrollment never finished (server died after the transaction). */
const seedPending = (userId: string, requestId: string, over: { courseId?: string; legacy?: boolean; stale?: boolean; leaseUntil?: Date | null; withRow?: boolean } = {}) => {
  const courseId = over.courseId ?? COURSE;
  seedWallet(userId, 1000 - PRICE, PRICE);
  const idempotencyKey = over.legacy ? requestId : scopedIdempotencyKey(userId, requestId);
  const debit = db.seed('rewardPointTransaction', {
    userId, amount: -PRICE, type: 'COURSE_REDEMPTION', description: 'seed', balanceAfter: 1000 - PRICE,
    sourceId: courseId, idempotencyKey,
    metadata: { courseId, pointsRequired: PRICE, redemptionStatus: 'PENDING_ENROLLMENT' },
  });
  let row: any = null;
  if (over.withRow ?? !over.legacy) {
    row = db.seed('courseRedemption', {
      userId, courseId, status: 'PENDING_ENROLLMENT', pointsCharged: PRICE, transactionId: debit.id,
      leaseUntil: over.leaseUntil ?? null,
    });
    if (over.stale ?? true) row.updatedAt = new Date(Date.now() - 10 * 60_000);
  }
  return { debit, row, idempotencyKey };
};

const assertWalletRestored = (u: string, balance = 1000) => {
  assert.equal(wallet(u)!.balance, balance);
  assert.equal(wallet(u)!.totalSpent, 0);
};
const assertSingleDebit = (u: string, start = 1000) => {
  assert.equal(wallet(u)!.balance, start - PRICE);
  assert.equal(wallet(u)!.totalSpent, PRICE);
  assert.equal(ledger(u, 'COURSE_REDEMPTION').length, 1);
  assert.equal(ledger(u, 'COURSE_REDEMPTION')[0].amount, -PRICE);
  assert.equal(ledger(u, 'COURSE_REDEMPTION')[0].balanceAfter, start - PRICE);
  assert.equal(ledger(u, 'COURSE_REDEMPTION_REFUND').length, 0);
};

// ====================================================================================

describe('TX: debit + ledger + claim are one transaction', () => {
  it('TX-01 ledger insert fails after the debit -> everything rolls back, balance untouched', async () => {
    seedWallet(ALICE, 1000);
    db.failNext('rewardPointTransaction', 'create');
    const r = await redeem(ALICE, COURSE, key());
    assert.equal(r.ok, false);
    assertWalletRestored(ALICE);
    assert.equal(ledger(ALICE).length, 0);
    assert.equal(rows(ALICE).length, 0, 'no claim row left behind');
    assert.equal(enrolled(ALICE).length, 0);
    assert.ok(db.rollbacks >= 1, 'the transaction was actually rolled back');
  });

  it('TX-01 claim insert fails after debit+ledger -> debit and ledger roll back too', async () => {
    seedWallet(ALICE, 1000);
    db.failNext('courseRedemption', 'create');
    const r = await redeem(ALICE, COURSE, key());
    assert.equal(r.ok, false);
    assertWalletRestored(ALICE);
    assert.equal(ledger(ALICE).length, 0);
    assert.equal(rows(ALICE).length, 0);
  });

  it('TX-02 completed transaction + same key again -> stored success, no second debit', async () => {
    seedWallet(ALICE, 1000);
    const k = key();
    const first = await redeem(ALICE, COURSE, k);
    assert.equal(first.ok, true);
    assert.equal(rows(ALICE)[0].status, 'COMPLETED');
    assert.equal(ledger(ALICE)[0].metadata.redemptionStatus, 'COMPLETED');

    const again = await redeem(ALICE, COURSE, k);
    assert.equal(again.ok, true);
    assert.equal((again as any).value.status, 'ALREADY_COMPLETED');
    assert.equal((again as any).value.pointsCharged, PRICE);
    assertSingleDebit(ALICE);
    assert.equal(enrolled(ALICE).length, 1);
    assert.equal(notifications, 1, 'completion notification sent once');
  });

  it('TX-12 first redemption with no wallet -> wallet created safely, rejected with 0 balance, never negative', async () => {
    const r = await redeem(ALICE, COURSE, key());
    assert.equal(r.ok, false);
    assert.match((r as any).error.message, /không đủ/);
    assert.equal(db.count('userRewardPoint'), 1);
    assert.equal(wallet(ALICE)!.balance, 0);
    assert.equal(ledger(ALICE).length, 0);
    assert.equal(rows(ALICE).length, 0);
  });

  it('TX-12 concurrent first-time wallet creation -> a single wallet', async () => {
    await Promise.all(Array.from({ length: 6 }, () => RewardPointService.getUserPoints(ALICE)));
    assert.equal(db.count('userRewardPoint'), 1);
  });

  it('TX-13 course-service timeout before the transaction -> no debit, no ledger, no claim, no wallet', async () => {
    courses.set(COURSE, { networkError: true });
    const r = await redeem(ALICE, COURSE, key());
    assert.equal(r.ok, false);
    assert.equal((r as any).error.statusCode, 503);
    assert.equal(db.count('userRewardPoint'), 0);
    assert.equal(db.count('rewardPointTransaction'), 0);
    assert.equal(db.count('courseRedemption'), 0);
    assert.equal(db.rollbacks, 0);
  });
});

describe('TX: PENDING_ENROLLMENT is never reported as completed without evidence', () => {
  it('TX-03 pending + not enrolled + enrollment outcome unknown -> 503, stays PENDING, NO refund, NO success', async () => {
    const { debit, row } = seedPending(ALICE, 'k-pending', { stale: false });
    courses.set(COURSE, { course: goodCourse(COURSE), lessonsStatus: 500 }); // enrollment cannot be confirmed

    const r = await redeem(ALICE, COURSE, 'k-pending');
    assert.equal(r.ok, false);
    assert.equal((r as any).error.statusCode, 503);
    assert.equal(db.tables.courseRedemption[0].status, 'PENDING_ENROLLMENT');
    assert.equal(db.tables.courseRedemption[0].leaseUntil, null, 'lease released so a retry can continue');
    assert.equal(db.tables.rewardPointTransaction.find((t) => t.id === debit.id)!.metadata.redemptionStatus, 'PENDING_ENROLLMENT');
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION_REFUND').length, 0);
    assert.equal(enrolled(ALICE).length, 0);
    assert.equal(wallet(ALICE)!.balance, 500);

    // the service recovers -> the SAME key finishes the redemption safely
    courses.set(COURSE, { course: goodCourse(COURSE) });
    const retry = await redeem(ALICE, COURSE, 'k-pending');
    assert.equal(retry.ok, true);
    assert.equal((retry as any).value.status, 'ALREADY_COMPLETED');
    assert.equal(enrolled(ALICE).length, 1);
    assert.equal(db.tables.courseRedemption[0].status, 'COMPLETED');
    assert.equal(wallet(ALICE)!.balance, 500, 'no extra debit, no refund');
    assert.equal(ledger(ALICE).length, 1);
    assert.equal(row.id, db.tables.courseRedemption[0].id);
  });

  it('TX-04 pending + enrollment already exists -> just marked COMPLETED (no re-enroll, no debit, no refund)', async () => {
    seedPending(ALICE, 'k-owned', { stale: false });
    db.seed('courseProgress', { userId: ALICE, courseId: COURSE, courseTitle: 't', totalLessons: 1 });

    const r = await redeem(ALICE, COURSE, 'k-owned');
    assert.equal(r.ok, true);
    assert.equal((r as any).value.status, 'ALREADY_COMPLETED');
    assert.equal(db.tables.courseRedemption[0].status, 'COMPLETED');
    assert.equal(ledger(ALICE)[0].metadata.redemptionStatus, 'COMPLETED');
    assert.equal(enrolled(ALICE).length, 1);
    assert.equal(enrollLogs(), 0, 'enrollment was not performed a second time');
    assert.equal(wallet(ALICE)!.balance, 500);
    assert.equal(wallet(ALICE)!.totalSpent, PRICE);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION_REFUND').length, 0);
  });

  it('TX-05 enrollment succeeds but the status update fails -> no refund, retry reconciles and completes', async () => {
    seedWallet(ALICE, 1000);
    const k = key();
    db.failNext('rewardPointTransaction', 'update'); // inside the "mark COMPLETED" transaction
    const first = await redeem(ALICE, COURSE, k);
    assert.equal(first.ok, false);
    assert.equal((first as any).error.statusCode, 503);
    assert.equal(enrolled(ALICE).length, 1, 'learner really is enrolled');
    assert.equal(rows(ALICE)[0].status, 'PENDING_ENROLLMENT', 'completion rolled back as a unit');
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION_REFUND').length, 0, 'NOT refunded although the call failed');
    assert.equal(wallet(ALICE)!.balance, 500);

    const retry = await redeem(ALICE, COURSE, k);
    assert.equal(retry.ok, true);
    assert.equal((retry as any).value.status, 'ALREADY_COMPLETED');
    assert.equal(rows(ALICE)[0].status, 'COMPLETED');
    assert.equal(enrolled(ALICE).length, 1);
    assert.equal(enrollLogs(), 1, 'enrolled exactly once');
    assertSingleDebit(ALICE);
  });

  it('enrollment outcome unknown (course-service down) is never turned into a refund, even by the worker', async () => {
    seedPending(ALICE, 'k-down');
    courses.set(COURSE, { course: goodCourse(COURSE), status: 500 });
    const summary = await CourseRedemptionService.recoverStale(60_000);
    assert.equal(summary.unresolved, 1);
    assert.equal(db.tables.courseRedemption[0].status, 'PENDING_ENROLLMENT');
    assert.ok(db.tables.courseRedemption[0].lastError);
    assert.ok(db.tables.courseRedemption[0].attempts >= 1);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION_REFUND').length, 0);
    assert.equal(wallet(ALICE)!.balance, 500);
  });
});

describe('TX: refund exactly once, only on a verified final failure', () => {
  it('TX-06 final enrollment failure -> refunded once, claim reopens for a NEW request id', async () => {
    seedWallet(ALICE, 1000);
    courses.set(COURSE, { course: goodCourse(COURSE), vanishAfterFetches: 1 }); // eligible, then 404 at enrollment
    const k = key();
    const first = await redeem(ALICE, COURSE, k);
    assert.equal(first.ok, false);
    assert.match((first as any).error.message, /Điểm đã được hoàn lại/);

    assertWalletRestored(ALICE);
    const refunds = ledger(ALICE, 'COURSE_REDEMPTION_REFUND');
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].amount, PRICE);
    assert.equal(refunds[0].balanceAfter, 1000);
    assert.equal(refunds[0].idempotencyKey, refundKeyFor(scopedIdempotencyKey(ALICE, k)));
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION')[0].metadata.redemptionStatus, 'FAILED');
    assert.equal(rows(ALICE)[0].status, 'REFUNDED');
    assert.equal(rows(ALICE)[0].refundTransactionId, refunds[0].id);
    assert.equal(enrolled(ALICE).length, 0);

    // same key -> terminal ALREADY_REFUNDED, still no new debit
    const replay = await redeem(ALICE, COURSE, k);
    assert.equal(replay.ok, true);
    assert.equal((replay as any).value.status, 'ALREADY_REFUNDED');
    assertWalletRestored(ALICE);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION').length, 1);

    // a NEW key may retry once the course is healthy: the (user, course) claim is reopened, not duplicated
    courses.set(COURSE, { course: goodCourse(COURSE) });
    const fresh = await redeem(ALICE, COURSE, key());
    assert.equal(fresh.ok, true);
    assert.equal(rows(ALICE).length, 1);
    assert.equal(rows(ALICE)[0].status, 'COMPLETED');
    assert.equal(wallet(ALICE)!.balance, 500);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION').length, 2, 'history preserved: failed + new debit');
  });

  it('TX-07 two processes refund the same redemption at once -> balance increases once', async () => {
    const { debit, row } = seedPending(ALICE, 'k-refund');
    const svc: any = CourseRedemptionService;
    const results = await Promise.allSettled([
      svc.refund(row, debit, 'final'),
      svc.refund(row, debit, 'final'),
      svc.refund(row, debit, 'final'),
    ]);
    assert.ok(results.every((r) => r.status === 'fulfilled'));
    assert.equal(wallet(ALICE)!.balance, 1000, '500 + exactly one refund of 500');
    assert.equal(wallet(ALICE)!.totalSpent, 0);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION_REFUND').length, 1);
    assert.equal(db.tables.courseRedemption[0].status, 'REFUNDED');
  });

  it('TX-07 worker + worker + retry on a doomed pending redemption -> a single refund', async () => {
    seedPending(ALICE, 'k-doomed');
    courses.set(COURSE, { course: goodCourse(COURSE), status: 404 });
    await Promise.all([
      CourseRedemptionService.recoverStale(60_000),
      CourseRedemptionService.recoverStale(60_000),
      redeem(ALICE, COURSE, 'k-doomed'),
    ]);
    assert.equal(wallet(ALICE)!.balance, 1000);
    assert.equal(wallet(ALICE)!.totalSpent, 0);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION_REFUND').length, 1);
    assert.equal(db.tables.courseRedemption[0].status, 'REFUNDED');
  });

  it('a refund is aborted (rolled back) if the learner turns out to be enrolled', async () => {
    const { debit, row } = seedPending(ALICE, 'k-race');
    db.seed('courseProgress', { userId: ALICE, courseId: COURSE, courseTitle: 't', totalLessons: 1 });
    await assert.rejects((CourseRedemptionService as any).refund(row, debit, 'final'), /refund aborted/);
    assert.equal(wallet(ALICE)!.balance, 500);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION_REFUND').length, 0);
    assert.equal(db.tables.courseRedemption[0].status, 'PENDING_ENROLLMENT');
  });
});

describe('TX: idempotency and concurrency', () => {
  it('TX-08 same user + same key sent concurrently -> one business transaction', async () => {
    seedWallet(ALICE, 1000);
    const k = key();
    const results = await Promise.all(Array.from({ length: 6 }, () => redeem(ALICE, COURSE, k)));
    assert.ok(results.some((r) => r.ok), 'at least one caller sees success');
    for (const r of results) {
      if (!r.ok) assert.equal((r as any).error.statusCode, 503, 'others may only be told "processing, retry"');
    }
    assertSingleDebit(ALICE);
    assert.equal(rows(ALICE).length, 1);
    assert.equal(enrolled(ALICE).length, 1);
    assert.equal(enrollLogs(), 1);
    assert.equal(rows(ALICE)[0].status, 'COMPLETED');
  });

  it('same user + same key + a different course -> idempotency conflict, nothing else touched', async () => {
    seedWallet(ALICE, 1000);
    const k = key();
    await redeem(ALICE, COURSE, k);
    const r = await redeem(ALICE, COURSE_B, k);
    assert.equal(r.ok, false);
    assert.match((r as any).error.message, /Xung đột khóa idempotency/);
    assertSingleDebit(ALICE);
    assert.equal(enrolled(ALICE, COURSE_B).length, 0);
  });

  it('TX-09 two users with the same clientRequestId (even concurrently) -> independent, nothing leaks', async () => {
    seedWallet(ALICE, 1000);
    seedWallet(BOB, 1000);
    const k = key();
    const [a, b] = await Promise.all([redeem(ALICE, COURSE, k), redeem(BOB, COURSE, k)]);
    assert.equal(a.ok && b.ok, true);
    assertSingleDebit(ALICE);
    assertSingleDebit(BOB);
    assert.equal((a as any).value.transaction.userId, ALICE);
    assert.equal((b as any).value.transaction.userId, BOB);
    assert.equal(ledger(ALICE)[0].idempotencyKey, scopedIdempotencyKey(ALICE, k));
    assert.equal(ledger(BOB)[0].idempotencyKey, scopedIdempotencyKey(BOB, k));
  });

  it('TX-09 a user cannot read or hijack another user\'s pending transaction through its key', async () => {
    seedPending(ALICE, 'shared-key');
    seedWallet(BOB, 1000);
    const r = await redeem(BOB, COURSE, 'shared-key');
    assert.equal(r.ok, true);
    assert.notEqual((r as any).value.transaction.userId, ALICE);
    assert.equal(rows(ALICE)[0].status, 'PENDING_ENROLLMENT', "Alice's transaction untouched");
    assert.equal(enrolled(ALICE).length, 0);
  });

  it('TX-10 different request ids racing for the same course -> only one is charged', async () => {
    seedWallet(ALICE, 1000);
    const results = await Promise.all(Array.from({ length: 6 }, () => redeem(ALICE, COURSE, key())));
    assert.equal(results.filter((r) => r.ok).length, 1);
    for (const r of results.filter((x) => !x.ok)) {
      assert.ok(
        /đã đăng ký|sở hữu|yêu cầu khác/.test((r as any).error.message),
        `unexpected failure: ${(r as any).error.message}`
      );
    }
    assertSingleDebit(ALICE);
    assert.equal(rows(ALICE).length, 1);
    assert.equal(enrolled(ALICE).length, 1);
  });

  it('TX-10 a second, different key while the first is still PENDING -> 409, no debit', async () => {
    seedPending(ALICE, 'first-key', { stale: false });
    const r = await redeem(ALICE, COURSE, 'second-key');
    assert.equal(r.ok, false);
    assert.equal((r as any).error.statusCode, 409);
    assert.equal(wallet(ALICE)!.balance, 500);
    assert.equal(ledger(ALICE).length, 1);
  });

  it('two redemptions of DIFFERENT courses still run in parallel and are balance-checked atomically', async () => {
    seedWallet(ALICE, 500);
    const [a, b] = await Promise.all([redeem(ALICE, COURSE, key()), redeem(ALICE, COURSE_B, key())]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
    assert.equal(wallet(ALICE)!.balance, 0);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION').length, 1);
  });
});

describe('TX: compatibility with ledger entries written before FIX 03', () => {
  it('TX-11 legacy COMPLETED entry (raw key) -> replay is a success, nothing charged', async () => {
    seedWallet(ALICE, 500, 500);
    db.seed('rewardPointTransaction', {
      userId: ALICE, amount: -PRICE, type: 'COURSE_REDEMPTION', description: 'old', balanceAfter: 500,
      sourceId: COURSE, idempotencyKey: 'legacy-done',
      metadata: { courseId: COURSE, pointsRequired: PRICE, redemptionStatus: 'COMPLETED' },
    });
    db.seed('courseProgress', { userId: ALICE, courseId: COURSE, courseTitle: 't', totalLessons: 1 });
    const r = await redeem(ALICE, COURSE, 'legacy-done');
    assert.equal(r.ok, true);
    assert.equal((r as any).value.status, 'ALREADY_COMPLETED');
    assert.equal(db.count('rewardPointTransaction'), 1);
    assert.equal(wallet(ALICE)!.balance, 500);
    assert.equal(db.count('courseRedemption'), 0, 'history is not rewritten');
  });

  it('TX-11 legacy PENDING entry (raw key, no claim row) -> adopted, finished, never double-charged', async () => {
    const { debit } = seedPending(ALICE, 'legacy-pending', { legacy: true });
    const r = await redeem(ALICE, COURSE, 'legacy-pending');
    assert.equal(r.ok, true);
    assert.equal((r as any).value.status, 'ALREADY_COMPLETED');
    assert.equal(rows(ALICE)[0].transactionId, debit.id);
    assert.equal(rows(ALICE)[0].status, 'COMPLETED');
    assert.equal(enrolled(ALICE).length, 1);
    assert.equal(db.count('rewardPointTransaction'), 1, 'no new ledger entry');
    assert.equal(wallet(ALICE)!.balance, 500);
    assert.equal(db.tables.rewardPointTransaction[0].idempotencyKey, 'legacy-pending', 'old key untouched');
  });

  it('TX-11 legacy refunded entry (refund_<key>) -> ALREADY_REFUNDED, no new debit', async () => {
    seedWallet(ALICE, 1000);
    db.seed('rewardPointTransaction', {
      userId: ALICE, amount: -PRICE, type: 'COURSE_REDEMPTION', description: 'old', balanceAfter: 500,
      sourceId: COURSE, idempotencyKey: 'legacy-failed',
      metadata: { courseId: COURSE, pointsRequired: PRICE, redemptionStatus: 'FAILED' },
    });
    db.seed('rewardPointTransaction', {
      userId: ALICE, amount: PRICE, type: 'COURSE_REDEMPTION_REFUND', description: 'old', balanceAfter: 1000,
      sourceId: COURSE, idempotencyKey: 'refund_legacy-failed', metadata: {},
    });
    const r = await redeem(ALICE, COURSE, 'legacy-failed');
    assert.equal(r.ok, true);
    assert.equal((r as any).value.status, 'ALREADY_REFUNDED');
    assert.equal(db.count('rewardPointTransaction'), 2);
    assertWalletRestored(ALICE);
  });

  it("TX-11 another user's raw legacy key is invisible to me (no leak) and does not block me", async () => {
    seedWallet(BOB, 1000);
    db.seed('rewardPointTransaction', {
      userId: ALICE, amount: -PRICE, type: 'COURSE_REDEMPTION', description: 'old', balanceAfter: 500,
      sourceId: COURSE, idempotencyKey: 'legacy-alice',
      metadata: { courseId: COURSE, pointsRequired: PRICE, redemptionStatus: 'COMPLETED' },
    });
    const r = await redeem(BOB, COURSE, 'legacy-alice');
    assert.equal(r.ok, true);
    assert.equal((r as any).value.transaction.userId, BOB);
    assertSingleDebit(BOB);
  });

  it('TX-11 adoptLegacyPendingEntries only adopts open legacy debits', async () => {
    seedPending(ALICE, 'legacy-open', { legacy: true });
    seedWallet(BOB, 500, 500);
    db.seed('rewardPointTransaction', {
      userId: BOB, amount: -PRICE, type: 'COURSE_REDEMPTION', description: 'old', balanceAfter: 500,
      sourceId: COURSE, idempotencyKey: 'legacy-bob-done',
      metadata: { courseId: COURSE, pointsRequired: PRICE, redemptionStatus: 'COMPLETED' },
    });
    const r = await CourseRedemptionService.adoptLegacyPendingEntries(1);
    assert.equal(r.adopted, 1);
    assert.equal(rows(ALICE).length, 1);
    assert.equal(rows(BOB).length, 0);
    const again = await CourseRedemptionService.adoptLegacyPendingEntries(1);
    assert.equal(again.adopted, 0, 'idempotent');
    assert.equal(db.count('rewardPointTransaction'), 2, 'ledger never modified');
  });
});

describe('TX: recovery worker', () => {
  it('worker completes stale pending redemptions and ignores fresh / finished ones', async () => {
    seedPending(ALICE, 'stale-1');
    seedPending(BOB, 'fresh-1', { stale: false });
    const summary = await CourseRedemptionService.recoverStale(60_000);
    assert.equal(summary.examined, 1);
    assert.equal(summary.completed, 1);
    assert.equal(rows(ALICE)[0].status, 'COMPLETED');
    assert.equal(enrolled(ALICE).length, 1);
    assert.equal(rows(BOB)[0].status, 'PENDING_ENROLLMENT');
    assert.equal(enrolled(BOB).length, 0);
    assert.equal(wallet(ALICE)!.balance, 500, 'no debit / refund by the worker');

    const second = await CourseRedemptionService.recoverStale(60_000);
    assert.equal(second.examined, 0);
  });

  it('TX-14 worker and a client retry on the same pending transaction -> enrolled/completed/notified once', async () => {
    seedPending(ALICE, 'race-1');
    await Promise.all([
      CourseRedemptionService.recoverStale(60_000),
      CourseRedemptionService.recoverStale(60_000),
      redeem(ALICE, COURSE, 'race-1'),
      redeem(ALICE, COURSE, 'race-1'),
    ]);
    assert.equal(enrolled(ALICE).length, 1);
    assert.equal(enrollLogs(), 1, 'enrolled once');
    assert.equal(notifications, 1, 'notified once');
    assert.equal(rows(ALICE)[0].status, 'COMPLETED');
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION_REFUND').length, 0);
    assert.equal(ledger(ALICE).length, 1);
    assert.equal(wallet(ALICE)!.balance, 500);
    assert.equal(wallet(ALICE)!.totalSpent, PRICE);
  });

  it('the completion notification goes out through the shared client: internal token header, unchanged payload, no idempotency key', async () => {
    seedPending(ALICE, 'notify-1');
    await redeem(ALICE, COURSE, 'notify-1');
    // the notification is fire-and-forget (`void notifyCompleted`): let it finish
    await new Promise((r) => setImmediate(r));
    assert.equal(notificationCalls.length, 1);
    const call = notificationCalls[0];
    assert.ok(call.url.endsWith('/api/users/internal/notifications'));
    assert.equal(call.config.headers['x-internal-service-token'], INTERNAL_TOKEN);
    assert.equal(call.config.headers['x-idempotency-key'], undefined, 'idempotency is FIX 06C-4B2B');
    assert.deepEqual(Object.keys(call.config.headers), ['x-internal-service-token']);
    assert.equal(call.config.timeout, undefined, 'this caller never had a timeout');
    assert.deepEqual(call.body, {
      userId: ALICE,
      title: '🎁 Đổi khóa học thành công!',
      message: `Bạn đã dùng ${PRICE} điểm thưởng để đổi thành công khóa học. Hãy bắt đầu học ngay!`,
      type: 'SUCCESS',
      link: `/learn/${COURSE}`,
    });
  });

  it('without the internal token nothing is sent, and the redemption itself is not affected', async () => {
    const saved = process.env.INTERNAL_SERVICE_TOKEN;
    delete process.env.INTERNAL_SERVICE_TOKEN;
    try {
      seedPending(ALICE, 'notify-2');
      const r = await redeem(ALICE, COURSE, 'notify-2');
      await new Promise((r2) => setImmediate(r2));
      assert.equal(r.ok, true);
      assert.equal(rows(ALICE)[0].status, 'COMPLETED');
      assert.equal(notifications, 0, 'no request without the secret');
    } finally {
      process.env.INTERNAL_SERVICE_TOKEN = saved;
    }
  });

  it('TX-14 a pending redemption leased by another processor is not touched (retry told to wait)', async () => {
    seedPending(ALICE, 'leased', { leaseUntil: new Date(Date.now() + 30_000) });
    const r = await redeem(ALICE, COURSE, 'leased');
    assert.equal(r.ok, false);
    assert.equal((r as any).error.statusCode, 503);
    assert.equal(enrolled(ALICE).length, 0);
    assert.equal(rows(ALICE)[0].status, 'PENDING_ENROLLMENT');
    const w = await CourseRedemptionService.recoverStale(60_000);
    assert.equal(w.busy, 1);
    assert.equal(enrolled(ALICE).length, 0);
  });

  it('an expired lease (crashed processor) can be taken over', async () => {
    seedPending(ALICE, 'expired', { leaseUntil: new Date(Date.now() - 1000) });
    const r = await redeem(ALICE, COURSE, 'expired');
    assert.equal(r.ok, true);
    assert.equal(rows(ALICE)[0].status, 'COMPLETED');
  });

  it('worker refunds a doomed pending redemption only after course-service definitively refuses', async () => {
    seedPending(ALICE, 'doomed');
    courses.set(COURSE, { course: goodCourse(COURSE), status: 404 });
    const s = await CourseRedemptionService.recoverStale(60_000);
    assert.equal(s.refunded, 1);
    assertWalletRestored(ALICE);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION_REFUND').length, 1);
    assert.equal(ledger(ALICE, 'COURSE_REDEMPTION')[0].metadata.redemptionStatus, 'FAILED');
    assert.equal((await CourseRedemptionService.recoverStale(60_000)).examined, 0);
  });
});
