/**
 * FIX 05 regression tests: fair, non-transitive tie handling (RANK-xx) and learner eligibility (ELIG-xx).
 *
 * RANK tests exercise the pure ranking function AND the real aggregation path (CourseCompletionRecord
 * -> eligibility filter -> rankEntries -> live view / frozen snapshot / rewards). ELIG tests run the real
 * LeaderboardService against the in-memory Prisma fake and a stubbed User Service.
 * Real-MongoDB counterpart: tests/integration/ranking.mongo.test.ts.
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
const {
  LeaderboardService, rankEntries, compareEntries, TIE_WINDOW_MS,
} = require('../src/services/leaderboard.service');
const { UserEligibilityError } = require('../src/services/user-eligibility.service');
const { LeaderboardController } = require('../src/controllers/leaderboard.controller');
const { getCurrentVietnamMonthYear } = require('../src/config/scoring-policy');

logger.transports.forEach((t: any) => { t.silent = true; });

const MONTH = 9;
const YEAR = 2026;
const BASE = Date.parse('2026-09-10T10:00:00.000Z');
const id = (n: number) => n.toString(16).padStart(2, '0').repeat(12).slice(0, 24);

type Spec = { points?: number; courses?: number; score?: number | null; at?: number };
const entry = (n: number, spec: Spec = {}) => ({
  userId: id(n), rank: 0, points: spec.points ?? 10, completedCourses: spec.courses ?? 1,
  averageScore: spec.score === undefined ? null : spec.score,
  lastCompletedAt: new Date(BASE + (spec.at ?? 0)), rewardPoints: 0, rewardBadgeId: null, scoreBreakdown: [], isTie: false,
});

/** rank + tie flag per user, for order-independent comparison */
const outcome = (list: any[]) => Object.fromEntries(list.map((e) => [e.userId, [e.rank, e.isTie]]));

/** Invariants that must hold for ANY output of rankEntries. */
const assertRankingConsistent = (ranked: any[]) => {
  let leader: any = null;
  const groups: any[][] = [];
  for (const e of ranked) {
    if (leader && e.rank === leader.rank) groups[groups.length - 1].push(e);
    else { leader = e; groups.push([e]); }
  }
  let position = 1;
  for (const g of groups) {
    assert.ok(g.every((m) => m.rank === position), `group starts at position ${position}`);   // standard competition ranking
    assert.ok(g.every((m) => m.isTie === (g.length > 1)), 'isTie true for every member of a group of 2+, false for singles');
    for (const m of g) {
      assert.equal(m.points, g[0].points);
      assert.equal(m.completedCourses, g[0].completedCourses);
      assert.equal(m.averageScore ?? -1, g[0].averageScore ?? -1);
      assert.ok(Math.abs(m.lastCompletedAt.getTime() - g[0].lastCompletedAt.getTime()) < TIE_WINDOW_MS, 'within the window of the LEADER');
    }
    position += g.length;
  }
};

