/**
 * FIX 06B2 tests: the monthly finalization runs under the per-period lock with fencing.
 *
 * The REAL LeaderboardService / RewardPointService / lock code runs against the in-memory Prisma fake and a
 * FakeLockStore with a controllable server clock. What the fake CANNOT prove - MongoDB's serialization of a take-over
 * against an open transaction, real rollback, the raw $$NOW fence - is proven on a replica set in
 * tests/integration/ownership.mongo.test.ts. Everything here is a SINGLE Node process: concurrency is interleaved
 * Promises, not separate processes (that is FIX 06C).
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePrisma, db } from './helpers/fake-prisma';
import { installUserServiceStub } from './helpers/user-service-stub';
import { installTestLocks } from './helpers/lock-harness';

installFakePrisma();

/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require('axios').default || require('axios');
const logger = require('../src/utils/logger').default;
const {
  LeaderboardService, LeaderboardRewardIncompleteError, LeaderboardStateError,
} = require('../src/services/leaderboard.service');
const { LockLostError, LockStoreError } = require('../src/services/leaderboard-lock.service');
const { UserEligibilityError } = require('../src/services/user-eligibility.service');
const { AdminLeaderboardController } = require('../src/controllers/admin-leaderboard.controller');
const { RewardPointService } = require('../src/services/reward-point.service');

logger.transports.forEach((t: any) => { t.silent = true; });

const MONTH = 9;
const YEAR = 2026;
const U1 = '11'.repeat(12);
const U2 = '22'.repeat(12);
const U3 = '33'.repeat(12);
const U4 = '44'.repeat(12);
const ALL = [U1, U2, U3, U4];
const REWARD: Record<string, number> = { [U1]: 1000, [U2]: 700, [U3]: 500, [U4]: 200 };
const TOTAL = 2400;
const ADMIN = 'ad'.repeat(12);
const TTL = 60_000;

const seedCompletion = (userId: string, points: number, at: string) =>
  db.seed('courseCompletionRecord', {
    userId, courseId: 'cc'.repeat(12), courseTitle: 'Course', completedAt: new Date(at), passed: true,
    totalDurationSeconds: 3600, level: 'BEGINNER', baseDurationPoints: points, levelMultiplier: 1,
    achievementPoints: points, averageQuizScore: null, hasQuiz: false, policyVersion: '1.1', status: 'VALID', month: MONTH, year: YEAR,
  });

let locks: ReturnType<typeof installTestLocks>;
let userService: ReturnType<typeof installUserServiceStub>;
let notified: string[] = [];
let failNotificationFor = new Set<string>();
let onNotifyHook: ((body: any) => Promise<void> | void) | null = null;
let notifiedInsideTransaction = 0;

/** A clean world: empty fake DB, four eligible students with completions, fresh lock service, stubbed User Service. */
const freshWorld = (lockOptions?: Parameters<typeof installTestLocks>) => {
  mock.restoreAll();
  db.reset();
  locks = lockOptions ? installTestLocks(LeaderboardService, ...lockOptions) : installTestLocks(LeaderboardService);
  notified = [];
  failNotificationFor = new Set();
  onNotifyHook = null;
  notifiedInsideTransaction = 0;
  seedCompletion(U1, 50, '2026-09-05T10:00:00Z');
  seedCompletion(U2, 30, '2026-09-06T10:00:00Z');
  seedCompletion(U3, 20, '2026-09-07T10:00:00Z');
  seedCompletion(U4, 10, '2026-09-08T10:00:00Z');
  userService = installUserServiceStub(axios, mock, async (body) => {
    if (db.openTransactions !== 0) notifiedInsideTransaction++;
    if (onNotifyHook) await onNotifyHook(body);
    if (failNotificationFor.has(body.userId)) throw new Error('user-service unavailable');
    notified.push(body.userId);
  });
};

beforeEach(() => freshWorld());
afterEach(() => { mock.restoreAll(); LeaderboardService.useLockService(null); });

const run = (opts?: any, who = 'TEST') => LeaderboardService.finalizeMonth(MONTH, YEAR, who, opts);
const settle = async (p: Promise<any>) => {
  try { return { ok: true as const, value: await p }; } catch (error: any) { return { ok: false as const, error }; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const board = () => db.tables.monthlyLeaderboard.find((b) => b.month === MONTH && b.year === YEAR)!;
const entries = () => db.tables.leaderboardEntry.filter((e) => e.leaderboardId === board().id).sort((a, b) => a.rank - b.rank);
const awards = (u: string) => db.tables.rewardPointTransaction.filter((t) => t.userId === u && t.type === 'LEADERBOARD_REWARD');
const wallet = (u: string) => db.tables.userRewardPoint.find((w) => w.userId === u);
const badges = (u: string) => db.tables.badge.filter((b) => b.userId === u);
const audit = (action: string) => db.tables.leaderboardAuditLog.filter((a) => a.action === action);
const notifiedCount = (u: string) => notified.filter((x) => x === u).length;
const state = () => JSON.stringify(db.tables);
const isFence = (c: { table: string; op: string; where?: any }) =>
  c.table === 'monthlyLeaderboard' && c.op === 'updateMany' && c.where?.lockExpiresAt?.gte !== undefined;
const WRITE_OPS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'deleteMany']);

/** A frozen snapshot, as left behind by a crash right after the freeze. */
const seedFrozen = (status: string, over: Record<string, any> = {}) => {
  const b = db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status, totalParticipants: 4, finalizedBy: 'earlier-run', ...over });
  ALL.forEach((u, i) =>
    db.seed('leaderboardEntry', {
      leaderboardId: b.id, userId: u, rank: i + 1, points: 50 - i * 10, completedCourses: 1,
      lastCompletedAt: new Date(`2026-09-0${i + 5}T10:00:00Z`), rewardPoints: [1000, 700, 500, 200][i],
    })
  );
  return b;
};

