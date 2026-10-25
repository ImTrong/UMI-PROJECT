/**
 * FIX 04.2 regression tests (kept in FIX 06B2): a FINALIZED leaderboard is immutable history; `force` can never
 * delete or rebuild a finalized or frozen snapshot and there is no take-over flag any more (only an EXPIRED lock
 * lease can be taken over); unfinished periods still recover (FIX 04.1).
 *
 * Evidence is the DATA, not return values: full fingerprints of period, entries, ledger, wallets and
 * badges are compared, and the database call log proves that no write / deleteMany / live recompute
 * happened. Real-MongoDB counterparts: tests/integration/finalize.mongo.test.ts.
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
const { LeaderboardService, LeaderboardStateError, LeaderboardRewardIncompleteError } = require('../src/services/leaderboard.service');
const { AdminLeaderboardController } = require('../src/controllers/admin-leaderboard.controller');
const { getCurrentVietnamMonthYear } = require('../src/config/scoring-policy');

logger.transports.forEach((t: any) => { t.silent = true; });

const MONTH = 9;
const YEAR = 2026;
const U1 = '11'.repeat(12);
const U2 = '22'.repeat(12);
const U3 = '33'.repeat(12);
const U4 = '44'.repeat(12);
const ALL = [U1, U2, U3, U4];
const TOTAL = 2400;
const ADMIN = 'ad'.repeat(12);

const seedCompletion = (userId: string, points: number, at: string, month = MONTH, year = YEAR) =>
  db.seed('courseCompletionRecord', {
    userId, courseId: 'cc'.repeat(12), courseTitle: 'Course', completedAt: new Date(at), passed: true,
    totalDurationSeconds: 3600, level: 'BEGINNER', baseDurationPoints: points, levelMultiplier: 1,
    achievementPoints: points, averageQuizScore: null, hasQuiz: false, policyVersion: '1.1', status: 'VALID', month, year,
  });

let notified: string[] = [];
let failNotificationFor = new Set<string>();

let locks: ReturnType<typeof installTestLocks>;

beforeEach(() => {
  db.reset();
  locks = installTestLocks(LeaderboardService);
  notified = [];
  failNotificationFor = new Set();
  seedCompletion(U1, 50, '2026-09-05T10:00:00Z');
  seedCompletion(U2, 30, '2026-09-06T10:00:00Z');
  seedCompletion(U3, 20, '2026-09-07T10:00:00Z');
  seedCompletion(U4, 10, '2026-09-08T10:00:00Z');
  installUserServiceStub(axios, mock, (body) => {
    if (failNotificationFor.has(body.userId)) throw new Error('user-service unavailable');
    notified.push(body.userId);
  });
});
afterEach(() => mock.restoreAll());

const run = (opts?: any) => LeaderboardService.finalizeMonth(MONTH, YEAR, 'TEST', opts);
const settle = async (p: Promise<any>) => {
  try { return { ok: true as const, value: await p }; } catch (error: any) { return { ok: false as const, error }; }
};
const board = () => db.tables.monthlyLeaderboard.find((b) => b.month === MONTH && b.year === YEAR)!;
const entries = () => db.tables.leaderboardEntry.filter((e) => e.leaderboardId === board().id).sort((a, b) => a.rank - b.rank);
const awards = (u: string) => db.tables.rewardPointTransaction.filter((t) => t.userId === u && t.type === 'LEADERBOARD_REWARD');
const wallet = (u: string) => db.tables.userRewardPoint.find((w) => w.userId === u);
const badges = (u: string) => db.tables.badge.filter((b) => b.userId === u);

/** Everything a finalized period consists of, as a comparable string. */
const fingerprint = (withAudit = true) =>
  JSON.stringify({
    boards: db.tables.monthlyLeaderboard,
    entries: db.tables.leaderboardEntry,
    ledger: db.tables.rewardPointTransaction,
    wallets: db.tables.userRewardPoint,
    badges: db.tables.badge,
    audit: withAudit ? db.tables.leaderboardAuditLog : [],
  });