// =====================================================================================================
describe('RANK: tie groups are anchored on the group leader (no transitive chaining)', () => {
  it('the tie window is the existing 1000 ms, strictly less-than', () => {
    assert.equal(TIE_WINDOW_MS, 1000);
  });

  it('RANK-01 A=0ms, B=900ms, C=1800ms (all else equal) -> A and B rank 1, C ranks 3', () => {
    const ranked = rankEntries([entry(3, { at: 1800 }), entry(1, { at: 0 }), entry(2, { at: 900 })]);
    assert.deepEqual(ranked.map((e: any) => [e.userId, e.rank, e.isTie]), [[id(1), 1, true], [id(2), 1, true], [id(3), 3, false]]);
    assertRankingConsistent(ranked);
  });

  it('RANK-02 20 learners, each 800 ms after the previous -> pairs, never one giant group of rank 1', () => {
    const list = Array.from({ length: 20 }, (_, i) => entry(i + 1, { at: i * 800 }));
    const ranked = rankEntries(list);
    assert.deepEqual(ranked.map((e: any) => e.rank), [1, 1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11, 13, 13, 15, 15, 17, 17, 19, 19]);
    assert.ok(ranked.every((e: any) => e.isTie));
    assert.notEqual(ranked.filter((e: any) => e.rank === 1).length, 20);
    assertRankingConsistent(ranked);

    // the old algorithm (compare with the previous entry) would have produced exactly this - prove the test can see it
    const chained = [...list];
    chained.forEach((e, i) => { e.rank = i === 0 ? 1 : (Math.abs(e.lastCompletedAt.getTime() - chained[i - 1].lastCompletedAt.getTime()) < 1000 ? chained[i - 1].rank : i + 1); });
    assert.equal(chained.filter((e) => e.rank === 1).length, 20);
  });

  it('RANK-03 999 ms apart -> tie', () => {
    const ranked = rankEntries([entry(1, { at: 0 }), entry(2, { at: 999 })]);
    assert.deepEqual(ranked.map((e: any) => [e.rank, e.isTie]), [[1, true], [1, true]]);
  });

  it('RANK-04 exactly 1000 ms apart -> NOT a tie (strictly less than)', () => {
    const ranked = rankEntries([entry(1, { at: 0 }), entry(2, { at: 1000 })]);
    assert.deepEqual(ranked.map((e: any) => [e.rank, e.isTie]), [[1, false], [2, false]]);
  });

  it('RANK-05 different achievement points never tie, however close the times', () => {
    const ranked = rankEntries([entry(1, { points: 10, at: 0 }), entry(2, { points: 9.99, at: 1 })]);
    assert.deepEqual(ranked.map((e: any) => [e.userId, e.rank, e.isTie]), [[id(1), 1, false], [id(2), 2, false]]);
  });

  it('RANK-06 different number of completed courses never tie', () => {
    const ranked = rankEntries([entry(1, { courses: 2, at: 5 }), entry(2, { courses: 3, at: 0 }), entry(3, { courses: 2, at: 0 })]);
    assert.deepEqual(ranked.map((e: any) => [e.userId, e.rank, e.isTie]), [[id(2), 1, false], [id(3), 2, true], [id(1), 2, true]]);
  });

  it('RANK-07 quiz average decides before the completion time; equal averages tie', () => {
    const ranked = rankEntries([
      entry(1, { score: 80, at: 0 }), entry(2, { score: 90, at: 500 }), entry(3, { score: 90, at: 900 }), entry(4, { score: 85, at: 0 }),
    ]);
    assert.deepEqual(ranked.map((e: any) => [e.userId, e.rank, e.isTie]), [[id(2), 1, true], [id(3), 1, true], [id(4), 3, false], [id(1), 4, false]]);
    assertRankingConsistent(ranked);
  });

  it('criteria keep their order: points > courses > quiz > time', () => {
    const ranked = rankEntries([
      entry(4, { points: 10, courses: 1, score: 99, at: 0 }),
      entry(3, { points: 10, courses: 2, score: 1, at: 99_000 }),
      entry(2, { points: 11, courses: 1, score: 1, at: 99_000 }),
      entry(1, { points: 10, courses: 2, score: 50, at: 50_000 }),
    ]);
    assert.deepEqual(ranked.map((e: any) => e.userId), [id(2), id(1), id(3), id(4)]);
  });

  it('RANK-08 three really tied learners -> same rank, all isTie, the next one skips to 4', () => {
    const ranked = rankEntries([entry(1, { at: 0 }), entry(2, { at: 300 }), entry(3, { at: 600 }), entry(4, { at: 5000 })]);
    assert.deepEqual(ranked.map((e: any) => [e.rank, e.isTie]), [[1, true], [1, true], [1, true], [4, false]]);
  });

  it('RANK-10 null quiz average: null ties with null, ranks below any real score (also 0)', () => {
    const ranked = rankEntries([
      entry(1, { score: null, at: 0 }), entry(2, { score: null, at: 400 }), entry(3, { score: 0, at: 0 }), entry(4, { score: 100, at: 0 }),
    ]);
    assert.deepEqual(ranked.map((e: any) => [e.userId, e.rank, e.isTie]), [[id(4), 1, false], [id(3), 2, false], [id(1), 3, true], [id(2), 3, true]]);
    assertRankingConsistent(ranked);
  });

  it('RANK-09 the outcome does not depend on the input order (many shuffles, several tie groups)', () => {
    const specs: Spec[] = [
      { points: 20, at: 0 }, { points: 20, at: 400 }, { points: 20, at: 1500 }, { points: 20, at: 1800 }, { points: 20, at: 2600 },
      { points: 15, courses: 2, at: 0 }, { points: 15, courses: 2, at: 999 }, { points: 15, courses: 1, at: 0 },
      { points: 10, score: 70, at: 0 }, { points: 10, score: 70, at: 1000 }, { points: 10, score: null, at: 0 }, { points: 5, at: 0 }, { points: 5, at: 0 },
    ];
    const list = specs.map((s, i) => entry(i + 1, s));
    const reference = rankEntries(list.map((e) => ({ ...e })));
    const expectedOutcome = outcome(reference);
    const expectedOrder = reference.map((e: any) => e.userId);
    assertRankingConsistent(reference);

    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let n = 0; n < 300; n++) {
      const shuffled = list.map((e) => ({ ...e })).sort(() => rnd() - 0.5);
      const ranked = rankEntries(shuffled);
      assert.deepEqual(outcome(ranked), expectedOutcome);
      assert.deepEqual(ranked.map((e: any) => e.userId), expectedOrder, 'display order is deterministic too (userId only breaks exact ties)');
    }
  });

  it('the userId tie-break only orders identical entries - it never creates or removes a tie', () => {
    const a = entry(2, { at: 0 });
    const b = entry(1, { at: 0 });
    assert.equal(compareEntries(a, b) > 0, true);
    const ranked = rankEntries([a, b]);
    assert.deepEqual(ranked.map((e: any) => [e.userId, e.rank, e.isTie]), [[id(1), 1, true], [id(2), 1, true]]);
  });
});

