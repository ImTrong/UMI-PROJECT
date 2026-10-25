/**
 * Regression tests: server-side pricing + course eligibility for point redemption (FIX 02).
 * The REAL controller and service run against an in-memory Prisma fake and a stubbed
 * course-service/user-service (axios). No database or network is touched.
 *
 * Run: npm test
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePrisma, db } from './helpers/fake-prisma';
import { useRandomInternalToken, useRandomCourseLearningToken } from './helpers/internal-token';

installFakePrisma();
useRandomCourseLearningToken(); // FIX-INS-06: the learning -> course lessons lookup needs COURSE_LEARNING_TOKEN
useRandomInternalToken(); // the notification client refuses to send without the internal service token

/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require('axios').default || require('axios');
const logger = require('../src/utils/logger').default;
const { LeaderboardController } = require('../src/controllers/leaderboard.controller');
const { RewardPointService, COURSE_REDEMPTION_POINTS } = require('../src/services/reward-point.service');

logger.transports.forEach((t: any) => { t.silent = true; });

const PRICE = 500;
const ALICE = 'a1'.repeat(12);
const BOB = 'b2'.repeat(12);
const VICTIM = 'c3'.repeat(12);
const COURSE = 'd4'.repeat(12);
const OTHER_COURSE = 'e5'.repeat(12);

// ---------- course-service / user-service stub ----------
type CourseStub = { status?: number; networkError?: boolean; course?: any; lessonsStatus?: number; vanishAfterFetches?: number; fetches?: number };
const courses = new Map<string, CourseStub>();
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

const goodCourse = (id: string, over: Record<string, any> = {}) => ({
  id, title: `Course ${id}`, price: 1_200_000, published: true, approvalStatus: 'APPROVED', ...over,
});
const defineCourse = (id: string, over: Record<string, any> = {}) =>
  courses.set(id, { course: goodCourse(id, over) });

const installAxiosStub = () => {
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
  mock.method(axios, 'post', async () => ({ data: {} })); // notification to user-service
};

// ---------- fake req/res ----------
const call = async (userId: string, body: any, headers: Record<string, string> = {}) => {
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
  await LeaderboardController.redeemCourse({ user: { userId, email: 'x@y.z' }, body, headers, params: {}, query: {} }, res);
  return res;
};
let seq = 0;
const key = () => `req_${++seq}_${Date.now()}`;

const wallet = (userId: string) => db.tables.userRewardPoint.find((w) => w.userId === userId);
const seedWallet = (userId: string, balance: number) =>
  db.seed('userRewardPoint', { userId, balance, totalEarned: balance, totalSpent: 0 });
const ledger = (userId: string) => db.tables.rewardPointTransaction.filter((t) => t.userId === userId);
const enrollments = (userId: string, courseId = COURSE) =>
  db.tables.courseProgress.filter((c) => c.userId === userId && c.courseId === courseId);

/** Nothing about the wallet, ledger or enrollment may have changed (wallet not even created). */
const assertUntouched = (userId: string, balanceBefore?: number) => {
  if (balanceBefore === undefined) {
    assert.equal(wallet(userId), undefined, 'wallet must not even be created');
  } else {
    assert.equal(wallet(userId)!.balance, balanceBefore);
    assert.equal(wallet(userId)!.totalSpent, 0);
  }
  assert.equal(ledger(userId).length, 0, 'no ledger entry');
  assert.equal(db.count('courseProgress'), 0, 'no enrollment');
};

const assertChargedOfficialPrice = (res: any, userId: string, balanceBefore: number) => {
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const w = wallet(userId)!;
  assert.equal(w.balance, balanceBefore - PRICE, 'balance reduced by the official price');
  assert.equal(w.totalSpent, PRICE);
  const txs = ledger(userId);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].amount, -PRICE);
  assert.equal(txs[0].type, 'COURSE_REDEMPTION');
  assert.equal(txs[0].balanceAfter, balanceBefore - PRICE);
  assert.equal(txs[0].metadata.pointsRequired, PRICE);
  assert.equal(txs[0].metadata.redemptionStatus, 'COMPLETED');
  assert.equal(enrollments(userId).length, 1);
  assert.equal(res.body.data.pointsCharged, PRICE, 'response price equals the amount actually deducted');
  assert.equal(res.body.data.remainingBalance, balanceBefore - PRICE);
};

beforeEach(() => {
  db.reset();
  courses.clear();
  defineCourse(COURSE);
  installAxiosStub();
});
afterEach(() => mock.restoreAll());