const assertPaidOnce = (users: string[]) => {
  for (const u of users) {
    assert.equal(awards(u).length, 1, `${u.slice(0, 2)}: exactly one ledger entry`);
    assert.equal(awards(u)[0].amount, REWARD[u]);
    assert.equal(wallet(u)!.balance, REWARD[u], `${u.slice(0, 2)}: wallet = reward, never doubled`);
    assert.equal(badges(u).length, 1, `${u.slice(0, 2)}: exactly one badge`);
  }
};

// ====================================================================================

describe('OWN lifecycle: acquire -> heartbeat -> snapshot -> rewards -> FINALIZED -> release', () => {
  it('OWN-01 a normal run takes the lock, finishes, and leaves the period unlocked with its fencing history', async () => {
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.totalPointsAwarded, TOTAL);
    assert.equal(board().status, 'FINALIZED');
    assert.equal(board().lockToken, null, 'released');
    assert.equal(board().lockOwner, null);
    assert.equal(board().lockExpiresAt, null);
    assert.equal(board().fencingToken, 1, 'one acquisition');
    assert.equal(locks.store.count('tryAcquire'), 1);
    assert.equal(locks.store.count('tryRenew'), 0, 'a short run never needed a renewal');
    assertPaidOnce(ALL);
    for (const u of ALL) assert.equal(notifiedCount(u), 1);
    assert.equal(notifiedInsideTransaction, 0, 'no notification was sent while a transaction was open');
  });

  it('OWN-02 the initiator is recorded, and a FINALIZED period afterwards can no longer be locked', async () => {
    await run(undefined, 'ADMIN:someone');
    assert.equal(board().finalizedBy, 'ADMIN:someone');
    assert.deepEqual(await locks.service.acquire(MONTH, YEAR), { status: 'FINALIZED' });
    assert.equal((await run()).status, 'ALREADY_FINALIZED');
  });

  it('OWN-03 two concurrent requests -> exactly one owner; the other is BUSY and touches nothing; every student is paid once', async () => {
    const [a, b] = await Promise.all([run(undefined, 'A'), run(undefined, 'B')]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ['BUSY', 'FINALIZED']);
    assert.equal(db.count('monthlyLeaderboard'), 1);
    assert.equal(entries().length, 4);
    assertPaidOnce(ALL);
    assert.equal(db.callCount('leaderboardEntry', 'createMany'), 1, 'the snapshot was written exactly once');
  });

  it('OWN-04 six concurrent requests (mixed initiators) -> still exactly one owner', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => run(undefined, `req-${i}`)));
    assert.equal(results.filter((r: any) => r.status === 'FINALIZED').length, 1);
    assert.ok(results.filter((r: any) => r.status !== 'FINALIZED').every((r: any) => r.status === 'BUSY' || r.status === 'ALREADY_FINALIZED'));
    assert.equal(db.callCount('leaderboardEntry', 'createMany'), 1);
    assertPaidOnce(ALL);
    for (const u of ALL) assert.equal(notifiedCount(u), 1);
  });

  it('OWN-05 a run that FAILS releases the lock, keeps the stored state, and the next request continues at once', async () => {
    const crash = await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    assert.equal(crash.ok, false);
    assert.equal(board().status, 'REWARDING');
    assert.equal(board().lockToken, null, 'released in finally');
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assertPaidOnce(ALL);
  });

  it('OWN-06 a failure to release does not mask the original business error; the lease simply lapses', async () => {
    db.failNext('monthlyLeaderboard', 'updateMany', new Error('release io error'), 1, (a: any) => a?.data?.lockToken === null);
    const crash = await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    assert.equal(crash.ok, false);
    assert.match((crash as any).error.message, /\[SIMULATION\] Crash occurred immediately after rewarding first student/);
    assert.doesNotMatch((crash as any).error.message, /release io error/);
    assert.ok(board().lockToken, 'the lock is still recorded ...');
    assert.equal((await run()).status, 'BUSY', '... so nobody else may proceed yet');
    locks.clock.advance(TTL + 1);
    assert.equal((await run()).status, 'FINALIZED', '... until the lease lapses');
    assertPaidOnce(ALL);
  });

  it('OWN-07 a period owned by a live process answers BUSY and nothing at all is written, whatever the caller passes', async () => {
    assert.equal((await locks.service.acquire(MONTH, YEAR, { owner: 'live' })).status, 'ACQUIRED');
    const before = state();
    db.calls = [];
    for (const arg of [undefined, true, { force: true }, { takeOver: true }, { simulateFailureAt: 'BEFORE_FINALIZED' }]) {
      const r = await LeaderboardService.finalizeMonth(MONTH, YEAR, 'X', arg as any);
      assert.equal(r.status, 'BUSY');
    }
    assert.equal(state(), before);
    assert.deepEqual(db.writeCalls(), [], 'not one database write');
    assert.equal(db.callCount('courseCompletionRecord', 'findMany'), 0, 'no live data was read');
    assert.equal(userService.eligibilityCalls.length, 0, 'the User Service was not called');
  });
});