// =====================================================================================================
// Real aggregation path: CourseCompletionRecord -> eligibility -> ranking -> live view / snapshot / rewards
// =====================================================================================================
const seedRecord = (userId: string, points: number, atMs: number, over: Record<string, any> = {}) =>
  db.seed('courseCompletionRecord', {
    userId, courseId: id(200 + db.count('courseCompletionRecord')), courseTitle: 'Course', completedAt: new Date(BASE + atMs), passed: true,
    totalDurationSeconds: 3600, level: 'BEGINNER', baseDurationPoints: points, levelMultiplier: 1, achievementPoints: points,
    averageQuizScore: null, hasQuiz: false, policyVersion: '1.1', status: 'VALID', month: MONTH, year: YEAR, ...over,
  });

let userService: ReturnType<typeof installUserServiceStub>;
let notified: string[] = [];

beforeEach(() => {
  db.reset();
  installTestLocks(LeaderboardService);
  notified = [];
  userService = installUserServiceStub(axios, mock, (body) => { notified.push(body.userId); });
});
afterEach(() => mock.restoreAll());

const live = () => LeaderboardService.getLeaderboard(MONTH, YEAR);
const finalize = (opts?: any) => LeaderboardService.finalizeMonth(MONTH, YEAR, 'TEST', opts);
const settle = async (p: Promise<any>) => { try { return { ok: true as const, value: await p }; } catch (error: any) { return { ok: false as const, error }; } };
const board = () => db.tables.monthlyLeaderboard[0];
const snapshot = () => db.tables.leaderboardEntry.filter((e) => e.leaderboardId === board().id).sort((a, b) => a.rank - b.rank);
const ledgerOf = (u: string) => db.tables.rewardPointTransaction.filter((t) => t.userId === u && t.type === 'LEADERBOARD_REWARD');
const walletOf = (u: string) => db.tables.userRewardPoint.find((w) => w.userId === u);
const badgesOf = (u: string) => db.tables.badge.filter((b) => b.userId === u);
const audit = (action: string) => db.tables.leaderboardAuditLog.filter((a) => a.action === action);
const nothingPaid = () => {
  assert.equal(db.tables.rewardPointTransaction.length, 0);
  assert.equal(db.tables.badge.length, 0);
  assert.equal(db.tables.userRewardPoint.length, 0);
};

