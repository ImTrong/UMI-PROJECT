/**
 * Labels and invariants for the multi-process reward-phase tests (FIX 06C-3).
 *
 * labelTx() names a MongoDB transaction by the BUSINESS write it performs, from the call log of the worker that ran it:
 *
 *   TRANSITION:<STATUS>     monthly_leaderboards status change (SNAPSHOT_BUILDING / REWARDING / FINALIZED)
 *   SNAPSHOT                delete + create of the snapshot entries
 *   WALLET                  creation of a missing reward wallet
 *   AWARD                   wallet increment + reward ledger entry
 *   BADGE                   leaderboard badge
 *   CLAIM                   notification claim on an entry
 *   PERSIST                 persistEntryRewards (badge link + reward points on the entries)
 *   SKIP                    reward skipped for an ineligible learner (entry reward 0 + audit REWARD_SKIPPED_INELIGIBLE)
 *   AUDIT:<action>          an audit row (REWARD_INTEGRITY_ERROR, REWARD_LEDGER_MISMATCH, FINALIZE_REWARDS_INCOMPLETE)
 *   TOTALS_INCOMPLETE       totalParticipants / totalPointsAwarded of a period that could not finish
 *   FENCE_ONLY              the transaction performed the fence and nothing else
 *
 * assertRewardInvariants() checks the data in MongoDB after a run: ledger entry by entry (user, type, month/year, key, amount, balance),
 * wallets against the ledger, badges against the snapshot entries, the audit trail, the totals and the final status.
 */
import assert from 'node:assert/strict';
import { Scenario, E2, EXPECTED_RANK, EXPECTED_TIE, EXPECTED_REWARD, ELIGIBLE, MONTH, YEAR, rewardKey } from './dataset';

const WRITE_OPS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'deleteMany']);

export interface TxCall { model: string; op: string; fields?: string[]; status?: string; action?: string }

export function labelTx(seg: { calls: TxCall[] }): string {
  const w = seg.calls.filter((c) => c.model !== '$raw' && WRITE_OPS.has(c.op));
  const has = (model: string, op: string) => w.some((c) => c.model === model && c.op === op);
  if (has('leaderboardEntry', 'deleteMany') || has('leaderboardEntry', 'createMany')) return 'SNAPSHOT';
  if (has('rewardPointTransaction', 'create')) return 'AWARD';
  if (has('userRewardPoint', 'create')) return 'WALLET';
  if (has('badge', 'create')) return 'BADGE';
  const entryUpdates = w.filter((c) => c.model === 'leaderboardEntry' && c.op === 'updateMany');
  if (entryUpdates.some((c) => (c.fields || []).join() === 'rewardPoints')) return 'SKIP';
  const audit = w.find((c) => c.model === 'leaderboardAuditLog' && c.op === 'create');
  if (audit) return `AUDIT:${audit.action}`;
  if (entryUpdates.some((c) => (c.fields || []).includes('rewardNotifyClaimToken'))) return 'CLAIM';
  if (entryUpdates.some((c) => (c.fields || []).includes('rewardBadgeId'))) return 'PERSIST';
  const period = w.find((c) => c.model === 'monthlyLeaderboard' && c.op === 'updateMany');
  if (period) return (period.fields || []).includes('status') ? `TRANSITION:${period.status}` : 'TOTALS_INCOMPLETE';
  return 'FENCE_ONLY';
}

/** The fields of the snapshot entries that must never change after the snapshot was frozen (ids included). */
export async function snapshotFields(ev: { raw: (c: string, f?: any) => Promise<any[]> }): Promise<string> {
  const entries = await ev.raw('leaderboard_entries');
  return JSON.stringify(
    entries.map((e) => ({
      id: e._id, leaderboardId: e.leaderboardId, userId: e.userId, rank: e.rank, points: e.points, completedCourses: e.completedCourses,
      averageScore: e.averageScore, lastCompletedAt: e.lastCompletedAt, isTie: e.isTie, scoreBreakdown: e.scoreBreakdown,
    }))
  );
}

const idOf = (v: any): string => (v && typeof v === 'object' && '$oid' in v ? v.$oid : String(v));
const numOf = (v: any): number => (typeof v === 'number' ? v : Number(v?.$numberInt ?? v?.$numberLong ?? v?.$numberDouble));

/**
 * Everything a settled reward phase must satisfy, read from MongoDB. `settled` = the run that completed the work (it ended FINALIZED, or
 * - for a scenario that cannot finish - REWARDING with the verified total). Returns nothing; throws with `label` on the first violation.
 */