describe('PRICE: the client can never set the price', () => {
  it('official price is a fixed 500 held on the server', () => {
    assert.equal(COURSE_REDEMPTION_POINTS, 500);
  });

  it('PRICE-01 pointsRequired: 1 -> still charged the official 500', async () => {
    seedWallet(ALICE, 1000);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key(), pointsRequired: 1 });
    assertChargedOfficialPrice(res, ALICE, 1000);
  });

  it('PRICE-01 exploit with a tiny wallet: balance 1 + pointsRequired 1 is rejected, nothing granted', async () => {
    seedWallet(ALICE, 1);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key(), pointsRequired: 1 });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /không đủ/);
    assert.equal(wallet(ALICE)!.balance, 1);
    assert.equal(wallet(ALICE)!.totalSpent, 0);
    assert.equal(ledger(ALICE).length, 0);
    assert.equal(enrollments(ALICE).length, 0);
  });

  it('PRICE-02 pointsRequired: 0 -> no fallback surprise, official price charged', async () => {
    seedWallet(ALICE, 1000);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key(), pointsRequired: 0 });
    assertChargedOfficialPrice(res, ALICE, 1000);
  });

  for (const [label, value] of [
    ['negative', -500], ['decimal', 0.5], ['numeric string', '1'], ['text', 'abc'],
    ['operator object', { $gt: 0 }], ['array', [1]], ['huge', 1e12], ['null', null], ['NaN-like string', 'NaN'],
  ] as const) {
    it(`PRICE-03 pointsRequired ${label} -> ignored`, async () => {
      seedWallet(ALICE, 1000);
      const res = await call(ALICE, { courseId: COURSE, clientRequestId: key(), pointsRequired: value });
      assertChargedOfficialPrice(res, ALICE, 1000);
    });
  }

  it('PRICE-04 pointsRequired omitted -> server price', async () => {
    seedWallet(ALICE, 1000);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
    assertChargedOfficialPrice(res, ALICE, 1000);
  });

  it('PRICE-13 tampered body (price, amount, balance, totalSpent, userId) -> only courseId + key are honoured', async () => {
    seedWallet(ALICE, 1000);
    seedWallet(VICTIM, 5000);
    const res = await call(ALICE, {
      courseId: COURSE, clientRequestId: key(),
      pointsRequired: 500, amount: -1, balance: 999999, totalSpent: -1000, balanceAfter: 999999,
      userId: VICTIM, price: 0, redemptionStatus: 'COMPLETED',
    });
    assertChargedOfficialPrice(res, ALICE, 1000);
    assert.equal(wallet(VICTIM)!.balance, 5000, 'other users are never touched');
    assert.equal(ledger(VICTIM).length, 0);
  });

  it('PRICE-13 the service signature has no price parameter (a 4th argument is ignored)', async () => {
    seedWallet(ALICE, 1000);
    const result = await (RewardPointService as any).redeemCourseWithPoints(ALICE, COURSE, key(), 1);
    assert.equal(result.pointsCharged, PRICE);
    assert.equal(wallet(ALICE)!.balance, 500);
  });

  it('GET /reward-points/me exposes the official price for display only', async () => {
    seedWallet(ALICE, 10);
    const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
    await LeaderboardController.getMyRewardPoints({ user: { userId: ALICE } }, res);
    assert.equal(res.body.data.courseRedemptionPoints, 500);
    assert.equal(res.body.data.balance, 10);
  });
});

