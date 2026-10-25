/**
 * FIX 04.2 integration tests on a REAL MongoDB replica set: FINALIZED periods are immutable,
 * `force`/take-over cannot reopen or rebuild them, frozen snapshots survive retries, and the
 * compare-and-set status transitions work against real documents (Date equality on updatedAt, etc.).
 * Opt-in; see tests/helpers/test-db-url.ts.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix04_test?replicaSet=rsTest" npm test
 *
 * Own database (`<name>_immutability`), created with `prisma db push`, dropped afterwards. Nothing here
 * touches a real leaderboard period.
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolveTestDb } from '../helpers/test-db-url';
import { installFaultyPrisma } from '../helpers/faulty-prisma';
import { installUserServiceStub } from '../helpers/user-service-stub';

const target = resolveTestDb('immutability');

describe('REAL MongoDB replica set: immutable finalized leaderboards', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let prisma: any;
  let axios: any;
  let LeaderboardService: any;
  let LeaderboardStateError: any;
  let calls: Array<{ model: string; op: string }>;
  let beforeNext: any;

  const oid = () => randomBytes(12).toString('hex');
  const MONTH = 9;
  const YEAR = 2026;
  const TOTAL = 2400;
  let U: string[];
  let notified: string[] = [];

  before(async () => {
    process.env.DATABASE_URL = target.url;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: target.url }, stdio: 'pipe' });

    const faulty = installFaultyPrisma();
    calls = faulty.calls;
    beforeNext = faulty.beforeNext;
    prisma = new faulty.FaultyPrismaClient();

    axios = require('axios').default || require('axios');
    require('../../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    ({ LeaderboardService, LeaderboardStateError } = require('../../src/services/leaderboard.service'));
  });

  after(async () => {
    try { await prisma.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    for (const m of ['leaderboardEntry', 'monthlyLeaderboard', 'courseCompletionRecord', 'badge', 'rewardPointTransaction', 'userRewardPoint', 'leaderboardAuditLog']) {
      await prisma[m].deleteMany({});
    }
    U = [oid(), oid(), oid(), oid()];
    for (const [i, u] of U.entries()) await seedCompletion(u, 50 - i * 10, `2026-09-0${i + 5}T10:00:00Z`);
    notified = [];
    mock.restoreAll();
    installUserServiceStub(axios, mock, (body) => { notified.push(body.userId); });
    calls.length = 0;
  });

  const seedCompletion = (userId: string, points: number, at: string) =>
    prisma.courseCompletionRecord.create({
      data: {
        userId, courseId: oid(), courseTitle: 'Course', completedAt: new Date(at), passed: true, totalDurationSeconds: 3600,
        level: 'BEGINNER', baseDurationPoints: points, levelMultiplier: 1, achievementPoints: points, policyVersion: '1.1',
        status: 'VALID', month: MONTH, year: YEAR,
      },
    });

  const run = (opts?: any) => LeaderboardService.finalizeMonth(MONTH, YEAR, 'IT', opts);
  const settle = (p: Promise<any>) => p.then((value: any) => ({ ok: true, value }), (error: any) => ({ ok: false, error }));
  const board = () => prisma.monthlyLeaderboard.findUnique({ where: { month_year: { month: MONTH, year: YEAR } } });
  const entries = () => prisma.leaderboardEntry.findMany({ orderBy: { rank: 'asc' } });
  const writes = () => calls.filter((c) => ['create', 'createMany', 'update', 'updateMany', 'upsert', 'deleteMany'].includes(c.op));
  const count = (model: string, op: string) => calls.filter((c) => c.model === model && c.op === op).length;

  /** Everything that makes up a finished period, straight from MongoDB. */
  const fingerprint = async () =>
    JSON.stringify({
      board: await board(),
      entries: await entries(),
      ledger: await prisma.rewardPointTransaction.findMany({ orderBy: { id: 'asc' } }),
      wallets: await prisma.userRewardPoint.findMany({ orderBy: { id: 'asc' } }),
      badges: await prisma.badge.findMany({ orderBy: { id: 'asc' } }),
    });

  const finalizeOnce = async () => {
    const r = await run();
    assert.equal(r.status, 'FINALIZED', JSON.stringify(r));
    assert.equal(r.totalPointsAwarded, TOTAL);
  };

  it('IMMUT-01/02/10 finalizing a FINALIZED period again - with simulated failures, many times - changes nothing and writes nothing', async () => {
    await finalizeOnce();
    const intruder = oid();
    await seedCompletion(intruder, 900, '2026-09-28T10:00:00Z'); // would rank first if recomputed
    const before = await fingerprint();
    const idsBefore = (await entries()).map((e: any) => e.id);
    calls.length = 0;

    for (const opts of [
      undefined, undefined, { simulateFailureAt: 'BEFORE_SNAPSHOT_CONFIRM' },
      { simulateFailureAt: 'AFTER_FIRST_REWARD' }, { simulateFailureAt: 'BEFORE_FINALIZED' },
    ] as const) {
      const r = await LeaderboardService.finalizeMonth(MONTH, YEAR, 'REPEAT', opts);
      assert.equal(r.status, 'ALREADY_FINALIZED');
      assert.equal(r.totalPointsAwarded, TOTAL);
    }

    assert.equal(await fingerprint(), before, 'period, entries, ledger, wallets, badges byte-identical in MongoDB');
    assert.deepEqual((await entries()).map((e: any) => e.id), idsBefore, 'entry documents were not deleted / recreated');
    assert.deepEqual(writes(), [], 'not a single write reached the database');
    assert.equal(count('leaderboardEntry', 'deleteMany'), 0);
    assert.equal(count('courseCompletionRecord', 'findMany'), 0, 'live data was not re-read');
    assert.equal(await prisma.rewardPointTransaction.count({ where: { userId: intruder } }), 0);
    assert.equal(notified.length, 4);
  });

  it('IMMUT-04/09 a REWARDING period resumes from its frozen entries; a student who arrived later is neither ranked nor paid', async () => {
    const crash: any = await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    assert.equal(crash.ok, false);
    assert.equal((await board()).status, 'REWARDING');
    const idsBefore = (await entries()).map((e: any) => e.id);
    const top1Ledger = (await prisma.rewardPointTransaction.findMany({ where: { userId: U[0] } }))[0];

    const intruder = oid();
    await seedCompletion(intruder, 900, '2026-09-28T10:00:00Z');
    calls.length = 0;
    const r = await run();

    assert.equal(r.status, 'FINALIZED');
    assert.deepEqual((await entries()).map((e: any) => e.id), idsBefore);
    assert.equal((await entries()).length, 4);
    assert.equal(await prisma.rewardPointTransaction.count({ where: { userId: intruder } }), 0);
    const top1After = await prisma.rewardPointTransaction.findMany({ where: { userId: U[0] } });
    assert.equal(top1After.length, 1);
    assert.equal(top1After[0].id, top1Ledger.id);
    assert.equal(count('leaderboardEntry', 'deleteMany'), 0);
    assert.equal(count('leaderboardEntry', 'createMany'), 0);
    assert.equal(count('courseCompletionRecord', 'findMany'), 0);
  });

  it('IMMUT-03 a SNAPSHOT_FROZEN period continues from the frozen entries', async () => {
    const b = await prisma.monthlyLeaderboard.create({ data: { month: MONTH, year: YEAR, status: 'SNAPSHOT_FROZEN', totalParticipants: 4, finalizedBy: 'earlier' } });
    for (const [i, u] of U.entries()) {
      await prisma.leaderboardEntry.create({
        data: { leaderboardId: b.id, userId: u, rank: i + 1, points: 50 - i * 10, completedCourses: 1, lastCompletedAt: new Date(`2026-09-0${i + 5}T10:00:00Z`), rewardPoints: [1000, 700, 500, 200][i] },
      });
    }
    const idsBefore = (await entries()).map((e: any) => e.id);
    await seedCompletion(oid(), 900, '2026-09-28T10:00:00Z');
    calls.length = 0;

    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.totalPointsAwarded, TOTAL);
    assert.deepEqual((await entries()).map((e: any) => e.id), idsBefore);
    assert.equal(count('leaderboardEntry', 'deleteMany'), 0);
    assert.equal(count('courseCompletionRecord', 'findMany'), 0);
  });

  it('IMMUT-08 a snapshot interrupted while being written leaves NO partial entries (real MongoDB rollback); the retry builds it', async () => {
    const crash: any = await settle(run({ simulateFailureAt: 'BEFORE_SNAPSHOT_CONFIRM' }));
    assert.equal(crash.ok, false);
    assert.equal((await board()).status, 'SNAPSHOT_BUILDING');
    assert.equal((await entries()).length, 0, 'the half-written snapshot was rolled back by MongoDB');

    calls.length = 0;
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal((await entries()).length, 4);
    assert.equal(count('leaderboardEntry', 'deleteMany'), 1);
    assert.equal(await prisma.rewardPointTransaction.count({}), 4);
  });

  it('IMMUT-08 a partial snapshot left by an OLDER (pre-lock) run is discarded and rebuilt in ONE transaction', async () => {
    const b = await prisma.monthlyLeaderboard.create({ data: { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 0, finalizedBy: 'old-run' } });
    await prisma.leaderboardEntry.create({ data: { leaderboardId: b.id, userId: U[2], rank: 1, points: 1, completedCourses: 1, lastCompletedAt: new Date('2026-09-01T00:00:00Z'), rewardPoints: 1000 } });
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.deepEqual((await entries()).map((e: any) => [e.userId, e.rank]), U.map((u: string, i: number) => [u, i + 1]));
    assert.equal(count('leaderboardEntry', 'deleteMany'), 1);
  });

  it('IMMUT-08 a non-SNAPSHOT_BUILDING period with entries is refused, entries kept', async () => {
    const b = await prisma.monthlyLeaderboard.create({ data: { month: MONTH, year: YEAR, status: 'FAILED', totalParticipants: 1 } });
    await prisma.leaderboardEntry.create({
      data: { leaderboardId: b.id, userId: U[0], rank: 1, points: 50, completedCourses: 1, lastCompletedAt: new Date('2026-09-05T10:00:00Z') },
    });
    calls.length = 0;
    const r: any = await settle(run());
    assert.equal(r.ok, false);
    assert.ok(r.error instanceof LeaderboardStateError);
    assert.equal((await entries()).length, 1);
    assert.equal(count('leaderboardEntry', 'deleteMany'), 0);
    assert.equal((await board()).status, 'FAILED');
  });

  it('another run finalizes while we are rewarding -> its stored result survives (real compare-and-set)', async () => {
    await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    const finalizedAt = new Date('2026-10-01T00:05:00.000Z');
    beforeNext('rewardPointTransaction', 'findUnique', async () => {   // the award fast path: outside any transaction
      await prisma.monthlyLeaderboard.updateMany({
        where: { month: MONTH, year: YEAR },
        data: { status: 'FINALIZED', finalizedAt, totalPointsAwarded: 4242 },
      });
    });

    const r = await run();
    assert.equal(r.status, 'ALREADY_FINALIZED');
    const b = await board();
    assert.equal(b.status, 'FINALIZED');
    assert.equal(b.totalPointsAwarded, 4242, 'not overwritten by our own total');
    assert.equal(b.finalizedAt.toISOString(), finalizedAt.toISOString());
  });

  it('several concurrent runs on a REWARDING period -> every reward and badge exists once, snapshot intact', async () => {
    await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    const idsBefore = (await entries()).map((e: any) => e.id);
    const results: any[] = await Promise.all([settle(run()), settle(run()), settle(run())]);
    assert.ok(results.some((x) => x.ok && ['FINALIZED', 'ALREADY_FINALIZED'].includes(x.value.status)), JSON.stringify(results.map((x) => x.error?.message || x.value?.status)));
    assert.equal(await prisma.rewardPointTransaction.count({}), 4);
    assert.equal(await prisma.badge.count({}), 4);
    assert.equal((await board()).status, 'FINALIZED');
    assert.equal((await board()).totalPointsAwarded, TOTAL);
    assert.deepEqual((await entries()).map((e: any) => e.id), idsBefore);
  });

  it('IMMUT-07 a failed notification of a FINALIZED period is retried on its own; nothing else is written', async () => {
    const failFor = U[2];
    mock.restoreAll();
    installUserServiceStub(axios, mock, (body) => {
      if (body.userId === failFor) throw new Error('user-service unavailable');
      notified.push(body.userId);
    });
    await finalizeOnce();
    assert.equal(notified.length, 3);
    const before = JSON.parse(await fingerprint());
    calls.length = 0;

    mock.restoreAll();
    installUserServiceStub(axios, mock, (body) => { notified.push(body.userId); });
    const left = await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    assert.equal(left, 0);
    assert.deepEqual(notified.slice(3), [failFor]);
    assert.deepEqual(writes().map((c) => `${c.model}.${c.op}`), ['leaderboardEntry.updateMany', 'leaderboardEntry.updateMany'], 'only that entry: the claim, then the outcome conditioned on the claim (real Mongo claim query works)');

    const after = JSON.parse(await fingerprint());
    assert.deepEqual(after.board, before.board, 'period row untouched');
    assert.deepEqual(after.ledger, before.ledger);
    assert.deepEqual(after.wallets, before.wallets);
    assert.deepEqual(after.badges, before.badges);
    assert.deepEqual(after.entries.map((e: any) => [e.id, e.rank, e.points, e.isTie]), before.entries.map((e: any) => [e.id, e.rank, e.points, e.isTie]));
  });
});
