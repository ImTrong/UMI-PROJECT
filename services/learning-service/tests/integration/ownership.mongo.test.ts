/**
 * FIX 06B2 integration tests on a REAL MongoDB replica set: the monthly finalization under the per-period lock with
 * fencing - real transactions, real rollback, the raw $$NOW fence, MongoDB's serialization of a take-over against an
 * open transaction, real unique indexes. Opt-in; see tests/helpers/test-db-url.ts.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06b2_test?replicaSet=rsTest" npm test
 *
 * Own database (`<name>_ownership`), created with `prisma db push`, dropped afterwards. Never point it at a shared
 * database. IMPORTANT about what "concurrent" means here: everything runs in ONE Node process - several Promises and
 * several PrismaClients (separate connection pools) racing against one MongoDB. Genuinely separate Node PROCESSES are
 * FIX 06C.
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolveTestDb } from '../helpers/test-db-url';
import { installFaultyPrisma } from '../helpers/faulty-prisma';
import { installUserServiceStub } from '../helpers/user-service-stub';

const target = resolveTestDb('ownership');

describe('REAL MongoDB replica set: finalization ownership (lock + fencing)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let prisma: any;
  let faulty: any;
  let axios: any;
  let LeaderboardService: any;
  let LeaderboardRewardIncompleteError: any;
  let lockModule: any;
  let userService: ReturnType<typeof installUserServiceStub>;
  const extraClients: any[] = [];

  const oid = () => randomBytes(12).toString('hex');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const MONTH = 9;
  const YEAR = 2026;
  const PAY = [1000, 700, 500, 200];
  const TOTAL = 2400;
  const STUDENTS = [oid(), oid(), oid(), oid()];
  let U: string[];
  let notified: string[] = [];
  let failNotificationFor = new Set<string>();
  let onNotifyHook: ((body: any) => Promise<void> | void) | null = null;

  /** A second "process": its own PrismaClient (own pool) and lock service. */
  const newLockService = (config = { ttlMs: 60_000, heartbeatMs: 20_000 }) => {
    const client = new faulty.FaultyPrismaClient();
    extraClients.push(client);
    return new lockModule.LeaderboardLockService({ prisma: client, config });
  };

  before(async () => {
    process.env.DATABASE_URL = target.url;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: target.url }, stdio: 'pipe' });
    faulty = installFaultyPrisma();
    prisma = new faulty.FaultyPrismaClient();
    axios = require('axios').default || require('axios');
    require('../../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    ({ LeaderboardService, LeaderboardRewardIncompleteError } = require('../../src/services/leaderboard.service'));
    lockModule = require('../../src/services/leaderboard-lock.service');
  });

  after(async () => {
    LeaderboardService.useLockService(null);
    try { await prisma.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await prisma.$disconnect();
    for (const c of extraClients) await c.$disconnect().catch(() => undefined);
  });

  const seedWorld = async () => {
    faulty.faults.length = 0;
    faulty.hooks.length = 0;
    for (const m of ['leaderboardEntry', 'monthlyLeaderboard', 'courseCompletionRecord', 'badge', 'rewardPointTransaction', 'userRewardPoint', 'leaderboardAuditLog']) {
      await prisma[m].deleteMany({});
    }
    U = STUDENTS;                          // the same four ids in every rebuilt world, so disturbed and undisturbed runs are comparable
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
    onNotifyHook = null;
    mock.restoreAll();
    userService = installUserServiceStub(axios, mock, async (body) => {
      if (onNotifyHook) await onNotifyHook(body);
      if (failNotificationFor.has(body.userId)) throw new Error('user-service unavailable');
      notified.push(body.userId);
    });
    LeaderboardService.useLockService(null); // default: MongoLockStore on the module's client, 60 s lease
    faulty.calls.length = 0;
    faulty.txEvents.length = 0;
  };
  beforeEach(seedWorld);

  const run = (opts?: any, who = 'IT') => LeaderboardService.finalizeMonth(MONTH, YEAR, who, opts);
  const settle = (p: Promise<any>) => p.then((value: any) => ({ ok: true, value }), (error: any) => ({ ok: false, error }));
  const board = () => prisma.monthlyLeaderboard.findUnique({ where: { month_year: { month: MONTH, year: YEAR } } });
  const entries = () => prisma.leaderboardEntry.findMany({ orderBy: { rank: 'asc' } });
  const awards = (u: string) => prisma.rewardPointTransaction.findMany({ where: { userId: u, type: 'LEADERBOARD_REWARD' } });
  const wallet = (u: string) => prisma.userRewardPoint.findUnique({ where: { userId: u } });
  const badges = (u: string) => prisma.badge.findMany({ where: { userId: u, badgeType: 'LEADERBOARD_REWARD' } });
  const notifiedCount = (u: string) => notified.filter((x) => x === u).length;
  const calls = () => faulty.calls as Array<{ model: string; op: string }>;
  const count = (model: string, op: string) => calls().filter((c) => c.model === model && c.op === op).length;
  const isRawFence = (c: { model: string; op: string }) => c.model === '$raw' && c.op === 'update';

  /** Everything that makes up the period and its money, straight from MongoDB. */
  const fingerprint = async () =>
    JSON.stringify({
      board: await board(),
      entries: await entries(),
      ledger: await prisma.rewardPointTransaction.findMany({ orderBy: { id: 'asc' } }),
      wallets: await prisma.userRewardPoint.findMany({ orderBy: { id: 'asc' } }),
      badges: await prisma.badge.findMany({ orderBy: { id: 'asc' } }),
      audit: await prisma.leaderboardAuditLog.findMany({ orderBy: { id: 'asc' } }),
    });
  /** The same without ids and timestamps - to compare a disturbed run with an undisturbed one. */
  const summary = async () => {
    const b = await board();
    return JSON.stringify({
      board: b && { status: b.status, totalParticipants: b.totalParticipants, totalPointsAwarded: b.totalPointsAwarded },
      entries: (await entries()).map((e: any) => [e.userId, e.rank, e.rewardPoints, !!e.rewardBadgeId, !!e.rewardNotifiedAt, e.rewardNotifyError ?? null]),
      ledger: (await prisma.rewardPointTransaction.findMany({})).map((t: any) => [t.userId, t.amount, t.idempotencyKey]).sort(),
      wallets: (await prisma.userRewardPoint.findMany({})).map((w: any) => [w.userId, w.balance, w.totalEarned, w.totalSpent]).sort(),
      badges: (await prisma.badge.findMany({})).map((x: any) => [x.userId, x.badgeName]).sort(),
      audit: (await prisma.leaderboardAuditLog.findMany({})).map((a: any) => a.action).sort(),
      notified: [...notified].sort(),
    });
  };
  const assertAllPaidOnce = async (users = U, pay = PAY) => {
    for (const u of users) {
      const i = U.indexOf(u);
      const a = await awards(u);
      assert.equal(a.length, 1, `reward ledger entries for rank ${i + 1}`);
      assert.equal(a[0].amount, pay[i]);
      assert.equal((await wallet(u)).balance, pay[i], 'wallet = reward, never doubled');
      assert.equal((await badges(u)).length, 1);
    }
  };
  const forceExpiry = (secondsAgo = 5) =>
    prisma.monthlyLeaderboard.updateMany({ where: { month: MONTH, year: YEAR }, data: { lockExpiresAt: new Date(Date.now() - secondsAgo * 1000) } });
  /** Hold `run()`'s first eligibility call (the User Service call of the snapshot build) until `release()`. */
  const pauseEligibility = () => {
    let release: () => void = () => undefined;
    const paused = new Promise<void>((r) => { release = r; });
    let reached: () => void = () => undefined;
    const reachedGate = new Promise<void>((r) => { reached = r; });
    userService.gate = async () => { userService.gate = undefined; reached(); await paused; };
    return { release, reachedGate };
  };
  const seedFrozen = async (status: string) => {
    const b = await prisma.monthlyLeaderboard.create({ data: { month: MONTH, year: YEAR, status, totalParticipants: 4, finalizedBy: 'earlier-run' } });
    for (const [i, u] of U.entries()) {
      await prisma.leaderboardEntry.create({
        data: { leaderboardId: b.id, userId: u, rank: i + 1, points: 50 - i * 10, completedCourses: 1, lastCompletedAt: new Date(`2026-09-0${i + 5}T10:00:00Z`), rewardPoints: PAY[i] },
      });
    }
    return b;
  };

  // ==============================================================================================

  /** Transactions that are open right now on the real client (begin without commit / rollback yet). */
  const openTransactions = () =>
    faulty.txEvents.filter((e: any) => e.kind === 'begin').length - faulty.txEvents.filter((e: any) => e.kind !== 'begin').length;

  it('REAL-01 a normal run on MongoDB: lock acquired once, period FINALIZED, lock released, fencing history kept; no HTTP call while a transaction is open', async () => {
    let httpInsideTransaction = 0;
    userService.gate = async () => { if (openTransactions() !== 0) httpInsideTransaction++; };   // before every eligibility call (stays installed)
    onNotifyHook = async () => { if (openTransactions() !== 0) httpInsideTransaction++; };
    const r = await run();
    assert.equal(httpInsideTransaction, 0, 'neither the User Service eligibility calls nor the notifications were made inside a transaction');
    assert.ok(userService.eligibilityCalls.length >= 2 && notified.length === 4, 'and they did happen');
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.totalPointsAwarded, TOTAL);
    const b = await board();
    assert.equal(b.status, 'FINALIZED');
    assert.equal(b.lockToken, null);
    assert.equal(b.lockExpiresAt, null);
    assert.equal(b.fencingToken, 1);
    assert.ok(b.fenceSeq >= 8, `fenceSeq counts the fenced transactions (${b.fenceSeq})`);
    await assertAllPaidOnce();
    for (const u of U) assert.equal(notifiedCount(u), 1);
  });

  it('REAL-02 EVERY real transaction of a finalize run begins with the raw lock fence (first statement)', async () => {
    for (const prepare of [async () => undefined, async () => { await seedFrozen('SNAPSHOT_FROZEN'); }]) {
      await seedWorld();
      await prepare();
      faulty.calls.length = 0;
      faulty.txEvents.length = 0;
      assert.equal((await run()).status, 'FINALIZED');
      const segments = faulty.txSegments();
      assert.ok(segments.length >= 8, `fenced transactions: ${segments.length}`);
      for (const [i, seg] of segments.entries()) {
        assert.ok(isRawFence(seg.calls[0]), `transaction #${i + 1} starts with ${seg.calls[0]?.model}.${seg.calls[0]?.op}, not with the fence`);
        assert.equal(seg.outcome, 'commit');
      }
    }
  });

  it('REAL-03 FIX 06A scenario S3 on a real replica set: the stalled old owner wakes up after the new owner FINALIZED -> it cannot delete or recreate the entries', async () => {
    const gate = pauseEligibility();
    const aRun = settle(run(undefined, 'A'));
    await gate.reachedGate;
    assert.equal((await board()).status, 'SNAPSHOT_BUILDING');

    await forceExpiry();                                     // A stalled: its lease lapsed on the MongoDB clock
    const b = await run(undefined, 'B');                     // B takes over and finishes the whole period
    assert.equal(b.status, 'FINALIZED');
    const idsAfterB = (await entries()).map((e: any) => e.id);
    const afterB = await fingerprint();
    const deletes = count('leaderboardEntry', 'deleteMany');
    const creates = count('leaderboardEntry', 'createMany');

    gate.release();                                          // A resumes with its stale rankings
    const a = await aRun;

    assert.equal(a.ok && a.value.status, 'ALREADY_FINALIZED');
    assert.equal(count('leaderboardEntry', 'deleteMany'), deletes, 'A never deleted the finalized entries');
    assert.equal(count('leaderboardEntry', 'createMany'), creates, 'A never recreated them');
    assert.deepEqual((await entries()).map((e: any) => e.id), idsAfterB, 'same entry documents as B left them');
    for (const e of await entries()) assert.ok(e.rewardBadgeId, 'badge links survived');
    assert.equal(await fingerprint(), afterB, 'MongoDB is byte-identical to the moment B finished');
    await assertAllPaidOnce();
  });

  it('REAL-04 the same stall, new owner not finished: the old owner is fenced out before it touches the leftover snapshot, and gets LockLostError', async () => {
    const b0 = await prisma.monthlyLeaderboard.create({ data: { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 0, finalizedBy: 'older' } });
    await prisma.leaderboardEntry.create({ data: { leaderboardId: b0.id, userId: U[2], rank: 1, points: 1, completedCourses: 1, lastCompletedAt: new Date('2026-09-01T00:00:00Z'), rewardPoints: 1000 } });
    const gate = pauseEligibility();
    const aRun = settle(run(undefined, 'A'));
    await gate.reachedGate;
    await forceExpiry();
    const bLock = newLockService();
    const b = await bLock.acquire(MONTH, YEAR, { owner: 'B' });
    assert.equal(b.status, 'ACQUIRED');
    const before = await fingerprint();
    faulty.calls.length = 0;
    gate.release();
    const a = await aRun;

    assert.equal(a.ok, false);
    assert.ok(a.error instanceof lockModule.LockLostError, a.error?.message);
    assert.equal(a.error.reason, 'REPLACED');
    assert.equal(await fingerprint(), before, 'neither the snapshot, nor the status, nor the lock changed');
    assert.equal(count('leaderboardEntry', 'deleteMany'), 0);
    assert.equal(count('leaderboardEntry', 'createMany'), 0);
    assert.equal((await entries()).length, 1, 'the leftover entry is still there');
    assert.equal((await board()).lockToken, b.handle.lockToken, 'the old owner did not release the new owner\'s lock');
  });

  const SCENARIOS: Array<{ name: string; setup: () => Promise<void>; paid: string[]; total: number }> = [
    { name: 'fresh period', setup: async () => undefined, paid: [], total: TOTAL },
    { name: 'REWARDING period after a crash', setup: async () => { await seedFrozen('REWARDING'); }, paid: [], total: TOTAL },
  ];
  for (const sc of SCENARIOS) {
    it(`REAL-05 [${sc.name}] the lock is taken over right before EACH real fenced transaction: the old owner writes nothing more; the next run ends exactly like an undisturbed run`, async () => {
      await seedWorld();
      await sc.setup();
      faulty.calls.length = 0;
      faulty.txEvents.length = 0;
      assert.equal((await run()).status, 'FINALIZED');
      const K = faulty.txSegments().length;
      const reference = await summary();
      assert.ok(K >= 8, `fenced transactions in a full run: ${K}`);

      for (let k = 1; k <= K; k++) {
        await seedWorld();
        await sc.setup();
        const bLock = newLockService();
        let bHandle: any = null;
        let atTakeover: { fp: string; eligibility: number; notified: number; at: number } | null = null;
        let seen = 0;
        const arm = () =>
          faulty.beforeNext('$raw', 'update', async () => {              // the fence of the next real transaction
            if (++seen === k) {
              const at = calls().length;                                  // (includes this fence call)
              await forceExpiry();                                        // A's lease lapsed on the MongoDB clock ...
              const b = await bLock.acquire(MONTH, YEAR, { owner: 'B' }); // ... and B takes over
              assert.equal(b.status, 'ACQUIRED', `k=${k}`);
              bHandle = b.handle;
              atTakeover = { fp: await fingerprint(), eligibility: userService.eligibilityCalls.length, notified: notified.length, at };
              return;
            }
            arm();
          });
        arm();

        const a = await settle(run(undefined, 'A'));
        const label = `[takeover before real fenced transaction #${k}/${K}]`;
        assert.ok(bHandle, `${label} the takeover happened`);
        assert.equal(a.ok, false, `${label} the old owner must fail`);
        assert.ok(a.error instanceof lockModule.LockLostError, `${label} LockLostError expected, got ${a.error?.name}: ${a.error?.message}`);
        assert.ok(!(a.error instanceof LeaderboardRewardIncompleteError), `${label} not swallowed into an "incomplete rewards" failure`);
        assert.equal(a.error.reason, 'REPLACED');
        assert.equal(await fingerprint(), atTakeover!.fp, `${label} the old owner changed data after losing the lock`);
        assert.equal(userService.eligibilityCalls.length, atTakeover!.eligibility, `${label} no HTTP call after the loss`);
        assert.equal(notified.length, atTakeover!.notified, `${label} no notification after the loss`);
        assert.equal(calls().slice(atTakeover!.at - 1).filter(isRawFence).length, 1, `${label} the refused fence was attempted exactly once (never retried)`);
        const row = await board();
        assert.equal(row.lockToken, bHandle.lockToken, `${label} the old owner must not release the new owner's lock`);
        assert.equal(row.fencingToken, bHandle.fencingToken);

        assert.deepEqual(await bLock.release(bHandle), { released: true });
        const done = await run(undefined, 'RECOVERY');
        assert.equal(done.status, 'FINALIZED', `${label} recovery`);
        assert.equal(await summary(), reference, `${label} ends exactly like an undisturbed run`);
        await assertAllPaidOnce();
        for (const u of U) assert.equal(notifiedCount(u), 1, `${label} notified exactly once`);
      }
    });
  }

  it('REAL-06 MongoDB serializes a take-over against the owner\'s OPEN snapshot transaction: it commits whole, the take-over waits, then the old owner is fenced out', async () => {
    const ttl = { ttlMs: 1000, heartbeatMs: 300 };
    LeaderboardService.useLockService(newLockService(ttl));
    const bLock = newLockService(ttl);
    let committedAfterHook = 0;
    let takeoverDoneAt = 0;
    let takeover: Promise<any> = Promise.resolve();
    faulty.beforeNext('leaderboardEntry', 'createMany', async () => {     // inside A's snapshot transaction, fence + delete already done
      await sleep(1300);                                                  // the 1 s lease lapses WHILE the transaction is open
      takeover = bLock.acquire(MONTH, YEAR, { owner: 'B' }).then((r: any) => { takeoverDoneAt = Date.now(); return r; });
      await sleep(300);
      committedAfterHook = Date.now();
    });
    const a = await settle(run(undefined, 'A'));
    const b: any = await takeover;

    assert.equal(b.status, 'ACQUIRED', 'B took over once the transaction was over');
    assert.ok(takeoverDoneAt >= committedAfterHook, 'and only after A\'s transaction had finished');
    assert.equal(b.handle.fencingToken, 2);
    const period = await board();
    assert.equal((await entries()).length, 4, 'A\'s snapshot transaction committed whole');
    assert.equal(period.totalParticipants, 4);
    assert.ok(a.ok === false && a.error instanceof lockModule.LockLostError, `A is fenced out afterwards: ${a.error?.message}`);
    assert.ok(['SNAPSHOT_FROZEN'].includes(period.status), `no reward phase ran for the old owner (status ${period.status})`);
    assert.equal(await prisma.rewardPointTransaction.count({}), 0);
    assert.equal(period.lockToken, b.handle.lockToken);
  });

  it('REAL-07 concurrent finalize requests (several clients) -> one owner; the others are BUSY / ALREADY_FINALIZED and write nothing; rewards once', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => run(undefined, `req-${i}`)));
    assert.equal(results.filter((r: any) => r.status === 'FINALIZED').length, 1, JSON.stringify(results.map((r: any) => r.status)));
    assert.ok(results.filter((r: any) => r.status !== 'FINALIZED').every((r: any) => ['BUSY', 'ALREADY_FINALIZED'].includes(r.status)));
    assert.equal(count('leaderboardEntry', 'createMany'), 1, 'the snapshot was written once');
    await assertAllPaidOnce();
    for (const u of U) assert.equal(notifiedCount(u), 1);
    assert.equal((await board()).fencingToken, 1);
  });

  it('REAL-08 a period owned by another client answers BUSY and not a single write reaches MongoDB', async () => {
    const other = newLockService();
    assert.equal((await other.acquire(MONTH, YEAR, { owner: 'someone-else' })).status, 'ACQUIRED');
    const before = await fingerprint();
    faulty.calls.length = 0;
    for (const arg of [undefined, { simulateFailureAt: 'BEFORE_FINALIZED' }, true]) {
      assert.equal((await LeaderboardService.finalizeMonth(MONTH, YEAR, 'X', arg)).status, 'BUSY');
    }
    assert.equal(await fingerprint(), before);
    const writes = calls().filter((c) => ['create', 'createMany', 'update', 'updateMany', 'upsert', 'deleteMany'].includes(c.op));
    assert.deepEqual(writes, [], 'no model write');
    assert.equal(userService.eligibilityCalls.length, 0);
  });

  it('REAL-09 a snapshot that fails mid-write rolls back completely on MongoDB: leftovers of an older run stay, status stays SNAPSHOT_BUILDING', async () => {
    const b0 = await prisma.monthlyLeaderboard.create({ data: { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 0, finalizedBy: 'older' } });
    await prisma.leaderboardEntry.create({ data: { leaderboardId: b0.id, userId: U[2], rank: 1, points: 1, completedCourses: 1, lastCompletedAt: new Date('2026-09-01T00:00:00Z'), rewardPoints: 1000 } });
    const r = await settle(run({ simulateFailureAt: 'BEFORE_SNAPSHOT_CONFIRM' }));
    assert.equal(r.ok, false);
    assert.match(r.error.message, /SIMULATION/);
    const leftovers = await entries();
    assert.equal(leftovers.length, 1, 'the delete AND the partial insert were rolled back');
    assert.equal(leftovers[0].userId, U[2]);
    assert.equal((await board()).status, 'SNAPSHOT_BUILDING');
    assert.equal((await board()).lockToken, null);
    assert.equal((await run()).status, 'FINALIZED', 'and the next run rebuilds it');
    assert.deepEqual((await entries()).map((e: any) => e.userId), U);
  });

  it('REAL-10 slow work longer than the lease keeps the lock on a real replica set (heartbeat renews on the MongoDB clock)', async () => {
    const ttl = { ttlMs: 1500, heartbeatMs: 400 };
    LeaderboardService.useLockService(newLockService(ttl));
    const rival = newLockService(ttl);
    let rivalResult: any = null;
    userService.gate = async () => {
      userService.gate = undefined;
      await sleep(2400);                                                  // 1.6 x the lease
      rivalResult = await rival.acquire(MONTH, YEAR, { owner: 'rival' });
    };
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(rivalResult.status, 'BUSY');
    assert.equal((await board()).fencingToken, 1, 'never taken over');
    await assertAllPaidOnce();
  });

  it('REAL-11 notifications: 8 concurrent retries of one failed notification -> sent exactly once (atomic claim on MongoDB)', async () => {
    failNotificationFor.add(U[2]);
    assert.equal((await run()).notificationsPending, 1);
    failNotificationFor.clear();
    notified = [];
    onNotifyHook = async () => { await sleep(250); };                      // keep the sender "on the wire" long enough for the others to collide
    const results = await Promise.all(Array.from({ length: 8 }, () => LeaderboardService.retryFailedNotifications(MONTH, YEAR)));
    assert.deepEqual(notified, [U[2]], 'one message in total');
    assert.equal(results.filter((n: number) => n === 0).length, 1, 'exactly one retry delivered it');
    const e = (await entries()).find((x: any) => x.userId === U[2]);
    assert.ok(e.rewardNotifiedAt);
    assert.equal(e.rewardNotifyError, null);
    assert.equal(e.rewardNotifyClaimToken, null);
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.equal(notified.length, 1);
  });

  it('REAL-12 a claim left by a crashed sender is retried once it has lapsed, and respected before that', async () => {
    failNotificationFor.add(U[2]);
    await run();
    failNotificationFor.clear();
    notified = [];
    const entry = (await entries()).find((x: any) => x.userId === U[2]);
    await prisma.leaderboardEntry.update({ where: { id: entry.id }, data: { rewardNotifyError: null, rewardNotifyClaimToken: 'crashed', rewardNotifyClaimExpiresAt: new Date(Date.now() + 30_000) } });
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1, 'a live claim is respected');
    assert.equal(notified.length, 0);
    await prisma.leaderboardEntry.update({ where: { id: entry.id }, data: { rewardNotifyClaimExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.deepEqual(notified, [U[2]]);
  });

  it('REAL-13 a notification is never sent inside a transaction and never after the lock owner is gone (claim handed back)', async () => {
    // lease runs out right after the claim of the first notification: the local deadline forbids the send
    const ttl = { ttlMs: 1000, heartbeatMs: 300 };
    LeaderboardService.useLockService(newLockService(ttl));
    let inFlight = 0;
    onNotifyHook = async () => { inFlight++; };
    faulty.beforeNext('leaderboardEntry', 'updateMany', async () => { await sleep(1100); });   // stall inside the claim transaction past the lease
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok(r.error instanceof lockModule.LockLostError, r.error?.message);
    assert.equal(inFlight, 0, 'nothing was sent');
    assert.equal(notified.length, 0);
    const first = (await entries()).find((x: any) => x.userId === U[0]);
    assert.equal(first.rewardNotifyClaimToken, null, 'the claim was handed back, not left to lapse');
  });

  it('REAL-14 FINALIZED can not be reopened by any caller: acquire refuses it, finalize returns ALREADY_FINALIZED, nothing changes', async () => {
    await run();
    const before = await fingerprint();
    const other = newLockService();
    for (const flags of [{}, { force: true }, { takeOver: true }]) {
      assert.deepEqual(await other.acquire(MONTH, YEAR, flags as any), { status: 'FINALIZED' });
    }
    faulty.calls.length = 0;
    for (const arg of [undefined, true, { simulateFailureAt: 'AFTER_FIRST_REWARD' }]) {
      assert.equal((await LeaderboardService.finalizeMonth(MONTH, YEAR, 'again', arg)).status, 'ALREADY_FINALIZED');
    }
    assert.equal(await fingerprint(), before);
    assert.equal(count('leaderboardEntry', 'deleteMany'), 0);
  });
});