const snapshotOf = () => entries().map((e) => ({ id: e.id, userId: e.userId, rank: e.rank, points: e.points, isTie: e.isTie }));

/** Clean slate for the call log right before the operation under test. */
const startRecording = () => { db.calls = []; db.maxOpenTransactions = 0; };
const assertNoWrites = (why: string) => {
  assert.deepEqual(db.writeCalls(), [], `${why}: no database write of any kind may happen`);
};
const assertNoRecompute = () => {
  assert.equal(db.callCount('leaderboardEntry', 'deleteMany'), 0, 'entries were never deleted');
  assert.equal(db.callCount('leaderboardEntry', 'createMany'), 0, 'no snapshot was rebuilt');
  assert.equal(db.callCount('courseCompletionRecord', 'findMany'), 0, 'live data was never re-read for ranking');
};

/** A period that was fully and correctly finalized. */
const finalizeOnce = async () => {
  const r = await run();
  assert.equal(r.status, 'FINALIZED');
  assert.equal(r.totalPointsAwarded, TOTAL);
  return r;
};

/** Seed a frozen snapshot by hand (status as given) - what a crash right after the freeze leaves behind. */
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

// ====================================================================================

describe('IMMUT: a FINALIZED period is history', () => {
  it('IMMUT-01 finalize on a FINALIZED period -> ALREADY_FINALIZED, not a single database write', async () => {
    await finalizeOnce();
    const before = fingerprint();
    startRecording();

    const r = await run();
    assert.equal(r.status, 'ALREADY_FINALIZED');
    assert.equal(r.totalPointsAwarded, TOTAL);
    assert.equal(r.totalParticipants, 4);
    assert.equal(fingerprint(), before, 'period, entries, ledger, wallets, badges and audit are byte-identical');
    assertNoWrites('finalize on FINALIZED');
    assertNoRecompute();
  });

  it('IMMUT-02 finalize on a FINALIZED period with force/take-over -> still nothing deleted or recomputed', async () => {
    await finalizeOnce();
    // live data moves on: this student would now be Top 1 if the month were recomputed
    const LATE = '66'.repeat(12);
    seedCompletion(LATE, 900, '2026-09-28T10:00:00Z');
    const before = fingerprint();
    const snapshot = snapshotOf();
    startRecording();

    const r = await run();
    assert.equal(r.status, 'ALREADY_FINALIZED');
    assert.equal(fingerprint(), before);
    assert.deepEqual(snapshotOf(), snapshot, 'same entry ids, ranks, points, isTie');
    assert.equal(awards(LATE).length, 0);
    assert.equal(board().status, 'FINALIZED');
    assertNoWrites('take-over on FINALIZED');
    assertNoRecompute();
  });

  it('IMMUT-10 finalizing the same period many times (any option, any initiator) never changes anything', async () => {
    await finalizeOnce();
    const before = fingerprint();
    startRecording();
    for (const opts of [
      undefined, undefined, { simulateFailureAt: 'BEFORE_SNAPSHOT_CONFIRM' },
      { simulateFailureAt: 'AFTER_FIRST_REWARD' }, { simulateFailureAt: 'BEFORE_FINALIZED' }, undefined,
    ] as const) {
      const r = await LeaderboardService.finalizeMonth(MONTH, YEAR, 'REPEAT', opts);
      assert.equal(r.status, 'ALREADY_FINALIZED');
    }
    assert.equal(fingerprint(), before, 'wallets, ledger, badges, snapshot, totals untouched');
    assert.equal(board().totalPointsAwarded, TOTAL);
    assertNoWrites('repeated finalize');
    assertNoRecompute();
    assert.equal(notified.length, 4, 'and no message was sent again');
  });

  it('IMMUT-06 admin API: finalize of a finished period (even with force:true) -> 200 "already finalized", data unchanged', async () => {
    await finalizeOnce();
    const before = fingerprint(false);
    startRecording();

    const res = await callAdmin({ month: MONTH, year: YEAR, force: true, reason: 'try to redo' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, 'ALREADY_FINALIZED');
    assert.match(res.body.message, /đã được chốt trước đó/);
    assert.equal(fingerprint(false), before);
    assert.deepEqual(db.writeCalls().map((c) => c.table), ['leaderboardAuditLog'], 'only the admin audit row is written');
    assertNoRecompute();
    const audit = db.tables.leaderboardAuditLog.find((a) => a.action === 'MANUAL_FINALIZE')!;
    assert.equal(audit.details.status, 'ALREADY_FINALIZED');
  });

  it('IMMUT-06 admin API validates `force` and reports an incomplete period as a retryable conflict', async () => {
    const bad = await callAdmin({ month: MONTH, year: YEAR, force: 'yes' });
    assert.equal(bad.statusCode, 400);
    assert.equal(db.count('monthlyLeaderboard'), 0, 'rejected before any work');

    db.failNext('rewardPointTransaction', 'create', new Error('boom'), 1, (a) => a?.data?.userId === U2 && a?.data?.type === 'LEADERBOARD_REWARD');
    const incomplete = await callAdmin({ month: MONTH, year: YEAR });
    assert.equal(incomplete.statusCode, 409);
    assert.equal(incomplete.body.details.verifiedPoints, TOTAL - 700);
    assert.equal(board().status, 'REWARDING');
  });
});

describe('IMMUT: unfinished periods keep recovering from their own snapshot', () => {
  it('IMMUT-03 SNAPSHOT_FROZEN -> continues from the frozen entries, never recomputes, ignores newer live data', async () => {
    const b = seedFrozen('SNAPSHOT_FROZEN');
    const idsBefore = entries().map((e) => e.id);
    seedCompletion('66'.repeat(12), 900, '2026-09-28T10:00:00Z'); // IMMUT-09: would rank first today
    startRecording();

    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.totalPointsAwarded, TOTAL);
    assert.deepEqual(entries().map((e) => e.id), idsBefore, 'the same entry rows');
    assert.equal(db.tables.leaderboardEntry.length, 4);
    assert.equal(awards('66'.repeat(12)).length, 0, 'IMMUT-09: a student who arrived after the freeze is not paid');
    for (const u of ALL) assert.equal(awards(u).length, 1);
    assertNoRecompute();
    assert.equal(b.id, board().id);
  });

  it('IMMUT-04 REWARDING (crashed after the first reward) -> finishes, does not pay the first reward again', async () => {
    await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    assert.equal(board().status, 'REWARDING');
    const ledgerOfTop1 = awards(U1)[0].id;
    const balanceTop1 = wallet(U1)!.balance;
    const idsBefore = entries().map((e) => e.id);
    seedCompletion('66'.repeat(12), 900, '2026-09-28T10:00:00Z');
    startRecording();

    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(awards(U1)[0].id, ledgerOfTop1);
    assert.equal(wallet(U1)!.balance, balanceTop1);
    assert.equal(awards(U1).length, 1);
    assert.equal(db.tables.rewardPointTransaction.length, 4);
    assert.deepEqual(entries().map((e) => e.id), idsBefore);
    assert.equal(r.totalPointsAwarded, TOTAL);
    assertNoRecompute();
  });

  it('IMMUT-04 REWARDING with an unresolved failure is not finalized (FIX 04.1 behaviour kept)', async () => {
    db.failNext('rewardPointTransaction', 'create', new Error('boom'), 1, (a) => a?.data?.userId === U3 && a?.data?.type === 'LEADERBOARD_REWARD');
    const first = await settle(run());
    assert.ok((first as any).error instanceof LeaderboardRewardIncompleteError);
    const second = await run();
    assert.equal(second.status, 'FINALIZED');
    for (const u of ALL) assert.equal(awards(u).length, 1);
  });

  it('IMMUT-08 snapshot interrupted while being written -> since FIX 06B2 NO partial snapshot is ever visible (one transaction); the retry builds it', async () => {
    const crash = await settle(run({ simulateFailureAt: 'BEFORE_SNAPSHOT_CONFIRM' }));
    assert.equal(crash.ok, false);
    assert.equal(board().status, 'SNAPSHOT_BUILDING', 'still unconfirmed');
    assert.equal(entries().length, 0, 'the half-written snapshot was rolled back with its transaction (before FIX 06B2 one partial entry stayed behind)');
    assert.ok(db.rollbacks >= 1);
    assert.equal(db.tables.rewardPointTransaction.length, 0, 'nothing is paid from an unconfirmed snapshot');

    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(entries().length, 4);
    assert.deepEqual(entries().map((e) => [e.userId, e.rank]), [[U1, 1], [U2, 2], [U3, 3], [U4, 4]]);
    for (const u of ALL) assert.equal(awards(u).length, 1);
  });

  it('IMMUT-08 a partial snapshot left by an OLDER (pre-lock) run in SNAPSHOT_BUILDING is discarded and rebuilt in the same transaction', async () => {
    const b = db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 0, finalizedBy: 'old-run' });
    db.seed('leaderboardEntry', { leaderboardId: b.id, userId: U3, rank: 1, points: 1, completedCourses: 1, lastCompletedAt: new Date('2026-09-01T00:00:00Z'), rewardPoints: 1000 });
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.deepEqual(entries().map((e) => [e.userId, e.rank]), [[U1, 1], [U2, 2], [U3, 3], [U4, 4]], 'the stale leftover is gone, the real ranking is in');
    assert.equal(db.callCount('leaderboardEntry', 'deleteMany'), 1);
  });

  it('IMMUT-08 an unconfirmed period that is NOT SNAPSHOT_BUILDING but holds entries is never auto-deleted', async () => {
    for (const status of ['FAILED', 'FINALIZING']) {
      db.reset();
      seedCompletion(U1, 50, '2026-09-05T10:00:00Z');
      seedFrozen(status);
      const before = fingerprint();
      startRecording();
      const r = await settle(run());
      assert.equal(r.ok, false, status);
      assert.ok((r as any).error instanceof LeaderboardStateError);
      assert.match((r as any).error.message, /will not be rebuilt automatically/);
      assert.equal(entries().length, 4);
      assert.equal(db.callCount('leaderboardEntry', 'deleteMany'), 0);
      assert.equal(db.callCount('leaderboardEntry', 'createMany'), 0);
      assert.equal(db.tables.rewardPointTransaction.length, 0);
      assert.equal(board().status, status);
      void before;
    }
  });

  it('IMMUT-08 an ACTIVE period without entries is built normally', async () => {
    db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'ACTIVE' });
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(entries().length, 4);
  });

  it('IMMUT-08 a period that a LIVE process is working on is left alone (BUSY); it can only be continued once the owner\'s lease has lapsed', async () => {
    await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));           // leaves REWARDING behind, lock released by the failed run
    const owner = await locks.service.acquire(MONTH, YEAR, { owner: 'process-that-is-still-alive' });
    assert.equal(owner.status, 'ACQUIRED');
    const before = fingerprint();
    startRecording();

    const waiting = await run();
    assert.equal(waiting.status, 'BUSY');
    assert.equal(fingerprint(), before, 'nothing changed - not even the initiator');
    assertNoWrites('period owned by a live process');
    assert.equal(awards(U1).length, 1, 'the first reward is not touched');

    locks.clock.advance(60_001);                                              // the owner died: its lease lapses
    const resumed = await run();
    assert.equal(resumed.status, 'FINALIZED');
    for (const u of ALL) assert.equal(awards(u).length, 1, 'every student paid exactly once');
    assert.equal(board().fencingToken, 3, 'acquire #1 (failed run), #2 (the "live" process), #3 (this take-over)');
  });

  it('a damaged frozen snapshot (entry count differs from the confirmed count) is refused before anything is paid', async () => {
    seedFrozen('SNAPSHOT_FROZEN', { totalParticipants: 5 });
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof LeaderboardStateError);
    assert.match((r as any).error.message, /Frozen snapshot/);
    assert.equal(db.tables.rewardPointTransaction.length, 0);
    assert.equal(entries().length, 4);
    assert.equal(board().status, 'SNAPSHOT_FROZEN');
  });
});

