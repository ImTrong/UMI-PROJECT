/**
 * Deterministic data for the multi-process reward-phase tests (FIX 06C-3): stable ids, so two runs (and two processes) are comparable.
 *
 * Five eligible students compete (E1 and E2 tie for rank 1), one account is deactivated and one is an instructor (both must stay out).
 * Rewards by the production policy: rank 1 -> 1000 (both tied), rank 3 -> 500, ranks 4-5 -> 200; total 2900.
 *
 * Besides the "fresh" period (the workers build the snapshot themselves) there are seeded variants that put the period straight into a
 * reward-phase state, to reach write paths that a clean run never takes:
 *   skip          snapshot frozen, E3's account deactivated afterwards            -> reward skipped, audit REWARD_SKIPPED_INELIGIBLE
 *   conflict      period REWARDING, a ledger entry on E2's reward key disagrees  -> integrity + mismatch audits, incomplete totals / audit
 *   walletgap     period REWARDING, E2's ledger entry is correct but has no wallet -> audit REWARD_LEDGER_MISMATCH, period still finalizes
 */
import type { StubUserService } from './stub-user-service';

export const oid = (n: number) => n.toString(16).padStart(24, '0');
export const E1 = oid(0xe1);
export const E2 = oid(0xe2);
export const E3 = oid(0xe3);
export const E4 = oid(0xe4);
export const E5 = oid(0xe5);
export const X_INACTIVE = oid(0xa1);
export const I_INSTRUCTOR = oid(0xb1);
export const ELIGIBLE = [E1, E2, E3, E4, E5];
export const EXPECTED_RANK: Record<string, number> = { [E1]: 1, [E2]: 1, [E3]: 3, [E4]: 4, [E5]: 5 };
export const EXPECTED_TIE: Record<string, boolean> = { [E1]: true, [E2]: true, [E3]: false, [E4]: false, [E5]: false };
export const EXPECTED_REWARD: Record<string, number> = { [E1]: 1000, [E2]: 1000, [E3]: 500, [E4]: 200, [E5]: 200 };
export const MONTH = 9;
export const YEAR = 2026;
export const rewardKey = (userId: string, month = MONTH, year = YEAR) => `reward_lb_month_${month}_year_${year}_user_${userId}`;

const COMPLETIONS: Array<[string, number, string]> = [
  [E1, 50, '2026-09-05T10:00:00.000Z'],
  [E2, 50, '2026-09-05T10:00:00.500Z'], // 500 ms after E1: inside the tie window
  [E3, 40, '2026-09-06T10:00:00.000Z'],
  [E4, 30, '2026-09-07T10:00:00.000Z'],
  [E5, 20, '2026-09-08T10:00:00.000Z'],
  [X_INACTIVE, 45, '2026-09-09T10:00:00.000Z'],
  [I_INSTRUCTOR, 60, '2026-09-10T10:00:00.000Z'],
];

export async function seedCompletions(admin: any, stub: StubUserService, month = MONTH, year = YEAR) {
  for (const [i, [userId, points, at]] of COMPLETIONS.entries()) {
    await admin.courseCompletionRecord.create({
      data: {
        userId, courseId: oid(0xc00 + i), courseTitle: `Course ${i}`, completedAt: new Date(at), passed: true, totalDurationSeconds: 3600,
        level: 'BEGINNER', baseDurationPoints: points, levelMultiplier: 1, achievementPoints: points, averageQuizScore: 80, hasQuiz: true,
        policyVersion: '1.1', status: 'VALID', month, year,
      },
    });
  }
  stub.profiles.set(X_INACTIVE, { userId: X_INACTIVE, role: 'STUDENT', isActive: false });
  stub.profiles.set(I_INSTRUCTOR, { userId: I_INSTRUCTOR, role: 'INSTRUCTOR', isActive: true });
}