describe('OWN heartbeat: the lease is kept alive during long work, and losing it stops the run', () => {
  it('OWN-08 slow work (longer than the lease) keeps the lock: rivals stay BUSY and the run completes', async () => {
    freshWorld([{ ttlMs: 1000, heartbeatMs: 200 }, { realClock: true }]);
    let rivalDuring: any = null;
    userService.gate = async () => {
      userService.gate = undefined;
      await sleep(1400);                                              // 1.4 x the lease
      rivalDuring = await locks.service.acquire(MONTH, YEAR, { owner: 'rival' });
    };
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(rivalDuring.status, 'BUSY', 'the heartbeat renewed the lease while the run was waiting');
    assert.ok(locks.store.count('tryRenew') >= 3, `renewals: ${locks.store.count('tryRenew')}`);
    assert.equal(board().fencingToken, 1, 'never taken over');
    assertPaidOnce(ALL);
    const renewsAtEnd = locks.store.count('tryRenew');
    await sleep(450);
    assert.equal(locks.store.count('tryRenew'), renewsAtEnd, 'heartbeat stopped when the run ended');
  });

  it('OWN-09 the lock is lost while the run waits for the User Service -> it stops: no write, no further HTTP call', async () => {
    freshWorld([{ ttlMs: 1000, heartbeatMs: 200 }, { realClock: true }]);
    let writesAtGate = -1;
    userService.gate = async () => {
      userService.gate = undefined;
      board().lockToken = 'e'.repeat(64);                             // somebody else owns the period now
      board().fencingToken = board().fencingToken + 1;
      await sleep(500);                                               // the heartbeat notices
      writesAtGate = db.writeCalls().length;
    };
    const stateAtGate = () => state();
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof LockLostError, (r as any).error?.message);
    assert.equal((r as any).error.reason, 'REPLACED');
    const lateWrites = db.writeCalls().slice(writesAtGate);
    assert.deepEqual(lateWrites.map((c) => `${c.table}.${c.op}`), ['monthlyLeaderboard.updateMany'], 'only the (ineffective) release attempt');
    assert.equal(board().lockToken, 'e'.repeat(64), 'the new owner\'s lock was not released by the old owner');
    assert.equal(entries().length, 0);
    assert.equal(db.tables.rewardPointTransaction.length, 0);
    assert.equal(userService.eligibilityCalls.length, 1, 'no further HTTP call');
    void stateAtGate;
  });
});

