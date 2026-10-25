/**
 * FIX 04 regression tests: atomic leaderboard reward (wallet + ledger), idempotency, concurrency.
 * Real service code against the in-memory transactional Prisma fake (serialized transactions,
 * rollback-on-throw, failure injection). Conflict/rollback behaviour on a REAL MongoDB replica set
 * is covered by tests/integration/reward.mongo.test.ts.
 *
 * Run: npm test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePrisma, db } from './helpers/fake-prisma';

installFakePrisma();

/* eslint-disable @typescript-eslint/no-var-requires */
const logger = require('../src/utils/logger').default;
const { RewardPointService } = require('../src/services/reward-point.service');

logger.transports.forEach((t: any) => { t.silent = true; });

const ALICE = 'a1'.repeat(12);
const BOB = 'b2'.repeat(12);
const LB_OCT = 'c3'.repeat(12);
const LB_NOV = 'c4'.repeat(12);
const LB_DEC = 'c5'.repeat(12);

const keyFor = (u: string, month = 10, year = 2026) => `reward_lb_month_${month}_year_${year}_user_${u}`;
const wallet = (u: string) => db.tables.userRewardPoint.find((w) => w.userId === u);
const ledger = (u: string) => db.tables.rewardPointTransaction.filter((t) => t.userId === u);
const wallets = (u: string) => db.tables.userRewardPoint.filter((w) => w.userId === u);
const audits = () => db.tables.leaderboardAuditLog.filter((a) => a.action === 'REWARD_LEDGER_MISMATCH');
const seedWallet = (u: string, balance: number, totalEarned = balance, totalSpent = 0) =>
  db.seed('userRewardPoint', { userId: u, balance, totalEarned, totalSpent });

const award = (u: string, points = 1000, rank = 1, month = 10, year = 2026, lb = LB_OCT) =>
  RewardPointService.awardLeaderboardPoints(u, points, lb, rank, month, year);
const settle = async (p: Promise<any>) => {
  try { return { ok: true as const, value: await p }; } catch (error: any) { return { ok: false as const, error }; }
};

/** Every committed award must be reflected in the wallet exactly once. */
const assertAwarded = (u: string, amount: number, startBalance = 0, startEarned = 0) => {
  const entries = ledger(u).filter((t) => t.type === 'LEADERBOARD_REWARD');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount, amount);
  assert.equal(entries[0].balanceAfter, startBalance + amount);
  assert.equal(wallet(u)!.balance, startBalance + amount);
  assert.equal(wallet(u)!.totalEarned, startEarned + amount);
};

beforeEach(() => db.reset());