describe('RANK: the real aggregation path uses the fixed algorithm (live view and snapshot)', () => {
  it('RANK-01/02 through the live view and the frozen snapshot', async () => {
    seedRecord(id(1), 10, 0);
    seedRecord(id(2), 10, 900);
    seedRecord(id(3), 10, 1800);
    const liveView = await live();
    assert.deepEqual(liveView.entries.map((e: any) => [e.userId, e.rank, e.isTie]), [[id(1), 1, true], [id(2), 1, true], [id(3), 3, false]]);

    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    assert.deepEqual(snapshot().map((e) => [e.userId, e.rank, e.isTie]), [[id(1), 1, true], [id(2), 1, true], [id(3), 3, false]]);
    // rewards follow the ranks (existing rule, untouched): two Top-1 winners, nobody at rank 2, rank 3 gets the Top-3 reward
    assert.equal(ledgerOf(id(1))[0].amount, 1000);
    assert.equal(ledgerOf(id(2))[0].amount, 1000);
    assert.equal(ledgerOf(id(3))[0].amount, 500);
    assert.equal(r.totalPointsAwarded, 2500);
  });

  it('RANK-09 the order the records were inserted in does not change the live ranking', async () => {
    const records: Array<[number, number, number]> = [[1, 20, 0], [2, 20, 400], [3, 20, 1500], [4, 20, 1800], [5, 15, 0], [6, 15, 700]];
    const run = async (order: Array<[number, number, number]>) => {
      db.reset();
      for (const [u, p, t] of order) seedRecord(id(u), p, t);
      return (await live()).entries.map((e: any) => [e.userId, e.rank, e.isTie]);
    };
    const reference = await run(records);
    assert.deepEqual(await run([...records].reverse()), reference);
    assert.deepEqual(await run([records[3], records[0], records[5], records[2], records[1], records[4]]), reference);
  });

  it('a learner with several courses is ranked by the LAST completion; points and course count are summed', async () => {
    seedRecord(id(1), 5, 0);
    seedRecord(id(1), 5, 800);   // user 1: 10 pts, 2 courses, last at +800
    seedRecord(id(2), 10, 100);  // user 2: 10 pts, 1 course
    const view = await live();
    assert.deepEqual(view.entries.map((e: any) => [e.userId, e.points, e.completedCourses, e.rank]), [[id(1), 10, 2, 1], [id(2), 10, 1, 2]]);
  });
});