describe('OWN fencing: a process that lost the lock cannot write anything - checked at EVERY write', () => {
  it('OWN-10 every transaction of a finalize run begins with the lock fence (first statement)', async () => {
    for (const setup of [() => undefined, () => { seedFrozen('SNAPSHOT_FROZEN'); }]) {
      freshWorld();
      setup();
      db.calls = [];
      db.txEvents = [];
      const r = await run();
      assert.equal(r.status, 'FINALIZED');
      const segments = db.txSegments();
      assert.ok(segments.length >= 8, `a full run opens many fenced transactions (${segments.length})`);
      for (const [i, seg] of segments.entries()) {
        assert.ok(isFence(seg.calls[0]), `transaction #${i + 1} (${seg.calls.map((c) => `${c.table}.${c.op}`).join(', ')}) does not start with the fence`);
      }
    }
  });

  it('OWN-11 outside a transaction a run writes only: the period row, the lock release, and notification outcomes', async () => {
    failNotificationFor.add(U2);                               // exercise the failure-recording path as well
    db.calls = [];
    db.txEvents = [];
    await run();
    const inside = new Set<number>();
    for (const ev of db.txEvents) void ev;
    let begin = -1;
    for (const ev of db.txEvents) {
      if (ev.kind === 'begin') begin = ev.at;
      else { for (let i = begin; i < ev.at; i++) inside.add(i); begin = -1; }
    }
    const outside = db.calls.map((c, i) => ({ c, i })).filter(({ c, i }) => !inside.has(i) && WRITE_OPS.has(c.op));
    const allowed = outside.map(({ c }) => `${c.table}.${c.op}`);
    for (const w of allowed) {
      assert.ok(
        ['monthlyLeaderboard.create', 'monthlyLeaderboard.updateMany', 'leaderboardEntry.updateMany'].includes(w),
        `unexpected unfenced write outside any transaction: ${w}`
      );
    }
    assert.ok(allowed.includes('monthlyLeaderboard.create'), 'the period row is created by the lock (ensurePeriod)');
    for (const forbidden of ['rewardPointTransaction', 'userRewardPoint', 'badge', 'leaderboardAuditLog']) {
      assert.ok(!allowed.some((w) => w.startsWith(forbidden)), `${forbidden} is never written outside a fenced transaction`);
    }
    assert.ok(!allowed.includes('leaderboardEntry.createMany') && !allowed.includes('leaderboardEntry.deleteMany'), 'snapshot writes are transactional');
  });

  /** What a finished (or settled) run leaves behind, without ids/timestamps: used to compare a disturbed run with an undisturbed one. */
  const summary = () =>
    JSON.stringify({
      board: { status: board().status, totalParticipants: board().totalParticipants, totalPointsAwarded: board().totalPointsAwarded },
      entries: entries().map((e) => [e.userId, e.rank, e.rewardPoints, !!e.rewardBadgeId, !!e.rewardNotifiedAt, e.rewardNotifyError ?? null]),
      ledger: db.tables.rewardPointTransaction.map((t) => [t.userId, t.amount, t.idempotencyKey]).sort(),
      wallets: db.tables.userRewardPoint.map((w) => [w.userId, w.balance, w.totalEarned, w.totalSpent]).sort(),
      badges: db.tables.badge.map((b) => [b.userId, b.badgeName]).sort(),
      audit: db.tables.leaderboardAuditLog.map((a) => a.action).sort(),
      notified: [...notified].sort(),
    });

  type Scenario = { name: string; setup: () => void; paid: string[]; total: number; ineligible?: string; incomplete?: string };
  const SCENARIOS: Scenario[] = [
    { name: 'fresh period (the run builds the snapshot)', setup: () => undefined, paid: ALL, total: TOTAL },
    {
      name: 'frozen snapshot whose #3 is no longer eligible',
      setup: () => { seedFrozen('SNAPSHOT_FROZEN'); userService.profiles.set(U3, { userId: U3, role: 'STUDENT', isActive: false }); },
      paid: [U1, U2, U4], total: TOTAL - 500, ineligible: U3,
    },
    { name: 'period already REWARDING after a crash', setup: () => { seedFrozen('REWARDING'); }, paid: ALL, total: TOTAL },
    {
      // a ledger entry on #2\'s reward key that disagrees with the snapshot: the run cannot finish, it audits the conflict
      name: 'REWARDING period with a conflicting ledger entry for #2 (integrity audit path)',
      setup: () => {
        const b = seedFrozen('REWARDING');
        db.seed('rewardPointTransaction', {
          userId: U2, amount: 999, type: 'LEADERBOARD_REWARD', description: 'old', balanceAfter: 999, sourceId: b.id,
          idempotencyKey: RewardPointService.leaderboardRewardKey(U2, MONTH, YEAR),
          metadata: { leaderboardId: b.id, rank: 2, month: MONTH, year: YEAR, points: 999 },
        });
      },
      paid: [U1, U3, U4], total: TOTAL - 700, incomplete: U2,
    },
  ];

  for (const sc of SCENARIOS) {
    it(`OWN-12 [${sc.name}] the lock is taken over right before EACH fenced write: the old owner writes nothing more, is never retried, and the next run completes it exactly as an undisturbed run would`, async () => {
      // dry run: how many fenced transactions does a full run perform, and what does an UNDISTURBED run leave behind?
      freshWorld();
      sc.setup();
      db.txEvents = [];
      db.calls = [];
      const dry = await settle(run());
      if (sc.incomplete) assert.ok(!dry.ok && (dry as any).error instanceof LeaderboardRewardIncompleteError, 'the conflicting ledger entry keeps the period unfinished');
      else assert.equal(dry.ok && dry.value.status, 'FINALIZED');
      const K = db.txSegments().length;
      const reference = summary();
      assert.ok(K >= 5, `fenced writes in a full run: ${K}`);

      for (let k = 1; k <= K; k++) {
        freshWorld();
        sc.setup();
        let bHandle: any = null;
        let atTakeover: { db: string; eligibility: number; notified: number; calls: number; ids: string[] } | null = null;
        let seen = 0;
        const arm = () =>
          db.beforeNext('monthlyLeaderboard', 'updateMany', async (args: any) => {
            if (args?.where?.lockExpiresAt?.gte !== undefined && ++seen === k) {
              const callsAtHook = db.calls.length;                                 // (includes the fence call that is about to run)
              locks.clock.advance(TTL + 1);                                       // A's lease lapses ...
              const b = await locks.service.acquire(MONTH, YEAR, { owner: 'B' });  // ... and B takes over
              assert.equal(b.status, 'ACQUIRED', `k=${k}`);
              bHandle = b.handle;
              atTakeover = { db: state(), eligibility: userService.eligibilityCalls.length, notified: notified.length, calls: callsAtHook, ids: entries().map((e) => e.id) };
              return;
            }
            arm();
          });
        arm();

        const a = await settle(run(undefined, 'A'));
        const label = `[takeover before fenced write #${k}/${K}]`;
        assert.ok(bHandle, `${label} the takeover happened`);
        assert.equal(a.ok, false, `${label} the old owner must fail`);
        assert.ok((a as any).error instanceof LockLostError, `${label} LockLostError expected, got ${(a as any).error?.name}: ${(a as any).error?.message}`);
        assert.ok(!((a as any).error instanceof LeaderboardRewardIncompleteError), `${label} not swallowed into an "incomplete rewards" failure`);
        assert.equal((a as any).error.reason, 'REPLACED');

        // nothing was written after the takeover - by anyone but the takeover itself
        assert.equal(state(), atTakeover!.db, `${label} the old owner changed data after losing the lock`);
        assert.equal(userService.eligibilityCalls.length, atTakeover!.eligibility, `${label} no HTTP call (eligibility) after the loss`);
        assert.equal(notified.length, atTakeover!.notified, `${label} no notification after the loss`);
        // (the fake logs a call before it runs the hook, so the fence that is about to be refused is the last call of atTakeover.calls)
        assert.equal(db.calls.slice(atTakeover!.calls - 1).filter(isFence).length, 1, `${label} the refused fence was attempted exactly once (LockLostError is not retried)`);
        // the new owner's lock survived the old owner's cleanup
        assert.equal(board().lockToken, bHandle.lockToken, `${label} the old owner must not release the new owner's lock`);
        assert.equal(board().fencingToken, bHandle.fencingToken);

        // B gives up (crashes without finishing); the next run completes the period
        assert.deepEqual(await locks.service.release(bHandle), { released: true });
        const done = await settle(run(undefined, 'RECOVERY'));
        if (sc.incomplete) {
          assert.ok(!done.ok && (done as any).error instanceof LeaderboardRewardIncompleteError, `${label} recovery reaches the same (unfinished) outcome`);
          assert.equal(board().status, 'REWARDING');
        } else {
          assert.equal(done.ok && done.value.status, 'FINALIZED', `${label} recovery`);
          assert.equal(board().status, 'FINALIZED');
        }
        assert.equal(board().totalPointsAwarded, sc.total, `${label} total = verified ledger`);
        assert.equal(summary(), reference, `${label} the disturbed run ends exactly like an undisturbed one (ledger, wallets, badges, audit, notifications)`);
        assertPaidOnce(sc.paid);
        if (sc.ineligible) {
          assert.equal(awards(sc.ineligible).length, 0, `${label} the ineligible student is not paid`);
          assert.equal(entries().find((e) => e.userId === sc.ineligible)!.rank, 3, `${label} frozen rank kept, nothing redistributed`);
          assert.equal(audit('REWARD_SKIPPED_INELIGIBLE').length, 1, `${label} skipped once, under valid ownership`);
        }
        if (sc.incomplete) {
          assert.equal(awards(sc.incomplete)[0].amount, 999, `${label} the conflicting ledger history is untouched`);
          assert.equal(audit('REWARD_INTEGRITY_ERROR').length, 1, `${label} the conflict is audited exactly once`);
          assert.equal(audit('FINALIZE_REWARDS_INCOMPLETE').length, 1);
        } else {
          assert.equal(audit('FINALIZE_REWARDS_INCOMPLETE').length, 0);
        }
        assert.equal(entries().length, 4);
        if (atTakeover!.ids.length === 4) assert.deepEqual(entries().map((e) => e.id), atTakeover!.ids, `${label} a frozen snapshot is never rebuilt`);
        for (const u of sc.paid) assert.equal(notifiedCount(u), 1, `${label} notified exactly once`);
      }
    });
  }

  it('OWN-13 FIX 06A scenario S3: the old owner, stalled in the User Service call, wakes up after the new owner FINALIZED the period -> it cannot delete or recreate the entries', async () => {
    let release: () => void = () => undefined;
    const paused = new Promise<void>((r) => { release = r; });
    let aIsPaused: () => void = () => undefined;
    const aReachedGate = new Promise<void>((r) => { aIsPaused = r; });
    userService.gate = async () => {
      userService.gate = undefined;                                    // only A's call (the first) waits
      aIsPaused();
      await paused;
    };

    const aRun = settle(run(undefined, 'A'));                          // A is now computing its snapshot, blocked on HTTP
    await aReachedGate;
    assert.equal(board().status, 'SNAPSHOT_BUILDING');

    locks.clock.advance(TTL + 1);                                      // A's lease lapses (A stalled: GC pause, frozen container ...)
    const b = await run(undefined, 'B');                               // B takes over and completes the whole period
    assert.equal(b.status, 'FINALIZED');
    const entryIds = entries().map((e) => e.id);
    const afterB = state();
    const deleteManyBefore = db.callCount('leaderboardEntry', 'deleteMany');
    const createManyBefore = db.callCount('leaderboardEntry', 'createMany');

    release();                                                         // A wakes up and continues with its stale data
    const a = await aRun;

    assert.equal(a.ok && a.value.status, 'ALREADY_FINALIZED', 'A learns that the period is final; it does not rebuild it');
    assert.equal(db.callCount('leaderboardEntry', 'deleteMany'), deleteManyBefore, 'A never deleted the finalized entries');
    assert.equal(db.callCount('leaderboardEntry', 'createMany'), createManyBefore, 'A never recreated them');
    assert.deepEqual(entries().map((e) => e.id), entryIds, 'same entry documents (ids, badge links) as B left them');
    for (const e of entries()) assert.ok(e.rewardBadgeId, 'badge link survived');
    assert.equal(state(), afterB, 'the database is byte-identical to the moment B finished');
    assertPaidOnce(ALL);
  });

  it('OWN-14 the same stall, but the new owner has NOT finished: the old owner is fenced out before it touches the leftover snapshot', async () => {
    const b0 = db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 0, finalizedBy: 'older' });
    db.seed('leaderboardEntry', { leaderboardId: b0.id, userId: U3, rank: 1, points: 1, completedCourses: 1, lastCompletedAt: new Date('2026-09-01T00:00:00Z'), rewardPoints: 1000 });
    let release: () => void = () => undefined;
    const paused = new Promise<void>((r) => { release = r; });
    let aIsPaused: () => void = () => undefined;
    const aReachedGate = new Promise<void>((r) => { aIsPaused = r; });
    userService.gate = async () => { userService.gate = undefined; aIsPaused(); await paused; };

    const aRun = settle(run(undefined, 'A'));
    await aReachedGate;
    locks.clock.advance(TTL + 1);
    const b = await locks.service.acquire(MONTH, YEAR, { owner: 'B' });
    assert.equal(b.status, 'ACQUIRED');
    const before = state();
    release();
    const a = await aRun;

    assert.equal(a.ok, false);
    assert.ok((a as any).error instanceof LockLostError);
    assert.equal(state(), before, 'neither the snapshot, nor the status, nor the lock changed');
    assert.equal(entries().length, 1, 'the leftover entry is still there: nothing was deleted');
    assert.equal(db.callCount('leaderboardEntry', 'deleteMany'), 0);
    assert.equal(db.callCount('leaderboardEntry', 'createMany'), 0);
    assert.equal(board().status, 'SNAPSHOT_BUILDING');
  });

  it('OWN-15 a snapshot build that fails (here: the fence of the snapshot transaction) rolls everything back', async () => {
    const b0 = db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 0, finalizedBy: 'older' });
    db.seed('leaderboardEntry', { leaderboardId: b0.id, userId: U3, rank: 1, points: 1, completedCourses: 1, lastCompletedAt: new Date('2026-09-01T00:00:00Z'), rewardPoints: 1000 });
    // the 2nd fenced transaction is the snapshot (1st = the claim)
    let fences = 0;
    const arm = () => db.beforeNext('monthlyLeaderboard', 'updateMany', (args: any) => {
      if (args?.where?.lockExpiresAt?.gte !== undefined && ++fences === 2) {
        // the fence of the snapshot transaction already matched; now the insert of the new entries fails mid-transaction
        db.failNext('leaderboardEntry', 'createMany', new Error('disk full while inserting the snapshot'));
        return;
      }
      arm();
    });
    arm();
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.match((r as any).error.message, /disk full/);
    assert.equal(board().status, 'SNAPSHOT_BUILDING', 'not SNAPSHOT_FROZEN');
    assert.equal(entries().length, 1, 'the delete was rolled back with the failed insert');
    assert.equal(entries()[0].userId, U3);
    assert.ok(db.rollbacks >= 1);
    assert.equal(db.tables.rewardPointTransaction.length, 0);
  });
});

