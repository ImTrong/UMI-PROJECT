/**
 * FIX 04.1 integration tests on a REAL MongoDB replica set: finalizeMonth with real transactions, real
 * rollback, real unique indexes. Opt-in; see tests/helpers/test-db-url.ts.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix04_test?replicaSet=rsTest" npm test
 *
 * Uses its own database (`<name>_finalize`), created with `prisma db push` and dropped afterwards. Never
 * point it at a shared / production database. Nothing here touches a real leaderboard period.
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolveTestDb } from '../helpers/test-db-url';
import { installFaultyPrisma } from '../helpers/faulty-prisma';
import { installUserServiceStub } from '../helpers/user-service-stub';

const target = resolveTestDb('finalize');

describe('REAL MongoDB replica set: leaderboard finalization', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let prisma: any;
  let axios: any;
  let LeaderboardService: any;
  let LeaderboardRewardIncompleteError: any;
  let RewardPointService: any;
  let failNext: any;
  let faults: any[];

  const oid = () => randomBytes(12).toString('hex');
  const MONTH = 9;
  const YEAR = 2026;
  let U: string[]; // rank 1..4
  const PAY = [1000, 700, 500, 200];
  const TOTAL = 2400;
  let notified: string[] = [];
  let failNotificationFor = new Set<string>();

  before(async () => {
    process.env.DATABASE_URL = target.url;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: target.url }, stdio: 'pipe' });

    const faulty = installFaultyPrisma();
    failNext = faulty.failNext;
    faults = faulty.faults;
    prisma = new faulty.FaultyPrismaClient();

    axios = require('axios').default || require('axios');
    require('../../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    ({ LeaderboardService, LeaderboardRewardIncompleteError } = require('../../src/services/leaderboard.service'));
    ({ RewardPointService } = require('../../src/services/reward-point.service'));
  });

  after(async () => {
    try { await prisma.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    faults.length = 0;
    for (const m of ['leaderboardEntry', 'monthlyLeaderboard', 'courseCompletionRecord', 'badge', 'rewardPointTransaction', 'userRewardPoint', 'leaderboardAuditLog']) {
      await prisma[m].deleteMany({});
    }
    U = [oid(), oid(), oid(), oid()];
    for (const [i, u] of U.entries()) {
      await prisma.courseCompletionRecord.create({
        data: {
          userId: u, courseId: oid(), courseTitle: 'Course', completedAt: new Date(`2026-09-0${i + 5}T10:00:00Z`),
          passed: true, totalDurationSeconds: 3600, level: 'BEGINNER', baseDurationPoints: 50 - i * 10,
          levelMultiplier: 1, achievementPoints: 50 - i * 10, policyVersion: '1.1', status: 'VALID', month: MONTH, year: YEAR,
        },
      });
    }
    notified = [];
    failNotificationFor = new Set();
    mock.restoreAll();
    installUserServiceStub(axios, mock, (body) => {
      if (failNotificationFor.has(body.userId)) throw new Error('user-service unavailable');
      notified.push(body.userId);
    });
  });

  const run = (opts?: any) => LeaderboardService.finalizeMonth(MONTH, YEAR, 'IT', opts);
  const settle = (p: Promise<any>) => p.then((value: any) => ({ ok: true, value }), (error: any) => ({ ok: false, error }));
  const board = () => prisma.monthlyLeaderboard.findUnique({ where: { month_year: { month: MONTH, year: YEAR } } });
  const entries = () => prisma.leaderboardEntry.findMany({ orderBy: { rank: 'asc' } });
  const awards = (u: string) => prisma.rewardPointTransaction.findMany({ where: { userId: u, type: 'LEADERBOARD_REWARD' } });
  const wallet = (u: string) => prisma.userRewardPoint.findUnique({ where: { userId: u } });
  const badges = (u: string) => prisma.badge.findMany({ where: { userId: u, badgeType: 'LEADERBOARD_REWARD' } });
  const notifiedCount = (u: string) => notified.filter((x) => x === u).length;

  const assertAllPaidOnce = async () => {
    for (const [i, u] of U.entries()) {
      const a = await awards(u);
      assert.equal(a.length, 1, `reward ledger entries for rank ${i + 1}`);
      assert.equal(a[0].amount, PAY[i]);
      assert.equal(a[0].balanceAfter, PAY[i]);
      assert.equal((await wallet(u)).balance, PAY[i]);
      assert.equal((await wallet(u)).totalEarned, PAY[i]);
      assert.equal((await badges(u)).length, 1);
    }
  };

  it('FINALIZE-01 happy path on real MongoDB', async () => {
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.totalPointsAwarded, TOTAL);
    assert.equal((await board()).status, 'FINALIZED');
    assert.equal((await board()).totalPointsAwarded, TOTAL);
    await assertAllPaidOnce();
    assert.equal(notified.length, 4);
    for (const e of await entries()) assert.ok(e.rewardNotifiedAt);
  });

  it('FINALIZE-02/03 ledger insert fails inside the transaction for Top 2 (real rollback) -> not finalized; retry completes without re-paying others', async () => {
    failNext('rewardPointTransaction', 'create', new Error('boom: ledger insert failed'), 1, (a: any) => a?.data?.userId === U[1] && a?.data?.type === 'LEADERBOARD_REWARD');
    const r: any = await settle(run());
    assert.equal(r.ok, false);
    assert.ok(r.error instanceof LeaderboardRewardIncompleteError, r.error?.message);
    assert.equal((await board()).status, 'REWARDING');
    assert.equal((await board()).totalPointsAwarded, TOTAL - 700);
    assert.equal((await awards(U[1])).length, 0);
    assert.equal((await wallet(U[1])).balance, 0, 'MongoDB rolled the wallet increment back');
    assert.equal((await entries()).length, 4);
    const ledgerOfTop1 = (await awards(U[0]))[0].id;

    const retry = await run();
    assert.equal(retry.status, 'FINALIZED');
    assert.equal(retry.totalPointsAwarded, TOTAL);
    assert.equal((await awards(U[0]))[0].id, ledgerOfTop1);
    await assertAllPaidOnce();
    assert.equal(notifiedCount(U[0]), 1);
  });

  it('FINALIZE-04 + FINALIZE-08 crash after the first reward, live data changes, retry keeps the frozen snapshot', async () => {
    const crash: any = await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    assert.equal(crash.ok, false);
    assert.equal((await board()).status, 'REWARDING');
    const idsBefore = (await entries()).map((e: any) => e.id);
    assert.equal((await awards(U[0])).length, 1);

    const intruder = oid();
    await prisma.courseCompletionRecord.create({
      data: {
        userId: intruder, courseId: oid(), courseTitle: 'Late', completedAt: new Date('2026-09-25T10:00:00Z'), passed: true,
        totalDurationSeconds: 3600, level: 'BEGINNER', baseDurationPoints: 500, levelMultiplier: 1, achievementPoints: 500,
        policyVersion: '1.1', status: 'VALID', month: MONTH, year: YEAR,
      },
    });

    const retry = await run();
    assert.equal(retry.status, 'FINALIZED');
    assert.deepEqual((await entries()).map((e: any) => e.id), idsBefore);
    assert.equal((await awards(intruder)).length, 0);
    await assertAllPaidOnce();
  });

  it('FINALIZE-10 all rewards done, final status not written -> retry finalizes without paying again', async () => {
    const crash: any = await settle(run({ simulateFailureAt: 'BEFORE_FINALIZED' }));
    assert.equal(crash.ok, false);
    assert.equal((await board()).status, 'REWARDING');
    const ledgerBefore = await prisma.rewardPointTransaction.count({});
    const retry = await run();
    assert.equal(retry.status, 'FINALIZED');
    assert.equal(await prisma.rewardPointTransaction.count({}), ledgerBefore);
    assert.equal(retry.totalPointsAwarded, TOTAL);
    await assertAllPaidOnce();
    for (const u of U) assert.equal(notifiedCount(u), 1);
  });

  it('FINALIZE-06 badge fails after points -> no second payment on retry', async () => {
    failNext('badge', 'create', new Error('boom: badge insert failed'), 1, (a: any) => a?.data?.userId === U[1]);
    const r: any = await settle(run());
    assert.equal(r.ok, false);
    assert.deepEqual(r.error.failures.map((f: any) => f.step), ['BADGE']);
    assert.equal((await awards(U[1])).length, 1);
    assert.equal((await badges(U[1])).length, 0);
    assert.equal((await board()).status, 'REWARDING');

    const retry = await run();
    assert.equal(retry.status, 'FINALIZED');
    assert.equal((await wallet(U[1])).balance, 700);
    await assertAllPaidOnce();
    assert.equal(notifiedCount(U[1]), 1);
  });

  it('FINALIZE-07 notification fails -> FINALIZED anyway, failure recorded (real Mongo null/absent semantics), retry notifies only that student', async () => {
    failNotificationFor.add(U[2]);
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.notificationsPending, 1);
    await assertAllPaidOnce();
    const e3 = (await entries()).find((e: any) => e.userId === U[2]);
    assert.match(e3.rewardNotifyError, /user-service unavailable/);
    assert.ok(!e3.rewardNotifiedAt);

    const again = await run();
    assert.equal(again.status, 'ALREADY_FINALIZED');
    assert.equal(again.notificationsPending, 1);
    assert.equal(notifiedCount(U[2]), 0, 'finalize does not send notifications for a finalized period');

    failNotificationFor.clear();
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    for (const u of U) assert.equal(notifiedCount(u), 1);
    const e3b = (await entries()).find((e: any) => e.userId === U[2]);
    assert.equal(e3b.rewardNotifyError, null);
    assert.ok(e3b.rewardNotifiedAt);
    await assertAllPaidOnce();
  });

  it('a finalized period with no notification markers (written before FIX 04.1) is never re-notified', async () => {
    await run();
    notified = [];
    const left = await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    assert.equal(left, 0);
    assert.equal(notified.length, 0);
  });

  it('FINALIZE-05 a conflicting ledger entry on a reward key is refused, recorded, never rewritten', async () => {
    await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    const lb = (await board()).id;
    const conflicting = await prisma.rewardPointTransaction.create({
      data: {
        userId: U[1], amount: 999, type: 'LEADERBOARD_REWARD', description: 'old', balanceAfter: 999, sourceId: lb,
        idempotencyKey: RewardPointService.leaderboardRewardKey(U[1], MONTH, YEAR),
        metadata: { leaderboardId: lb, rank: 2, month: MONTH, year: YEAR, points: 999 },
      },
    });
    const r: any = await settle(run());
    assert.equal(r.ok, false);
    assert.ok(r.error instanceof LeaderboardRewardIncompleteError);
    assert.equal((await board()).status, 'REWARDING');
    assert.equal((await board()).totalPointsAwarded, TOTAL - 700);
    const after = await prisma.rewardPointTransaction.findUnique({ where: { id: conflicting.id } });
    assert.equal(after.amount, 999, 'ledger history untouched');
    assert.equal((await wallet(U[1])), null, 'no wallet credit for the conflicting entry');
    const logs = await prisma.leaderboardAuditLog.findMany({ where: { action: 'REWARD_INTEGRITY_ERROR', targetUserId: U[1] } });
    assert.equal(logs.length, 1);
  });

  it('three concurrent retries on a REWARDING period -> every ledger entry and badge exists exactly once', async () => {
    await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    const results: any[] = await Promise.all([settle(run()), settle(run()), settle(run())]);
    assert.ok(results.some((x) => x.ok), JSON.stringify(results.map((x) => x.error?.message)));
    assert.equal(await prisma.rewardPointTransaction.count({}), 4);
    assert.equal(await prisma.badge.count({}), 4);
    assert.equal((await board()).status, 'FINALIZED');
    assert.equal((await board()).totalPointsAwarded, TOTAL);
    await assertAllPaidOnce();
    for (const u of U) assert.equal(notifiedCount(u), 1, 'one owner at a time + the notification claim: every student is notified exactly once here');
  });

  it('FINALIZE-09 verified total equals the ledger sum for the period', async () => {
    failNext('rewardPointTransaction', 'create', new Error('boom'), 1, (a: any) => a?.data?.userId === U[1] && a?.data?.type === 'LEADERBOARD_REWARD');
    failNext('rewardPointTransaction', 'create', new Error('boom'), 1, (a: any) => a?.data?.userId === U[3] && a?.data?.type === 'LEADERBOARD_REWARD');
    const r: any = await settle(run());
    assert.equal(r.ok, false);
    const lb = (await board()).id;
    const sum = (await prisma.rewardPointTransaction.findMany({ where: { type: 'LEADERBOARD_REWARD', sourceId: lb } }))
      .reduce((s: number, t: any) => s + t.amount, 0);
    assert.equal(sum, 1500);
    assert.equal((await board()).totalPointsAwarded, sum);

    const retry = await run();
    assert.equal(retry.totalPointsAwarded, TOTAL);
    const sum2 = (await prisma.rewardPointTransaction.findMany({ where: { type: 'LEADERBOARD_REWARD', sourceId: lb } }))
      .reduce((s: number, t: any) => s + t.amount, 0);
    assert.equal(sum2, TOTAL);
  });
});
