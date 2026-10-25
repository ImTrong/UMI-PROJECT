/**
 * FIX 05 integration tests on a REAL MongoDB replica set: tie handling with millisecond timestamps stored in
 * MongoDB, learner eligibility (stubbed User Service) through the live view, the frozen snapshot and the real
 * reward transactions. Opt-in; see tests/helpers/test-db-url.ts.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix05_test?replicaSet=rsTest" npm test
 *
 * Own database (`<name>_ranking`), created with `prisma db push`, dropped afterwards. Nothing here touches a real
 * leaderboard period or a real User Service.
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolveTestDb } from '../helpers/test-db-url';
import { installFaultyPrisma } from '../helpers/faulty-prisma';
import { installUserServiceStub } from '../helpers/user-service-stub';

const target = resolveTestDb('ranking');

describe('REAL MongoDB replica set: fair ranking and eligibility', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let prisma: any;
  let axios: any;
  let LeaderboardService: any;
  let UserEligibilityError: any;
  let calls: Array<{ model: string; op: string }>;
  let userService: ReturnType<typeof installUserServiceStub>;

  const MONTH = 9;
  const YEAR = 2026;
  const BASE = Date.parse('2026-09-10T10:00:00.000Z');
  const oid = () => randomBytes(12).toString('hex');
  let U: string[];

  before(async () => {
    process.env.DATABASE_URL = target.url;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: target.url }, stdio: 'pipe' });
    const faulty = installFaultyPrisma();
    calls = faulty.calls;
    prisma = new faulty.FaultyPrismaClient();
    axios = require('axios').default || require('axios');
    require('../../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    ({ LeaderboardService } = require('../../src/services/leaderboard.service'));
    ({ UserEligibilityError } = require('../../src/services/user-eligibility.service'));
  });

  after(async () => {
    try { await prisma.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    for (const m of ['leaderboardEntry', 'monthlyLeaderboard', 'courseCompletionRecord', 'badge', 'rewardPointTransaction', 'userRewardPoint', 'leaderboardAuditLog']) {
      await prisma[m].deleteMany({});
    }
    U = Array.from({ length: 8 }, oid);
    mock.restoreAll();
    userService = installUserServiceStub(axios, mock);
    calls.length = 0;
  });

  const record = (userId: string, points: number, atMs: number, over: Record<string, any> = {}) =>
    prisma.courseCompletionRecord.create({
      data: {
        userId, courseId: oid(), courseTitle: 'Course', completedAt: new Date(BASE + atMs), passed: true, totalDurationSeconds: 3600,
        level: 'BEGINNER', baseDurationPoints: points, levelMultiplier: 1, achievementPoints: points, policyVersion: '1.1',
        status: 'VALID', month: MONTH, year: YEAR, ...over,
      },
    });
  const live = () => LeaderboardService.getLeaderboard(MONTH, YEAR);
  const finalize = (opts?: any) => LeaderboardService.finalizeMonth(MONTH, YEAR, 'IT', opts);
  const settle = (p: Promise<any>) => p.then((value: any) => ({ ok: true, value }), (error: any) => ({ ok: false, error }));
  const board = () => prisma.monthlyLeaderboard.findUnique({ where: { month_year: { month: MONTH, year: YEAR } } });
  const entries = () => prisma.leaderboardEntry.findMany({ orderBy: [{ rank: 'asc' }, { userId: 'asc' }] });
  const ledger = (u: string) => prisma.rewardPointTransaction.findMany({ where: { userId: u, type: 'LEADERBOARD_REWARD' } });
  const shape = (list: any[]) => list.map((e) => [e.userId, e.rank, e.isTie]);

  it('RANK-01/02 millisecond-exact tie windows survive MongoDB; the snapshot equals the live ranking', async () => {
    const [a, b, c] = [U[0], U[1], U[2]].sort();
    await record(a, 10, 0);
    await record(b, 10, 900);
    await record(c, 10, 1800);
    const chain = [U[3], U[4], U[5]].sort();
    for (const [i, u] of chain.entries()) await record(u, 5, i * 800);   // 800 ms steps

    const liveView = await live();
    assert.deepEqual(shape(liveView.entries), [[a, 1, true], [b, 1, true], [c, 3, false], [chain[0], 4, true], [chain[1], 4, true], [chain[2], 6, false]]);

    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    assert.deepEqual(shape(await entries()), shape(liveView.entries));
    assert.equal((await ledger(a))[0].amount, 1000);
    assert.equal((await ledger(b))[0].amount, 1000);
    assert.equal((await ledger(c))[0].amount, 500);
  });

  it('RANK-03/04 999 ms ties, exactly 1000 ms does not (stored timestamps)', async () => {
    const [a, b, c, d] = U.slice(0, 4).sort();
    await record(a, 10, 0); await record(b, 10, 999);
    await record(c, 5, 0); await record(d, 5, 1000);
    const view = await live();
    assert.deepEqual(shape(view.entries), [[a, 1, true], [b, 1, true], [c, 3, false], [d, 4, false]]);
  });

  it('ELIG-02/03/04/08 admin, instructor and deactivated accounts neither rank nor get paid; the next eligible learner takes rank 1', async () => {
    const [admin, instructor, inactive, s1, s2, s3] = U;
    await record(admin, 100, 0); await record(instructor, 90, 0); await record(inactive, 80, 0);
    await record(s1, 50, 0); await record(s2, 30, 0); await record(s3, 10, 0);
    userService.profiles.set(admin, { userId: admin, role: 'ADMIN', isActive: true });
    userService.profiles.set(instructor, { userId: instructor, role: 'INSTRUCTOR', isActive: true });
    userService.profiles.set(inactive, { userId: inactive, role: 'STUDENT', isActive: false });

    assert.deepEqual((await live()).entries.map((e: any) => [e.userId, e.rank]), [[s1, 1], [s2, 2], [s3, 3]]);
    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.totalPointsAwarded, 2200);
    assert.deepEqual((await entries()).map((e: any) => [e.userId, e.rank]), [[s1, 1], [s2, 2], [s3, 3]]);
    for (const u of [admin, instructor, inactive]) {
      assert.equal((await ledger(u)).length, 0);
      assert.equal(await prisma.badge.count({ where: { userId: u } }), 0);
      assert.equal(await prisma.userRewardPoint.count({ where: { userId: u } }), 0);
    }
    assert.equal((await ledger(s1))[0].amount, 1000);
  });

  it('ELIG-05/06 an unreachable or unusable User Service never yields a snapshot or a payment; the same period completes afterwards', async () => {
    await record(U[0], 50, 0); await record(U[1], 30, 0);
    for (const mode of ['timeout', 'http500', 'empty'] as const) {
      userService.mode = mode;
      const r: any = await settle(finalize());
      assert.equal(r.ok, false, mode);
      assert.ok(r.error instanceof UserEligibilityError, mode);
    }
    assert.equal(await prisma.leaderboardEntry.count({}), 0);
    assert.equal(await prisma.rewardPointTransaction.count({}), 0);
    assert.notEqual((await board()).status, 'FINALIZED');

    userService.mode = 'ok';
    userService.rawAnswer = (ids) => ({ data: ids.map((u) => ({ userId: u, fullName: 'old contract' })) });
    assert.equal((await settle(finalize()) as any).ok, false, 'no usable role/isActive anywhere -> contract mismatch');
    userService.rawAnswer = undefined;

    const ok = await finalize();
    assert.equal(ok.status, 'FINALIZED');
    assert.equal((await entries()).length, 2);
  });

  it('an already-frozen snapshot containing an admin: no new reward for them, frozen ranks unchanged, others paid by their frozen rank', async () => {
    const [admin, s1, s2] = U;
    const b = await prisma.monthlyLeaderboard.create({ data: { month: MONTH, year: YEAR, status: 'SNAPSHOT_FROZEN', totalParticipants: 3, finalizedBy: 'older-build' } });
    for (const [u, rank, points] of [[admin, 1, 100], [s1, 2, 50], [s2, 3, 30]] as Array<[string, number, number]>) {
      await prisma.leaderboardEntry.create({ data: { leaderboardId: b.id, userId: u, rank, points, completedCourses: 1, lastCompletedAt: new Date(BASE) } });
    }
    userService.profiles.set(admin, { userId: admin, role: 'ADMIN', isActive: true });
    const before = (await entries()).map((e: any) => [e.id, e.userId, e.rank, e.points, e.isTie]);

    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.rewardsSkippedIneligible, 1);
    assert.deepEqual((await entries()).map((e: any) => [e.id, e.userId, e.rank, e.points, e.isTie]), before);
    assert.equal((await ledger(admin)).length, 0);
    assert.equal((await ledger(s1))[0].amount, 700);
    assert.equal((await ledger(s2))[0].amount, 500);
    assert.equal(r.totalPointsAwarded, 1200);
    assert.equal(await prisma.leaderboardAuditLog.count({ where: { action: 'REWARD_SKIPPED_INELIGIBLE', targetUserId: admin } }), 1);
  });

  it('ELIG-10 a FINALIZED period is not re-filtered, re-ranked or touched when an account changes later', async () => {
    await record(U[0], 50, 0); await record(U[1], 30, 0);
    await finalize();
    const snapshotJson = JSON.stringify({ b: await board(), e: await entries(), l: await prisma.rewardPointTransaction.findMany({ orderBy: { id: 'asc' } }) });
    userService.profiles.set(U[0], { userId: U[0], role: 'STUDENT', isActive: false });
    userService.eligibilityCalls.length = 0;
    calls.length = 0;

    const history = await live();
    assert.deepEqual(history.entries.map((e: any) => e.userId), [U[0], U[1]].sort((x, y) => (x === U[0] ? -1 : 1)));
    assert.equal((await finalize()).status, 'ALREADY_FINALIZED');
    assert.equal(JSON.stringify({ b: await board(), e: await entries(), l: await prisma.rewardPointTransaction.findMany({ orderBy: { id: 'asc' } }) }), snapshotJson);
    assert.equal(userService.eligibilityCalls.length, 0);
    assert.deepEqual(calls.filter((c) => ['create', 'createMany', 'update', 'updateMany', 'upsert', 'deleteMany'].includes(c.op)), []);
  });
});
