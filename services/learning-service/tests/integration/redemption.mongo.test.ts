/**
 * Integration tests on a REAL MongoDB replica set (real transactions, real write conflicts, real
 * unique indexes). Opt-in: skipped unless TEST_DATABASE_URL points at an ISOLATED replica-set
 * database whose name contains "test" (it is created with `prisma db push` and dropped afterwards).
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix03_test?replicaSet=rsTest" npm test
 *
 * Never point this at a shared / production database.
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolveTestDb } from '../helpers/test-db-url';
import { useRandomInternalToken } from '../helpers/internal-token';

const target = resolveTestDb('redemption');
const URL_ = target.url;
const enabled = target.enabled;

describe('REAL MongoDB replica set: course redemption', { skip: enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let prisma: any;
  let axios: any;
  let RewardPointService: any;
  let CourseRedemptionService: any;
  let scopedIdempotencyKey: any;

  const oid = () => randomBytes(12).toString('hex');
  const PRICE = 500;
  let COURSE: string;
  let COURSE_B: string;
  const courses = new Map<string, any>();
  let notifications = 0;

  before(async () => {
    process.env.DATABASE_URL = URL_;
    useRandomInternalToken(); // the completion notification goes through the shared client, which refuses to send without the internal token
    execSync('npx prisma db push --skip-generate', {
      env: { ...process.env, DATABASE_URL: URL_ },
      stdio: 'pipe',
    });
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    axios = require('axios').default || require('axios');
    require('../../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    ({ RewardPointService } = require('../../src/services/reward-point.service'));
    ({ CourseRedemptionService, scopedIdempotencyKey } = require('../../src/services/course-redemption.service'));
  });

  after(async () => {
    try { await prisma.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    for (const m of ['courseRedemption', 'rewardPointTransaction', 'userRewardPoint', 'courseProgress', 'lessonProgress', 'userProgress', 'activityLog']) {
      await prisma[m].deleteMany({});
    }
    courses.clear();
    notifications = 0;
    COURSE = oid();
    COURSE_B = oid();
    const mk = (id: string) => ({ id, title: `C ${id}`, price: 900000, published: true, approvalStatus: 'APPROVED' });
    courses.set(COURSE, { course: mk(COURSE) });
    courses.set(COURSE_B, { course: mk(COURSE_B) });
    mock.restoreAll();
    mock.method(axios, 'get', async (url: string) => {
      const m = url.match(/\/api\/courses\/(?:internal\/)?([^/]+?)(\/lessons)?$/);
      const stub = m ? courses.get(m[1]) : undefined;
      if (!stub) throw Object.assign(new Error('404'), { response: { status: 404 } });
      if (stub.status) throw Object.assign(new Error(String(stub.status)), { response: { status: stub.status } });
      return m![2] ? { data: { data: [{ id: oid(), title: 'L1' }] } } : { data: { data: stub.course } };
    });
    mock.method(axios, 'post', async () => { notifications++; return { data: {} }; });
  });

  const seedWallet = (userId: string, balance: number) =>
    prisma.userRewardPoint.create({ data: { userId, balance, totalEarned: balance, totalSpent: 0 } });
  const wallet = (userId: string) => prisma.userRewardPoint.findUnique({ where: { userId } });
  const debits = (userId: string) => prisma.rewardPointTransaction.findMany({ where: { userId, type: 'COURSE_REDEMPTION' } });
  const refunds = (userId: string) => prisma.rewardPointTransaction.findMany({ where: { userId, type: 'COURSE_REDEMPTION_REFUND' } });
  const redemptions = (userId: string, courseId = COURSE) => prisma.courseRedemption.findMany({ where: { userId, courseId } });
  const enrollments = (userId: string, courseId = COURSE) => prisma.courseProgress.findMany({ where: { userId, courseId } });
  const redeem = (userId: string, courseId: string, key: string) =>
    RewardPointService.redeemCourseWithPoints(userId, courseId, key).then(
      (value: any) => ({ ok: true, value }),
      (error: any) => ({ ok: false, error })
    );
  let n = 0;
  const key = () => `it_${++n}_${Date.now()}`;

  it('environment: the unique indexes from schema.prisma exist, interactive transactions roll back', async () => {
    const idx: any = await prisma.$runCommandRaw({ listIndexes: 'course_redemptions' });
    const unique = idx.cursor.firstBatch.filter((i: any) => i.unique).map((i: any) => Object.keys(i.key).join(','));
    assert.ok(unique.includes('userId,courseId'), `unique (userId,courseId) missing: ${JSON.stringify(unique)}`);

    const userId = oid();
    await seedWallet(userId, 1000);
    await assert.rejects(
      prisma.$transaction(async (tx: any) => {
        await tx.userRewardPoint.updateMany({ where: { userId }, data: { balance: { decrement: PRICE } } });
        await tx.rewardPointTransaction.create({
          data: { userId, amount: -PRICE, type: 'X', description: 'a', balanceAfter: 500, idempotencyKey: 'dup-probe' },
        });
        await tx.rewardPointTransaction.create({
          data: { userId, amount: -PRICE, type: 'X', description: 'b', balanceAfter: 500, idempotencyKey: 'dup-probe' },
        });
      })
    );
    assert.equal((await wallet(userId)).balance, 1000, 'debit rolled back with the failed ledger insert');
    assert.equal(await prisma.rewardPointTransaction.count({ where: { userId } }), 0);
  });

  it('happy path + replay: one debit, one ledger entry, enrolled once, replay does not charge', async () => {
    const u = oid();
    await seedWallet(u, 1000);
    const k = key();
    const first: any = await redeem(u, COURSE, k);
    assert.equal(first.ok, true, first.error?.message);
    const replay: any = await redeem(u, COURSE, k);
    assert.equal(replay.value.status, 'ALREADY_COMPLETED');

    const w = await wallet(u);
    assert.equal(w.balance, 500);
    assert.equal(w.totalSpent, 500);
    const d = await debits(u);
    assert.equal(d.length, 1);
    assert.equal(d[0].amount, -PRICE);
    assert.equal(d[0].balanceAfter, 500);
    assert.equal(d[0].idempotencyKey, scopedIdempotencyKey(u, k));
    assert.equal((await redemptions(u))[0].status, 'COMPLETED');
    assert.equal((await enrollments(u)).length, 1);
  });

  it('TX-08 same user, same key, 8 concurrent requests -> one business transaction', async () => {
    const u = oid();
    await seedWallet(u, 1000);
    const k = key();
    const results: any[] = await Promise.all(Array.from({ length: 8 }, () => redeem(u, COURSE, k)));
    assert.ok(results.some((r) => r.ok));
    for (const r of results.filter((x) => !x.ok)) assert.equal(r.error.statusCode, 503, r.error.message);
    assert.equal((await wallet(u)).balance, 500);
    assert.equal((await debits(u)).length, 1);
    assert.equal((await redemptions(u)).length, 1);
    assert.equal((await enrollments(u)).length, 1);
    assert.equal((await redemptions(u))[0].status, 'COMPLETED');
  });

  it('TX-10 same user + course, 8 DIFFERENT keys at once -> only one charge', async () => {
    const u = oid();
    await seedWallet(u, 2000);
    const results: any[] = await Promise.all(Array.from({ length: 8 }, () => redeem(u, COURSE, key())));
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => r.error?.message)));
    assert.equal((await wallet(u)).balance, 1500);
    assert.equal((await wallet(u)).totalSpent, 500);
    assert.equal((await debits(u)).length, 1);
    assert.equal((await redemptions(u)).length, 1);
    assert.equal((await enrollments(u)).length, 1);
  });

  it('balance race: 500 points, 6 concurrent redemptions of different courses -> exactly one succeeds', async () => {
    const u = oid();
    await seedWallet(u, 500);
    const ids = Array.from({ length: 6 }, () => oid());
    for (const id of ids) courses.set(id, { course: { id, title: 'x', price: 1, published: true, approvalStatus: 'APPROVED' } });
    const results: any[] = await Promise.all(ids.map((id) => redeem(u, id, key())));
    assert.equal(results.filter((r) => r.ok).length, 1);
    const w = await wallet(u);
    assert.equal(w.balance, 0);
    assert.equal(w.totalSpent, 500);
    assert.equal((await debits(u)).length, 1);
  });

  it('TX-09 two users, same clientRequestId, concurrently -> independent', async () => {
    const [a, b] = [oid(), oid()];
    await seedWallet(a, 1000);
    await seedWallet(b, 1000);
    const k = key();
    const [ra, rb]: any[] = await Promise.all([redeem(a, COURSE, k), redeem(b, COURSE, k)]);
    assert.equal(ra.ok && rb.ok, true, `${ra.error?.message} / ${rb.error?.message}`);
    for (const u of [a, b]) {
      assert.equal((await wallet(u)).balance, 500);
      assert.equal((await debits(u)).length, 1);
      assert.equal((await enrollments(u)).length, 1);
    }
    assert.notEqual(ra.value.transaction.id, rb.value.transaction.id);
  });

  it('TX-12 concurrent first-time wallet creation -> one wallet (unique userId)', async () => {
    const u = oid();
    await Promise.all(Array.from({ length: 8 }, () => RewardPointService.getUserPoints(u)));
    assert.equal(await prisma.userRewardPoint.count({ where: { userId: u } }), 1);
    const r: any = await redeem(u, COURSE, key());
    assert.equal(r.ok, false);
    assert.match(r.error.message, /không đủ/);
    assert.equal((await wallet(u)).balance, 0);
  });

  const seedPending = async (userId: string, requestId: string, courseId = COURSE) => {
    await seedWallet(userId, 500);
    await prisma.userRewardPoint.update({ where: { userId }, data: { totalSpent: PRICE } });
    const debit = await prisma.rewardPointTransaction.create({
      data: {
        userId, amount: -PRICE, type: 'COURSE_REDEMPTION', description: 'seed', balanceAfter: 500,
        sourceId: courseId, idempotencyKey: scopedIdempotencyKey(userId, requestId),
        metadata: { courseId, pointsRequired: PRICE, redemptionStatus: 'PENDING_ENROLLMENT' },
      },
    });
    const row = await prisma.courseRedemption.create({
      data: { userId, courseId, status: 'PENDING_ENROLLMENT', pointsCharged: PRICE, transactionId: debit.id },
    });
    await new Promise((r) => setTimeout(r, 30)); // let it become "stale" for a 10ms threshold
    return { debit, row };
  };

  it('TX-14 worker x2 + retries race on a stale pending redemption -> enrolled / completed / notified once', async () => {
    const u = oid();
    await seedPending(u, 'stuck');
    await Promise.all([
      CourseRedemptionService.recoverStale(10),
      CourseRedemptionService.recoverStale(10),
      redeem(u, COURSE, 'stuck'),
      redeem(u, COURSE, 'stuck'),
    ]);
    assert.equal((await enrollments(u)).length, 1);
    assert.equal((await redemptions(u))[0].status, 'COMPLETED');
    assert.equal(notifications, 1);
    assert.equal((await refunds(u)).length, 0);
    assert.equal((await wallet(u)).balance, 500);
    assert.equal((await debits(u)).length, 1);
  });

  it('TX-07 refund races (workers + retry) on a doomed redemption -> balance restored exactly once', async () => {
    const u = oid();
    await seedPending(u, 'doomed');
    courses.set(COURSE, { status: 404 });
    await Promise.all([
      CourseRedemptionService.recoverStale(10),
      CourseRedemptionService.recoverStale(10),
      redeem(u, COURSE, 'doomed'),
    ]);
    const w = await wallet(u);
    assert.equal(w.balance, 1000);
    assert.equal(w.totalSpent, 0);
    const r = await refunds(u);
    assert.equal(r.length, 1);
    assert.equal(r[0].amount, PRICE);
    assert.equal((await redemptions(u))[0].status, 'REFUNDED');
    assert.equal((await debits(u))[0].metadata.redemptionStatus, 'FAILED');
    assert.equal((await enrollments(u)).length, 0);
  });

  it('unknown enrollment outcome never refunds (course-service 500)', async () => {
    const u = oid();
    await seedPending(u, 'unknown');
    courses.set(COURSE, { status: 500 });
    const s = await CourseRedemptionService.recoverStale(10);
    assert.equal(s.unresolved, 1);
    assert.equal((await redemptions(u))[0].status, 'PENDING_ENROLLMENT');
    assert.equal((await refunds(u)).length, 0);
    assert.equal((await wallet(u)).balance, 500);
  });

  it('TX-11 legacy un-scoped keys: pending entry is adopted and finished; replay of refunded entry never re-charges', async () => {
    const u = oid();
    await seedWallet(u, 500);
    await prisma.rewardPointTransaction.create({
      data: {
        userId: u, amount: -PRICE, type: 'COURSE_REDEMPTION', description: 'legacy', balanceAfter: 500,
        sourceId: COURSE, idempotencyKey: 'legacy-key',
        metadata: { courseId: COURSE, pointsRequired: PRICE, redemptionStatus: 'PENDING_ENROLLMENT' },
      },
    });
    const r: any = await redeem(u, COURSE, 'legacy-key');
    assert.equal(r.ok, true, r.error?.message);
    assert.equal(r.value.status, 'ALREADY_COMPLETED');
    assert.equal(await prisma.rewardPointTransaction.count({ where: { userId: u } }), 1, 'no new ledger entry');
    assert.equal((await enrollments(u)).length, 1);
    assert.equal((await wallet(u)).balance, 500);
  });
});