describe('REWARD: wallet + ledger commit or roll back together', () => {
  it('happy path: one ledger entry, balance and totalEarned raised, key and fields as before', async () => {
    const tx = await award(ALICE, 1000);
    assert.equal(tx.type, 'LEADERBOARD_REWARD');
    assert.equal(tx.sourceId, LB_OCT);
    assert.equal(tx.idempotencyKey, keyFor(ALICE));
    assert.match(tx.description, /Top 1 Bảng xếp hạng tháng 10\/2026/);
    assert.deepEqual(tx.metadata, { leaderboardId: LB_OCT, rank: 1, month: 10, year: 2026, points: 1000 });
    assertAwarded(ALICE, 1000);
    assert.equal(wallet(ALICE)!.totalSpent, 0);
    assert.equal(db.rollbacks, 0);
  });

  it('REWARD-01 wallet update fails inside the transaction -> no ledger entry, balance unchanged', async () => {
    seedWallet(ALICE, 300);
    db.failNext('userRewardPoint', 'updateMany');
    const r = await settle(award(ALICE, 1000));
    assert.equal(r.ok, false);
    assert.equal(wallet(ALICE)!.balance, 300);
    assert.equal(wallet(ALICE)!.totalEarned, 300);
    assert.equal(ledger(ALICE).length, 0);
    assert.equal(db.rollbacks, 1, 'a real rollback happened (the failure was not retried as a conflict)');
  });

  it('REWARD-02 wallet already incremented, then the ledger insert fails -> the increment is rolled back', async () => {
    seedWallet(ALICE, 300);
    db.failNext('rewardPointTransaction', 'create');
    const r = await settle(award(ALICE, 1000));
    assert.equal(r.ok, false);
    assert.equal(wallet(ALICE)!.balance, 300, 'the +1000 made earlier in the same transaction was undone');
    assert.equal(wallet(ALICE)!.totalEarned, 300);
    assert.equal(ledger(ALICE).length, 0);
    assert.equal(db.rollbacks, 1);

    // nothing half-done is left behind: the next attempt awards normally, exactly once
    const again = await award(ALICE, 1000);
    assert.equal(again.balanceAfter, 1300);
    assertAwarded(ALICE, 1000, 300, 300);
  });

  it('REWARD-02 failure while reading the wallet back (after the increment) also rolls everything back', async () => {
    seedWallet(ALICE, 300);
    // 2nd userRewardPoint.findUnique call is the one inside the transaction (1st is ensureWallet)
    let calls = 0;
    const real = (db as any).maybeFail.bind(db);
    (db as any).maybeFail = (table: string, op: string) => {
      if (table === 'userRewardPoint' && op === 'findUnique' && ++calls === 2) throw new Error('read back failed');
      return real(table, op);
    };
    try {
      const r = await settle(award(ALICE, 1000));
      assert.equal(r.ok, false);
    } finally {
      (db as any).maybeFail = real;
    }
    assert.equal(wallet(ALICE)!.balance, 300);
    assert.equal(wallet(ALICE)!.totalEarned, 300);
    assert.equal(ledger(ALICE).length, 0);
  });
});

describe('REWARD: idempotency', () => {
  it('REWARD-03 retrying a completed award (even with another rank / amount) adds nothing', async () => {
    const first = await award(ALICE, 1000, 1);
    const again = await award(ALICE, 700, 2);
    const third = await award(ALICE, 1000, 1);
    assert.equal(again.id, first.id);
    assert.equal(third.id, first.id);
    assertAwarded(ALICE, 1000);
    assert.equal(ledger(ALICE)[0].idempotencyKey, keyFor(ALICE));
  });

  it('REWARD-10 retry after a lost response returns the committed entry unchanged', async () => {
    await award(ALICE, 1000); // the caller never saw this result
    const retry = await award(ALICE, 1000);
    assert.equal(retry.amount, 1000);
    assert.equal(retry.balanceAfter, 1000);
    assert.equal(retry.idempotencyKey, keyFor(ALICE));
    assertAwarded(ALICE, 1000);
  });

  it('REWARD-10 transient failure on the first attempt, retried by the same call: committed once', async () => {
    db.failNext('rewardPointTransaction', 'create', Object.assign(new Error('transient'), { code: 'P2034' }));
    const r = await award(ALICE, 1000);
    assert.equal(r.amount, 1000);
    assertAwarded(ALICE, 1000);
    assert.equal(db.rollbacks, 1, 'first attempt rolled back, second committed');
  });

  it('different months are different rewards for the same user', async () => {
    await award(ALICE, 1000, 1, 10, 2026, LB_OCT);
    await award(ALICE, 700, 2, 11, 2026, LB_NOV);
    assert.equal(ledger(ALICE).length, 2);
    assert.equal(wallet(ALICE)!.balance, 1700);
    assert.equal(wallet(ALICE)!.totalEarned, 1700);
  });

  it('points <= 0 is a no-op; a non-integer amount is rejected before touching anything', async () => {
    assert.equal(await award(ALICE, 0), null);
    assert.equal((await settle(award(ALICE, 12.5))).ok, false);
    assert.equal((await settle(award(ALICE, Number.NaN))).ok, false);
    assert.equal(db.count('rewardPointTransaction'), 0);
    assert.equal(db.count('userRewardPoint'), 0);
  });
});