describe('IMMUT: racing runs cannot move a period out of FINALIZED', () => {
  it('another run finalizes between our read and our write -> we stop, their stored result is untouched', async () => {
    await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    const finalizedAt = new Date('2026-10-01T00:05:00Z');
    db.beforeNext('monthlyLeaderboard', 'updateMany', () => {
      Object.assign(board(), { status: 'FINALIZED', finalizedAt, totalPointsAwarded: 4242, finalizedBy: 'other-run' });
    });
    const idsBefore = entries().map((e) => e.id);
    const ledgerBefore = db.tables.rewardPointTransaction.length;
    startRecording();

    const r = await run();
    assert.equal(r.status, 'ALREADY_FINALIZED');
    assert.equal(r.totalPointsAwarded, 4242);
    assert.equal(board().status, 'FINALIZED');
    assert.equal(board().finalizedBy, 'other-run', 'initiator of the finished run not overwritten');
    assert.equal(board().totalPointsAwarded, 4242);
    assert.equal(board().finalizedAt, finalizedAt);
    assert.deepEqual(entries().map((e) => e.id), idsBefore);
    assert.equal(db.tables.rewardPointTransaction.length, ledgerBefore);
    assertNoRecompute();
  });

  it('another run finalizes while we are rewarding -> our REWARDING/FINALIZED writes cannot overwrite it', async () => {
    await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    const finalizedAt = new Date('2026-10-01T00:05:00Z');
    let flipped = false;
    db.beforeNext('badge', 'findUnique', () => {
      flipped = true;
      Object.assign(board(), { status: 'FINALIZED', finalizedAt, totalPointsAwarded: 4242 });
    });

    const r = await run();
    assert.ok(flipped);
    assert.equal(r.status, 'ALREADY_FINALIZED');
    assert.equal(board().status, 'FINALIZED');
    assert.equal(board().totalPointsAwarded, 4242, 'not replaced by our own total');
    assert.equal(board().finalizedAt, finalizedAt);
    assert.equal(db.tables.leaderboardEntry.length, 4);
  });

  it('the status is changed by someone else while we claim a rebuild -> the compare-and-set fails and no entry is deleted', async () => {
    const b = db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 0, finalizedBy: 'old-run' });
    db.seed('leaderboardEntry', { leaderboardId: b.id, userId: U3, rank: 1, points: 1, completedCourses: 1, lastCompletedAt: new Date('2026-09-01T00:00:00Z'), rewardPoints: 1000 });
    // between our read and our claim an out-of-band actor moves the period elsewhere
    db.beforeNext('monthlyLeaderboard', 'updateMany', () => { board().status = 'FAILED'; });
    startRecording();

    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof LeaderboardStateError);
    assert.match((r as any).error.message, /changed while it was being claimed/);
    assert.equal(db.callCount('leaderboardEntry', 'deleteMany'), 0);
    assert.equal(entries().length, 1, 'the leftover snapshot is still there');
    assert.equal(board().status, 'FAILED', 'and the foreign status was not overwritten');
  });
});