/** A snapshot exactly as buildSnapshot would have frozen it (same ranks / ties / planned rewards), put straight into the database. */
export async function seedFrozenSnapshot(admin: any, status: 'SNAPSHOT_FROZEN' | 'REWARDING', month = MONTH, year = YEAR) {
  const period = await admin.monthlyLeaderboard.create({
    data: { month, year, status, totalParticipants: 5, finalizedBy: 'seeded-earlier-run', policyVersion: '1.1' },
  });
  for (const [i, [userId, points, at]] of COMPLETIONS.slice(0, 5).entries()) {
    await admin.leaderboardEntry.create({
      data: {
        leaderboardId: period.id, userId, rank: EXPECTED_RANK[userId], points, completedCourses: 1, averageScore: 80,
        lastCompletedAt: new Date(at), rewardPoints: EXPECTED_REWARD[userId], isTie: EXPECTED_TIE[userId],
        scoreBreakdown: [{ courseId: oid(0xc00 + i), achievementPoints: points }],
      },
    });
  }
  return period;
}

export async function seedLedgerFor(admin: any, periodId: string, userId: string, amount: number, month = MONTH, year = YEAR) {
  return admin.rewardPointTransaction.create({
    data: {
      userId, amount, type: 'LEADERBOARD_REWARD', description: 'seeded earlier award', balanceAfter: amount, sourceId: periodId,
      idempotencyKey: rewardKey(userId, month, year), metadata: { leaderboardId: periodId, rank: EXPECTED_RANK[userId], month, year, points: amount },
    },
  });
}

export type ScenarioKey = 'fresh' | 'skip' | 'conflict' | 'walletgap' | 'leftover';
export interface Scenario {
  key: ScenarioKey;
  title: string;
  setup: (admin: any, stub: StubUserService) => Promise<void>;
  /** What a correct run must end as. */
  expect: 'FINALIZED' | 'INCOMPLETE';
  /** Users that are rewarded by a correct run, and the amounts. */
  paid: Record<string, number>;
  /** Users whose ledger entry exists but who have NO wallet (the seeded inconsistency). */
  noWallet: string[];
  /** Sum the period must show as totalPointsAwarded at the end. */
  totalPointsAwarded: number;
}

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
  fresh: {
    key: 'fresh', title: 'fresh period: the workers build the snapshot and pay everyone', setup: async () => undefined,
    expect: 'FINALIZED', paid: { ...EXPECTED_REWARD }, noWallet: [], totalPointsAwarded: 2900,
  },
  leftover: {
    key: 'leftover', title: 'unconfirmed snapshot (SNAPSHOT_BUILDING) with a stale entry left by an older run: the rebuild must replace it atomically',
    setup: async (admin) => {
      const p = await admin.monthlyLeaderboard.create({ data: { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 0, finalizedBy: 'older-run', policyVersion: '1.1' } });
      await admin.leaderboardEntry.create({
        data: { leaderboardId: p.id, userId: E3, rank: 1, points: 1, completedCourses: 1, lastCompletedAt: new Date('2026-09-01T00:00:00Z'), rewardPoints: 1000, isTie: false },
      });
    },
    expect: 'FINALIZED', paid: { ...EXPECTED_REWARD }, noWallet: [], totalPointsAwarded: 2900,
  },
  skip: {
    key: 'skip', title: 'frozen snapshot, #3 deactivated before the reward phase (reward skipped, rank kept)',
    setup: async (admin, stub) => {
      await seedFrozenSnapshot(admin, 'SNAPSHOT_FROZEN');
      stub.profiles.set(E3, { userId: E3, role: 'STUDENT', isActive: false });
    },
    expect: 'FINALIZED', paid: { [E1]: 1000, [E2]: 1000, [E4]: 200, [E5]: 200 }, noWallet: [], totalPointsAwarded: 2400,
  },
  conflict: {
    key: 'conflict', title: 'REWARDING period with a conflicting ledger entry for #2 (cannot finish; audited)',
    setup: async (admin) => {
      const p = await seedFrozenSnapshot(admin, 'REWARDING');
      await seedLedgerFor(admin, p.id, E2, 999);
    },
    expect: 'INCOMPLETE', paid: { [E1]: 1000, [E3]: 500, [E4]: 200, [E5]: 200 }, noWallet: [E2], totalPointsAwarded: 1900,
  },
  walletgap: {
    key: 'walletgap', title: 'REWARDING period where #2 has a correct ledger entry but no wallet (audited, still finalizes)',
    setup: async (admin) => {
      const p = await seedFrozenSnapshot(admin, 'REWARDING');
      await seedLedgerFor(admin, p.id, E2, 1000);
    },
    expect: 'FINALIZED', paid: { ...EXPECTED_REWARD }, noWallet: [E2], totalPointsAwarded: 2900,
  },
};
