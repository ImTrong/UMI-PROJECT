/**
 * FIX 06C-1: the leaderboard LOCK PRIMITIVES between several REAL Node.js PROCESSES.
 *
 * Every worker below is a separate OS process started with child_process.fork (own PID, own PrismaClient / connection pool, own
 * LeaderboardLockService) talking to the same isolated MongoDB replica set. The controller (this file) only sends commands over
 * IPC and reads the database; it never performs a contested operation itself. See tests/helpers/mp/harness.ts for the barrier.
 *
 * Scope of this file: acquire / BUSY / expiry / take-over / renew / release / fencing token and abnormal situations of the LOCK.
 * It does NOT run finalizeMonth, rewards, snapshots or notifications - the finalize lifecycle across processes is a later step of FIX 06C.
 * (Those are covered in a single process by tests/integration/ownership.mongo.test.ts.)
 *
 * Opt-in; see tests/helpers/test-db-url.ts:
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" npm test
 * Own database (`<name>_mp`), created with `prisma db push` and dropped afterwards. Workers refuse any database whose name lacks "test".
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { resolveTestDb } from '../helpers/test-db-url';
import { Worker, WorkerPool } from '../helpers/mp/harness';

const target = resolveTestDb('mp');
const COLLECTION = 'monthly_leaderboards';
const SHORT_TTL = 1500; // ms, test environment only (the minimum the lock accepts is 1000)
const DEAD_DB = 'mongodb://127.0.0.1:1/umi_unreachable_test?serverSelectionTimeoutMS=400&connectTimeoutMS=400&directConnection=true';

describe('REAL MULTI-PROCESS: leaderboard lock between independent Node.js processes', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run', timeout: 600_000 }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let admin: any; // the controller's own client: used ONLY to read the lock state and to seed test fixtures
  let pool: WorkerPool;
  const extra: WorkerPool[] = [];

  // ---------------------------------------------------------------- database evidence (read straight from MongoDB)
  const num = (v: any): number | null => {
    if (typeof v === 'number') return v;
    const w = v?.$numberInt ?? v?.$numberLong ?? v?.$numberDouble;
    return w === undefined ? null : Number(w);
  };
  const date = (v: any): Date | null => {
    const d = v?.$date;
    if (d === undefined) return null;
    return new Date(typeof d === 'string' ? d : Number(d?.$numberLong ?? d));
  };
  interface LockRow {
    count: number;
    status?: string;
    lockToken: string | null;
    lockOwner: string | null;
    fencingToken: number | null;
    lockExpiresAt: Date | null;
    serverNow: Date;
    expired: boolean | null;
    remainingMs: number | null;
  }
  /** The lock state exactly as MongoDB sees it, including MongoDB's own clock ($$NOW) and MongoDB's own verdict on expiry. */
  const dbLock = async (month: number, year: number): Promise<LockRow> => {
    const count = await admin.monthlyLeaderboard.count({ where: { month, year } });
    const r: any = await admin.$runCommandRaw({
      aggregate: COLLECTION,
      pipeline: [
        { $match: { month, year } },
        {
          $project: {
            status: 1, lockToken: 1, lockOwner: 1, fencingToken: 1, lockExpiresAt: 1, serverNow: '$$NOW',
            expired: { $cond: [{ $eq: [{ $ifNull: ['$lockExpiresAt', null] }, null] }, null, { $lt: ['$lockExpiresAt', '$$NOW'] }] },
            remainingMs: { $cond: [{ $eq: [{ $ifNull: ['$lockExpiresAt', null] }, null] }, null, { $subtract: ['$lockExpiresAt', '$$NOW'] }] },
          },
        },
      ],
      cursor: {},
    });
    const d = r.cursor.firstBatch[0] || {};
    return {
      count,
      status: d.status,
      lockToken: typeof d.lockToken === 'string' ? d.lockToken : null,
      lockOwner: typeof d.lockOwner === 'string' ? d.lockOwner : null,
      fencingToken: num(d.fencingToken),
      lockExpiresAt: date(d.lockExpiresAt),
      serverNow: date(d.serverNow) as Date,
      expired: typeof d.expired === 'boolean' ? d.expired : null,
      remainingMs: num(d.remainingMs),
    };
  };
  const rawDoc = async (month: number, year: number) => ((await admin.$runCommandRaw({ find: COLLECTION, filter: { month, year } })) as any).cursor.firstBatch[0];
  const insertRaw = (doc: Record<string, unknown>) => admin.$runCommandRaw({ insert: COLLECTION, documents: [doc] });
  /** Poll MongoDB until MongoDB ITSELF says the lease has expired (its own $$NOW is past lockExpiresAt). */
  const waitUntilMongoSaysExpired = async (month: number, year: number, timeoutMs = 10_000): Promise<LockRow> => {
    const t0 = Date.now();
    for (;;) {
      const s = await dbLock(month, year);
      if (s.expired === true) return s;
      if (Date.now() - t0 > timeoutMs) throw new Error(`MongoDB still reports the lease of ${month}/${year} as valid after ${timeoutMs} ms: ${JSON.stringify(s)}`);
      await new Promise((r) => setTimeout(r, 75));
    }
  };
  const isAlive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  const label = (w: Worker) => `${w.label}/pid ${w.pid}`;

  /** Append the workers' event log to a failing assertion, so a failure says WHO did WHAT. */
  const traced = async (fn: () => Promise<void>, pools: WorkerPool[] = [pool]) => {
    try {
      await fn();
    } catch (e: any) {
      e.message += `\n--- worker events (latest) ---\n${pools.map((p) => p.dump()).join('\n')}`;
      throw e;
    }
  };

  before(async () => {
    process.env.DATABASE_URL = target.url;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: target.url }, stdio: 'pipe' });
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient();
    pool = await WorkerPool.start(4, target.url as string);
  });

  after(async () => {
    await pool?.shutdown();
    for (const p of extra) await p.shutdown();
    try { await admin.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
  });

  beforeEach(async () => {
    await admin.monthlyLeaderboard.deleteMany({});
  });

  /** Extra, disposable workers (for tests that kill or break a worker): they are cleaned up in `after` even if the test fails. */
  const disposable = async (n: number, labelPrefix: string, env: Record<string, string> = {}): Promise<{ p: WorkerPool; ws: Worker[] }> => {
    const p = new WorkerPool();
    extra.push(p);
    const ws: Worker[] = [];
    for (let i = 0; i < n; i++) ws.push(await p.spawn(`${labelPrefix}${i}`, target.url as string, env));
    if (!env.MP_DATABASE_URL) await Promise.all(ws.map((w) => w.must('connect')));
    return { p, ws };
  };

  // ==============================================================================================

  it('MP-00 the harness really runs 4 independent Node.js processes, each with its own connection pool, all on the isolated database', async (t) => {
    await traced(async () => {
      const pids = pool.workers.map((w) => w.pid);
      assert.equal(pool.workers.length, 4);
      assert.equal(new Set(pids).size, 4, `four different PIDs: ${pids}`);
      assert.ok(!pids.includes(process.pid), 'none of them is the test process');
      for (const w of pool.workers) {
        assert.ok(isAlive(w.pid), `${label(w)} is alive`);
        const hello = await w.must('ping');
        assert.equal(hello.pid, w.pid, 'the worker reports the PID the OS gave it');
        assert.match(hello.database, /test/i);
      }
      t.diagnostic(`controller pid ${process.pid}; workers ${pool.workers.map(label).join(', ')}; database ${target.dbName}`);
    });
  });

  it('MP-00 harness safety: a worker that never answers is timed out in finite time, and shutdown() really kills every worker process', async () => {
    const p = new WorkerPool();
    extra.push(p);
    const ws = [await p.spawn('hang0-', target.url as string), await p.spawn('hang1-', target.url as string)];
    const pids = ws.map((w) => w.pid);
    assert.ok(pids.every(isAlive));
    const t0 = Date.now();
    await assert.rejects(ws[0].send('hang', {}, 600), /did not answer "hang" within 600 ms/);
    assert.ok(Date.now() - t0 < 3000, 'the timeout is finite and honoured');
    await assert.rejects(p.race(ws, 'hang', () => ({}), { timeoutMs: 600 }), /did not answer|exited/);
    await p.shutdown();
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(pids.every((pid) => !isAlive(pid)), `all worker processes are gone: ${pids}`);
    assert.ok(ws.every((w) => w.exited), 'and the controller knows it');
  });

  it('MP-01 four processes acquire the same, not yet existing period at the same moment -> exactly one owner (10 rounds, release, race again)', async (t) => {
    await traced(async () => {
      const ROUNDS = 10;
      const YEAR = 2031;
      const lines: string[] = [];
      let maxSkew = 0;
      const pidsSeen = new Set<number>();
      let totalWins = 0;

      for (let round = 1; round <= ROUNDS; round++) {
        const month = round; // a different period each round: 1..10
        assert.equal((await dbLock(month, YEAR)).count, 0, `round ${round}: the period has no record yet`);

        // ---- race 1: nobody holds it, the record does not even exist
        const race1 = await pool.race(pool.workers, 'acquire', (w) => ({ month, year: YEAR, owner: w.label, ttlMs: 60_000 }));
        maxSkew = Math.max(maxSkew, race1.startSkewMs);
        race1.replies.forEach((r, i) => {
          assert.ok(r.ok, `round ${round}: ${label(pool.workers[i])} failed: ${r.error?.name}: ${r.error?.message}`);
          assert.equal(r.pid, pool.workers[i].pid, 'the reply comes from the PID of that worker');
          pidsSeen.add(r.pid);
        });
        const wins = race1.replies.map((r, i) => ({ r, w: pool.workers[i] })).filter((x) => x.r.value.status === 'ACQUIRED');
        const losers = race1.replies.map((r, i) => ({ r, w: pool.workers[i] })).filter((x) => x.r.value.status !== 'ACQUIRED');
        assert.equal(wins.length, 1, `round ${round}: exactly one ACQUIRED, got ${race1.replies.map((r) => r.value.status)}`);
        for (const l of losers) {
          assert.equal(l.r.value.status, 'BUSY', `round ${round}: ${label(l.w)} must see BUSY`);
          assert.equal(l.r.value.holder, wins[0].w.label, 'BUSY names the real holder');
          assert.equal(l.r.value.fencingToken, 1);
          assert.equal(l.r.value.handle, undefined, 'a loser holds no handle');
        }
        const won = wins[0].r.value.handle;
        const s1 = await dbLock(month, YEAR);
        assert.equal(s1.count, 1, `round ${round}: one MonthlyLeaderboard record for ${month}/${YEAR}`);
        assert.equal(s1.lockToken, won.lockToken, 'the lock token in MongoDB is the winner\'s');
        assert.equal(s1.fencingToken, 1);
        assert.equal(won.fencingToken, 1);
        assert.equal(s1.lockOwner, wins[0].w.label);
        assert.equal(s1.expired, false);
        assert.ok(s1.remainingMs! > 50_000, `lease is live: ${s1.remainingMs} ms left`);
        assert.equal((await wins[0].w.must('inspect')).state, 'HELD');
        totalWins++;

        // ---- the winner releases: the lock is really free, the fencing token is kept
        const rel = await wins[0].w.must('release');
        assert.deepEqual(rel, { released: true });
        const s2 = await dbLock(month, YEAR);
        assert.equal(s2.count, 1);
        assert.equal(s2.lockToken, null);
        assert.equal(s2.lockOwner, null);
        assert.equal(s2.lockExpiresAt, null);
        assert.equal(s2.fencingToken, 1, 'fencing token is never reset');

        // ---- race 2: all four again on the released period -> exactly one, fencing token 2
        const race2 = await pool.race(pool.workers, 'acquire', (w) => ({ month, year: YEAR, owner: w.label, ttlMs: 60_000 }));
        maxSkew = Math.max(maxSkew, race2.startSkewMs);
        race2.replies.forEach((r, i) => assert.ok(r.ok, `round ${round}/2: ${label(pool.workers[i])}: ${r.error?.message}`));
        const wins2 = race2.replies.map((r, i) => ({ r, w: pool.workers[i] })).filter((x) => x.r.value.status === 'ACQUIRED');
        assert.equal(wins2.length, 1, `round ${round}/2: exactly one ACQUIRED, got ${race2.replies.map((r) => r.value.status)}`);
        assert.equal(race2.replies.filter((r) => r.value.status === 'BUSY').length, 3);
        const won2 = wins2[0].r.value.handle;
        assert.equal(won2.fencingToken, 2, 'second acquisition: fencing token 2');
        const s3 = await dbLock(month, YEAR);
        assert.equal(s3.count, 1);
        assert.equal(s3.lockToken, won2.lockToken);
        assert.equal(s3.fencingToken, 2);
        assert.equal(s3.lockOwner, wins2[0].w.label);
        totalWins++;

        assert.deepEqual(await wins2[0].w.must('release'), { released: true });
        const s4 = await dbLock(month, YEAR);
        assert.equal(s4.lockToken, null);
        assert.equal(s4.fencingToken, 2);

        lines.push(
          `round ${round} (${month}/${YEAR}): race1 winner ${label(wins[0].w)} fencing ${won.fencingToken}, losers ${losers.map((l) => `${l.w.label}:${l.r.value.status}`).join(',')}; ` +
          `race2 winner ${label(wins2[0].w)} fencing ${won2.fencingToken}; start skew ${race1.startSkewMs}/${race2.startSkewMs} ms; db rows 1, lock free, fencing 2`
        );
      }
      lines.forEach((l) => t.diagnostic(l));
      t.diagnostic(`MP-01: ${ROUNDS} rounds x 2 races x 4 processes = ${ROUNDS * 2 * 4} acquire attempts, ${totalWins} winners (one per race); distinct worker PIDs ${[...pidsSeen]}; max start skew ${maxSkew} ms`);
      assert.equal(pidsSeen.size, 4);
      assert.equal(totalWins, ROUNDS * 2);
    });
  });

  it('MP-02 lease expiry and take-over between two processes (MongoDB clock): BUSY while valid, take-over after expiry with a higher fencing token, the old token has no effect', async (t) => {
    await traced(async () => {
      const [A, B] = pool.workers;
      const MONTH = 1;
      const YEAR = 2032;

      // 1-2. A acquires (short lease) and holds it; MongoDB shows A as the owner of a live lease
      const a = await A.must('acquire', { month: MONTH, year: YEAR, owner: 'A', ttlMs: SHORT_TTL });
      assert.equal(a.status, 'ACQUIRED');
      const sA = await dbLock(MONTH, YEAR);
      assert.equal(sA.lockToken, a.handle.lockToken);
      assert.equal(sA.fencingToken, a.handle.fencingToken);
      assert.equal(sA.lockOwner, 'A');
      assert.equal(sA.expired, false, 'MongoDB says: valid');
      assert.ok(sA.remainingMs! > 0 && sA.remainingMs! <= SHORT_TTL, `remaining ${sA.remainingMs} ms (MongoDB clock)`);
      assert.equal((await A.must('inspect')).state, 'HELD');
      const expiryA = (await rawDoc(MONTH, YEAR)).lockExpiresAt.$date;

      // 3-4. A does NOT renew. B tries while MongoDB still says "valid": BUSY, and nothing changes
      const stillValid = await dbLock(MONTH, YEAR);
      assert.equal(stillValid.expired, false);
      const early = await B.must('acquire', { month: MONTH, year: YEAR, owner: 'B', ttlMs: SHORT_TTL, key: 'b' });
      assert.equal(early.status, 'BUSY', 'B must not get a live lease');
      assert.equal(early.holder, 'A');
      assert.equal(early.fencingToken, a.handle.fencingToken);
      assert.deepEqual((await rawDoc(MONTH, YEAR)).lockExpiresAt.$date, expiryA, 'the failed attempt did not touch the lease');
      assert.equal((await dbLock(MONTH, YEAR)).lockToken, a.handle.lockToken);

      // 5. wait until MONGODB says the lease is over (its own clock, polled - not a sleep guessed in the test process)
      const lapsed = await waitUntilMongoSaysExpired(MONTH, YEAR);
      assert.ok(lapsed.serverNow.getTime() > lapsed.lockExpiresAt!.getTime(), `MongoDB now ${lapsed.serverNow.toISOString()} is past lockExpiresAt ${lapsed.lockExpiresAt!.toISOString()}`);
      assert.equal(lapsed.lockToken, a.handle.lockToken, 'still A\'s record: lapsed, but nobody took it over yet');
      assert.equal((await A.must('inspect')).state, 'EXPIRED');

      // 6. B takes over: ACQUIRED, fencing token greater than A's
      const b = await B.must('acquire', { month: MONTH, year: YEAR, owner: 'B', ttlMs: 20_000, key: 'b' });
      assert.equal(b.status, 'ACQUIRED');
      assert.ok(b.handle.fencingToken > a.handle.fencingToken, `fencing ${b.handle.fencingToken} > ${a.handle.fencingToken}`);
      assert.equal(b.handle.fencingToken, a.handle.fencingToken + 1);
      assert.notEqual(b.handle.lockToken, a.handle.lockToken);
      const sB = await dbLock(MONTH, YEAR);
      assert.equal(sB.lockToken, b.handle.lockToken);
      assert.equal(sB.fencingToken, b.handle.fencingToken);
      assert.equal(sB.lockOwner, 'B');
      assert.equal(sB.expired, false);
      assert.equal(sB.count, 1);
      const rawB = await rawDoc(MONTH, YEAR);

      // 7. A (still alive, with its old token) tries to renew and to release: neither may touch B's lock
      const renewA = await A.must('renew');
      assert.deepEqual(renewA, { renewed: false, reason: 'REPLACED' });
      assert.deepEqual(await A.must('release'), { released: false, reason: 'NOT_OWNER' });
      assert.equal((await A.must('inspect')).state, 'REPLACED');
      const afterStale = await rawDoc(MONTH, YEAR);
      assert.deepEqual(afterStale.lockExpiresAt, rawB.lockExpiresAt, 'B\'s lease was not extended or shortened by A');
      assert.equal(afterStale.lockToken, b.handle.lockToken);
      assert.deepEqual(afterStale.fencingToken, rawB.fencingToken);

      // 8. final database state: B is the owner; B can still use its lock normally
      const fin = await dbLock(MONTH, YEAR);
      assert.equal(fin.lockToken, b.handle.lockToken);
      assert.equal(fin.fencingToken, b.handle.fencingToken);
      assert.equal(fin.lockOwner, 'B');
      assert.equal((await B.must('inspect', { key: 'b' })).state, 'HELD');
      assert.equal((await B.must('renew', { key: 'b' })).renewed, true);
      assert.deepEqual(await B.must('release', { key: 'b' }), { released: true });
      assert.equal((await dbLock(MONTH, YEAR)).lockToken, null);

      t.diagnostic(
        `MP-02: A=${label(A)} fencing ${a.handle.fencingToken} -> (B BUSY while MongoDB remaining ${stillValid.remainingMs} ms) -> MongoDB now ${lapsed.serverNow.toISOString()} > expires ${lapsed.lockExpiresAt!.toISOString()} -> ` +
        `B=${label(B)} fencing ${b.handle.fencingToken}; A renew=${JSON.stringify(renewA)}, A release=NOT_OWNER; final owner ${fin.lockOwner}, token ${fin.lockToken?.slice(0, 8)}…, fencing ${fin.fencingToken}`
      );
    });
  });

  // ==============================================================================================

  describe('abnormal situations', () => {
    it('MP-03 a worker dies right after acquiring (SIGKILL, and a self-inflicted abrupt exit): the lease is left behind, nobody else gets in until MongoDB says it lapsed, then exactly one takes over', async (t) => {
      await traced(async () => {
        for (const [i, how] of (['SIGKILL from the controller', 'process.exit inside the worker'] as const).entries()) {
          const MONTH = 3 + i;
          const YEAR = 2033;
          const { p, ws } = await disposable(3, `d${i}-`);
          const [doomed, x, y] = ws;
          const a = await doomed.must('acquire', { month: MONTH, year: YEAR, owner: `doomed-${i}`, ttlMs: SHORT_TTL });
          assert.equal(a.status, 'ACQUIRED');
          const doomedPid = doomed.pid;

          if (i === 0) await p.kill(doomed);
          else await assert.rejects(doomed.send('die'), /exited/);
          await new Promise((r) => setTimeout(r, 100));
          assert.ok(doomed.exited, 'the worker is gone');
          assert.equal(isAlive(doomedPid), false, `pid ${doomedPid} no longer exists`);

          // the dead owner's lock is still in MongoDB and still valid
          const left = await dbLock(MONTH, YEAR);
          assert.equal(left.lockToken, a.handle.lockToken, 'the dead worker\'s lock is still recorded');
          assert.equal(left.expired, false);
          const busy = await x.must('acquire', { month: MONTH, year: YEAR, owner: 'x', ttlMs: SHORT_TTL });
          assert.equal(busy.status, 'BUSY', 'a live lease of a dead owner is respected until it lapses');
          assert.equal(busy.holder, `doomed-${i}`);

          const lapsed = await waitUntilMongoSaysExpired(MONTH, YEAR);
          assert.ok(lapsed.serverNow.getTime() > lapsed.lockExpiresAt!.getTime());
          const race = await p.race([x, y], 'acquire', (w) => ({ month: MONTH, year: YEAR, owner: w.label, ttlMs: 20_000 }));
          const winners = race.replies.filter((r) => r.ok && r.value.status === 'ACQUIRED');
          assert.equal(winners.length, 1, `exactly one survivor takes over (${race.replies.map((r) => r.ok ? r.value.status : r.error?.name)})`);
          assert.equal(winners[0].value.handle.fencingToken, a.handle.fencingToken + 1);
          const fin = await dbLock(MONTH, YEAR);
          assert.equal(fin.lockToken, winners[0].value.handle.lockToken);
          assert.equal(fin.fencingToken, a.handle.fencingToken + 1);
          t.diagnostic(`MP-03 [${how}]: pid ${doomedPid} died holding fencing ${a.handle.fencingToken}; survivors ${x.pid}/${y.pid} got BUSY until MongoDB expired it; winner pid ${winners[0].pid} fencing ${fin.fencingToken}`);
          await p.shutdown();
        }
      }, [pool, ...extra]);
    });

    it('MP-04 two processes release at the same moment: with a duplicated handle exactly one release succeeds; after a take-over the stale owner\'s release has no effect on the new owner\'s', async (t) => {
      await traced(async () => {
        const [A, B] = pool.workers;

        // (a) one lock, two processes holding a copy of the same handle, both release simultaneously
        const a = await A.must('acquire', { month: 5, year: 2033, owner: 'A', ttlMs: 30_000 });
        await B.must('adopt', { handle: a.handle });
        const same = await pool.race([A, B], 'release', () => ({}));
        const outcomes = same.replies.map((r) => (r.ok ? (r.value.released ? 'released' : r.value.reason) : `error ${r.error?.name}`)).sort();
        assert.deepEqual(outcomes, ['NOT_OWNER', 'released'], `exactly one release wins: ${outcomes}`);
        const sa = await dbLock(5, 2033);
        assert.equal(sa.lockToken, null);
        assert.equal(sa.fencingToken, a.handle.fencingToken, 'releasing does not move the fencing token');
        assert.equal(sa.count, 1);

        // (b) A is superseded by B (after expiry); A's release and B's release arrive together
        const a2 = await A.must('acquire', { month: 6, year: 2033, owner: 'A', ttlMs: SHORT_TTL });
        await waitUntilMongoSaysExpired(6, 2033);
        const b2 = await B.must('acquire', { month: 6, year: 2033, owner: 'B', ttlMs: 30_000 });
        assert.equal(b2.status, 'ACQUIRED');
        assert.equal(b2.handle.fencingToken, a2.handle.fencingToken + 1);
        const both = await pool.race([A, B], 'release', () => ({}));
        assert.deepEqual(both.replies[0].value, { released: false, reason: 'NOT_OWNER' }, 'the stale owner\'s release does nothing');
        assert.deepEqual(both.replies[1].value, { released: true }, 'the current owner\'s release works');
        const sb = await dbLock(6, 2033);
        assert.equal(sb.lockToken, null);
        assert.equal(sb.fencingToken, b2.handle.fencingToken);
        t.diagnostic(`MP-04: (a) duplicated handle ${label(A)} & ${label(B)} -> ${outcomes.join(' + ')}; (b) stale ${label(A)} NOT_OWNER, owner ${label(B)} released; fencing kept at ${sb.fencingToken}`);
      });
    });

    it('MP-05 four processes race for a period whose lease has lapsed -> exactly one takes over, fencing token +1 exactly once', async (t) => {
      await traced(async () => {
        const MONTH = 7;
        const YEAR = 2033;
        const [A] = pool.workers;
        const a = await A.must('acquire', { month: MONTH, year: YEAR, owner: 'A', ttlMs: SHORT_TTL }); // A is alive but never renews
        const lapsed = await waitUntilMongoSaysExpired(MONTH, YEAR);
        assert.equal(lapsed.lockToken, a.handle.lockToken);

        for (let attempt = 0; attempt < 1; attempt++) {
          const race = await pool.race(pool.workers, 'acquire', (w) => ({ month: MONTH, year: YEAR, owner: w.label, ttlMs: 20_000, key: 'again' }));
          race.replies.forEach((r, i) => assert.ok(r.ok, `${label(pool.workers[i])}: ${r.error?.message}`));
          const wins = race.replies.map((r, i) => ({ r, w: pool.workers[i] })).filter((x) => x.r.value.status === 'ACQUIRED');
          assert.equal(wins.length, 1, `exactly one ACQUIRED among 4 processes, got ${race.replies.map((r) => r.value.status)}`);
          assert.equal(wins[0].r.value.handle.fencingToken, a.handle.fencingToken + 1, 'fencing +1, once');
          assert.equal(race.replies.filter((r) => r.value.status === 'BUSY').length, 3);
          const fin = await dbLock(MONTH, YEAR);
          assert.equal(fin.count, 1);
          assert.equal(fin.lockToken, wins[0].r.value.handle.lockToken);
          assert.equal(fin.fencingToken, a.handle.fencingToken + 1);
          // the previous holder's handle is dead whoever won
          assert.deepEqual(await A.must('renew', { key: 'h' }), { renewed: false, reason: 'REPLACED' });
          t.diagnostic(`MP-05: ${label(wins[0].w)} won after expiry, fencing ${a.handle.fencingToken} -> ${fin.fencingToken}; start skew ${race.startSkewMs} ms; stale A renew REPLACED`);
          assert.deepEqual(await wins[0].w.must('release', { key: 'again' }), { released: true });
        }
      });
    });

    it('MP-06 database failures are never reported as success: a worker that cannot reach MongoDB, and a worker whose connection breaks while it holds a lock', async (t) => {
      await traced(async () => {
        // (a) a whole process that cannot reach the database
        const { p: deadPool, ws: [dead] } = await disposable(1, 'dead-', { MP_DATABASE_URL: DEAD_DB });
        const r = await dead.send('acquire', { month: 8, year: 2033, owner: 'dead', ttlMs: SHORT_TTL }, 30_000);
        assert.equal(r.ok, false, 'no ACQUIRED / BUSY / FINALIZED for a database that is not there');
        assert.equal(r.error?.name, 'LockStoreError', `${r.error?.name}: ${r.error?.message}`);
        assert.equal((await dbLock(8, 2033)).count, 0, 'and nothing was created');
        assert.ok(deadPool.events.some((e) => e.step === 'ready'));

        // (b) a healthy worker holds a lock, then its database connection "breaks"
        const [W, other] = pool.workers;
        const a = await W.must('acquire', { month: 9, year: 2033, owner: 'W', ttlMs: 10_000 });
        const before = await rawDoc(9, 2033);
        try {
          await W.must('useDatabase', { url: DEAD_DB });
          for (const cmd of ['renew', 'release', 'inspect']) {
            const e = await W.send(cmd, {}, 30_000);
            assert.equal(e.ok, false, `${cmd} must not report success while the database is unreachable`);
            assert.equal(e.error?.name, 'LockStoreError', `${cmd}: ${e.error?.name}`);
          }
          const during = await rawDoc(9, 2033);
          assert.deepEqual(during.lockExpiresAt, before.lockExpiresAt, 'the lease was not extended by a "renew" that never reached MongoDB');
          assert.equal(during.lockToken, a.handle.lockToken, 'and not released by a release that never reached MongoDB');
          const busy = await other.must('acquire', { month: 9, year: 2033, owner: 'other', ttlMs: SHORT_TTL, key: 'o' });
          assert.equal(busy.status, 'BUSY', 'meanwhile the lock is still held by worker W');
        } finally {
          await W.send('useDatabase', { url: 'default' }); // never leave a shared worker on the dead database, whatever happened above
        }
        assert.equal((await W.must('renew')).renewed, true, 'the connection is back: W still owns its lock');
        assert.deepEqual(await W.must('release'), { released: true });
        t.diagnostic(`MP-06: dead-DB worker pid ${dead.pid} -> ${r.error?.name}; ${label(W)} renew/release/inspect on a broken connection -> LockStoreError x3, lease untouched, lock still W's until it released after reconnecting`);
      }, [pool, ...extra]);
    });

    it('MP-07 records written before the lock existed (missing lockToken / lockExpiresAt / fencingToken): four processes race, exactly one wins, the other fields survive; a live lease on such a record is respected', async (t) => {
      await traced(async () => {
        const YEAR = 2034;
        const base = (month: number) => ({
          month, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 5, totalPointsAwarded: 0, policyVersion: '1.0', finalizedBy: 'old-run',
          createdAt: { $date: '2026-01-01T00:00:00.000Z' }, updatedAt: { $date: '2026-01-02T00:00:00.000Z' },
        });
        const past = { $date: new Date(Date.now() - 60_000).toISOString() };
        const future = { $date: new Date(Date.now() + 120_000).toISOString() };
        const variants: Array<{ name: string; month: number; extra: Record<string, unknown>; expectedFencing: number | null }> = [
          { name: 'none of the lock fields', month: 1, extra: {}, expectedFencing: 1 },
          { name: 'lockToken only (no lockExpiresAt, no fencingToken)', month: 2, extra: { lockToken: 'ancient' }, expectedFencing: 1 },
          { name: 'lapsed lease, no fencingToken', month: 3, extra: { lockToken: 'ancient', lockOwner: 'old', lockExpiresAt: past }, expectedFencing: 1 },
          { name: 'released (explicit nulls) with fencingToken 7', month: 4, extra: { lockToken: null, lockOwner: null, lockExpiresAt: null, fencingToken: 7 }, expectedFencing: 8 },
          { name: 'LIVE lease without fencingToken', month: 5, extra: { lockToken: 'someone-alive', lockOwner: 'old-owner', lockExpiresAt: future }, expectedFencing: null },
        ];
        for (const v of variants) {
          await insertRaw({ ...base(v.month), ...v.extra });
          const before = await rawDoc(v.month, YEAR);
          const race = await pool.race(pool.workers, 'acquire', (w) => ({ month: v.month, year: YEAR, owner: w.label, ttlMs: 20_000 }));
          race.replies.forEach((r, i) => assert.ok(r.ok, `[${v.name}] ${label(pool.workers[i])}: ${r.error?.name}: ${r.error?.message}`));
          const wins = race.replies.map((r, i) => ({ r, w: pool.workers[i] })).filter((x) => x.r.value.status === 'ACQUIRED');
          const after = await rawDoc(v.month, YEAR);
          const s = await dbLock(v.month, YEAR);
          assert.equal(s.count, 1, `[${v.name}] still one record`);
          if (v.expectedFencing === null) {
            assert.equal(wins.length, 0, `[${v.name}] nobody may take a live lease`);
            assert.ok(race.replies.every((r) => r.value.status === 'BUSY'));
            assert.deepEqual(after, before, `[${v.name}] the record is byte-identical`);
          } else {
            assert.equal(wins.length, 1, `[${v.name}] exactly one winner, got ${race.replies.map((r) => r.value.status)}`);
            assert.equal(wins[0].r.value.handle.fencingToken, v.expectedFencing);
            assert.equal(s.lockToken, wins[0].r.value.handle.lockToken);
            assert.equal(s.fencingToken, v.expectedFencing);
            for (const f of ['status', 'totalParticipants', 'totalPointsAwarded', 'policyVersion', 'finalizedBy', 'createdAt']) {
              assert.deepEqual(after[f], before[f], `[${v.name}] legacy field ${f} survived`);
            }
            await wins[0].w.must('release');
          }
          t.diagnostic(`MP-07 [${v.name}]: ${v.expectedFencing === null ? 'all 4 BUSY, record untouched' : `winner ${label(wins[0].w)} fencing ${s.fencingToken}`}`);
        }
      });
    });

    it('MP-08 a FINALIZED period cannot be acquired by any process, however many try; the record does not change by a single byte', async (t) => {
      await traced(async () => {
        const MONTH = 11;
        const YEAR = 2034;
        await insertRaw({
          month: MONTH, year: YEAR, status: 'FINALIZED', totalParticipants: 4, totalPointsAwarded: 2400, policyVersion: '1.1', finalizedBy: 'earlier',
          lockToken: 'old-token', lockOwner: 'old-owner', lockExpiresAt: { $date: new Date(Date.now() - 600_000).toISOString() }, fencingToken: 3,
          createdAt: { $date: '2026-01-01T00:00:00.000Z' }, updatedAt: { $date: '2026-01-02T00:00:00.000Z' },
        });
        const before = JSON.stringify(await rawDoc(MONTH, YEAR));
        for (let round = 0; round < 3; round++) {
          const race = await pool.race(pool.workers, 'acquire', (w) => ({ month: MONTH, year: YEAR, owner: w.label, ttlMs: 20_000 }));
          race.replies.forEach((r, i) => {
            assert.ok(r.ok, `${label(pool.workers[i])}: ${r.error?.message}`);
            assert.deepEqual({ status: r.value.status }, { status: 'FINALIZED' }, `${label(pool.workers[i])} must be refused`);
          });
        }
        assert.equal(JSON.stringify(await rawDoc(MONTH, YEAR)), before, 'the FINALIZED record is byte-identical');
        assert.equal((await dbLock(MONTH, YEAR)).count, 1);
        t.diagnostic(`MP-08: 3 races x 4 processes (${pool.workers.map((w) => w.pid)}) -> 12 x FINALIZED, record unchanged`);
      });
    });
  });
});
