/**
 * FIX 06B1 + 06B2 integration tests for the leaderboard lock on a REAL MongoDB replica set: atomic acquire under
 * genuine concurrency (several independent Prisma clients = separate connection pools), expiry decided by the
 * MongoDB SERVER clock, take-over + fencing, and fenceTransaction inside real transactions.
 *
 * Opt-in; see tests/helpers/test-db-url.ts:
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06_test?replicaSet=rsTest" npm test
 *
 * Own database (`<name>_lock`), created with `prisma db push`, dropped afterwards. It never uses the
 * DATABASE_URL of a running environment. (Real separate Node PROCESSES racing are FIX 06C.)
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolveTestDb } from '../helpers/test-db-url';

const target = resolveTestDb('lock');

describe('REAL MongoDB replica set: leaderboard lock', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let PrismaClient: any;
  let lockModule: any;
  let runTx: any;
  let admin: any;                                 // inspection / setup client
  const clients: any[] = [];

  const MONTH = 9;
  const YEAR = 2031;
  const oid = () => randomBytes(12).toString('hex');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const SHORT = { ttlMs: 1500, heartbeatMs: 500 };

  /** A "process": its own PrismaClient (own pool) + its own lock service. */
  const newProc = (config: any = SHORT) => {
    const prisma = new PrismaClient();
    clients.push(prisma);
    return { prisma, svc: new lockModule.LeaderboardLockService({ prisma, config }) };
  };

  before(async () => {
    process.env.DATABASE_URL = target.url;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: target.url }, stdio: 'pipe' });
    ({ PrismaClient } = require('@prisma/client'));
    require('../../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    lockModule = require('../../src/services/leaderboard-lock.service');
    ({ runTx } = require('../../src/services/course-redemption.service'));
    admin = new PrismaClient();
    clients.push(admin);
  });

  after(async () => {
    try { await admin.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    for (const c of clients) await c.$disconnect().catch(() => undefined);
  });

  beforeEach(async () => {
    await admin.monthlyLeaderboard.deleteMany({});
    await admin.userRewardPoint.deleteMany({});
  });

  const rawDoc = async (month = MONTH, year = YEAR) => {
    const r: any = await admin.$runCommandRaw({ find: 'monthly_leaderboards', filter: { month, year } });
    return r.cursor.firstBatch[0];
  };
  const typeOf = async (field: string) => {
    const r: any = await admin.$runCommandRaw({
      aggregate: 'monthly_leaderboards',
      pipeline: [{ $match: { month: MONTH, year: YEAR } }, { $project: { t: { $type: `$${field}` } } }],
      cursor: {},
    });
    return r.cursor.firstBatch[0].t;
  };
  const periodRows = () => admin.monthlyLeaderboard.count({ where: { month: MONTH, year: YEAR } });
  const acquire = async (p: any, owner: string, opts: any = {}) => p.svc.acquire(MONTH, YEAR, { owner, ...opts });
  const must = async (p: any, owner: string) => {
    const r = await acquire(p, owner);
    assert.equal(r.status, 'ACQUIRED', JSON.stringify(r));
    return r.handle;
  };
  const wallets = () => admin.userRewardPoint.count({});
  const business = (tx: any) =>
    tx.userRewardPoint.create({ data: { userId: oid(), balance: 1, totalEarned: 1, totalSpent: 0 } });

  it('environment: the unique (month, year) index exists; a raw command on a transaction client rolls back with it', async () => {
    const idx: any = await admin.$runCommandRaw({ listIndexes: 'monthly_leaderboards' });
    assert.ok(idx.cursor.firstBatch.some((i: any) => i.unique && Object.keys(i.key).join(',') === 'month,year'));

    await admin.$runCommandRaw({ insert: 'monthly_leaderboards', documents: [{ month: 3, year: 2031, status: 'ACTIVE' }] });
    await assert.rejects(
      admin.$transaction(async (tx: any) => {
        await tx.$runCommandRaw({ update: 'monthly_leaderboards', updates: [{ q: { month: 3, year: 2031 }, u: { $set: { marker: 'raw-in-tx' } } }] });
        throw new Error('rollback');
      }),
      /rollback/
    );
    const doc = (await admin.$runCommandRaw({ find: 'monthly_leaderboards', filter: { month: 3, year: 2031 } }) as any).cursor.firstBatch[0];
    assert.equal(doc.marker, undefined, 'raw commands issued on the transaction client take part in the transaction');
  });

  describe('acquire is atomic under real concurrency', () => {
    it('16 concurrent acquires from 4 independent clients: exactly one ACQUIRED, fencing token 1, real random token', async () => {
      const procs = Array.from({ length: 4 }, () => newProc());
      // connect every client's pool first (on another period), so the race below is a real race
      await Promise.all(procs.map((p) => p.svc.acquire(12, YEAR, { owner: 'warm-up' })));
      await admin.monthlyLeaderboard.deleteMany({});

      const results: any[] = await Promise.all(Array.from({ length: 16 }, (_, i) => acquire(procs[i % 4], `p${i}`)));
      const winners = results.filter((r) => r.status === 'ACQUIRED');
      assert.equal(winners.length, 1, JSON.stringify(results.map((r) => r.status)));
      assert.equal(results.filter((r) => r.status === 'BUSY').length, 15);
      assert.equal(winners[0].handle.fencingToken, 1);
      assert.match(winners[0].handle.lockToken, /^[0-9a-f]{64}$/);
      assert.equal(await periodRows(), 1);

      const doc = await rawDoc();
      assert.equal(doc.lockToken, winners[0].handle.lockToken);
      assert.equal(await typeOf('fencingToken'), 'int');
      assert.equal(await typeOf('lockExpiresAt'), 'date');
      for (const r of results.filter((x) => x.status === 'BUSY')) {
        assert.equal(r.owner, winners[0].handle.owner);
        assert.equal(r.fencingToken, 1);
        assert.ok(r.expiresInMs > 0 && r.expiresInMs <= 1500);
      }
    });

    it('16 concurrent first-time acquires with NO period row: one row, one winner', async () => {
      const procs = Array.from({ length: 4 }, () => newProc());
      assert.equal(await periodRows(), 0);
      const results: any[] = await Promise.all(Array.from({ length: 16 }, (_, i) => acquire(procs[i % 4], `p${i}`)));
      assert.equal(await periodRows(), 1);
      assert.equal(results.filter((r) => r.status === 'ACQUIRED').length, 1);
      assert.equal(results.filter((r) => r.status === 'BUSY').length, 15);
    });

    it('a row written before the lock existed (no lock fields) is acquirable; its other fields survive', async () => {
      await admin.$runCommandRaw({ insert: 'monthly_leaderboards', documents: [{ month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 5, totalPointsAwarded: 0, policyVersion: '1.0', finalizedBy: 'old', createdAt: { $date: '2026-01-01T00:00:00.000Z' }, updatedAt: { $date: '2026-01-02T00:00:00.000Z' } }] });
      const p = newProc();
      const h = await must(p, 'A');
      assert.equal(h.fencingToken, 1);
      const viaPrisma = await admin.monthlyLeaderboard.findUnique({ where: { month_year: { month: MONTH, year: YEAR } } });
      assert.equal(viaPrisma.status, 'SNAPSHOT_BUILDING', 'Prisma can read the row after the raw update');
      assert.equal(viaPrisma.totalParticipants, 5);
      assert.equal(viaPrisma.finalizedBy, 'old');
      assert.equal(viaPrisma.fencingToken, 1);
      assert.equal(await typeOf('fencingToken'), 'int');
    });

    it('a row with explicit nulls (after release) and a sequence of cycles keep the fencing token strictly increasing', async () => {
      const p = newProc();
      const seen: number[] = [];
      for (let i = 0; i < 12; i++) {
        const h = await must(p, `o${i}`);
        seen.push(h.fencingToken);
        assert.deepEqual(await p.svc.release(h), { released: true });
      }
      assert.deepEqual(seen, Array.from({ length: 12 }, (_, i) => i + 1));
      assert.equal((await rawDoc()).lockToken, null);
    });

    it('a FINALIZED period is refused with every flag a caller could pass, and not one field changes', async () => {
      await admin.$runCommandRaw({ insert: 'monthly_leaderboards', documents: [{ month: MONTH, year: YEAR, status: 'FINALIZED', totalParticipants: 4, totalPointsAwarded: 2400, lockToken: 'old', lockExpiresAt: { $date: new Date(Date.now() - 60_000).toISOString() }, fencingToken: 3 }] });
      const before = JSON.stringify(await rawDoc());
      const p = newProc();
      for (const flags of [{}, { force: true }, { takeOver: true }, { force: true, takeOver: true }]) {
        assert.deepEqual(await acquire(p, 'x', flags), { status: 'FINALIZED' });
      }
      assert.equal(JSON.stringify(await rawDoc()), before);
    });
  });

  describe('time comes from the MongoDB server, not from the callers\' clocks', () => {
    it('the lease is TTL ms ahead of the SERVER clock', async () => {
      const p = newProc({ ttlMs: 30_000, heartbeatMs: 10_000 });
      const h = await must(p, 'A');
      const ahead = h.expiresAt.getTime() - Date.now();
      assert.ok(ahead > 28_000 && ahead <= 30_500, `lease ends ${ahead} ms from now`);
    });

    it('a caller whose clock is one hour FAST cannot expire someone else\'s lease; one an hour SLOW cannot keep its own', async () => {
      const a = newProc();
      const b = newProc();
      const ha = await must(a, 'A');

      const realNow = Date.now;
      try {
        mock.method(Date, 'now', () => realNow() + 3_600_000);
        assert.equal((await acquire(b, 'B')).status, 'BUSY', 'fast clock: still BUSY');
        mock.restoreAll();

        await sleep(1700); // the lease really expires on the server
        mock.method(Date, 'now', () => realNow() - 3_600_000);
        const r = await acquire(b, 'B');
        assert.equal(r.status, 'ACQUIRED', 'slow clock: the lapsed lease is still taken over');
        assert.equal(r.handle.fencingToken, ha.fencingToken + 1);
      } finally {
        mock.restoreAll();
      }
    });
  });

  describe('take-over, renew, release and fencing', () => {
    it('expiry -> take-over: BUSY before, ACQUIRED after with a higher fencing token; the old owner is shut out', async () => {
      const a = newProc();
      const b = newProc();
      const ha = await must(a, 'A');
      assert.equal((await acquire(b, 'B')).status, 'BUSY');
      assert.equal(await a.svc.inspect(ha), 'HELD');

      await sleep(1700);
      assert.equal(await a.svc.inspect(ha), 'EXPIRED', 'lapsed but not yet replaced');
      const rb = await acquire(b, 'B');
      assert.equal(rb.status, 'ACQUIRED');
      const hb = rb.handle;
      assert.equal(hb.fencingToken, ha.fencingToken + 1);
      assert.notEqual(hb.lockToken, ha.lockToken);

      assert.equal(await a.svc.inspect(ha), 'REPLACED');
      assert.deepEqual(await a.svc.renew(ha), { renewed: false, reason: 'REPLACED' });
      assert.deepEqual(await a.svc.release(ha), { released: false, reason: 'NOT_OWNER' });
      await assert.rejects(a.svc.assertHeld(ha), (e: any) => e instanceof lockModule.LockLostError && e.reason === 'REPLACED');
      assert.equal(await b.svc.inspect(hb), 'HELD', 'the stale owner changed nothing');
      assert.equal((await rawDoc()).lockToken, hb.lockToken);

      // fenced out of a real transaction: nothing is written
      await assert.rejects(
        runTx(async (tx: any) => { await a.svc.fenceTransaction(tx, ha); await business(tx); }),
        (e: any) => e instanceof lockModule.LockLostError
      );
      assert.equal(await wallets(), 0);
      await runTx(async (tx: any) => { await b.svc.fenceTransaction(tx, hb); await business(tx); });
      assert.equal(await wallets(), 1);
    });

    it('8 acquirers racing for a LAPSED lease: exactly one wins, fencing token +1 exactly once', async () => {
      const a = newProc();
      const ha = await must(a, 'A');
      await sleep(1700);
      const racers = Array.from({ length: 4 }, () => newProc());
      const results: any[] = await Promise.all(Array.from({ length: 8 }, (_, i) => acquire(racers[i % 4], `r${i}`)));
      assert.equal(results.filter((r) => r.status === 'ACQUIRED').length, 1);
      assert.equal(results.find((r) => r.status === 'ACQUIRED').handle.fencingToken, ha.fencingToken + 1);
      assert.equal((await rawDoc()).fencingToken, ha.fencingToken + 1);
    });

    it('renew by the owner extends the lease (server clock); a lapsed lease is NOT revived even if nobody replaced it', async () => {
      const a = newProc();
      const b = newProc();
      const h = await must(a, 'A');
      await sleep(900);
      const before = h.expiresAt.getTime();
      const r = await a.svc.renew(h);
      assert.equal(r.renewed, true);
      assert.ok(h.expiresAt.getTime() > before + 500, 'lease moved forward');
      await sleep(900);
      assert.equal((await acquire(b, 'B')).status, 'BUSY', 'renewal kept B out');

      await sleep(1000);                                  // let it lapse
      assert.equal(await a.svc.inspect(h), 'EXPIRED');
      const expiryOnDisk = (await rawDoc()).lockExpiresAt.$date;
      assert.deepEqual(await a.svc.renew(h), { renewed: false, reason: 'EXPIRED' }, 'nobody replaced us, but the lapsed lease stays lapsed');
      assert.equal(await a.svc.inspect(h), 'EXPIRED');
      assert.deepEqual((await rawDoc()).lockExpiresAt.$date, expiryOnDisk, 'the stored lease was not extended');
      assert.equal((await acquire(b, 'B')).status, 'ACQUIRED', 'so anyone may take it');
      assert.deepEqual(await a.svc.renew(h), { renewed: false, reason: 'REPLACED' });
    });

    it('FIX 06C-4A: an acquire BLOCKED by an in-flight transaction until after the lease it was granted has passed does not report ACQUIRED with a dead lease', async () => {
      // A's lease lapses while A's transaction still holds the period row (what a process killed mid-transaction leaves behind until the server aborts it).
      // MongoDB computes the new lease from the moment the blocked command STARTED, so by the time it runs the lease can already be over.
      const a = newProc();
      const b = newProc();
      const ha = await must(a, 'A');                                        // 1.5 s lease
      const holder = a.prisma
        .$transaction(async (tx: any) => {
          await a.svc.fenceTransaction(tx, ha);                             // A's transaction now holds the period row ...
          await sleep(3600);                                                // ... for much longer than the lease
        }, { timeout: 20000, maxWait: 20000 })
        .catch(() => 'tx failed');
      await sleep(1700);                                                    // A's lease lapsed; its transaction is still open
      const t0 = Date.now();
      const r = await acquire(b, 'B');                                      // blocks until A's transaction ends, then must not hand out a dead lease
      const blockedMs = Date.now() - t0;
      assert.ok(blockedMs > 1500, `the acquire really was blocked (${blockedMs} ms)`);
      assert.equal(r.status, 'ACQUIRED');
      assert.equal(await b.svc.inspect(r.handle), 'HELD', `what is reported as ACQUIRED must be a usable lease (expires ${r.handle.expiresAt.toISOString()}, now ${new Date().toISOString()})`);
      assert.ok(r.handle.expiresAt.getTime() > Date.now(), 'the lease the caller received is in the future');
      assert.ok(r.handle.fencingToken > ha.fencingToken);
      await holder;
      assert.equal((await rawDoc()).lockToken, r.handle.lockToken, 'B really is the owner of record');
    });

    it('release needs the exact token AND fencing token; a FINALIZED period\'s owner can still release', async () => {
      const a = newProc();
      const h = await must(a, 'A');
      assert.deepEqual(await a.svc.release({ ...h, fencingToken: h.fencingToken + 1 }), { released: false, reason: 'NOT_OWNER' });
      assert.deepEqual(await a.svc.release({ ...h, lockToken: 'a'.repeat(64) }), { released: false, reason: 'NOT_OWNER' });
      assert.equal(await a.svc.inspect(h), 'HELD');
      await admin.monthlyLeaderboard.updateMany({ where: { month: MONTH, year: YEAR }, data: { status: 'FINALIZED' } });
      assert.equal(await a.svc.inspect(h), 'FINALIZED');
      assert.deepEqual(await a.svc.release(h), { released: true });
      assert.equal((await rawDoc()).lockToken, null);
      assert.equal((await rawDoc()).fencingToken, 1, 'fencing token is kept');
    });

    it('renew and acquire refuse a period that became FINALIZED', async () => {
      const a = newProc();
      const h = await must(a, 'A');
      await admin.monthlyLeaderboard.updateMany({ where: { month: MONTH, year: YEAR }, data: { status: 'FINALIZED' } });
      assert.deepEqual(await a.svc.renew(h), { renewed: false, reason: 'FINALIZED' });
      await sleep(1700);
      assert.deepEqual(await acquire(newProc(), 'B'), { status: 'FINALIZED' });
    });
  });

  describe('fenceTransaction inside real transactions', () => {
    it('a take-over that starts while the owner\'s fenced transaction is open waits for it: the transaction commits whole, THEN ownership changes', async () => {
      const a = newProc();
      const b = newProc();
      const ha = await must(a, 'A');                        // 1.5 s lease

      let committedAt = 0;
      let takeoverDoneAt = 0;
      const txA = a.prisma
        .$transaction(async (tx: any) => {
          await a.svc.fenceTransaction(tx, ha);             // lease is valid HERE
          await sleep(1900);                                // the lease lapses while the transaction is still open
          await business(tx);
          await business(tx);
        })
        .then(() => { committedAt = Date.now(); return 'committed'; }, (e: any) => `failed: ${e.code || e.message.slice(0, 60)}`);

      await sleep(1700);                                    // lease lapsed on the server; A's transaction is still open
      assert.equal(await a.svc.inspect(ha), 'EXPIRED');
      const takeover = acquire(b, 'B').then((r: any) => { takeoverDoneAt = Date.now(); return r; });
      const [resA, resB] = await Promise.all([txA, takeover]);

      assert.equal(resA, 'committed');
      assert.equal(await wallets(), 2, 'both protected writes are present: the transaction was not torn apart');
      assert.equal(resB.status, 'ACQUIRED');
      assert.equal(resB.handle.fencingToken, ha.fencingToken + 1);
      assert.ok(takeoverDoneAt >= committedAt - 5, `take-over (${takeoverDoneAt}) completed only after the commit (${committedAt})`);

      await assert.rejects(runTx(async (tx: any) => { await a.svc.fenceTransaction(tx, ha); await business(tx); }), lockModule.LockLostError);
      assert.equal(await wallets(), 2, 'and from now on A writes nothing');
    });

    it('an owner whose lease LAPSED but who was not replaced yet cannot start a business transaction (server clock): EXPIRED, nothing written', async () => {
      const a = newProc();
      const ha = await must(a, 'A');
      await sleep(1700);
      assert.equal((await rawDoc()).lockToken, ha.lockToken, 'precondition: still the owner of record');
      const seqBefore = (await rawDoc()).fenceSeq;
      let ran = false;
      await assert.rejects(
        runTx(async (tx: any) => { await a.svc.fenceTransaction(tx, ha); ran = true; await business(tx); }),
        (e: any) => e instanceof lockModule.LockLostError && e.reason === 'EXPIRED'
      );
      assert.equal(ran, false);
      assert.equal(await wallets(), 0);
      assert.equal((await rawDoc()).fenceSeq, seqBefore, 'a refused fence wrote nothing');
    });

    it('the fence is a REAL write: fenceSeq counts every fenced transaction, and a rolled-back one leaves no trace', async () => {
      const a = newProc();
      const h = await must(a, 'A');
      assert.equal((await rawDoc()).fenceSeq, undefined);
      for (let i = 1; i <= 3; i++) {
        await runTx(async (tx: any) => { await a.svc.fenceTransaction(tx, h); });
        assert.equal((await rawDoc()).fenceSeq, i);
      }
      await assert.rejects(runTx(async (tx: any) => { await a.svc.fenceTransaction(tx, h); throw new Error('business failed'); }), /business failed/);
      assert.equal((await rawDoc()).fenceSeq, 3, 'the fence rolled back together with the failed transaction');
      assert.equal(await typeOf('fenceSeq'), 'int');
    });

    it('a stale owner whose transaction SNAPSHOT predates a take-over is still shut out (the lease check uses the live server clock, not the snapshot)', async () => {
      const a = newProc();
      const b = newProc();
      const ha = await must(a, 'A');
      let attempts = 0;
      let rb: any;
      const stale = runTx(async (tx: any) => {
        attempts++;
        await tx.userRewardPoint.count({});                    // the snapshot of this transaction starts here: lease still valid
        await sleep(1700);                                     // the lease lapses ...
        rb = await acquire(b, 'B');                            // ... and B takes over and commits, outside this transaction
        await a.svc.fenceTransaction(tx, ha);                  // the stale owner now tries to fence from its OLD snapshot
        await business(tx);
      });
      await assert.rejects(stale, (e: any) => e instanceof lockModule.LockLostError && (e.reason === 'EXPIRED' || e.reason === 'REPLACED'));
      assert.equal(attempts, 1, 'LockLostError is final - no retry');
      assert.equal(rb.status, 'ACQUIRED');
      assert.equal(await wallets(), 0, 'the stale owner wrote nothing');
      assert.equal((await rawDoc()).lockToken, rb.handle.lockToken, 'the new owner is untouched');
    });

    it('a transaction write conflict on the period row (here: a heartbeat renew by the owner itself) is retried boundedly and the retry fences again', async () => {
      const a = newProc();
      const h = await must(a, 'A');
      let attempts = 0;
      await runTx(async (tx: any) => {
        attempts++;
        if (attempts === 1) {
          await tx.userRewardPoint.count({});                  // snapshot starts
          assert.equal((await a.svc.renew(h)).renewed, true);  // the row changes after the snapshot
        }
        await a.svc.fenceTransaction(tx, h);                   // attempt 1: MongoDB reports a write conflict (P2034)
        await business(tx);
      });
      assert.equal(attempts, 2, 'one conflict, then the re-fenced retry commits');
      assert.equal(await wallets(), 1);
      assert.equal((await rawDoc()).fenceSeq, 1, 'only the committed attempt left a fence');
    });

    it('a handle for another month / year than the row never fences', async () => {
      const a = newProc();
      const h = await must(a, 'A');
      let ran = false;
      await assert.rejects(runTx(async (tx: any) => { await a.svc.fenceTransaction(tx, { ...h, month: MONTH === 1 ? 2 : 1 }); ran = true; }));
      assert.equal(ran, false);
    });

    it('the fencing token is checked together with the lock token (right token + wrong fencing token is fenced out)', async () => {
      const a = newProc();
      const h = await must(a, 'A');
      for (const forged of [h.fencingToken + 1, h.fencingToken - 1, 0]) {
        await assert.rejects(
          runTx(async (tx: any) => { await a.svc.fenceTransaction(tx, { ...h, fencingToken: forged }); await business(tx); }),
          (e: any) => e instanceof lockModule.LockLostError
        );
      }
      assert.equal(await wallets(), 0);
      await runTx(async (tx: any) => { await a.svc.fenceTransaction(tx, h); await business(tx); });
      assert.equal(await wallets(), 1);
    });

    it('fenced transactions of one period serialize at document level: short ones all commit through bounded retry', async () => {
      const a = newProc();
      const h = await must(a, 'A');
      let attempts = 0;
      const one = () => runTx(async (tx: any) => { attempts++; await a.svc.fenceTransaction(tx, h); await business(tx); });
      for (let round = 0; round < 3; round++) {
        const before = await wallets();
        const results = await Promise.allSettled([one(), one(), one(), one()]);
        assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results.map((r: any) => r.reason?.message?.slice(-60))));
        assert.equal((await wallets()) - before, 4);
      }
      assert.ok(attempts >= 12 && attempts <= 12 * 5, `attempts ${attempts} (bounded by 5 per transaction)`);
    });

    it('a transaction that HOLDS the period row for long outlasts the bounded retry: it fails atomically, never half-written, never endlessly', async () => {
      const a = newProc();
      const h = await must(a, 'A');
      let attempts = 0;
      const slow = () => runTx(async (tx: any) => {
        attempts++;
        await a.svc.fenceTransaction(tx, h);
        await sleep(300);                         // external work inside the transaction - exactly what FIX 06B2 must not do
        await business(tx);
        await business(tx);
      });
      const results = await Promise.allSettled([slow(), slow(), slow()]);
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      assert.ok(ok >= 1, 'the first one always wins');
      assert.equal(await wallets(), ok * 2, 'each commit has BOTH of its writes; each failure has none');
      assert.ok(attempts <= 3 * 5, `bounded: ${attempts} attempts in total`);
      for (const f of failed) assert.match(String(f.reason?.message), /write conflict|deadlock/i);
    });
  });

  describe('heartbeat on a real lease', () => {
    it('keeps a 2 s lease alive for over 3 s and keeps others out; after stop() the lease lapses and can be taken', async () => {
      const a = newProc({ ttlMs: 2000, heartbeatMs: 500 });
      const b = newProc({ ttlMs: 2000, heartbeatMs: 500 });
      const h = await must(a, 'A');
      const hb = a.svc.startHeartbeat(h);
      await sleep(3200);
      assert.equal(await a.svc.inspect(h), 'HELD');
      assert.equal((await acquire(b, 'B')).status, 'BUSY');
      assert.equal(hb.lost, false);
      hb.stop();
      await sleep(2300);
      assert.equal((await acquire(b, 'B')).status, 'ACQUIRED');
    });

    it('notices a take-over (lease force-expired + acquired by someone else) and reports the loss', async () => {
      const a = newProc({ ttlMs: 2000, heartbeatMs: 500 });
      const b = newProc({ ttlMs: 2000, heartbeatMs: 500 });
      const h = await must(a, 'A');
      const reasons: string[] = [];
      const hb = a.svc.startHeartbeat(h, (r: string) => reasons.push(r));
      // simulate a long stall of A: force the lease to lapse, B takes over before A's next beat
      await admin.monthlyLeaderboard.updateMany({ where: { month: MONTH, year: YEAR }, data: { lockExpiresAt: new Date(Date.now() - 1000) } });
      const rb = await acquire(b, 'B');
      assert.equal(rb.status, 'ACQUIRED');
      await sleep(1200);
      assert.equal(hb.lost, true);
      assert.deepEqual(reasons, ['REPLACED']);
      assert.equal((await rawDoc()).lockToken, rb.handle.lockToken, 'the stale heartbeat did not touch the new lease');
    });
  });

  describe('database failures are never ACQUIRED', () => {
    it('an unreachable database makes acquire / renew / release reject', async () => {
      const dead = new PrismaClient({ datasources: { db: { url: 'mongodb://127.0.0.1:1/umi_unreachable_test?serverSelectionTimeoutMS=400&connectTimeoutMS=400&directConnection=true' } } });
      clients.push(dead);
      const svc = new lockModule.LeaderboardLockService({ prisma: dead, config: SHORT });
      await assert.rejects(svc.acquire(MONTH, YEAR), lockModule.LockStoreError);

      const fake = { periodId: oid(), month: MONTH, year: YEAR, lockToken: 'a'.repeat(64), fencingToken: 1, owner: 'x', ttlMs: 1500, expiresAt: new Date() };
      await assert.rejects(svc.renew(fake), lockModule.LockStoreError);
      await assert.rejects(svc.release(fake), lockModule.LockStoreError);
    });
  });
});