describe('IMMUT: startup catch-up and notification retry', () => {
  /** Six "past months" as the catch-up computes them, all FINALIZED except the one under test. */
  const pastMonths = () => {
    const { month: cm, year: cy } = getCurrentVietnamMonthYear();
    const list: Array<{ month: number; year: number }> = [];
    let m = cm - 1;
    let y = cy;
    if (m < 1) { m = 12; y--; }
    for (let i = 0; i < 6; i++) {
      list.unshift({ month: m, year: y });
      m--;
      if (m < 1) { m = 12; y--; }
    }
    return list;
  };
  const seedPastExcept = (target: { month: number; year: number } | null) => {
    for (const p of pastMonths()) {
      if (target && p.month === target.month && p.year === target.year) continue;
      db.seed('monthlyLeaderboard', { month: p.month, year: p.year, status: 'FINALIZED', finalizedAt: new Date('2026-01-01'), totalParticipants: 0, totalPointsAwarded: 0, finalizedBy: 'earlier' });
    }
  };

  it('IMMUT-05 startup catch-up meets only FINALIZED periods -> no write to snapshot, ledger, wallets or badges', async () => {
    seedPastExcept(null);
    const before = fingerprint();
    startRecording();

    const r = await LeaderboardService.checkAndFinalizeAllPastMonths({ initiator: 'SYSTEM_STARTUP_CATCHUP' });
    assert.deepEqual(r.finalizedMonths, []);
    assert.equal(fingerprint(), before);
    assertNoWrites('catch-up over finalized months');
    assertNoRecompute();
  });

  it('IMMUT-05 catch-up finalizes a missing month normally and still leaves the finalized ones alone', async () => {
    const target = pastMonths()[5];
    seedPastExcept(target);
    for (const [i, u] of ALL.entries()) seedCompletion(u, 50 - i * 10, `2026-09-0${i + 5}T10:00:00Z`, target.month, target.year);
    const finalizedBefore = JSON.stringify(db.tables.monthlyLeaderboard.filter((b) => b.status === 'FINALIZED'));

    const r = await LeaderboardService.checkAndFinalizeAllPastMonths();
    assert.deepEqual(r.finalizedMonths, [`${target.month}/${target.year}`]);
    assert.equal(db.tables.rewardPointTransaction.length, 4);
    assert.equal(JSON.stringify(db.tables.monthlyLeaderboard.filter((b) => b.status === 'FINALIZED' && b.finalizedBy === 'earlier')), finalizedBefore);
  });

  it('IMMUT-05 startup, cron and reconciliation all use the same plain acquire: a live owner is respected, a lapsed one is continued without paying twice', async () => {
    const target = pastMonths()[5];
    seedPastExcept(target);
    for (const [i, u] of ALL.entries()) seedCompletion(u, 50 - i * 10, `2026-09-0${i + 5}T10:00:00Z`, target.month, target.year);
    await settle(LeaderboardService.finalizeMonth(target.month, target.year, 'crashed-run', { simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    const ledgerOfTop1 = awards(U1)[0].id;
    // the process that is working on it right now (its lease is alive)
    assert.equal((await locks.service.acquire(target.month, target.year, { owner: 'live-process' })).status, 'ACQUIRED');

    for (const initiator of ['SYSTEM_STARTUP_CATCHUP', 'SYSTEM_CRON', 'SYSTEM_RECONCILE']) {
      const r = await LeaderboardService.checkAndFinalizeAllPastMonths({ initiator });
      assert.deepEqual(r.finalizedMonths, [], `${initiator}: left alone`);
      assert.deepEqual(r.busyMonths, [`${target.month}/${target.year}`], `${initiator}: reported as busy`);
    }
    assert.equal(db.tables.rewardPointTransaction.length, 1);

    locks.clock.advance(60_001);                                          // the live process died
    const later = await LeaderboardService.checkAndFinalizeAllPastMonths({ initiator: 'SYSTEM_RECONCILE' });
    assert.deepEqual(later.finalizedMonths, [`${target.month}/${target.year}`]);
    assert.equal(awards(U1)[0].id, ledgerOfTop1, 'the first reward is not paid again');
    assert.equal(db.tables.rewardPointTransaction.length, 4);
  });

  it('IMMUT-05 legacy options (takeOverInProgress / takeOver / force) are ignored: they open no way around the lock', async () => {
    const target = pastMonths()[5];
    seedPastExcept(target);
    for (const [i, u] of ALL.entries()) seedCompletion(u, 50 - i * 10, `2026-09-0${i + 5}T10:00:00Z`, target.month, target.year);
    assert.equal((await locks.service.acquire(target.month, target.year, { owner: 'live-process' })).status, 'ACQUIRED');
    const r = await LeaderboardService.checkAndFinalizeAllPastMonths({ takeOverInProgress: true } as any);
    assert.deepEqual(r.finalizedMonths, []);
    const direct = await LeaderboardService.finalizeMonth(target.month, target.year, 'x', true as any);
    assert.equal(direct.status, 'BUSY');
    assert.equal(db.tables.rewardPointTransaction.length, 0);
  });

  it('IMMUT-07 FINALIZED period with a failed notification -> only that message is retried; nothing else is written', async () => {
    failNotificationFor.add(U3);
    await finalizeOnce();
    assert.equal(notified.length, 3);
    const snapshot = snapshotOf();
    const ledger = JSON.stringify(db.tables.rewardPointTransaction);
    const wallets = JSON.stringify(db.tables.userRewardPoint);
    const badgeRows = JSON.stringify(db.tables.badge);
    const boardRow = JSON.stringify(board());

    // finalize does not send it ...
    startRecording();
    const again = await run();
    assert.equal(again.status, 'ALREADY_FINALIZED');
    assert.equal(again.notificationsPending, 1);
    assert.equal(notified.length, 3);
    assertNoWrites('finalize of a period with a pending notification');

    // ... the dedicated retry does
    failNotificationFor.clear();
    startRecording();
    const left = await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    assert.equal(left, 0);
    assert.deepEqual(notified.slice(3), [U3], 'exactly the failed recipient');
    assert.deepEqual(
      db.writeCalls().map((c) => `${c.table}.${c.op}`),
      ['leaderboardEntry.updateMany', 'leaderboardEntry.updateMany'],
      'only the notification marker of that entry: the claim, then the outcome conditioned on it'
    );
    assert.equal(db.maxOpenTransactions, 0, 'no transaction was opened for a notification');
    assert.deepEqual(snapshotOf(), snapshot);
    assert.equal(JSON.stringify(db.tables.rewardPointTransaction), ledger);
    assert.equal(JSON.stringify(db.tables.userRewardPoint), wallets);
    assert.equal(JSON.stringify(db.tables.badge), badgeRows);
    assert.equal(JSON.stringify(board()), boardRow, 'status, totals and timestamps of the period untouched');
    assert.equal(db.callCount('rewardPointTransaction', 'findUnique'), 0, 'the reward code was not even invoked');
    assertNoRecompute();

    // and a second retry has nothing left to do
    startRecording();
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.equal(notified.length, 4);
    assertNoWrites('second retry');
  });

  it('IMMUT-07 the admin retry route re-sends failed notifications without finalizing anything', async () => {
    failNotificationFor.add(U3);
    await finalizeOnce();
    failNotificationFor.clear();
    const before = fingerprint(false);
    startRecording();

    const res = await callAdmin({ month: MONTH, year: YEAR }, 'retryNotifications');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.stillPending, 0);
    assert.equal(notified.filter((u) => u === U3).length, 1);
    const writes = db.writeCalls().map((c) => `${c.table}.${c.op}`).sort();
    assert.deepEqual(writes, ['leaderboardAuditLog.create', 'leaderboardEntry.updateMany', 'leaderboardEntry.updateMany'], 'audit row + claim + outcome of that one entry');
    assert.notEqual(fingerprint(false), before, 'only the notification marker changed');
    assert.equal(board().status, 'FINALIZED');
    assert.equal(db.callCount('monthlyLeaderboard', 'updateMany'), 0);

    const bad = await callAdmin({ month: 13, year: YEAR }, 'retryNotifications');
    assert.equal(bad.statusCode, 400);
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
