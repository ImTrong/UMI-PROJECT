/**
 * FIX 04.1 regression tests: finalizeMonth must not FINALIZE while a required reward is unconfirmed,
 * must be safely resumable from the frozen snapshot, and totalPointsAwarded must be the VERIFIED total.
 * Real LeaderboardService / RewardPointService code against the in-memory transactional Prisma fake
 * and a stubbed notification endpoint. Real-MongoDB runs: tests/integration/finalize.mongo.test.ts.
 *
 * Run: npm test
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePrisma, db } from './helpers/fake-prisma';
import { installUserServiceStub, TEST_INTERNAL_TOKEN } from './helpers/user-service-stub';
import { installTestLocks } from './helpers/lock-harness';

installFakePrisma();

/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require('axios').default || require('axios');
const logger = require('../src/utils/logger').default;
const { LeaderboardService, LeaderboardRewardIncompleteError } = require('../src/services/leaderboard.service');
const { RewardPointService } = require('../src/services/reward-point.service');

logger.transports.forEach((t: any) => { t.silent = true; });

const MONTH = 9;
const YEAR = 2026;
const U1 = '11'.repeat(12); // rank 1 -> 1000
const U2 = '22'.repeat(12); // rank 2 -> 700
const U3 = '33'.repeat(12); // rank 3 -> 500
const U4 = '44'.repeat(12); // rank 4 -> 200
const ALL = [U1, U2, U3, U4];
const REWARD: Record<string, number> = { [U1]: 1000, [U2]: 700, [U3]: 500, [U4]: 200 };
const TOTAL = 2400;

const seedCompletion = (userId: string, achievementPoints: number, at: string) =>
  db.seed('courseCompletionRecord', {
    userId, courseId: 'cc'.repeat(12), courseTitle: 'Course', completedAt: new Date(at), passed: true,
    totalDurationSeconds: 3600, level: 'BEGINNER', baseDurationPoints: achievementPoints, levelMultiplier: 1,
    achievementPoints, averageQuizScore: null, hasQuiz: false, policyVersion: '1.1', status: 'VALID',
    month: MONTH, year: YEAR,
  });

// ---------- notification endpoint stub ----------
let notified: string[] = [];
let failNotificationFor = new Set<string>();

let locks: ReturnType<typeof installTestLocks>;
let userService: ReturnType<typeof installUserServiceStub>;

beforeEach(() => {
  db.reset();
  locks = installTestLocks(LeaderboardService);
  notified = [];
  failNotificationFor = new Set();
  seedCompletion(U1, 50, '2026-09-05T10:00:00Z');
  seedCompletion(U2, 30, '2026-09-06T10:00:00Z');
  seedCompletion(U3, 20, '2026-09-07T10:00:00Z');
  seedCompletion(U4, 10, '2026-09-08T10:00:00Z');
  userService = installUserServiceStub(axios, mock, (body) => {
    if (failNotificationFor.has(body.userId)) throw new Error('user-service unavailable');
    notified.push(body.userId);
  });
});
afterEach(() => mock.restoreAll());

// ---------- helpers ----------
const run = (opts?: any) => LeaderboardService.finalizeMonth(MONTH, YEAR, 'TEST', opts);
const settle = async (p: Promise<any>) => {
  try { return { ok: true as const, value: await p }; } catch (error: any) { return { ok: false as const, error }; }
};
const board = () => db.tables.monthlyLeaderboard[0];
const entries = () => db.tables.leaderboardEntry.slice().sort((a, b) => a.rank - b.rank);
const awards = (u: string) => db.tables.rewardPointTransaction.filter((t) => t.userId === u && t.type === 'LEADERBOARD_REWARD');
const wallet = (u: string) => db.tables.userRewardPoint.find((w) => w.userId === u);
const badges = (u: string) => db.tables.badge.filter((b) => b.userId === u && b.badgeType === 'LEADERBOARD_REWARD');
const audit = (action: string) => db.tables.leaderboardAuditLog.filter((a) => a.action === action);
const notifiedCount = (u: string) => notified.filter((x) => x === u).length;
const key = (u: string) => RewardPointService.leaderboardRewardKey(u, MONTH, YEAR);

const failAwardFor = (userId: string, error = new Error('ledger insert failed')) =>
  db.failNext('rewardPointTransaction', 'create', error, 1, (a) => a?.data?.userId === userId && a?.data?.type === 'LEADERBOARD_REWARD');
const failBadgeFor = (userId: string) =>
  db.failNext('badge', 'create', new Error('badge insert failed'), 1, (a) => a?.data?.userId === userId);

const assertPaidOnce = (u: string) => {
  assert.equal(awards(u).length, 1, `user ${u.slice(0, 2)} has exactly one reward ledger entry`);
  assert.equal(awards(u)[0].amount, REWARD[u]);
  assert.equal(awards(u)[0].idempotencyKey, key(u));
  assert.equal(awards(u)[0].sourceId, board().id);
  assert.equal(wallet(u)!.balance, REWARD[u]);
  assert.equal(wallet(u)!.totalEarned, REWARD[u]);
  assert.equal(badges(u).length, 1, 'exactly one badge');
};

// ====================================================================================

describe('FINALIZE: completion requires every reward to be confirmed', () => {
  it('FINALIZE-01 all rewards confirmed -> FINALIZED with the verified total', async () => {
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.totalPointsAwarded, TOTAL);
    assert.equal(r.notificationsPending, 0);
    assert.equal(board().status, 'FINALIZED');
    assert.equal(board().totalPointsAwarded, TOTAL);
    assert.ok(board().finalizedAt);
    for (const u of ALL) {
      assertPaidOnce(u);
      assert.equal(notifiedCount(u), 1);
    }
    assert.deepEqual(entries().map((e) => [e.userId, e.rank]), [[U1, 1], [U2, 2], [U3, 3], [U4, 4]]);
    for (const e of entries()) {
      assert.ok(e.rewardBadgeId, 'badge linked on the snapshot entry');
      assert.ok(e.rewardNotifiedAt);
    }
    assert.equal(db.tables.rewardPointTransaction.length, 4);
    assert.equal(audit('FINALIZE_REWARDS_INCOMPLETE').length, 0);
  });

  it('FINALIZE-02 one award fails mid-loop -> NOT finalized, the other students are still paid, total = verified only', async () => {
    failAwardFor(U2);
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof LeaderboardRewardIncompleteError);
    assert.match((r as any).error.message, /rewards incomplete/);
    assert.deepEqual((r as any).error.failures.map((f: any) => [f.userId, f.step]), [[U2, 'POINTS']]);

    assert.equal(board().status, 'REWARDING', 'not marked FINALIZED');
    assert.equal(board().finalizedAt, null);
    assert.equal(board().totalPointsAwarded, 1700, 'verified 1000 + 500 + 200, NOT the planned 2400');
    assert.equal(awards(U2).length, 0);
    assert.equal(wallet(U2)!.balance, 0, 'rolled back by the transaction');
    for (const u of [U1, U3, U4]) assertPaidOnce(u);
    assert.equal(entries().length, 4, 'frozen snapshot kept');
    assert.equal(audit('FINALIZE_REWARDS_INCOMPLETE').length, 1);
    assert.equal(notifiedCount(U2), 0, 'no "you received points" message for a student who was not paid');
  });

  it('FINALIZE-03 Top 1 already rewarded, Top 2 fails -> retry does not pay Top 1 again and completes Top 2', async () => {
    failAwardFor(U2);
    await settle(run());
    assert.equal(awards(U1).length, 1);
    const u1Ledger = awards(U1)[0].id;

    const retry = await run();
    assert.equal(retry.status, 'FINALIZED');
    assert.equal(retry.totalPointsAwarded, TOTAL);
    assert.equal(awards(U1)[0].id, u1Ledger, 'same ledger entry, not a new one');
    for (const u of ALL) assertPaidOnce(u);
    assert.equal(notifiedCount(U1), 1, 'Top 1 is not notified a second time');
    assert.equal(notifiedCount(U2), 1);
    assert.equal(board().status, 'FINALIZED');
  });
});

describe('FINALIZE: crash recovery from the frozen snapshot', () => {
  it('FINALIZE-04 server dies after the first reward was committed -> retry verifies it, never re-pays', async () => {
    const crash = await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    assert.equal(crash.ok, false);
    assert.match((crash as any).error.message, /Crash occurred immediately after rewarding first student/);
    assert.equal(board().status, 'REWARDING');
    assertPaidOnce(U1);
    assert.equal(awards(U2).length, 0);

    const resumed = await run();
    assert.equal(resumed.status, 'FINALIZED');
    assert.equal(resumed.totalPointsAwarded, TOTAL);
    assert.equal(wallet(U1)!.balance, 1000, 'no double reward');
    for (const u of ALL) assertPaidOnce(u);
    assert.equal(db.tables.rewardPointTransaction.length, 4);
  });

  it('FINALIZE-04 award committed but the caller saw an error (lost response) -> counted from the ledger, never paid twice', async () => {
    // commit succeeds, then the caller gets an exception - for Top 2 only, on the first run only
    const original = RewardPointService.awardLeaderboardPoints.bind(RewardPointService);
    let armed = true;
    mock.method(RewardPointService, 'awardLeaderboardPoints', async (userId: string, ...rest: any[]) => {
      const result = await original(userId, ...rest);
      if (armed && userId === U2) throw new Error('connection reset after commit');
      return result;
    });

    const first = await run();
    assert.equal(first.status, 'FINALIZED', 'the committed reward is recognised from the ledger, so nothing is missing');
    assert.equal(first.totalPointsAwarded, TOTAL);
    armed = false;
    assert.equal(awards(U2).length, 1);
    assert.equal(wallet(U2)!.balance, 700);

    const again = await run(undefined, false);
    assert.equal(again.status, 'ALREADY_FINALIZED');
    for (const u of ALL) assertPaidOnce(u);
    assert.equal(db.tables.rewardPointTransaction.length, 4);
  });

  it('FINALIZE-08 retry in REWARDING uses the frozen snapshot: ranks and entries are not recomputed', async () => {
    failAwardFor(U3);
    await settle(run());
    const idsBefore = entries().map((e) => e.id);
    const ranksBefore = entries().map((e) => [e.userId, e.rank, e.points]);

    // live data moves on after the freeze: a new student would now rank first
    const U5 = '55'.repeat(12);
    seedCompletion(U5, 500, '2026-09-20T10:00:00Z');

    const retry = await run();
    assert.equal(retry.status, 'FINALIZED');
    assert.deepEqual(entries().map((e) => e.id), idsBefore, 'snapshot rows were not deleted / recreated');
    assert.deepEqual(entries().map((e) => [e.userId, e.rank, e.points]), ranksBefore);
    assert.equal(awards(U5).length, 0, 'a student who was not in the snapshot is not paid');
    assert.equal(db.tables.leaderboardEntry.length, 4);
    assert.equal(retry.totalPointsAwarded, TOTAL);
  });

  it('FINALIZE-10 every reward done but the final status not written -> retry finalizes without paying again', async () => {
    const crash = await settle(run({ simulateFailureAt: 'BEFORE_FINALIZED' }));
    assert.equal(crash.ok, false);
    assert.equal(board().status, 'REWARDING');
    assert.equal(db.tables.rewardPointTransaction.length, 4);
    const ledgerIds = db.tables.rewardPointTransaction.map((t) => t.id);
    const walletsBefore = ALL.map((u) => wallet(u)!.balance);

    const retry = await run();
    assert.equal(retry.status, 'FINALIZED');
    assert.equal(retry.totalPointsAwarded, TOTAL);
    assert.deepEqual(db.tables.rewardPointTransaction.map((t) => t.id), ledgerIds, 'no new ledger entries');
    assert.deepEqual(ALL.map((u) => wallet(u)!.balance), walletsBefore);
    for (const u of ALL) {
      assert.equal(badges(u).length, 1);
      assert.equal(notifiedCount(u), 1, 'already-notified students are not messaged again');
    }
  });

  it('two forced retries running at the same time on a REWARDING period: no duplicate points or badges', async () => {
    await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    const [a, b] = await Promise.all([settle(run()), settle(run())]);
    assert.ok(a.ok || b.ok);
    for (const u of ALL) assertPaidOnce(u);
    assert.equal(db.tables.rewardPointTransaction.length, 4);
    assert.equal(board().status, 'FINALIZED');
    assert.equal(board().totalPointsAwarded, TOTAL);
  });
});

describe('FINALIZE: ledger entries that do not match the snapshot are never accepted', () => {
  const cases: Array<[string, (leaderboardId: string) => Record<string, any>]> = [
    ['wrong amount', () => ({ amount: 999 })],
    ['belongs to another user', () => ({ userId: '99'.repeat(12) })],
    ['wrong transaction type', () => ({ type: 'ADMIN_ADJUSTMENT' })],
    ['wrong period', (lb) => ({ metadata: { leaderboardId: lb, rank: 2, month: MONTH - 1, year: YEAR, points: 700 } })],
    ['wrong leaderboard', () => ({ sourceId: 'ff'.repeat(12) })],
  ];
  for (const [label, override] of cases) {
    it(`FINALIZE-05 ledger entry with ${label} -> integrity error, period NOT finalized, nothing rewritten`, async () => {
      // 1. run once and "crash" so the snapshot is frozen and its leaderboard id exists
      await settle(run({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
      const lb = board().id;

      // 2. Top 2's reward key is occupied by an entry that conflicts with the frozen snapshot
      const conflicting = db.seed('rewardPointTransaction', {
        userId: U2, amount: 700, type: 'LEADERBOARD_REWARD', description: 'old', balanceAfter: 700,
        sourceId: lb, idempotencyKey: key(U2),
        metadata: { leaderboardId: lb, rank: 2, month: MONTH, year: YEAR, points: 700 },
        ...override(lb),
      });
      const snapshotOfEntry = JSON.stringify(conflicting);
      const walletBefore = wallet(U2)?.balance ?? 0;

      // 3. retry: must be refused, not silently accepted
      const r = await settle(run());
      assert.equal(r.ok, false, 'must not be reported as success');
      assert.ok((r as any).error instanceof LeaderboardRewardIncompleteError, (r as any).error?.message);
      assert.deepEqual((r as any).error.failures.filter((f: any) => f.userId === U2).map((f: any) => f.step), ['POINTS']);
      assert.equal(board().status, 'REWARDING');
      assert.equal(wallet(U2)?.balance ?? 0, walletBefore, 'no automatic credit');
      assert.equal(JSON.stringify(conflicting), snapshotOfEntry, 'history is not modified');
      assert.equal(db.tables.rewardPointTransaction.filter((t) => t.idempotencyKey === key(U2)).length, 1, 'no second entry');
      assert.ok(audit('REWARD_INTEGRITY_ERROR').some((a) => a.targetUserId === U2), 'the integrity problem is recorded');
      assert.equal(board().totalPointsAwarded, TOTAL - 700, 'only the verified rewards are counted');
      for (const u of [U1, U3, U4]) assert.equal(awards(u).length, 1);
    });
  }
});

describe('FINALIZE: badges and notifications', () => {
  it('FINALIZE-06 badge fails after the points were added -> retry adds no points, then the missing badge', async () => {
    failBadgeFor(U2);
    const first = await settle(run());
    assert.equal(first.ok, false);
    assert.deepEqual((first as any).error.failures.map((f: any) => [f.userId, f.step]), [[U2, 'BADGE']]);
    assert.equal(board().status, 'REWARDING');
    assert.equal(awards(U2).length, 1, 'points were committed');
    assert.equal(wallet(U2)!.balance, 700);
    assert.equal(badges(U2).length, 0);
    assert.equal(board().totalPointsAwarded, TOTAL, 'all points are verified; the period is still not final because the badge is missing');
    assert.equal(notifiedCount(U2), 0, 'no notification until points AND badge are confirmed');

    const retry = await run();
    assert.equal(retry.status, 'FINALIZED');
    assert.equal(wallet(U2)!.balance, 700, 'points are not added a second time');
    assert.equal(awards(U2).length, 1);
    assert.equal(badges(U2).length, 1);
    assert.equal(notifiedCount(U2), 1);
    for (const u of ALL) assertPaidOnce(u);
  });

  it('an existing badge is never duplicated and a same-named badge of another type is an integrity error', async () => {
    await run();
    const badgeCount = db.tables.badge.length;
    await run();
    assert.equal(db.tables.badge.length, badgeCount);

    db.reset();
    seedCompletion(U1, 50, '2026-09-05T10:00:00Z');
    const name = `Nhà vô địch tháng 09/${YEAR}`;
    db.seed('badge', { userId: U1, badgeName: name, badgeType: 'SOMETHING_ELSE' });
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.equal((r as any).error.failures[0].step, 'BADGE');
    assert.equal(db.tables.badge.length, 1, 'the existing badge is untouched');
    assert.equal(db.tables.badge[0].badgeType, 'SOMETHING_ELSE');
  });

  it('FINALIZE-07 notification fails -> the period is still FINALIZED, the failure is recorded, points/badges untouched; retry notifies only the failed one', async () => {
    failNotificationFor.add(U3);
    const r = await run();
    assert.equal(r.status, 'FINALIZED', 'notification is a secondary task, not a finalization requirement');
    assert.equal(r.notificationsPending, 1);
    assert.equal(r.totalPointsAwarded, TOTAL);
    for (const u of ALL) assertPaidOnce(u);

    const e3 = entries().find((e) => e.userId === U3)!;
    assert.match(e3.rewardNotifyError, /user-service unavailable/);
    assert.equal(e3.rewardNotifiedAt, undefined);
    assert.equal(notifiedCount(U3), 0);
    for (const u of [U1, U2, U4]) assert.equal(notifiedCount(u), 1);

    // finalizing again is NOT how notifications are retried: it only reports what is still pending
    const again = await run(undefined, false);
    assert.equal(again.status, 'ALREADY_FINALIZED');
    assert.equal(again.notificationsPending, 1);
    assert.equal(notifiedCount(U3), 0, 'finalize never sends anything for a finalized period');

    // user-service recovers: the dedicated retry only re-sends the failed notification
    failNotificationFor.clear();
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.equal(notifiedCount(U3), 1);
    for (const u of [U1, U2, U4]) assert.equal(notifiedCount(u), 1, 'nobody else is notified again');
    const e3b = entries().find((e) => e.userId === U3)!;
    assert.equal(e3b.rewardNotifyError, null);
    assert.ok(e3b.rewardNotifiedAt);
    for (const u of ALL) assertPaidOnce(u);
    assert.equal(db.tables.rewardPointTransaction.length, 4);
  });

  it('an old FINALIZED period (no notification markers at all) is never re-notified', async () => {
    await run();
    notified = [];
    for (const e of db.tables.leaderboardEntry) { delete e.rewardNotifiedAt; delete e.rewardNotifyError; }
    const left = await LeaderboardService.retryFailedNotifications(MONTH, YEAR);
    assert.equal(left, 0);
    assert.equal(notified.length, 0);
  });
});

describe('FINALIZE: totalPointsAwarded is the verified total', () => {
  it('FINALIZE-09 some rewards succeed, some fail -> the stored total counts only the verified ones, then converges', async () => {
    failAwardFor(U2);
    failAwardFor(U4);
    const r = await settle(run());
    assert.equal(r.ok, false);
    assert.equal((r as any).error.verifiedPoints, 1500);
    assert.equal((r as any).error.expectedPoints, TOTAL);
    assert.equal(board().totalPointsAwarded, 1500);
    assert.equal(board().status, 'REWARDING');
    // the stored value equals what the ledger shows for this leaderboard
    const ledgerSum = db.tables.rewardPointTransaction
      .filter((t) => t.type === 'LEADERBOARD_REWARD' && t.sourceId === board().id)
      .reduce((s, t) => s + t.amount, 0);
    assert.equal(ledgerSum, 1500);

    const retry = await run();
    assert.equal(retry.totalPointsAwarded, TOTAL);
    assert.equal(board().totalPointsAwarded, TOTAL);
    const ledgerSum2 = db.tables.rewardPointTransaction
      .filter((t) => t.type === 'LEADERBOARD_REWARD' && t.sourceId === board().id)
      .reduce((s, t) => s + t.amount, 0);
    assert.equal(ledgerSum2, TOTAL, 'a retry does not accumulate on top of the earlier total');
  });

  it('course-redemption and other wallet transactions never count towards the total', async () => {
    db.seed('userRewardPoint', { userId: U1, balance: 5000, totalEarned: 5000, totalSpent: 0 });
    db.seed('rewardPointTransaction', {
      userId: U1, amount: -500, type: 'COURSE_REDEMPTION', description: 'x', balanceAfter: 4500,
      sourceId: 'cc'.repeat(12), idempotencyKey: 'redeem:x', metadata: {},
    });
    const r = await run();
    assert.equal(r.totalPointsAwarded, TOTAL);
  });

  it('an unrewarded rank (outside the Top 10) contributes nothing', async () => {
    for (let i = 0; i < 8; i++) seedCompletion(`${(0x60 + i).toString(16)}`.repeat(12), 5 - i * 0.1, `2026-09-${10 + i}T10:00:00Z`);
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    // ranks 5..10 pay 200 each; ranks 11,12 pay nothing
    assert.equal(r.totalPointsAwarded, 1000 + 700 + 500 + 200 * 7);
    assert.equal(db.tables.rewardPointTransaction.filter((t) => t.type === 'LEADERBOARD_REWARD').length, 10);
  });
});

describe('FINALIZE: reward notifications are authenticated service-to-service calls (FIX 06C-4B2A)', () => {
  const withSecret = async (secret: string | undefined, fn: () => Promise<void>) => {
    const saved = process.env.INTERNAL_SERVICE_TOKEN;
    if (secret === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = secret;
    try { await fn(); } finally { process.env.INTERNAL_SERVICE_TOKEN = saved; }
  };

  it('NOTIFY-AUTH-01 every reward notification goes through the shared client: internal token header, the leaderboard idempotency key, the 5 s timeout, the same payload', async () => {
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(userService.notificationCalls.length, 4, 'one request per rewarded student');
    for (const call of userService.notificationCalls) {
      assert.ok(call.url.endsWith('/api/users/internal/notifications'));
      assert.equal(call.token, TEST_INTERNAL_TOKEN, 'the shared secret is sent');
      assert.equal(call.timeout, 5000, 'the timeout this caller always had');
      assert.deepEqual(call.headerNames, ['x-internal-service-token', 'x-idempotency-key'], 'the token and, since FIX 06C-4B2B2, the key of this reward event - nothing else');
      assert.equal(call.key, `reward_lb_notify_9_2026_${call.body.userId}`);
      assert.deepEqual(Object.keys(call.body).sort(), ['link', 'message', 'title', 'type', 'userId']);
      assert.equal(call.body.type, 'SUCCESS');
      assert.equal(call.body.link, '/leaderboard');
    }
    const first = userService.notificationCalls.find((c) => c.body.userId === U1)!;
    assert.equal(first.body.title, '🏆 Chúc mừng! Bạn đạt Nhà vô địch tháng 09/2026');
    assert.equal(
      first.body.message,
      'Bạn đạt thứ hạng #1 trong Bảng xếp hạng tháng 09/2026 với 50 điểm thành tích và nhận được 1000 điểm thưởng cùng huy hiệu 🥇!'
    );
  });

  it('NOTIFY-AUTH-02 a refused notification (the User Service answers 403) is recorded and retried exactly like any other failure', async () => {
    failNotificationFor.add(U3);
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.notificationsPending, 1);

    failNotificationFor.clear();
    const wrongSecret = 'wrong-secret-for-this-test';
    await withSecret(wrongSecret, async () => {
      assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1, 'still undelivered');
    });
    const refused = entries().find((e) => e.userId === U3)!;
    assert.match(refused.rewardNotifyError, /status code 403|Forbidden/, 'the refusal is recorded, not swallowed');
    assert.match(refused.rewardNotifyError, /rejected the internal service token/);
    assert.ok(!refused.rewardNotifyError.includes(wrongSecret), 'the secret never reaches the recorded error');
    assert.equal(refused.rewardNotifiedAt, undefined);
    assert.equal(refused.rewardNotifyClaimToken, null, 'the claim is released so the next attempt is not delayed');
    assert.equal(notifiedCount(U3), 0);

    // the right secret again: the same entry is delivered, nobody else is notified a second time
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.equal(notifiedCount(U3), 1);
    for (const u of [U1, U2, U4]) assert.equal(notifiedCount(u), 1);
    assert.ok(entries().find((e) => e.userId === U3)!.rewardNotifiedAt);
  });

  it('NOTIFY-AUTH-03 without INTERNAL_SERVICE_TOKEN nothing is sent: the entry keeps an error marker and the next retry with the secret delivers it', async () => {
    failNotificationFor.add(U3);
    await run();
    failNotificationFor.clear();
    const before = userService.notificationCalls.length;

    await withSecret(undefined, async () => {
      assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1);
    });
    assert.equal(userService.notificationCalls.length, before, 'no request at all without the secret');
    const e3 = entries().find((e) => e.userId === U3)!;
    assert.match(e3.rewardNotifyError, /INTERNAL_SERVICE_TOKEN is not configured/);
    assert.equal(e3.rewardNotifiedAt, undefined);
    assert.equal(e3.rewardNotifyClaimToken, null);

    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.equal(notifiedCount(U3), 1);
    assert.ok(entries().find((e) => e.userId === U3)!.rewardNotifiedAt);
  });
});

describe('FINALIZE: the reward notification carries one stable idempotency key (FIX 06C-4B2B2)', () => {
  const keyOf = (u: string) => `reward_lb_notify_${MONTH}_${YEAR}_${u}`;
  const callsTo = (u: string) => userService.notificationCalls.filter((c) => c.body.userId === u);
  const timeoutError = () => Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' });

  it('NOTIFY-KEY-01 the answer is lost AFTER the User Service stored the notification: the retry sends the SAME key and body, gets 200 deduplicated, records success - one notification, one push', async () => {
    userService.notificationMode = 'idempotent';
    let lose = true;
    userService.afterCreate = (body) => { if (body.userId === U3 && lose) { lose = false; throw timeoutError(); } };
    const r = await run();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.notificationsPending, 1, 'finalize could not know the message was stored');
    assert.match(entries().find((e) => e.userId === U3)!.rewardNotifyError, /timeout/);

    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0, 'the deduplicated answer counts as delivered');
    const toU3 = callsTo(U3);
    assert.equal(toU3.length, 2);
    assert.deepEqual(toU3.map((c) => c.key), [keyOf(U3), keyOf(U3)], 'finalize and the retry use the same key');
    assert.deepEqual(toU3[1].body, toU3[0].body, 'and the same body');
    assert.deepEqual(toU3.map((c) => c.outcome), ['created', 'deduplicated']);
    assert.equal(notifiedCount(U3), 1, 'ONE notification stored and pushed');
    assert.equal(userService.createdByKey.size, 4);
    const e3 = entries().find((e) => e.userId === U3)!;
    assert.ok(e3.rewardNotifiedAt);
    assert.equal(e3.rewardNotifyError, null);
    assert.equal(e3.rewardNotifyClaimToken, null);
  });

  it('NOTIFY-KEY-02 the same scenario against a LEGACY server that ignores the key: two notifications - what the key protects against', async () => {
    let lose = true;
    userService.notificationMode = 'legacy';
    mock.restoreAll();
    userService = installUserServiceStub(axios, mock, (body) => {
      notified.push(body.userId);                                     // stored and pushed ...
      if (body.userId === U3 && lose) { lose = false; throw timeoutError(); } // ... then the answer is lost
    });
    await run();
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.equal(notifiedCount(U3), 2, 'the old server creates a second notification');
    assert.deepEqual(callsTo(U3).map((c) => c.key), [keyOf(U3), keyOf(U3)], 'although the key was sent both times');
  });

  it('NOTIFY-KEY-03 timeouts / 5xx keep the existing retry behaviour and every attempt uses the same key', async () => {
    userService.notificationMode = 'idempotent';
    failNotificationFor.add(U3);
    await run();
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1);
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1);
    failNotificationFor.clear();
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    assert.deepEqual(callsTo(U3).map((c) => c.key), [keyOf(U3), keyOf(U3), keyOf(U3), keyOf(U3)]);
    assert.equal(notifiedCount(U3), 1);
    for (const u of [U1, U2, U4]) assert.deepEqual(callsTo(u).map((c) => c.key), [keyOf(u)], 'one request each, with its own key');
  });

  it('NOTIFY-KEY-04 a 422 (the key is already used for a different notification) is recorded as an error; the retry does NOT invent another key', async () => {
    userService.notificationMode = 'idempotent';
    userService.createdByKey.set(keyOf(U3), { userId: U3, type: 'INFO', link: '/somewhere-else', title: 'x', message: 'y' });
    await run();
    const e3 = entries().find((e) => e.userId === U3)!;
    assert.match(e3.rewardNotifyError, /status code 422/);
    assert.equal(e3.rewardNotifiedAt, undefined);
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1, 'still undelivered: a conflict needs a human, not a new key');
    assert.deepEqual(callsTo(U3).map((c) => [c.key, c.outcome]), [[keyOf(U3), 'conflict'], [keyOf(U3), 'conflict']]);
    assert.equal(notifiedCount(U3), 0);
  });

  it('NOTIFY-KEY-05 the text comes from frozen data: after a scoring-policy change the retry still says what was paid and awarded', async () => {
    userService.notificationMode = 'idempotent';
    failNotificationFor.add(U1);
    await run();
    const firstAttempt = callsTo(U1)[0].body;
    const { REWARD_TIERS } = require('../src/config/scoring-policy');
    const saved = { ...REWARD_TIERS[0] };
    try {
      Object.assign(REWARD_TIERS[0], { rewardPoints: 5000, badgeTitlePrefix: 'Vua tháng', icon: '👑' }); // the live policy changes later
      failNotificationFor.clear();
      assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 0);
    } finally {
      Object.assign(REWARD_TIERS[0], saved);
    }
    const retried = callsTo(U1)[1].body;
    assert.deepEqual(retried, firstAttempt, 'same key, same text');
    assert.equal(retried.title, '🏆 Chúc mừng! Bạn đạt Nhà vô địch tháng 09/2026');
    assert.match(retried.message, /nhận được 1000 điểm thưởng cùng huy hiệu 🥇!$/);
    assert.equal(awards(U1)[0].amount, 1000, 'which is what the ledger shows');
  });

  it('NOTIFY-KEY-06 nothing is sent when the frozen facts are missing (no badge for the period): the failure is recorded, no amount is guessed', async () => {
    failNotificationFor.add(U2);
    await run();
    failNotificationFor.clear();
    const e2 = entries().find((e) => e.userId === U2)!;
    db.tables.badge = db.tables.badge.filter((b) => b.id !== e2.rewardBadgeId); // the awarded badge disappeared (manual deletion)
    const before = callsTo(U2).length;
    assert.equal(await LeaderboardService.retryFailedNotifications(MONTH, YEAR), 1);
    assert.equal(callsTo(U2).length, before, 'no request');
    assert.match(entries().find((e) => e.userId === U2)!.rewardNotifyError, /badge of this period was not found/);
  });
});