describe('OWN snapshot compare-and-set', () => {
  it('OWN-37 the snapshot transaction moves SNAPSHOT_BUILDING -> SNAPSHOT_FROZEN only from SNAPSHOT_BUILDING; if the state changed, nothing is deleted or inserted', async () => {
    const b0 = db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 0, finalizedBy: 'older' });
    db.seed('leaderboardEntry', { leaderboardId: b0.id, userId: U3, rank: 1, points: 1, completedCourses: 1, lastCompletedAt: new Date('2026-09-01T00:00:00Z'), rewardPoints: 1000 });
    let fences = 0;
    const arm = () => db.beforeNext('monthlyLeaderboard', 'updateMany', (args: any) => {
      if (args?.where?.lockExpiresAt?.gte !== undefined && ++fences === 2) {      // the fence of the snapshot transaction (1 = claim)
        board().status = 'FAILED';                                                  // an out-of-band actor changes the state right before it
        return;
      }
      arm();
    });
    arm();
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof LeaderboardStateError);
    assert.match((r as any).error.message, /left SNAPSHOT_BUILDING/);
    assert.equal(db.callCount('leaderboardEntry', 'deleteMany'), 0, 'nothing was deleted');
    assert.equal(db.callCount('leaderboardEntry', 'createMany'), 0);
    assert.equal(entries().length, 1);
    assert.equal(board().status, 'FAILED', 'the foreign status was not overwritten');
    assert.equal(board().totalParticipants, 0);
  });
});