// =====================================================================================================
describe('ELIG: only active STUDENT accounts compete and receive rewards', () => {
  const setupTop = (userId: string, profile: any | null) => {
    seedRecord(userId, 100, 0);                 // by far the best
    seedRecord(id(1), 50, 0);
    seedRecord(id(2), 30, 0);
    seedRecord(id(3), 10, 0);
    userService.profiles.set(userId, profile);
  };

  it('ELIG-01 an active STUDENT is ranked and rewarded', async () => {
    seedRecord(id(1), 50, 0);
    userService.profiles.set(id(1), { userId: id(1), role: 'STUDENT', isActive: true });
    const view = await live();
    assert.deepEqual(view.entries.map((e: any) => [e.userId, e.rank]), [[id(1), 1]]);
    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(walletOf(id(1))!.balance, 1000);
  });

  for (const [code, role] of [['ELIG-02', 'ADMIN'], ['ELIG-03', 'INSTRUCTOR']] as const) {
    it(`${code} a ${role} with the best score is not ranked and not rewarded (live view, snapshot and rewards)`, async () => {
      const X = id(99);
      setupTop(X, { userId: X, role, isActive: true });

      const view = await live();
      assert.ok(!view.entries.some((e: any) => e.userId === X));
      assert.deepEqual(view.entries.map((e: any) => [e.userId, e.rank]), [[id(1), 1], [id(2), 2], [id(3), 3]]);

      const rank = await LeaderboardService.getUserRank(X);
      assert.equal(rank.rank, null);

      const r = await finalize();
      assert.equal(r.status, 'FINALIZED');
      assert.ok(!snapshot().some((e) => e.userId === X), 'not in the snapshot');
      assert.equal(ledgerOf(X).length, 0);
      assert.equal(walletOf(X), undefined);
      assert.equal(badgesOf(X).length, 0);
      assert.equal(notified.includes(X), false);
      assert.equal(r.totalPointsAwarded, 1000 + 700 + 500);
      assert.deepEqual(snapshot().map((e) => [e.userId, e.rank]), [[id(1), 1], [id(2), 2], [id(3), 3]]);
    });
  }

  it('ELIG-04 a deactivated STUDENT is not ranked and not rewarded', async () => {
    const X = id(99);
    setupTop(X, { userId: X, role: 'STUDENT', isActive: false });
    assert.ok(!(await live()).entries.some((e: any) => e.userId === X));
    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    assert.ok(!snapshot().some((e) => e.userId === X));
    assert.equal(ledgerOf(X).length, 0);
    assert.equal(badgesOf(X).length, 0);
  });

  it('ELIG-08 an ineligible learner in first place does not occupy a prize position - the next eligible learner gets rank 1', async () => {
    const X = id(99);
    setupTop(X, { userId: X, role: 'ADMIN', isActive: true });
    await finalize();
    assert.equal(snapshot()[0].userId, id(1));
    assert.equal(snapshot()[0].rank, 1);
    assert.equal(ledgerOf(id(1))[0].amount, 1000);
    assert.equal(ledgerOf(id(2))[0].amount, 700);
    assert.equal(ledgerOf(id(3))[0].amount, 500);
  });

  it('the profile lookup contract: one authenticated, de-duplicated request, only ids are sent', async () => {
    seedRecord(id(1), 10, 0);
    seedRecord(id(1), 5, 10);
    seedRecord(id(2), 4, 0);
    await live();
    assert.equal(userService.eligibilityCalls.length, 1);
    assert.equal(userService.eligibilityCalls[0].token, TEST_INTERNAL_TOKEN);
    assert.deepEqual([...userService.eligibilityCalls[0].ids].sort(), [id(1), id(2)]);
  });

  it('ELIG-09 getUserRank (current month) uses the same ranking and eligibility', async () => {
    const { month, year } = getCurrentVietnamMonthYear();
    seedRecord(id(1), 50, 0, { month, year });
    seedRecord(id(2), 50, 600, { month, year });
    seedRecord(id(3), 50, 1300, { month, year });
    seedRecord(id(98), 80, 0, { month, year });
    userService.profiles.set(id(98), { userId: id(98), role: 'ADMIN', isActive: true });
    const mine = await LeaderboardService.getUserRank(id(2));
    assert.equal(mine.rank, 1);
    assert.equal(mine.isTie, true);
    assert.equal(mine.totalParticipants, 3);
    const admin = await LeaderboardService.getUserRank(id(98));
    assert.equal(admin.rank, null);
    assert.equal((await LeaderboardService.getCurrentLeaderboard()).entries.some((e: any) => e.userId === id(98)), false);
  });

  it('live views may use the short cache, but the snapshot and the rewards always re-verify (fresh)', async () => {
    seedRecord(id(1), 50, 0);
    seedRecord(id(2), 40, 0);
    await live();                                   // caches both learners as eligible
    await live();
    assert.equal(userService.eligibilityCalls.length, 1, 'the second live view was served from the cache');

    userService.profiles.set(id(1), { userId: id(1), role: 'STUDENT', isActive: false }); // deactivated just now
    assert.deepEqual((await live()).entries.map((e: any) => e.userId), [id(1), id(2)], 'a live read may be up to 30 s stale');

    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    assert.deepEqual(snapshot().map((e) => e.userId), [id(2)], 'the snapshot used a fresh, authoritative answer');
    assert.equal(ledgerOf(id(1)).length, 0);
    assert.equal(userService.eligibilityCalls.length, 3, '1 cached live read + 2 fresh checks (snapshot build, reward time)');
  });

  it('role / active state never reach the public API response', async () => {
    const { month, year } = getCurrentVietnamMonthYear();
    seedRecord(id(1), 10, 0, { month, year });
    userService.profiles.set(id(1), { userId: id(1), role: 'STUDENT', isActive: true });
    const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
    await LeaderboardController.getCurrentLeaderboard({ user: undefined }, res);
    assert.equal(res.statusCode, 200);
    const text = JSON.stringify(res.body);
    assert.ok(!/"role"|"isActive"|@example\.com|"email"/.test(text), text);
    assert.equal(res.body.data.entries[0].fullName.startsWith('Learner'), true);
  });

  // ---- fail-closed
  for (const mode of ['timeout', 'http500', 'empty', 'not-array'] as const) {
    it(`ELIG-05 user service ${mode} -> live view refuses, snapshot is not built, nothing is paid, no empty period is finalized`, async () => {
      seedRecord(id(1), 50, 0);
      seedRecord(id(2), 30, 0);
      userService.mode = mode;

      const liveResult = await settle(live());
      assert.equal(liveResult.ok, false);
      assert.ok((liveResult as any).error instanceof UserEligibilityError);
      assert.equal((liveResult as any).error.statusCode, 503);

      const r = await settle(finalize());
      assert.equal(r.ok, false);
      assert.ok((r as any).error instanceof UserEligibilityError);
      assert.equal(db.tables.leaderboardEntry.length, 0, 'no snapshot from an unverified population');
      assert.notEqual(board().status, 'FINALIZED');
      nothingPaid();

      // the service comes back: the very same period completes normally
      userService.mode = 'ok';
      const retry = await finalize();
      assert.equal(retry.status, 'FINALIZED');
      assert.deepEqual(snapshot().map((e) => e.userId), [id(1), id(2)]);
    });
  }

  it('ELIG-05 the public endpoint answers 503 (not 500, not a guessed list) when eligibility cannot be verified', async () => {
    const { month, year } = getCurrentVietnamMonthYear();
    seedRecord(id(1), 50, 0, { month, year });
    userService.mode = 'timeout';
    const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
    await LeaderboardController.getCurrentLeaderboard({ user: undefined }, res);
    assert.equal(res.statusCode, 503);
    assert.ok(res.body.error);
    assert.equal(res.body.data, undefined);
  });

  it('ELIG-05 a missing service token fails closed without calling the user service', async () => {
    seedRecord(id(1), 50, 0);
    const saved = process.env.INTERNAL_SERVICE_TOKEN;
    delete process.env.INTERNAL_SERVICE_TOKEN;
    try {
      const r = await settle(live());
      assert.equal(r.ok, false);
      assert.ok((r as any).error instanceof UserEligibilityError);
      assert.equal(userService.eligibilityCalls.length, 0);
    } finally {
      process.env.INTERNAL_SERVICE_TOKEN = saved;
    }
  });

  it('ELIG-06 a profile without role or without isActive is treated as NOT eligible; the others are unaffected', async () => {
    seedRecord(id(1), 50, 0);
    seedRecord(id(2), 40, 0);
    seedRecord(id(3), 30, 0);
    seedRecord(id(4), 20, 0);
    seedRecord(id(5), 10, 0);
    userService.profiles.set(id(1), { userId: id(1), isActive: true });                       // no role
    userService.profiles.set(id(2), { userId: id(2), role: 'STUDENT' });                     // no isActive
    userService.profiles.set(id(3), { userId: id(3), role: 'STUDENT', isActive: 'true' });   // wrong type
    userService.profiles.set(id(4), null);                                                   // no profile at all
    // id(5) is a normal active student
    const view = await live();
    assert.deepEqual(view.entries.map((e: any) => [e.userId, e.rank]), [[id(5), 1]]);
    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    for (const u of [id(1), id(2), id(3), id(4)]) {
      assert.equal(ledgerOf(u).length, 0);
      assert.equal(badgesOf(u).length, 0);
    }
    assert.equal(walletOf(id(5))!.balance, 1000);
  });

  it('ELIG-06 a role other than exactly STUDENT (e.g. lower-case) is not eligible', async () => {
    seedRecord(id(1), 50, 0);
    seedRecord(id(2), 40, 0);
    userService.profiles.set(id(1), { userId: id(1), role: 'student', isActive: true });
    assert.deepEqual((await live()).entries.map((e: any) => e.userId), [id(2)]);
  });

  it('ELIG-06 an answer in which NO entry is usable is a contract mismatch -> fail closed, not an empty leaderboard', async () => {
    seedRecord(id(1), 50, 0);
    seedRecord(id(2), 40, 0);
    userService.rawAnswer = (ids) => ({ data: ids.map((u) => ({ userId: u, fullName: 'Old contract' })) }); // no role / isActive anywhere
    const r = await settle(live());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof UserEligibilityError);
    assert.match((r as any).error.message, /contract mismatch/);
    const f = await settle(finalize());
    assert.equal(f.ok, false);
    assert.equal(db.tables.leaderboardEntry.length, 0);
  });

  it('ELIG-07 SUSPECT and EXCLUDED achievements never count; VALID ones of the same learner still do', async () => {
    seedRecord(id(1), 50, 0, { status: 'SUSPECT' });
    seedRecord(id(2), 40, 0, { status: 'EXCLUDED' });
    seedRecord(id(3), 5, 0);
    seedRecord(id(3), 100, 10, { status: 'SUSPECT' });
    const view = await live();
    assert.deepEqual(view.entries.map((e: any) => [e.userId, e.points, e.completedCourses]), [[id(3), 5, 1]]);
    await finalize();
    assert.deepEqual(snapshot().map((e) => e.userId), [id(3)]);
    assert.equal(ledgerOf(id(1)).length, 0);
    assert.equal(ledgerOf(id(2)).length, 0);
  });

  it('ELIG-09 the live ranking and the snapshot are identical (same population, same ranks, same ties)', async () => {
    seedRecord(id(1), 50, 0);
    seedRecord(id(2), 50, 600);
    seedRecord(id(3), 50, 1300);
    seedRecord(id(4), 20, 0);
    seedRecord(id(98), 80, 0);
    userService.profiles.set(id(98), { userId: id(98), role: 'INSTRUCTOR', isActive: true });
    seedRecord(id(97), 70, 0);
    userService.profiles.set(id(97), { userId: id(97), role: 'STUDENT', isActive: false });

    const liveBefore = (await live()).entries.map((e: any) => [e.userId, e.rank, e.isTie, e.points]);
    await finalize();
    const frozen = snapshot().map((e) => [e.userId, e.rank, e.isTie, e.points]);
    assert.deepEqual(frozen, liveBefore);
    assert.deepEqual(liveBefore.map((e: any) => [e[0], e[1], e[2]]), [[id(1), 1, true], [id(2), 1, true], [id(3), 3, false], [id(4), 4, false]]);
    // and the rewards were paid to exactly this population
    assert.deepEqual(db.tables.rewardPointTransaction.map((t) => t.userId).sort(), [id(1), id(2), id(3), id(4)].sort());
  });

  it('ELIG-10 a FINALIZED period is history: later role/active changes do not alter it, and it is not even re-checked', async () => {
    seedRecord(id(1), 50, 0);
    seedRecord(id(2), 40, 0);
    await finalize();
    const before = JSON.stringify({ b: db.tables.monthlyLeaderboard, e: db.tables.leaderboardEntry, l: db.tables.rewardPointTransaction, w: db.tables.userRewardPoint, g: db.tables.badge });
    userService.profiles.set(id(1), { userId: id(1), role: 'STUDENT', isActive: false }); // deactivated afterwards
    userService.eligibilityCalls.length = 0;
    db.calls = [];

    const history = await live();            // FINALIZED -> served from the snapshot
    assert.deepEqual(history.entries.map((e: any) => e.userId), [id(1), id(2)]);
    const again = await finalize();
    assert.equal(again.status, 'ALREADY_FINALIZED');
    assert.equal(JSON.stringify({ b: db.tables.monthlyLeaderboard, e: db.tables.leaderboardEntry, l: db.tables.rewardPointTransaction, w: db.tables.userRewardPoint, g: db.tables.badge }), before);
    assert.equal(userService.eligibilityCalls.length, 0, 'history is never re-filtered');
    assert.deepEqual(db.writeCalls(), []);
  });
});