describe('REWARD: concurrency', () => {
  it('REWARD-04 many concurrent awards for the same user + period -> exactly one is committed', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => settle(award(ALICE, 1000, (i % 3) + 1))));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r: any) => r.error?.message)));
    const ids = new Set(results.map((r: any) => r.value.id));
    assert.equal(ids.size, 1, 'every caller receives the same committed entry');
    assertAwarded(ALICE, 1000);
  });

  it('REWARD-05 different users awarded concurrently are fully independent', async () => {
    const users = Array.from({ length: 8 }, (_, i) => `${i.toString(16)}f`.repeat(12).slice(0, 24));
    await Promise.all(users.map((u, i) => award(u, 1000 - i * 100, i + 1)));
    for (const [i, u] of users.entries()) assertAwarded(u, 1000 - i * 100);
    assert.equal(db.count('rewardPointTransaction'), users.length);
    assert.equal(db.count('userRewardPoint'), users.length);
  });

  it('REWARD-06 wallet missing + concurrent awards -> one wallet, one award', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => settle(award(ALICE, 1000))));
    assert.ok(results.every((r) => r.ok));
    assert.equal(wallets(ALICE).length, 1);
    assertAwarded(ALICE, 1000);
  });

  it('REWARD-06 wallet missing + concurrent awards of different months -> one wallet, both applied', async () => {
    await Promise.all([
      award(ALICE, 1000, 1, 10, 2026, LB_OCT),
      award(ALICE, 700, 1, 11, 2026, LB_NOV),
      award(ALICE, 500, 1, 12, 2026, LB_DEC),
    ]);
    assert.equal(wallets(ALICE).length, 1);
    assert.equal(wallet(ALICE)!.balance, 2200);
    assert.equal(ledger(ALICE).length, 3);
  });

  it('REWARD-07 different rewards for one user at once -> balanceAfter forms a consistent chain', async () => {
    seedWallet(ALICE, 300);
    await Promise.all([
      award(ALICE, 1000, 1, 10, 2026, LB_OCT),
      award(ALICE, 700, 2, 11, 2026, LB_NOV),
      award(ALICE, 500, 3, 12, 2026, LB_DEC),
    ]);
    assert.equal(wallet(ALICE)!.balance, 2500);
    assert.equal(wallet(ALICE)!.totalEarned, 2500);
    const chain = ledger(ALICE).sort((a, b) => a.balanceAfter - b.balanceAfter);
    assert.equal(chain.length, 3);
    let running = 300;
    for (const entry of chain) {
      running += entry.amount;
      assert.equal(entry.balanceAfter, running, 'each balanceAfter = previous committed balance + amount');
    }
    assert.equal(running, wallet(ALICE)!.balance);
  });

  it('REWARD-08 a transient write conflict is retried (bounded) and never creates a duplicate award', async () => {
    db.failNext('userRewardPoint', 'updateMany', Object.assign(new Error('Transaction failed due to a write conflict'), { code: 'P2034' }), 2);
    const r = await award(ALICE, 1000);
    assert.equal(r.amount, 1000);
    assertAwarded(ALICE, 1000);
    assert.equal(db.rollbacks, 2);
  });

  it('REWARD-08 a persistent conflict gives up after a bounded number of attempts: nothing committed, no false success', async () => {
    const f = db.failNext('userRewardPoint', 'updateMany', Object.assign(new Error('write conflict'), { code: 'P2034' }), 100) as any;
    const r = await settle(award(ALICE, 1000));
    assert.equal(r.ok, false);
    const consumed = 100 - db.failures[0].remaining;
    assert.ok(consumed >= 2 && consumed <= 5, `retried ${consumed} times - must be bounded`);
    assert.equal(ledger(ALICE).length, 0);
    assert.equal(wallet(ALICE)!.balance, 0);
    assert.equal(wallet(ALICE)!.totalEarned, 0);
    void f;

    db.failures = [];
    const later = await award(ALICE, 1000);
    assert.equal(later.amount, 1000);
    assertAwarded(ALICE, 1000);
  });

  it('REWARD-08 a non-transient error is NOT retried', async () => {
    db.failNext('userRewardPoint', 'updateMany', new Error('disk full'), 10);
    const r = await settle(award(ALICE, 1000));
    assert.equal(r.ok, false);
    assert.equal(10 - db.failures[0].remaining, 1);
    assert.equal(ledger(ALICE).length, 0);
  });
});

