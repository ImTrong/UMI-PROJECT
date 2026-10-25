/**
 * FIX 04 integration tests on a REAL MongoDB replica set: real transactions, real rollback,
 * real write conflicts, real unique indexes. Opt-in; see tests/helpers/test-db-url.ts.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix04_test?replicaSet=rsTest" npm test
 *
 * Runs `prisma db push` and finally drops ONLY its own database (`<name>_reward`). Never point it at a
 * shared / production database.
 *
 * Fault injection: the service code runs UNMODIFIED against the real database; a thin proxy around the
 * Prisma client can make chosen calls inside a transaction throw, so the rollback is a real MongoDB one.
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolveTestDb } from '../helpers/test-db-url';

const target = resolveTestDb('reward');

describe('REAL MongoDB replica set: leaderboard reward', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let prisma: any;
  let axios: any;
  let RewardPointService: any;

  // ----- fault injection (inside $transaction only) -----
  const faults: Array<{ model: string; op: string; error: Error; remaining: number }> = [];
  const failNext = (model: string, op: string, error: Error, times = 1) => faults.push({ model, op, error, remaining: times });

  const wrapTx = (tx: any) =>
    new Proxy(tx, {
      get(t, model: string) {
        const m = (t as any)[model];
        if (!m || typeof m !== 'object') return m;
        return new Proxy(m, {
          get(mt, op: string) {
            const fn = (mt as any)[op];
            if (typeof fn !== 'function') return fn;
            return (...args: any[]) => {
              const f = faults.find((x) => x.model === model && x.op === op && x.remaining > 0);
              if (f) { f.remaining--; return Promise.reject(f.error); }
              return fn.apply(mt, args);
            };
          },
        });
      },
    });

  const oid = () => randomBytes(12).toString('hex');
  let LB_OCT: string, LB_NOV: string, LB_DEC: string, LB_JAN: string;

  before(async () => {
    process.env.DATABASE_URL = target.url;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: target.url }, stdio: 'pipe' });

    // Install a Prisma client whose $transaction passes a fault-injecting proxy to the callback.
    const realModule = require('@prisma/client');
    const RealPrismaClient = realModule.PrismaClient;
    class FaultyPrismaClient {
      constructor(...args: any[]) {
        const real = new RealPrismaClient(...args);
        return new Proxy(real, {
          get(t, prop: string) {
            if (prop === '$transaction') {
              return (fn: any, opts?: any) =>
                typeof fn === 'function' ? t.$transaction((tx: any) => fn(wrapTx(tx)), opts) : t.$transaction(fn, opts);
            }
            const v = (t as any)[prop];
            return typeof v === 'function' ? v.bind(t) : v;
          },
        });
      }
    }
    const resolved = require.resolve('@prisma/client');
    require.cache[resolved]!.exports = { ...realModule, PrismaClient: FaultyPrismaClient };

    prisma = new FaultyPrismaClient();
    axios = require('axios').default || require('axios');
    require('../../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    ({ RewardPointService } = require('../../src/services/reward-point.service'));
  });

  after(async () => {
    try { await prisma.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    faults.length = 0;
    for (const m of ['courseRedemption', 'rewardPointTransaction', 'userRewardPoint', 'courseProgress', 'userProgress', 'activityLog', 'leaderboardAuditLog']) {
      await prisma[m].deleteMany({});
    }
    [LB_OCT, LB_NOV, LB_DEC, LB_JAN] = [oid(), oid(), oid(), oid()];
    mock.restoreAll();
  });

  const award = (u: string, points = 1000, month = 10, year = 2026, lb = LB_OCT, rank = 1) =>
    RewardPointService.awardLeaderboardPoints(u, points, lb, rank, month, year);
  const settle = (p: Promise<any>) => p.then((value: any) => ({ ok: true, value }), (error: any) => ({ ok: false, error }));
  const wallet = (u: string) => prisma.userRewardPoint.findUnique({ where: { userId: u } });
  const entries = (u: string) => prisma.rewardPointTransaction.findMany({ where: { userId: u }, orderBy: { balanceAfter: 'asc' } });
  const seedWallet = (u: string, balance: number) =>
    prisma.userRewardPoint.create({ data: { userId: u, balance, totalEarned: balance, totalSpent: 0 } });

  it('environment: unique indexes exist (idempotencyKey, wallet userId)', async () => {
    const uniq = async (coll: string) => {
      const r: any = await prisma.$runCommandRaw({ listIndexes: coll });
      return r.cursor.firstBatch.filter((i: any) => i.unique).map((i: any) => Object.keys(i.key).join(','));
    };
    assert.ok((await uniq('reward_point_transactions')).includes('idempotencyKey'));
    assert.ok((await uniq('user_reward_points')).includes('userId'));
  });

  it('happy path: wallet and ledger agree, audit is clean', async () => {
    const u = oid();
    const tx = await award(u, 1000);
    assert.equal(tx.balanceAfter, 1000);
    assert.equal(tx.idempotencyKey, `reward_lb_month_10_year_2026_user_${u}`);
    const w = await wallet(u);
    assert.equal(w.balance, 1000);
    assert.equal(w.totalEarned, 1000);
    assert.equal((await entries(u)).length, 1);
    assert.equal((await RewardPointService.auditWalletConsistency(u)).consistent, true);
  });

  it('REWARD-01/02 ledger insert fails AFTER the wallet increment -> real MongoDB rollback leaves the wallet untouched', async () => {
    const u = oid();
    await seedWallet(u, 300);
    failNext('rewardPointTransaction', 'create', new Error('boom: ledger insert failed'));
    const r: any = await settle(award(u, 1000));
    assert.equal(r.ok, false);
    assert.match(r.error.message, /boom/);
    const w = await wallet(u);
    assert.equal(w.balance, 300, 'the committed-looking +1000 was rolled back by MongoDB');
    assert.equal(w.totalEarned, 300);
    assert.equal((await entries(u)).length, 0);

    const later = await award(u, 1000);
    assert.equal(later.balanceAfter, 1300);
    assert.equal((await wallet(u)).balance, 1300);
  });

  it('REWARD-01 wallet update fails -> no ledger entry is committed', async () => {
    const u = oid();
    await seedWallet(u, 300);
    failNext('userRewardPoint', 'updateMany', new Error('boom: wallet update failed'));
    const r: any = await settle(award(u, 1000));
    assert.equal(r.ok, false);
    assert.equal((await wallet(u)).balance, 300);
    assert.equal((await entries(u)).length, 0);
  });

  it('REWARD-03 + REWARD-10 retry returns the committed entry and never pays twice', async () => {
    const u = oid();
    const first = await award(u, 1000, 10, 2026, LB_OCT, 1);
    const retry = await award(u, 700, 10, 2026, LB_OCT, 2);
    assert.equal(retry.id, first.id);
    assert.equal((await wallet(u)).balance, 1000);
    assert.equal((await wallet(u)).totalEarned, 1000);
    assert.equal((await entries(u)).length, 1);
  });

  it('REWARD-04 12 concurrent awards, same user + period -> one commit', async () => {
    const u = oid();
    const results: any[] = await Promise.all(Array.from({ length: 12 }, (_, i) => settle(award(u, 1000, 10, 2026, LB_OCT, (i % 3) + 1))));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.error?.message)));
    assert.equal(new Set(results.map((r) => r.value.id)).size, 1);
    assert.equal((await entries(u)).length, 1);
    const w = await wallet(u);
    assert.equal(w.balance, 1000);
    assert.equal(w.totalEarned, 1000);
    assert.equal(await prisma.userRewardPoint.count({ where: { userId: u } }), 1);
  });

  it('REWARD-05 ten users awarded concurrently -> independent wallets and ledgers', async () => {
    const users = Array.from({ length: 10 }, oid);
    await Promise.all(users.map((u, i) => award(u, 1000 - i * 50, 10, 2026, LB_OCT, i + 1)));
    for (const [i, u] of users.entries()) {
      const w = await wallet(u);
      const e = await entries(u);
      assert.equal(w.balance, 1000 - i * 50);
      assert.equal(e.length, 1);
      assert.equal(e[0].balanceAfter, 1000 - i * 50);
    }
  });

  it('REWARD-06 wallet missing + 12 concurrent first-time awards -> one wallet, one award', async () => {
    const u = oid();
    const results: any[] = await Promise.all(Array.from({ length: 12 }, () => settle(award(u, 1000))));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.error?.message)));
    assert.equal(await prisma.userRewardPoint.count({ where: { userId: u } }), 1);
    assert.equal((await wallet(u)).balance, 1000);
    assert.equal((await entries(u)).length, 1);
  });

  it('REWARD-07 four different rewards for one wallet at once (real write conflicts) -> consistent balanceAfter chain', async () => {
    const u = oid();
    await seedWallet(u, 300);
    const specs: Array<[number, number, string]> = [[1000, 10, LB_OCT], [700, 11, LB_NOV], [500, 12, LB_DEC], [200, 1, LB_JAN]];
    const results: any[] = await Promise.all(specs.map(([pts, month, lb]) => settle(award(u, pts, month, month === 1 ? 2027 : 2026, lb))));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.error?.message)));
    const w = await wallet(u);
    assert.equal(w.balance, 2700);
    assert.equal(w.totalEarned, 2700);
    const chain = await entries(u);
    assert.equal(chain.length, 4);
    let running = 300;
    for (const e of chain) {
      running += e.amount;
      assert.equal(e.balanceAfter, running, 'balanceAfter must equal the committed running balance');
    }
    assert.equal(running, w.balance);
    // the only unexplained amount is the 300 seeded straight into the wallet (no ledger entry) - the audit sees exactly that
    const audit = await RewardPointService.auditWalletConsistency(u);
    assert.deepEqual(audit.difference, { balance: 300, totalEarned: 300, totalSpent: 0 });
  });

  it('REWARD-08 transient write conflict -> bounded retry, still exactly one award', async () => {
    const u = oid();
    await seedWallet(u, 0);
    failNext('userRewardPoint', 'updateMany', Object.assign(new Error('Transaction failed due to a write conflict'), { code: 'P2034' }), 2);
    const tx = await award(u, 1000);
    assert.equal(tx.amount, 1000);
    assert.equal(faults[0].remaining, 0, 'the failing step was really hit twice before succeeding');
    assert.equal((await entries(u)).length, 1);
    assert.equal((await wallet(u)).balance, 1000);
  });

  it('REWARD-08 a persistent conflict stops after a bounded number of tries and commits nothing', async () => {
    const u = oid();
    await seedWallet(u, 0);
    failNext('userRewardPoint', 'updateMany', Object.assign(new Error('write conflict'), { code: 'P2034' }), 1000);
    const r: any = await settle(award(u, 1000));
    assert.equal(r.ok, false);
    const tries = 1000 - faults[0].remaining;
    assert.ok(tries >= 2 && tries <= 5, `bounded: ${tries}`);
    assert.equal((await entries(u)).length, 0);
    assert.equal((await wallet(u)).balance, 0);
  });

  it('REWARD-09 legacy ledger entry without a wallet credit -> not credited silently, mismatch recorded once', async () => {
    const u = oid();
    await seedWallet(u, 0);
    await prisma.userRewardPoint.update({ where: { userId: u }, data: { totalEarned: 0 } });
    const legacy = await prisma.rewardPointTransaction.create({
      data: {
        userId: u, amount: 1000, type: 'LEADERBOARD_REWARD', description: 'old', balanceAfter: 1000,
        sourceId: LB_OCT, idempotencyKey: `reward_lb_month_10_year_2026_user_${u}`,
        metadata: { leaderboardId: LB_OCT, rank: 1, month: 10, year: 2026, points: 1000 },
      },
    });
    const a = await award(u, 1000);
    const b = await award(u, 1000);
    assert.equal(a.id, legacy.id);
    assert.equal(b.id, legacy.id);
    assert.equal((await wallet(u)).balance, 0, 'no automatic credit');
    assert.equal((await entries(u)).length, 1);
    const logs = await prisma.leaderboardAuditLog.findMany({ where: { action: 'REWARD_LEDGER_MISMATCH', targetUserId: u } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].details.difference.balance, -1000);
  });

  it('cross-check with FIX 03: award + course redemption on one wallet at once stay consistent', async () => {
    const u = oid();
    const courseId = oid();
    await seedWallet(u, 600);
    mock.method(axios, 'get', async (url: string) => {
      if (url.includes('/lessons')) return { data: { data: [{ id: oid(), title: 'L1' }] } };
      return { data: { data: { id: courseId, title: 'C', price: 1, published: true, approvalStatus: 'APPROVED' } } };
    });
    mock.method(axios, 'post', async () => ({ data: {} }));

    const [reward, redeemed]: any[] = await Promise.all([
      settle(award(u, 1000)),
      settle(RewardPointService.redeemCourseWithPoints(u, courseId, `req_${Date.now()}`)),
    ]);
    assert.equal(reward.ok, true, reward.error?.message);
    assert.equal(redeemed.ok, true, redeemed.error?.message);

    const w = await wallet(u);
    assert.equal(w.balance, 600 + 1000 - 500);
    assert.equal(w.totalEarned, 1600);
    assert.equal(w.totalSpent, 500);
    // the wallet history is the seed (600) plus the two committed entries, in a consistent chain
    const chain = await entries(u);
    assert.equal(chain.length, 2);
    const byBalance = chain.map((e: any) => e.balanceAfter).sort((x: number, y: number) => x - y);
    const total = chain.reduce((s: number, e: any) => s + e.amount, 600);
    assert.equal(total, w.balance);
    assert.ok(byBalance.every((b: number) => b >= 0));
  });
});