describe('PRICE: balance, course eligibility and failures are checked before the wallet changes', () => {
  it('PRICE-05 balance below the official price -> rejected, no enrollment, wallet unchanged', async () => {
    seedWallet(ALICE, 499);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Cần 500 điểm/);
    assertUntouched(ALICE, 499);
  });

  it('PRICE-06 course does not exist -> 404, wallet not touched or created', async () => {
    const res = await call(ALICE, { courseId: OTHER_COURSE, clientRequestId: key() });
    assert.equal(res.statusCode, 404);
    assertUntouched(ALICE);
    seedWallet(BOB, 1000);
    const res2 = await call(BOB, { courseId: OTHER_COURSE, clientRequestId: key() });
    assert.equal(res2.statusCode, 404);
    assertUntouched(BOB, 1000);
  });

  it('PRICE-07 unpublished course -> 403 before the wallet is touched', async () => {
    defineCourse(COURSE, { published: false });
    seedWallet(ALICE, 1000);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
    assert.equal(res.statusCode, 403);
    assertUntouched(ALICE, 1000);
  });

  for (const status of ['DRAFT', 'PENDING_REVIEW', 'REJECTED']) {
    it(`PRICE-08 published but approvalStatus ${status} -> 403 (published !== approved)`, async () => {
      defineCourse(COURSE, { published: true, approvalStatus: status });
      seedWallet(ALICE, 1000);
      const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
      assert.equal(res.statusCode, 403);
      assertUntouched(ALICE, 1000);
    });
  }

  it('PRICE-08 approved but not published -> 403 (both conditions are required)', async () => {
    defineCourse(COURSE, { published: false, approvalStatus: 'APPROVED' });
    seedWallet(ALICE, 1000);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
    assert.equal(res.statusCode, 403);
    assertUntouched(ALICE, 1000);
  });

  const badMetadata: Array<[string, Record<string, any>]> = [
    ['price missing', { price: undefined }],
    ['price null', { price: null }],
    ['price string', { price: '1200000' }],
    ['price negative', { price: -1 }],
    ['price NaN', { price: Number.NaN }],
    ['approvalStatus missing', { approvalStatus: undefined }],
    ['approvalStatus not a string', { approvalStatus: true }],
    ['published missing', { published: undefined }],
    ['published as string "true"', { published: 'true' }],
    ['id missing', { id: undefined }],
    ['id of a different course', { id: OTHER_COURSE }],
  ];
  for (const [label, over] of badMetadata) {
    it(`PRICE-09 metadata ${label} -> rejected safely (503), no defaults`, async () => {
      defineCourse(COURSE, over);
      seedWallet(ALICE, 1000);
      const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
      assert.equal(res.statusCode, 503);
      assertUntouched(ALICE, 1000);
    });
  }

  it('PRICE-09 non-object response body -> 503', async () => {
    courses.set(COURSE, { course: 'oops' });
    seedWallet(ALICE, 1000);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
    assert.equal(res.statusCode, 503);
    assertUntouched(ALICE, 1000);
  });

  it('PRICE-10 course-service timeout -> 503, no deduction', async () => {
    courses.set(COURSE, { networkError: true });
    seedWallet(ALICE, 1000);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
    assert.equal(res.statusCode, 503);
    assertUntouched(ALICE, 1000);
  });

  it('PRICE-10 course-service 500 -> 503, no deduction', async () => {
    courses.set(COURSE, { status: 500 });
    seedWallet(ALICE, 1000);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
    assert.equal(res.statusCode, 503);
    assertUntouched(ALICE, 1000);
  });

  it('PRICE-11 already enrolled -> rejected, not charged again', async () => {
    db.seed('courseProgress', { userId: ALICE, courseId: COURSE, courseTitle: 't', totalLessons: 1 });
    seedWallet(ALICE, 1000);
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: key() });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /đã đăng ký hoặc sở hữu/);
    assert.equal(wallet(ALICE)!.balance, 1000);
    assert.equal(ledger(ALICE).length, 0);
    assert.equal(enrollments(ALICE).length, 1);
  });

  it('request validation: missing/invalid courseId and missing key are rejected before any work', async () => {
    seedWallet(ALICE, 1000);
    for (const body of [
      { clientRequestId: key() },
      { courseId: { $ne: null }, clientRequestId: key() },
      { courseId: 'not-an-object-id', clientRequestId: key() },
      { courseId: COURSE },
    ]) {
      const res = await call(ALICE, body);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(wallet(ALICE)!.balance, 1000);
    assert.equal(ledger(ALICE).length, 0);
  });

  it('unauthenticated request -> 401, nothing happens', async () => {
    const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
    await LeaderboardController.redeemCourse({ body: { courseId: COURSE, clientRequestId: key() }, headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(db.count('rewardPointTransaction'), 0);
  });
});

describe('PRICE: retries and the existing refund path keep working with the server price', () => {
  it('PRICE-12 retry of a completed redemption -> no second charge, no second ledger entry', async () => {
    seedWallet(ALICE, 1000);
    const k = key();
    const first = await call(ALICE, { courseId: COURSE, clientRequestId: k });
    assertChargedOfficialPrice(first, ALICE, 1000);

    const retry = await call(ALICE, { courseId: COURSE, clientRequestId: k, pointsRequired: 1 });
    // FIX 03: a retry of a completed request returns the stored success (not "already owned")
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.data.status, 'ALREADY_COMPLETED');
    assert.equal(retry.body.data.isIdempotentReplay, true);
    assert.equal(wallet(ALICE)!.balance, 500, 'still exactly one 500 deduction');
    assert.equal(wallet(ALICE)!.totalSpent, 500);
    assert.equal(ledger(ALICE).length, 1);
    assert.equal(enrollments(ALICE).length, 1);
  });

  it('PRICE-12 replay of a completed ledger entry (no enrollment row) -> ALREADY_COMPLETED, no new charge', async () => {
    seedWallet(ALICE, 500);
    wallet(ALICE)!.totalSpent = 500;
    const k = key();
    db.seed('rewardPointTransaction', {
      userId: ALICE, amount: -500, type: 'COURSE_REDEMPTION', description: 'x', balanceAfter: 500,
      sourceId: COURSE, idempotencyKey: k, metadata: { courseId: COURSE, pointsRequired: 500, redemptionStatus: 'COMPLETED' },
    });
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: k, pointsRequired: 1 });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, 'ALREADY_COMPLETED');
    assert.equal(wallet(ALICE)!.balance, 500);
    assert.equal(ledger(ALICE).length, 1);
  });

  it('enrollment failure after the debit refunds exactly the official price (single refund)', async () => {
    // eligibility check passes, then course-service definitively answers 404 when enrolling
    courses.set(COURSE, { course: goodCourse(COURSE), vanishAfterFetches: 1 });
    seedWallet(ALICE, 1000);
    const k = key();
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: k, pointsRequired: 1 });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Điểm đã được hoàn lại/);

    assert.equal(wallet(ALICE)!.balance, 1000);
    assert.equal(wallet(ALICE)!.totalSpent, 0);
    const txs = ledger(ALICE);
    assert.equal(txs.length, 2);
    assert.equal(txs.find((t) => t.type === 'COURSE_REDEMPTION')!.amount, -500);
    assert.equal(txs.find((t) => t.type === 'COURSE_REDEMPTION')!.metadata.redemptionStatus, 'FAILED');
    assert.equal(txs.find((t) => t.type === 'COURSE_REDEMPTION_REFUND')!.amount, 500);
    assert.equal(enrollments(ALICE).length, 0);

    // retry with the SAME key -> ALREADY_REFUNDED, still no new debit
    const retry = await call(ALICE, { courseId: COURSE, clientRequestId: k });
    assert.equal(retry.statusCode, 409);
    assert.equal(retry.body.data.status, 'ALREADY_REFUNDED');
    assert.equal(wallet(ALICE)!.balance, 1000);
    assert.equal(ledger(ALICE).length, 2);
  });

  it('same key with a different course -> idempotency conflict, nothing charged', async () => {
    defineCourse(OTHER_COURSE);
    seedWallet(ALICE, 1000);
    const k = key();
    await call(ALICE, { courseId: COURSE, clientRequestId: k });
    const res = await call(ALICE, { courseId: OTHER_COURSE, clientRequestId: k });
    assert.equal(res.statusCode, 409);
    assert.equal(wallet(ALICE)!.balance, 500);
    assert.equal(ledger(ALICE).length, 1);
  });

  it('two users sending the same clientRequestId are processed independently (no leak, no clash)', async () => {
    seedWallet(ALICE, 1000);
    seedWallet(BOB, 1000);
    const k = key();
    const a = await call(ALICE, { courseId: COURSE, clientRequestId: k });
    const b = await call(BOB, { courseId: COURSE, clientRequestId: k });
    assertChargedOfficialPrice(a, ALICE, 1000);
    assertChargedOfficialPrice(b, BOB, 1000);
    assert.notEqual(a.body.data.transaction.id, b.body.data.transaction.id);
    assert.equal(b.body.data.transaction.userId, BOB);
  });

  it('two simultaneous redemptions with 500 points -> only one succeeds (atomic balance check kept)', async () => {
    defineCourse(OTHER_COURSE);
    seedWallet(ALICE, 500);
    const [a, b] = await Promise.all([
      call(ALICE, { courseId: COURSE, clientRequestId: key(), pointsRequired: 1 }),
      call(ALICE, { courseId: OTHER_COURSE, clientRequestId: key(), pointsRequired: 1 }),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 400]);
    assert.equal(wallet(ALICE)!.balance, 0);
    assert.equal(wallet(ALICE)!.totalSpent, 500);
    assert.equal(db.tables.courseProgress.filter((c) => c.userId === ALICE).length, 1);
  });

  it('PRICE-14 request exactly as the updated frontend sends it works end to end', async () => {
    seedWallet(ALICE, 700);
    const k = key();
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: k, requestId: k }, { 'x-idempotency-key': k });
    assertChargedOfficialPrice(res, ALICE, 700);
    assert.equal(res.body.data.enrollment.courseId, COURSE);
  });

  it('PRICE-14 a legacy client that still sends pointsRequired: 500 keeps working', async () => {
    seedWallet(ALICE, 700);
    const k = key();
    const res = await call(ALICE, { courseId: COURSE, clientRequestId: k, pointsRequired: 500 }, { 'x-idempotency-key': k });
    assertChargedOfficialPrice(res, ALICE, 700);
  });
});