describe('REWARD: pre-existing ledger entries (written by the old, non-atomic code)', () => {
  const seedLegacyEntry = (u: string, over: Record<string, any> = {}) =>
    db.seed('rewardPointTransaction', {
      userId: u, amount: 1000, type: 'LEADERBOARD_REWARD', description: 'old', balanceAfter: 1000,
      sourceId: LB_OCT, idempotencyKey: keyFor(u),
      metadata: { leaderboardId: LB_OCT, rank: 1, month: 10, year: 2026, points: 1000 },
      ...over,
    });

  it('REWARD-09 ledger entry exists but the wallet was never credited -> no silent credit, no silent skip: risk recorded', async () => {
    seedWallet(ALICE, 0, 0, 0); // old code crashed between ledger insert and wallet update
    const entry = seedLegacyEntry(ALICE);

    const results = [await award(ALICE, 1000), await award(ALICE, 1000), await award(ALICE, 1000)];
    assert.ok(results.every((r) => r.id === entry.id));
    assert.equal(wallet(ALICE)!.balance, 0, 'balance is NOT adjusted automatically');
    assert.equal(wallet(ALICE)!.totalEarned, 0);
    assert.equal(ledger(ALICE).length, 1, 'ledger history untouched, no second entry');

    assert.equal(audits().length, 1, 'the mismatch is recorded exactly once, not once per retry');
    const a = audits()[0];
    assert.equal(a.targetUserId, ALICE);
    assert.equal(a.month, 10);
    assert.equal(a.year, 2026);
    assert.equal(a.details.ledgerEntryId, entry.id);
    assert.deepEqual(a.details.expected, { balance: 1000, totalEarned: 1000, totalSpent: 0 });
    assert.deepEqual(a.details.actual, { balance: 0, totalEarned: 0, totalSpent: 0 });

    const report = await RewardPointService.auditWalletConsistency(ALICE);
    assert.equal(report.consistent, false);
    assert.deepEqual(report.difference, { balance: -1000, totalEarned: -1000, totalSpent: 0 });
  });

  it('REWARD-09 ledger entry with a wallet that DOES reflect it -> plain idempotent skip, nothing recorded', async () => {
    seedWallet(ALICE, 1000);
    seedLegacyEntry(ALICE);
    const r = await award(ALICE, 1000);
    assert.equal(r.amount, 1000);
    assert.equal(audits().length, 0);
    assert.equal(wallet(ALICE)!.balance, 1000);
    assert.equal((await RewardPointService.auditWalletConsistency(ALICE)).consistent, true);
  });

  for (const [label, over] of [
    ['belongs to another user', { userId: BOB }],
    ['is a different transaction type', { type: 'ADMIN_ADJUSTMENT' }],
    ['was issued for another leaderboard', { sourceId: LB_NOV }],
    ['was issued for another month', { metadata: { leaderboardId: LB_OCT, rank: 1, month: 9, year: 2026, points: 1000 } }],
  ] as const) {
    it(`REWARD-09 an entry holding our key that ${label} is an integrity error, never a success`, async () => {
      seedWallet(ALICE, 0);
      seedLegacyEntry(ALICE, over);
      const r = await settle(award(ALICE, 1000));
      assert.equal(r.ok, false);
      assert.match((r as any).error.message, /Ledger integrity error/);
      assert.equal(wallet(ALICE)!.balance, 0);
      assert.equal(db.count('rewardPointTransaction'), 1);
    });
  }

  it('wallet audit invariants hold across all writers (award, admin adjustments)', async () => {
    await award(ALICE, 1000);
    await RewardPointService.adminAdjustPoints('d9'.repeat(12), 'admin@umi.vn', ALICE, 100, 'bonus');
    await new Promise((r) => setTimeout(r, 5)); // adminAdjustPoints keys on Date.now() (out of scope here)
    await RewardPointService.adminAdjustPoints('d9'.repeat(12), 'admin@umi.vn', ALICE, -250, 'correction');
    const report = await RewardPointService.auditWalletConsistency(ALICE);
    assert.equal(report.consistent, true, JSON.stringify(report));
    assert.equal(report.actual!.balance, 850);
  });
});