export async function assertRewardInvariants(
  ev: { raw: (c: string, f?: any) => Promise<any[]> },
  sc: Scenario,
  label: string,
  opts: { allowLeftoverLock?: boolean } = {}
) {
  const periods = await ev.raw('monthly_leaderboards', { month: MONTH, year: YEAR });
  assert.equal(periods.length, 1, `${label}: exactly one period`);
  const period = periods[0];
  const pid = idOf(period._id);
  assert.equal(period.status, sc.expect === 'FINALIZED' ? 'FINALIZED' : 'REWARDING', `${label}: final status`);
  if (sc.expect === 'INCOMPLETE') assert.ok(!period.finalizedAt, `${label}: an unfinished period is not given a finalizedAt`);
  if (!opts.allowLeftoverLock) assert.equal(period.lockToken ?? null, null, `${label}: lock released by the run that settled the period`);
  assert.equal(numOf(period.totalPointsAwarded), sc.totalPointsAwarded, `${label}: totalPointsAwarded = verified ledger total`);

  // ---- ledger: every entry, field by field
  const ledger = await ev.raw('reward_point_transactions');
  assert.ok(ledger.every((t) => t.type === 'LEADERBOARD_REWARD'), `${label}: only leaderboard rewards in the ledger (nothing pending / of another kind)`);
  const keys = ledger.map((t) => t.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length, `${label}: idempotency keys are unique`);
  const expectedLedgerUsers = new Set([...Object.keys(sc.paid), ...sc.noWallet]);
  assert.deepEqual([...new Set(ledger.map((t) => idOf(t.userId)))].sort(), [...expectedLedgerUsers].sort(), `${label}: exactly the rewarded users have a ledger entry`);
  assert.equal(ledger.length, expectedLedgerUsers.size, `${label}: one ledger entry per rewarded user - none duplicated`);
  for (const t of ledger) {
    const u = idOf(t.userId);
    assert.equal(t.idempotencyKey, rewardKey(u), `${label}: idempotency key of ${u.slice(-2)} is the unchanged scheme`);
    assert.equal(t.sourceId, pid, `${label}: ledger of ${u.slice(-2)} points at this period`);
    assert.equal(numOf(t.metadata?.month), MONTH);
    assert.equal(numOf(t.metadata?.year), YEAR);
    const amount = sc.key === 'conflict' && u === E2 ? 999 : EXPECTED_REWARD[u]; // the seeded conflicting entry keeps its (wrong) amount: history is never rewritten
    assert.equal(numOf(t.amount), amount, `${label}: amount of ${u.slice(-2)}`);
    if (!sc.noWallet.includes(u)) assert.equal(numOf(t.balanceAfter), numOf(t.amount), `${label}: balance after the award of ${u.slice(-2)} (first and only credit)`);
  }

  // ---- wallets agree with the ledger (except the seeded inconsistency)
  const wallets = await ev.raw('user_reward_points');
  assert.deepEqual(wallets.map((w) => idOf(w.userId)).sort(), Object.keys(sc.paid).filter((u) => !sc.noWallet.includes(u)).sort(), `${label}: wallets exist for the paid users only`);
  for (const w of wallets) {
    const u = idOf(w.userId);
    const sum = ledger.filter((t) => idOf(t.userId) === u).reduce((s, t) => s + numOf(t.amount), 0);
    assert.equal(numOf(w.balance), sum, `${label}: wallet balance of ${u.slice(-2)} equals its ledger`);
    assert.equal(numOf(w.totalEarned), sum, `${label}: totalEarned of ${u.slice(-2)} equals its ledger`);
    assert.equal(numOf(w.totalSpent), 0);
  }

  // ---- snapshot entries and badges
  const entries = await ev.raw('leaderboard_entries', { leaderboardId: { $oid: pid } });
  assert.equal(entries.length, 5, `${label}: five snapshot entries - none lost, none duplicated`);
  assert.deepEqual(entries.map((e) => idOf(e.userId)).sort(), [...ELIGIBLE].sort());
  for (const e of entries) {
    const u = idOf(e.userId);
    assert.equal(numOf(e.rank), EXPECTED_RANK[u], `${label}: frozen rank of ${u.slice(-2)}`);
    assert.equal(e.isTie, EXPECTED_TIE[u]);
  }
  const badges = await ev.raw('badges', { badgeType: 'LEADERBOARD_REWARD' });
  const badgeKeys = badges.map((b) => `${idOf(b.userId)}|${b.badgeName}`);
  assert.equal(new Set(badgeKeys).size, badgeKeys.length, `${label}: no duplicate badge`);
  for (const b of badges) {
    const e = entries.find((x) => idOf(x.userId) === idOf(b.userId));
    assert.ok(e, `${label}: a badge belongs to a ranked user`);
    assert.equal(idOf(e!.rewardBadgeId), idOf(b._id), `${label}: the entry of ${idOf(b.userId).slice(-2)} links exactly its own badge`);
    assert.equal(numOf(b.metadata?.rank), numOf(e!.rank), `${label}: badge metadata rank matches the snapshot`);
    assert.equal(b.metadata?.isTie, e!.isTie);
    assert.equal(numOf(b.metadata?.points), numOf(e!.points));
    assert.equal(numOf(b.metadata?.month), MONTH);
    assert.equal(numOf(b.metadata?.year), YEAR);
  }
  for (const e of entries) if (e.rewardBadgeId) assert.ok(badges.some((b) => idOf(b._id) === idOf(e.rewardBadgeId)), `${label}: a linked badge exists`);

  // ---- a FINALIZED period has every required reward confirmed
  if (sc.expect === 'FINALIZED') {
    for (const u of Object.keys(sc.paid)) {
      assert.ok(ledger.some((t) => idOf(t.userId) === u), `${label}: FINALIZED but ${u.slice(-2)} has no ledger entry`);
      assert.ok(badges.some((b) => idOf(b.userId) === u), `${label}: FINALIZED but ${u.slice(-2)} has no badge`);
    }
  }
}