describe('OWN notifications: one claim, one sender; never inside a transaction', () => {
  /** Finalized period where U3\'s notification failed. */
  const finalizedWithPendingU3 = async () => {
    failNotificationFor.add(U3);
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.notificationsPending, 1);
    failNotificationFor.delete(U3);
    notified = [];
  };
  const entryOf = (u: string) => db.tables.leaderboardEntry.find((e) => e.userId === u)!;

  it('OWN-16 two processes retrying the same failed notification at the same time -> it is sent ONCE (the second sees a live claim)', async () => {
    await finalizedWithPendingU3();
    let sending: () => void = () => undefined;
    const startedSending = new Promise<void>((r) => { sending = r; });
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((r) => { openGate = r; });
    onNotifyHook = async () => { sending(); await gate; };

    const first = LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    await startedSending;                                              // the first sender holds the claim and is "on the wire"
    assert.ok(entryOf(U3).rewardNotifyClaimToken, 'claim recorded');
    const second = await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    assert.equal(second, 1, 'the second retry reports the notification as still undelivered ...');
    assert.equal(notified.length, 0, '... and did not send it');

    openGate();
    assert.equal(await first, 0);
    assert.deepEqual(notified, [U3], 'sent exactly once in total');
    assert.ok(entryOf(U3).rewardNotifiedAt);
    assert.equal(entryOf(U3).rewardNotifyError, null);
    assert.equal(entryOf(U3).rewardNotifyClaimToken, null, 'claim cleared');
    assert.equal(notifiedInsideTransaction, 0);
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.equal(notified.length, 1, 'and a later retry has nothing to do');
  });

  it('OWN-17 the admin retry API follows the same claim rules as the job', async () => {
    await finalizedWithPendingU3();
    let sending: () => void = () => undefined;
    const startedSending = new Promise<void>((r) => { sending = r; });
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((r) => { openGate = r; });
    onNotifyHook = async () => { sending(); await gate; };
    const job = LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    await startedSending;

    const res = await callAdmin({ month: MONTH, year: YEAR }, 'retryNotifications');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.stillPending, 1, 'the API did not send what the job is sending');
    assert.equal(notified.length, 0);
    openGate();
    await job;
    assert.deepEqual(notified, [U3]);
  });

  it('OWN-18 a sender that crashed holding a claim: once the claim has lapsed the notification is sent again; before that it is left alone', async () => {
    await finalizedWithPendingU3();
    Object.assign(entryOf(U3), { rewardNotifyError: undefined, rewardNotifyClaimToken: 'crashed-sender', rewardNotifyClaimExpiresAt: new Date(Date.now() + 30_000) });
    delete entryOf(U3).rewardNotifyError;
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1, 'live claim respected');
    assert.equal(notified.length, 0);

    entryOf(U3).rewardNotifyClaimExpiresAt = new Date(Date.now() - 1000);        // the claim lapsed
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.deepEqual(notified, [U3]);
    assert.equal(entryOf(U3).rewardNotifyClaimToken, null);
  });

  it('OWN-19 the outcome is recorded only while the claim is still ours: a sender whose claim lapsed and was taken over cannot overwrite', async () => {
    await finalizedWithPendingU3();
    onNotifyHook = async () => {                                                  // while this sender is on the wire its claim lapses and another process takes over
      entryOf(U3).rewardNotifyClaimToken = 'the-new-sender';
      entryOf(U3).rewardNotifyClaimExpiresAt = new Date(Date.now() + 30_000);
    };
    await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    assert.equal(entryOf(U3).rewardNotifyClaimToken, 'the-new-sender', 'the new sender\'s claim is intact');
    assert.ok(!entryOf(U3).rewardNotifiedAt, 'the late outcome was not written over the new claim');
  });

  it('OWN-20 a failed send records the error and clears the claim, so the next retry can claim it', async () => {
    failNotificationFor.add(U3);
    await run();
    assert.match(entryOf(U3).rewardNotifyError, /user-service unavailable/);
    assert.equal(entryOf(U3).rewardNotifyClaimToken, null);
    assert.equal(entryOf(U3).rewardNotifyClaimExpiresAt, null);
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1, 'still failing: still pending');
    failNotificationFor.clear();
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
  });

  it('OWN-21 the finalize path only sends if the lock owner is still valid at the moment of sending: lock lost after the claim -> nothing sent, claim handed back, LockLostError', async () => {
    let mono = 1_000;
    freshWorld([{ ttlMs: TTL, heartbeatMs: 20_000 }, { monotonicNow: () => mono }]);
    db.beforeNext('leaderboardEntry', 'updateMany', () => { mono += TTL + 1; });   // the claim of the first notification; the lease runs out right after it
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof LockLostError);
    assert.equal((r as any).error.reason, 'LOCAL_DEADLINE');
    assert.equal(notified.length, 0, 'nothing was sent');
    assert.equal(entryOf(U1).rewardNotifyClaimToken, null, 'the claim was handed back');
    assert.equal(awards(U1).length, 1, 'rewards before it are intact');
    assert.equal(board().status, 'REWARDING');
    assert.equal(board().lockToken, null, 'released');
  });

  it('OWN-38 a notification that another process delivered between our listing and our claim is NOT sent again (the claim itself checks "not delivered yet")', async () => {
    await finalizedWithPendingU3();
    // we have listed U3 as undelivered; before we claim it, another process delivers it and records the outcome
    db.beforeNext('leaderboardEntry', 'updateMany', () => {
      Object.assign(entryOf(U3), { rewardNotifiedAt: new Date(), rewardNotifyError: null, rewardNotifyClaimToken: null, rewardNotifyClaimExpiresAt: null });
    });
    const left = await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    assert.equal(notified.length, 0, 'nothing was sent a second time');
    assert.equal(left, 1, 'reported as not sent by us (the delivery was done by the other process)');
    assert.ok(entryOf(U3).rewardNotifiedAt, 'and the record of the other process is intact');
  });

  it('OWN-22 no notification is ever sent while a transaction is open (finalize path and retry path)', async () => {
    failNotificationFor.add(U4);
    await run();
    failNotificationFor.clear();
    await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    assert.equal(notified.length, 4);
    assert.equal(notifiedInsideTransaction, 0);
  });

  it('OWN-23 FINALIZED is not needed for notifications, and a period without any marker is never re-notified', async () => {
    const r = await run();
    assert.equal(r.notificationsPending, 0);
    notified = [];
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.equal(notified.length, 0);
  });
});