// =====================================================================================================
describe('ELIG: snapshots that were frozen before eligibility existed, and eligibility changing mid-flight', () => {
  const seedFrozen = (status: string, withAdminOnTop: boolean) => {
    const b = db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status, totalParticipants: withAdminOnTop ? 3 : 2, finalizedBy: 'older-build' });
    const rows = withAdminOnTop
      ? [[id(99), 1, 100], [id(1), 2, 50], [id(2), 3, 30]]
      : [[id(1), 1, 50], [id(2), 2, 30]];
    for (const [u, rank, points] of rows as Array<[string, number, number]>) {
      db.seed('leaderboardEntry', { leaderboardId: b.id, userId: u, rank, points, completedCourses: 1, lastCompletedAt: new Date(BASE), rewardPoints: 0 });
    }
    return b;
  };

  it('an ineligible entry of an already-frozen snapshot gets no NEW reward; every frozen rank stays as it is', async () => {
    seedFrozen('SNAPSHOT_FROZEN', true);
    userService.profiles.set(id(99), { userId: id(99), role: 'ADMIN', isActive: true });
    const ranksBefore = snapshot().map((e) => [e.userId, e.rank, e.points, e.isTie]);

    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(r.rewardsSkippedIneligible, 1);
    assert.deepEqual(snapshot().map((e) => [e.userId, e.rank, e.points, e.isTie]), ranksBefore, 'no re-ranking of a frozen snapshot');
    assert.equal(ledgerOf(id(99)).length, 0);
    assert.equal(badgesOf(id(99)).length, 0);
    assert.equal(snapshot().find((e) => e.userId === id(99))!.rewardPoints, 0);
    assert.equal(ledgerOf(id(1))[0].amount, 700, 'rank 2 keeps its rank-2 reward; the vacated prize is not redistributed');
    assert.equal(ledgerOf(id(2))[0].amount, 500);
    assert.equal(r.totalPointsAwarded, 1200);
    assert.equal(audit('REWARD_SKIPPED_INELIGIBLE').length, 1);
    assert.equal(audit('REWARD_SKIPPED_INELIGIBLE')[0].targetUserId, id(99));
  });

  it('a reward that was already paid stays paid and counted when the account is deactivated before the period finishes', async () => {
    seedFrozen('SNAPSHOT_FROZEN', false);
    const crash = await settle(finalize({ simulateFailureAt: 'AFTER_FIRST_REWARD' }));
    assert.equal(crash.ok, false);
    assert.equal(ledgerOf(id(1)).length, 1);
    userService.profiles.set(id(1), { userId: id(1), role: 'STUDENT', isActive: false }); // deactivated after being paid
    const ledgerId = ledgerOf(id(1))[0].id;

    const r = await finalize();
    assert.equal(r.status, 'FINALIZED');
    assert.equal(ledgerOf(id(1)).length, 1);
    assert.equal(ledgerOf(id(1))[0].id, ledgerId, 'history is not reversed');
    assert.equal(r.totalPointsAwarded, 1000 + 700);
    assert.equal(r.rewardsSkippedIneligible, 0);
  });

  it('the User Service being down at reward time stops the period BEFORE it enters REWARDING and pays nothing', async () => {
    seedFrozen('SNAPSHOT_FROZEN', false);
    userService.mode = 'timeout';
    const r = await settle(finalize());
    assert.equal(r.ok, false);
    assert.ok((r as any).error instanceof UserEligibilityError);
    assert.equal(board().status, 'SNAPSHOT_FROZEN');
    nothingPaid();
    userService.mode = 'ok';
    assert.equal((await finalize()).status, 'FINALIZED');
  });
});