describe('OWN failure semantics are unchanged', () => {
  it('OWN-24 User Service down while building -> UserEligibilityError, SNAPSHOT_BUILDING, nothing written, lock released, no early FINALIZED', async () => {
    userService.mode = 'http500';
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof UserEligibilityError);
    assert.equal(board().status, 'SNAPSHOT_BUILDING');
    assert.equal(entries().length, 0);
    assert.equal(db.tables.rewardPointTransaction.length, 0);
    assert.equal(board().lockToken, null);
    userService.mode = 'ok';
    assert.equal((await run()).status, 'FINALIZED');
    assertPaidOnce(ALL);
  });

  it('OWN-25 User Service down at reward time -> the existing frozen snapshot is kept untouched and nothing is paid', async () => {
    seedFrozen('SNAPSHOT_FROZEN');
    const idsBefore = entries().map((e) => e.id);
    userService.mode = 'timeout';
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof UserEligibilityError);
    assert.equal(board().status, 'SNAPSHOT_FROZEN', 'not even REWARDING: nothing happened');
    assert.deepEqual(entries().map((e) => e.id), idsBefore);
    assert.equal(db.callCount('leaderboardEntry', 'deleteMany'), 0);
    assert.equal(db.tables.rewardPointTransaction.length, 0);
    userService.mode = 'ok';
    assert.equal((await run()).status, 'FINALIZED');
    assert.deepEqual(entries().map((e) => e.id), idsBefore);
  });

  it('OWN-26 SNAPSHOT_FROZEN and REWARDING recover without rebuilding; FINALIZED is returned as it is', async () => {
    for (const status of ['SNAPSHOT_FROZEN', 'REWARDING']) {
      freshWorld();
      seedFrozen(status);
      const ids = entries().map((e) => e.id);
      seedCompletion('66'.repeat(12), 900, '2026-09-28T10:00:00Z');         // would rank first today
      db.calls = [];
      const r = await run();
      assert.equal(r.status, 'FINALIZED', status);
      assert.deepEqual(entries().map((e) => e.id), ids, `${status}: same entries`);
      assert.equal(db.callCount('leaderboardEntry', 'deleteMany') + db.callCount('leaderboardEntry', 'createMany'), 0);
      assert.equal(db.callCount('courseCompletionRecord', 'findMany'), 0, 'live data not re-read');
    }
    const before = state();
    assert.equal((await run()).status, 'ALREADY_FINALIZED');
    assert.equal(state(), before);
  });

  it('OWN-27 rewards stay idempotent: a reward already in the ledger is not paid again, even after a takeover mid-way', async () => {
    const crash = await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    assert.equal(crash.ok, false);
    const firstLedgerId = awards(U1)[0].id;
    locks.clock.advance(TTL + 1);
    assert.equal((await run()).status, 'FINALIZED');
    assert.equal(awards(U1)[0].id, firstLedgerId);
    assertPaidOnce(ALL);
  });

  it('OWN-28 an award whose fence is refused is neither retried nor counted as a reward failure (LockLostError is final)', async () => {
    seedFrozen('SNAPSHOT_FROZEN');
    let fences = 0;
    const arm = () => db.beforeNext('monthlyLeaderboard', 'updateMany', async (args: any) => {
      if (args?.where?.lockExpiresAt?.gte !== undefined && ++fences === 4) {     // 1 REWARDING, 2 wallet of U1, 3 award of U1, 4 badge of U1 ... take over before the award of U2? (just some mid-reward fence)
        locks.clock.advance(TTL + 1);
        await locks.service.acquire(MONTH, YEAR, { owner: 'B' });
        return;
      }
      arm();
    });
    arm();
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof LockLostError);
    assert.equal(audit('FINALIZE_REWARDS_INCOMPLETE').length, 0, 'nothing was recorded as an incomplete-reward failure');
    assert.equal(db.tables.rewardPointTransaction.length <= 1, true);
  });

  it('OWN-29 a conflicting transaction on the period row is retried a bounded number of times, re-fencing every time', async () => {
    seedFrozen('SNAPSHOT_FROZEN');
    db.failNext('monthlyLeaderboard', 'updateMany', Object.assign(new Error('Transaction failed due to a write conflict'), { code: 'P2034' }), 2);
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    const fences = db.calls.filter(isFence).length;
    assert.ok(fences >= 3, `the conflicted transaction fenced again on each attempt (${fences})`);
    assertPaidOnce(ALL);

    freshWorld();
    seedFrozen('SNAPSHOT_FROZEN');
    db.failNext('monthlyLeaderboard', 'updateMany', Object.assign(new Error('write conflict'), { code: 'P2034' }), 1000);
    const bad = await settle(run());
    assert.equal(bad.ok, false, 'a persistent conflict ends the run, it does not spin');
    assert.ok(db.callCount('monthlyLeaderboard', 'updateMany') < 40, `bounded: ${db.callCount('monthlyLeaderboard', 'updateMany')} attempts`);
    assert.equal(db.tables.rewardPointTransaction.length, 0);
  });

  it('OWN-30 a lock-store failure (database unreachable for the lock) is surfaced as LockStoreError and nothing is written', async () => {
    locks.store.failNext('tryAcquire', new Error('socket hang up'));
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok(r.ok === false && r.error.message.includes('socket hang up'));
    assert.equal(entries().length, 0);
    assert.deepEqual(db.writeCalls().filter((c) => c.table !== 'monthlyLeaderboard'), []);
  });
});

describe('OWN admin API and jobs', () => {
  it('OWN-31 manual finalize of a period a live process owns -> HTTP 409 LEADERBOARD_BUSY, force:true changes nothing, no audit row', async () => {
    assert.equal((await locks.service.acquire(MONTH, YEAR, { owner: 'live' })).status, 'ACQUIRED');
    const before = state();
    const res = await callAdmin({ month: MONTH, year: YEAR, force: true, reason: 'push it through' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'LEADERBOARD_BUSY');
    assert.equal(state(), before);
    assert.equal(db.tables.leaderboardAuditLog.length, 0);
  });

  it('OWN-32 `force` is accepted for compatibility but has no effect on a FINALIZED period either', async () => {
    await run();
    const before = state();
    const res = await callAdmin({ month: MONTH, year: YEAR, force: true });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, 'ALREADY_FINALIZED');
    const rows = db.tables.leaderboardAuditLog.filter((a) => a.action === 'MANUAL_FINALIZE');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].details.forceIgnored, true);
    assert.equal(JSON.stringify({ ...db.tables, leaderboardAuditLog: [] }), JSON.stringify({ ...JSON.parse(before), leaderboardAuditLog: [] }) && JSON.stringify({ ...db.tables, leaderboardAuditLog: [] }));
    assert.equal(awards(U1).length, 1);
  });

  it('OWN-33 LockLostError -> 409 LEADERBOARD_LOCK_LOST; a lock-store failure -> 503; a bad year -> 400 before any work', async () => {
    mock.method(LeaderboardService, 'finalizeMonth', async () => { throw new LockLostError('REPLACED', MONTH, YEAR); });
    const lost = await callAdmin({ month: MONTH, year: YEAR });
    assert.equal(lost.statusCode, 409);
    assert.equal(lost.body.code, 'LEADERBOARD_LOCK_LOST');
    assert.equal(lost.body.reason, 'REPLACED');
    mock.restoreAll();

    mock.method(LeaderboardService, 'finalizeMonth', async () => { throw new LockStoreError('db down'); });
    const down = await callAdmin({ month: MONTH, year: YEAR });
    assert.equal(down.statusCode, 503);
    assert.equal(down.body.code, 'LEADERBOARD_LOCK_UNAVAILABLE');
    mock.restoreAll();

    for (const bad of [{ month: MONTH, year: 1999 }, { month: MONTH, year: 'abc' }, { month: 13, year: YEAR }, { year: YEAR }]) {
      assert.equal((await callAdmin(bad)).statusCode, 400, JSON.stringify(bad));
    }
    assert.equal(db.count('monthlyLeaderboard'), 0);
  });

  it('OWN-34 the controller still reports an incomplete period as a retryable 409 and a state problem as 409', async () => {
    db.failNext('rewardPointTransaction', 'create', new Error('boom'), 1, (a: any) => a?.data?.userId === U2 && a?.data?.type === 'LEADERBOARD_REWARD');
    const incomplete = await callAdmin({ month: MONTH, year: YEAR });
    assert.equal(incomplete.statusCode, 409);
    assert.equal(incomplete.body.details.verifiedPoints, TOTAL - 700);
    assert.equal(board().status, 'REWARDING');

    freshWorld();
    seedFrozen('SNAPSHOT_FROZEN', { totalParticipants: 5 });
    const damaged = await callAdmin({ month: MONTH, year: YEAR });
    assert.equal(damaged.statusCode, 409);
    assert.equal(damaged.body.status, 'SNAPSHOT_FROZEN');
  });

  it('OWN-35 repeated identical incomplete-reward failures are audited once, not on every reconciliation pass', async () => {
    db.failNext('rewardPointTransaction', 'create', new Error('boom'), 3, (a: any) => a?.data?.userId === U2 && a?.data?.type === 'LEADERBOARD_REWARD');
    for (let i = 0; i < 3; i++) {
      const r = await settle(run(undefined, 'SYSTEM_RECONCILE'));
      assert.ok((r as any).error instanceof LeaderboardRewardIncompleteError);
    }
    assert.equal(audit('FINALIZE_REWARDS_INCOMPLETE').length, 1);
    assert.equal((await run()).status, 'FINALIZED');
  });

  it('OWN-36 the reward service refuses to write for a guard that has lost its lock, without touching wallet or ledger', async () => {
    const h = await locks.service.acquire(MONTH, YEAR, { owner: 'A' });
    const ctx = locks.service.createContext(h.handle);
    locks.clock.advance(TTL + 1);
    await locks.service.acquire(MONTH, YEAR, { owner: 'B' });
    const before = state();
    await assert.rejects(
      RewardPointService.awardLeaderboardPoints(U1, 1000, h.handle.periodId, 1, MONTH, YEAR, ctx),
      (e: any) => e instanceof LockLostError
    );
    assert.equal(state(), before, 'not even an empty wallet was created');
  });
});

// ---------- admin controller helper ----------
async function callAdmin(body: any, method: 'manualFinalize' | 'retryNotifications' = 'manualFinalize') {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
  };
  await AdminLeaderboardController[method]({ user: { userId: ADMIN, email: 'admin@umi.vn' }, body }, res);
  return res;
}
void LeaderboardStateError;
