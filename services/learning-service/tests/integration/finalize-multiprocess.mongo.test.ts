/**
 * FIX 06C-2: the REAL monthly finalization (LeaderboardService.finalizeMonth) between several independent Node.js PROCESSES.
 *
 * Every worker is a separate OS process (child_process.fork: own PID, own PrismaClient pools, own lock service) that calls the production
 * function `LeaderboardService.finalizeMonth` - nothing is re-implemented in the test. The only HTTP a worker may make goes to a loopback
 * stub of the User Service run by this file (everything else, including the real User Service port, is blocked inside the worker).
 * The test controls WHERE a worker stops with named barrier points placed from the worker side (tests/helpers/mp/finalize-worker.ts);
 * the product code is not modified and exposes no pause API.
 *
 * Conclusions are read from MongoDB itself: full-collection fingerprints, MongoDB's own clock for lease expiry, and the replica set's oplog
 * (every write, in order, with MongoDB's wall-clock time) for "nothing was written after ..." and for the exact status transitions.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" npm test
 * Own database (`<name>_mpf`), created with `prisma db push`, dropped afterwards. Workers refuse any database whose name lacks "test".
 *
 * What this file does NOT claim: notifications stay AT-LEAST-ONCE (a process that dies after the User Service accepted a request but before
 * the outcome was recorded would send it again); exhaustive crash recovery and notification races are a separate step.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { resolveTestDb } from '../helpers/test-db-url';
import { FINALIZE_WORKER, Worker, WorkerPool } from '../helpers/mp/harness';
import { Evidence, OplogWrite } from '../helpers/mp/evidence';
import { StubUserService } from '../helpers/mp/stub-user-service';

const target = resolveTestDb('mpf');
const MONTH = 9;
const YEAR = 2026;

// ---- deterministic data set (stable ids) ---------------------------------------------------------------------------------------
const oid = (n: number) => n.toString(16).padStart(24, '0');
const E1 = oid(0xe1), E2 = oid(0xe2), E3 = oid(0xe3), E4 = oid(0xe4), E5 = oid(0xe5);
const X_INACTIVE = oid(0xa1);      // 45 points, account deactivated  -> must not compete
const I_INSTRUCTOR = oid(0xb1);    // 60 points, role INSTRUCTOR      -> must not compete
const ELIGIBLE = [E1, E2, E3, E4, E5];
// E1 and E2 finish 500 ms apart with identical points / courses / quiz average: a tie (rank 1, 1), then E3 is rank 3
const EXPECTED_RANK: Record<string, number> = { [E1]: 1, [E2]: 1, [E3]: 3, [E4]: 4, [E5]: 5 };
const EXPECTED_REWARD: Record<string, number> = { [E1]: 1000, [E2]: 1000, [E3]: 500, [E4]: 200, [E5]: 200 };
const EXPECTED_TOTAL = 2900;
const ALLOWED_NEXT: Record<string, string[]> = {
  ACTIVE: ['SNAPSHOT_BUILDING'],
  SNAPSHOT_BUILDING: ['SNAPSHOT_FROZEN'],
  SNAPSHOT_FROZEN: ['REWARDING'],
  REWARDING: ['FINALIZED'],
};

describe('REAL MULTI-PROCESS: finalizeMonth between independent Node.js processes', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run', timeout: 900_000 }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let admin: any;
  let localDb: any;
  let ev: Evidence;
  let stub: StubUserService;
  const pools: WorkerPool[] = [];
  let baseline = '';

  const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  const seed = async (month = MONTH, year = YEAR) => {
    const rows: Array<[string, number, string]> = [
      [E1, 50, '2026-09-05T10:00:00.000Z'], [E2, 50, '2026-09-05T10:00:00.500Z'], [E3, 40, '2026-09-06T10:00:00.000Z'],
      [E4, 30, '2026-09-07T10:00:00.000Z'], [E5, 20, '2026-09-08T10:00:00.000Z'],
      [X_INACTIVE, 45, '2026-09-09T10:00:00.000Z'], [I_INSTRUCTOR, 60, '2026-09-10T10:00:00.000Z'],
    ];
    for (const [i, [userId, points, at]] of rows.entries()) {
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
  };
  const world = async () => { await ev.reset(); stub.reset(); await seed(); };

  const spawnFinalizers = async (labels: string[], lock = { ttlMs: 1500, heartbeatMs: 500 }): Promise<{ pool: WorkerPool; ws: Worker[] }> => {
    const pool = new WorkerPool();
    pools.push(pool);
    const ws: Worker[] = [];
    for (const l of labels) {
      ws.push(await pool.spawn(l, target.url as string, { MP_STUB_URL: stub.url, MP_LOCK_TTL_MS: String(lock.ttlMs), MP_LOCK_HB_MS: String(lock.heartbeatMs) }, FINALIZE_WORKER));
    }
    await Promise.all(ws.map((w) => w.must('connect')));
    return { pool, ws };
  };

  const traced = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) {
      e.message += `\n--- worker events (latest) ---\n${pools.map((p) => p.dump(80)).join('\n')}\n--- stub requests ---\n${stub.requests.slice(-20).map((r) => `${r.kind} ${r.worker} openTx=${r.openTx} ${r.userId || ''}`).join('\n')}`;
      throw e;
    }
  };

  // ---- assertions on the data in MongoDB ----------------------------------------------------------------------------------------
  /** Everything a correctly finalized period must look like, read from MongoDB. Returns the entries (with ids) for later comparison. */
  const assertFinalizedCorrectly = async (label: string) => {
    const periods = await admin.monthlyLeaderboard.findMany({ where: { month: MONTH, year: YEAR } });
    assert.equal(periods.length, 1, `${label}: exactly one MonthlyLeaderboard for ${MONTH}/${YEAR}`);
    const period = periods[0];
    assert.equal(period.status, 'FINALIZED', `${label}: FINALIZED`);
    assert.ok(period.finalizedAt, `${label}: finalizedAt set`);
    assert.equal(period.lockToken, null, `${label}: lock released`);

    const entries = await admin.leaderboardEntry.findMany({ where: { leaderboardId: period.id }, orderBy: { rank: 'asc' } });
    assert.equal(entries.length, 5, `${label}: five entries - no entry lost, none created twice`);
    assert.deepEqual(entries.map((e: any) => e.userId).sort(), [...ELIGIBLE].sort(), `${label}: only the eligible students are ranked`);
    for (const e of entries) {
      assert.equal(e.rank, EXPECTED_RANK[e.userId], `${label}: rank of ${e.userId.slice(-2)}`);
      assert.equal(e.isTie, e.userId === E1 || e.userId === E2, `${label}: tie flag of ${e.userId.slice(-2)}`);
      assert.equal(e.rewardPoints, EXPECTED_REWARD[e.userId]);
    }
    assert.equal(period.totalParticipants, 5);

    const ledger = await admin.rewardPointTransaction.findMany({ where: { type: 'LEADERBOARD_REWARD' } });
    assert.equal(ledger.length, 5, `${label}: one reward ledger entry per rewarded student - none duplicated`);
    assert.equal(new Set(ledger.map((t: any) => t.idempotencyKey)).size, 5, `${label}: distinct idempotency keys`);
    for (const t of ledger) {
      assert.equal(t.amount, EXPECTED_REWARD[t.userId]);
      assert.equal(t.sourceId, period.id);
    }
    const ledgerSum = ledger.reduce((s: number, t: any) => s + t.amount, 0);
    assert.equal(ledgerSum, EXPECTED_TOTAL);
    assert.equal(period.totalPointsAwarded, ledgerSum, `${label}: totalPointsAwarded equals the verified ledger`);

    const wallets = await admin.userRewardPoint.findMany({});
    assert.equal(wallets.length, 5);
    for (const w of wallets) {
      assert.equal(w.balance, EXPECTED_REWARD[w.userId], `${label}: wallet of ${w.userId.slice(-2)} credited once`);
      assert.equal(w.totalEarned, EXPECTED_REWARD[w.userId]);
    }
    const badges = await admin.badge.findMany({ where: { badgeType: 'LEADERBOARD_REWARD' } });
    assert.equal(badges.length, 5, `${label}: one badge per rewarded student - none duplicated`);
    for (const e of entries) {
      const b = badges.find((x: any) => x.userId === e.userId);
      assert.ok(b && e.rewardBadgeId === b.id, `${label}: entry of ${e.userId.slice(-2)} links its badge`);
    }
    return { period, entries };
  };

  const assertLegalTransitions = (seq: string[], label: string) => {
    for (let i = 1; i < seq.length; i++) {
      assert.ok((ALLOWED_NEXT[seq[i - 1]] || []).includes(seq[i]), `${label}: illegal status transition ${seq[i - 1]} -> ${seq[i]} (sequence ${seq.join(' > ')})`);
    }
  };
  const writesTo = (ws: OplogWrite[], coll: string, op?: string) => ws.filter((w) => w.coll === coll && (!op || w.op === op));

  /** No HTTP request of any worker was made while that worker had a MongoDB transaction open. */
  const assertNoHttpInsideTransaction = (label: string) => {
    assert.ok(stub.requests.length > 0, `${label}: the stub saw requests`);
    for (const r of stub.requests) assert.equal(r.openTx, 0, `${label}: ${r.kind} request from ${r.worker} was made with ${r.openTx} transaction(s) open`);
  };

  // ---- the S3 scenario with two real processes ---------------------------------------------------------------------------------
  interface S3 {
    pids: { controller: number; A: number; B: number };
    paused: any; lapsed: any; stateBeforeB: any; bResult: any; aResult: any;
    fpAfterB: string; fpAfterA: string; entryIdsAfterB: string[];
    writesAfterResume: OplogWrite[]; writesAll: OplogWrite[];
    aState: any; aMarkAtPause: any; stubAtBFinish: number; stubAfterA: number; aRequestsAfterPause: number;
    takeoverWall: Date | null; finalizedWall: Date | null; resumedAt: number; pausedAt: number; timeline: string;
  }
  const runS3 = async (freezeLocalClock: boolean): Promise<S3> => {
    await world();
    const { pool: s3pool, ws: [A, B] } = await spawnFinalizers(['A', 'B']);
    const marker0 = await ev.oplogMarker();

    // A: the real finalizeMonth, parked right before the snapshot transaction (delete + create entries)
    await A.must('armPause', { point: 'BEFORE_SNAPSHOT_TX' });
    const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 180_000);
    aRun.catch(() => undefined);
    const paused = await A.waitEvent('paused', (e) => e.detail.point === 'BEFORE_SNAPSHOT_TX', 60_000);
    const pausedAt = paused.at;
    assert.equal(paused.detail.assertAliveOk, true, 'A passed the ownership check that precedes the snapshot transaction');
    assert.equal(paused.detail.openTx, 0, 'A holds no MongoDB transaction while parked');
    const stateBeforeB = await ev.lock(MONTH, YEAR);
    assert.equal(stateBeforeB.status, 'SNAPSHOT_BUILDING');
    assert.equal(stateBeforeB.fencingToken, 1);
    assert.match(stateBeforeB.lockOwner || '', /^A @/);
    assert.equal((await admin.leaderboardEntry.count({})), 0, 'no entry exists yet');
    assert.equal((await admin.rewardPointTransaction.count({})), 0, 'nothing is paid yet');

    // A is "stalled": heartbeat stopped (lock NOT released, no transaction open), local clock frozen if requested
    await A.must('stopHeartbeat');
    if (freezeLocalClock) await A.must('freezeLocalClock');
    const aMarkAtPause = await A.must('mark');
    const lapsed = await ev.waitUntilMongoSaysExpired(MONTH, YEAR);

    // B: the real finalizeMonth takes over and completes the period
    const bRun = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000);
    const fpAfterB = await ev.fingerprint();
    const entryIdsAfterB = (await ev.raw('leaderboard_entries')).map((e) => e._id.$oid);
    const markerB = await ev.oplogMarker();
    const stubAtBFinish = stub.requests.length;
    const aRequestsAtPause = stub.of('eligibility', 'A').length + stub.of('notification', 'A').length;

    // A resumes from exactly where it was parked, with its old LockContext
    const resumedAt = Date.now();
    await A.must('resume', { point: 'BEFORE_SNAPSHOT_TX' });
    const aResult = (await aRun).value;
    const fpAfterA = await ev.fingerprint();
    const writesAfterResume = await ev.writesSince(markerB);
    const writesAll = await ev.writesSince(marker0);
    const aState = await A.must('state', { since: aMarkAtPause });

    const takeover = writesAll.find((w) => w.coll === 'monthly_leaderboards' && w.periodAfter && Number(w.periodAfter.fencingToken) === 2);
    const finalized = writesAll.find((w) => w.coll === 'monthly_leaderboards' && w.periodAfter?.status === 'FINALIZED');
    return {
      pids: { controller: process.pid, A: A.pid, B: B.pid }, paused, lapsed, stateBeforeB, bResult: bRun, aResult, fpAfterB, fpAfterA, entryIdsAfterB,
      writesAfterResume, writesAll, aState, aMarkAtPause, stubAtBFinish, stubAfterA: stub.requests.length,
      aRequestsAfterPause: stub.of('eligibility', 'A').length + stub.of('notification', 'A').length - aRequestsAtPause,
      takeoverWall: takeover?.wall ?? null, finalizedWall: finalized?.wall ?? null, resumedAt, pausedAt,
      // the workers' own progress log: which process called what in the production flow (HTTP calls summarised)
      timeline: s3pool.events
        .filter((e) => !['http', 'ready', 'armed', 'fire'].includes(e.step) || e.step === 'http')
        .map((e) => `${new Date(e.at).toISOString().slice(11, 23)} ${e.worker}(pid ${e.pid}) ${e.step}${e.step === 'http' ? ` ${e.detail.path} openTx=${e.detail.openTx}` : ` ${JSON.stringify(e.detail)}`}`)
        .join('\n'),
    };
  };

  before(async () => {
    process.env.DATABASE_URL = target.url;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: target.url }, stdio: 'pipe' });
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient();
    const localUrl = (target.url as string).replace(/\/[^/?]+\?/, '/local?');
    localDb = new PrismaClient({ datasources: { db: { url: localUrl } } });
    ev = new Evidence(admin, localDb, target.dbName);
    stub = new StubUserService();
    await stub.start();

    // the reference outcome: ONE process, an ordinary run, same data
    await world();
    const { pool, ws: [N] } = await spawnFinalizers(['N'], { ttlMs: 3000, heartbeatMs: 1000 });
    const r = await N.must('finalize', { month: MONTH, year: YEAR, by: 'N' }, 120_000);
    assert.equal(r.outcome, 'resolved');
    assert.equal(r.result.status, 'FINALIZED');
    await assertFinalizedCorrectly('baseline');
    baseline = await ev.summary(MONTH, YEAR);
    await pool.shutdown();
  });

  after(async () => {
    for (const p of pools) await p.shutdown();
    await stub?.stop().catch(() => undefined);
    try { await admin.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
    await localDb?.$disconnect();
  });

  beforeEach(async () => { await world(); });

  // ==============================================================================================

  it('MP-FINALIZE-00 the workers are separate processes running the production finalizeMonth, and can only reach the loopback stub', async (t) => {
    await traced(async () => {
      const { ws: [A, B] } = await spawnFinalizers(['A', 'B']);
      assert.notEqual(A.pid, B.pid);
      assert.ok(![A.pid, B.pid].includes(process.pid));
      assert.ok(isAlive(A.pid) && isAlive(B.pid));
      const ping = await A.must('ping');
      assert.equal(ping.pid, A.pid);
      assert.match(ping.stub, /^127\.0\.0\.1:\d+$/);
      // the worker refuses to reach anything but the stub - checked without sending anything to a real service
      const net = await A.must('probeNetwork');
      assert.equal(net.userServiceUrl, stub.url, 'the product code is pointed at the stub (its default would be the real User Service on :3002)');
      assert.deepEqual(net.decision, { stub: true, realUserServicePort3002: false, localhost3002: false, anotherLoopbackPort: false, external: false });
      for (const k of ['http', 'httpExternal', 'https', 'fetch']) assert.equal(net[k].blocked, true, `${k} is blocked inside the worker`);
      t.diagnostic(`controller pid ${process.pid}; A=pid ${A.pid}, B=pid ${B.pid}; stub ${stub.url}; database ${target.dbName}`);
    });
  });

  it('MP-FINALIZE-01 two processes call finalizeMonth at the same moment (4 rounds): one owner, no duplicate snapshot / ledger / badge, correct totals', async (t) => {
    await traced(async () => {
      const { pool, ws: [A, B] } = await spawnFinalizers(['A', 'B'], { ttlMs: 3000, heartbeatMs: 1000 });
      const ROUNDS = 4;
      const lines: string[] = [];
      for (let round = 1; round <= ROUNDS; round++) {
        await world();
        const marker = await ev.oplogMarker();
        const race = await pool.race([A, B], 'finalize', (w) => ({ month: MONTH, year: YEAR, by: w.label }), { leadMs: 300, timeoutMs: 120_000 });
        const outcomes = race.replies.map((r, i) => {
          assert.ok(r.ok, `round ${round}: ${[A, B][i].label}: ${r.error?.message}`);
          assert.equal(r.value.outcome, 'resolved', `round ${round}: ${[A, B][i].label} rejected: ${JSON.stringify(r.value.error)}`);
          return { w: [A, B][i], status: r.value.result.status as string, pid: r.pid };
        });
        const winners = outcomes.filter((o) => o.status === 'FINALIZED');
        const others = outcomes.filter((o) => o.status !== 'FINALIZED');
        assert.equal(winners.length, 1, `round ${round}: exactly one process finalized it: ${outcomes.map((o) => `${o.w.label}:${o.status}`)}`);
        assert.ok(others.every((o) => o.status === 'BUSY' || o.status === 'ALREADY_FINALIZED'), `round ${round}: the other process saw BUSY or ALREADY_FINALIZED, got ${others.map((o) => o.status)}`);

        const { period } = await assertFinalizedCorrectly(`round ${round}`);
        const lock = await ev.lock(MONTH, YEAR);
        assert.equal(lock.fencingToken, 1, `round ${round}: one single successful acquisition`);
        assert.equal(period.finalizedBy, winners[0].w.label, `round ${round}: the recorded initiator is the winner`);
        assert.equal(await ev.summary(MONTH, YEAR), baseline, `round ${round}: same business result as a single-process run`);

        const writes = await ev.writesSince(marker);
        assert.equal(writesTo(writes, 'leaderboard_entries', 'i').length, 5, `round ${round}: the snapshot was written exactly once`);
        assert.equal(writesTo(writes, 'leaderboard_entries', 'd').length, 0, `round ${round}: no entry was ever deleted`);
        assert.equal(writesTo(writes, 'reward_point_transactions', 'i').length, 5);
        assert.equal(writesTo(writes, 'badges', 'i').length, 5);
        const seq = Evidence.statusSequence(writes);
        assert.deepEqual(seq, ['ACTIVE', 'SNAPSHOT_BUILDING', 'SNAPSHOT_FROZEN', 'REWARDING', 'FINALIZED'], `round ${round}: status path`);
        assertLegalTransitions(seq, `round ${round}`);
        const finalizedAt = writes.findIndex((w) => w.coll === 'monthly_leaderboards' && w.periodAfter?.status === 'FINALIZED');
        assert.equal(Evidence.businessWrites(writes.slice(finalizedAt + 1)).filter((w) => w.coll !== 'leaderboard_entries').length, 0, `round ${round}: after FINALIZED nothing but lock release was written`);

        const notifications = stub.of('notification');
        assert.equal(notifications.length, 5, `round ${round}: five notifications - one per rewarded student`);
        assert.equal(new Set(notifications.map((n) => n.userId)).size, 5);
        assert.equal(new Set(notifications.map((n) => n.worker)).size, 1, `round ${round}: all sent by the owner`);
        assert.equal(notifications[0].worker, winners[0].w.label);
        assertNoHttpInsideTransaction(`round ${round}`);
        lines.push(`round ${round}: winner ${winners[0].w.label}/pid ${winners[0].pid} FINALIZED, other ${others[0].w.label}/pid ${others[0].pid} ${others[0].status}; start skew ${race.startSkewMs} ms; fencing 1; status path ${seq.join('>')}; 5 entries, 5 ledger, 5 badges, total ${period.totalPointsAwarded}`);
        stub.requests = [];
      }
      lines.forEach((l) => t.diagnostic(l));
    });
  });

  it('MP-FINALIZE-02 FIX 06A scenario S3 with two real processes: A stalls before the snapshot transaction, B takes over and FINALIZES, A resumes -> A cannot delete, recreate or change anything', async (t) => {
    await traced(async () => {
      const s = await runS3(true);

      // --- preconditions that make the test meaningful
      assert.equal(new Set([s.pids.controller, s.pids.A, s.pids.B]).size, 3, 'three different PIDs');
      assert.equal(s.paused.detail.point, 'BEFORE_SNAPSHOT_TX');
      assert.ok(s.lapsed.serverNow.getTime() > s.lapsed.lockExpiresAt.getTime(), `MongoDB's own clock (${s.lapsed.serverNow.toISOString()}) is past the lease end (${s.lapsed.lockExpiresAt.toISOString()})`);
      assert.equal(s.lapsed.lockToken, s.stateBeforeB.lockToken, 'still A\'s record: lapsed, not replaced yet');

      // --- B did the whole job through the production flow
      assert.equal(s.bResult.outcome, 'resolved');
      assert.equal(s.bResult.result.status, 'FINALIZED');
      const { period } = await assertFinalizedCorrectly('after B and A');
      assert.equal(period.fencingToken, 2, 'B holds the second lock generation (A had 1)');
      assert.equal(period.finalizedBy, 'B');
      assert.equal(await ev.summary(MONTH, YEAR), baseline);

      // --- A resumed with its old LockContext and was stopped
      assert.equal(s.aResult.outcome, 'resolved', 'A returned (not crashed)');
      assert.equal(s.aResult.result.status, 'ALREADY_FINALIZED', 'A reports the period as already final: it did not claim to have finalized it');
      const refusals = s.aState.fenceLog.filter((f: any) => !f.ok);
      assert.equal(refusals.length, 1, 'exactly one refused fence after resuming');
      assert.deepEqual({ reason: refusals[0].reason, fencingToken: refusals[0].fencingToken }, { reason: 'FINALIZED', fencingToken: 1 }, 'the DATABASE fence of the snapshot transaction refused A (old fencing token 1)');
      assert.equal(s.aState.fenceLog.filter((f: any) => f.ok).length, 0, 'A\'s fence never succeeded after the pause');
      assert.deepEqual(s.aState.transitions.filter((x: any) => x.at > s.pausedAt), [], 'A made no status transition after the pause');

      // --- the data: nothing changed by one byte
      assert.equal(s.fpAfterA, s.fpAfterB, 'fingerprint of every collection after A finished == right after B FINALIZED');
      const idsNow = (await ev.raw('leaderboard_entries')).map((e) => e._id.$oid);
      assert.deepEqual(idsNow, s.entryIdsAfterB, 'same entry ids');
      assert.deepEqual(s.writesAfterResume, [], 'MongoDB\'s oplog: NOT ONE write to the database between B finishing and A ending');

      // --- the oplog tells the whole story
      assert.equal(writesTo(s.writesAll, 'leaderboard_entries', 'i').length, 5, 'the snapshot was inserted exactly once (by B)');
      assert.equal(writesTo(s.writesAll, 'leaderboard_entries', 'd').length, 0, 'no entry was ever deleted');
      const seq = Evidence.statusSequence(s.writesAll);
      assert.deepEqual(seq, ['ACTIVE', 'SNAPSHOT_BUILDING', 'SNAPSHOT_FROZEN', 'REWARDING', 'FINALIZED']);
      assertLegalTransitions(seq, 'S3');

      // --- the network
      assert.equal(s.aRequestsAfterPause, 0, 'A sent no request to the User Service after it was parked (no eligibility call, no notification)');
      assert.equal(s.stubAfterA, s.stubAtBFinish, 'the stub saw nothing new after B finished');
      assert.deepEqual([...new Set(stub.of('notification').map((n) => n.worker))], ['B'], 'every notification was sent by B');
      assert.equal(stub.of('notification').length, 5);
      assertNoHttpInsideTransaction('S3');

      const fmt = (d: Date | null) => (d ? d.toISOString().slice(11, 23) : 'n/a');
      t.diagnostic(`MP-FINALIZE-02: controller pid ${s.pids.controller}, A pid ${s.pids.A}, B pid ${s.pids.B}; both called LeaderboardService.finalizeMonth`);
      t.diagnostic(`barrier: A parked at ${s.paused.detail.point} (fencing ${s.paused.detail.fencingToken}, ownership check passed, ${s.paused.detail.openTx} open transactions), status SNAPSHOT_BUILDING, 0 entries, 0 ledger`);
      t.diagnostic(`MongoDB clock: lease ended ${fmt(s.lapsed.lockExpiresAt)}Z, MongoDB confirmed expiry at ${fmt(s.lapsed.serverNow)}Z; B took over (oplog wall ${fmt(s.takeoverWall)}Z, fencing 2); B FINALIZED (oplog wall ${fmt(s.finalizedWall)}Z)`);
      t.diagnostic(`fingerprint after B: ${sha(s.fpAfterB)} ; after A resumed and ended: ${sha(s.fpAfterA)} (identical); oplog writes after resume: ${s.writesAfterResume.length}`);
      t.diagnostic(`worker timeline (production flow, as logged by the workers):\n${s.timeline}`);
      t.diagnostic(`A's result: ${s.aResult.result.status} - produced from a refused fence (LockLostError reason ${refusals[0].reason}) at the snapshot transaction, i.e. A reached the DATABASE fence and was stopped there; status path ${seq.join(' > ')}`);
    });
  });

  it('MP-FINALIZE-02b same S3 stall, but the old owner\'s clock keeps running: A is stopped even EARLIER, by its local ownership check, before any database access', async (t) => {
    await traced(async () => {
      const s = await runS3(false);
      assert.equal(s.bResult.result.status, 'FINALIZED');
      assert.equal(s.aResult.outcome, 'rejected', 'A\'s finalizeMonth rejected');
      assert.deepEqual({ name: s.aResult.error.name, reason: s.aResult.error.reason }, { name: 'LockLostError', reason: 'LOCAL_DEADLINE' });
      assert.equal(s.aState.fenceLog.length, 0, 'A never reached the database fence: the local check came first');
      const dbCalls = s.aState.calls.filter((c: any) => c.model !== 'monthlyLeaderboard' || c.op !== 'updateMany');
      assert.deepEqual(dbCalls, [], `A made no database call after resuming except its (ineffective) release: ${JSON.stringify(s.aState.calls)}`);
      assert.equal(s.fpAfterA, s.fpAfterB);
      assert.deepEqual(s.writesAfterResume, []);
      assert.equal(s.aRequestsAfterPause, 0);
      await assertFinalizedCorrectly('S3b');
      t.diagnostic(`MP-FINALIZE-02b: A pid ${s.pids.A} -> LockLostError(LOCAL_DEADLINE) before any DB access; fingerprint ${sha(s.fpAfterB)} unchanged; oplog writes after resume 0`);
    });
  });

  it('MP-FINALIZE-02c A resumes while B is still working (B has frozen the snapshot): A gets LockLostError REPLACED from the database fence and B\'s frozen snapshot survives', async (t) => {
    await traced(async () => {
      await world();
      const { ws: [A, B] } = await spawnFinalizers(['A', 'B']);
      await A.must('armPause', { point: 'BEFORE_SNAPSHOT_TX' });
      const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 180_000);
      aRun.catch(() => undefined);
      await A.waitEvent('paused', (e) => e.detail.point === 'BEFORE_SNAPSHOT_TX', 60_000);
      await A.must('stopHeartbeat');
      await A.must('freezeLocalClock');
      const aMark = await A.must('mark');
      await ev.waitUntilMongoSaysExpired(MONTH, YEAR);

      // B takes over and is parked right after it froze the snapshot, before rewarding (its heartbeat keeps its lease alive)
      await B.must('armPause', { point: 'BEFORE_REWARDING' });
      const bRun = B.send('finalize', { month: MONTH, year: YEAR, by: 'B' }, 180_000);
      bRun.catch(() => undefined);
      await B.waitEvent('paused', (e) => e.detail.point === 'BEFORE_REWARDING', 60_000);
      const frozen = await ev.lock(MONTH, YEAR);
      assert.equal(frozen.status, 'SNAPSHOT_FROZEN');
      assert.equal(frozen.fencingToken, 2);
      const entryIds = (await ev.raw('leaderboard_entries')).map((e) => e._id.$oid);
      assert.equal(entryIds.length, 5, 'B\'s frozen snapshot is in the database');
      const fpFrozenEntries = JSON.stringify(await ev.raw('leaderboard_entries'));
      const marker = await ev.oplogMarker();

      await A.must('resume', { point: 'BEFORE_SNAPSHOT_TX' });                 // A wakes up with its stale rankings
      const aResult = (await aRun).value;
      const aState = await A.must('state', { since: aMark });
      const writes = await ev.writesSince(marker);

      assert.equal(aResult.outcome, 'rejected');
      assert.deepEqual({ name: aResult.error.name, reason: aResult.error.reason }, { name: 'LockLostError', reason: 'REPLACED' }, 'A\'s finalizeMonth rejected with LockLostError (REPLACED)');
      assert.deepEqual(aState.fenceLog.map((f: any) => [f.ok, f.reason]), [[false, 'REPLACED']], 'the DATABASE fence refused A');
      assert.equal(JSON.stringify(await ev.raw('leaderboard_entries')), fpFrozenEntries, 'B\'s snapshot entries are byte-identical');
      assert.deepEqual(Evidence.businessWrites(writes), [], 'the only writes since A resumed are B\'s heartbeat renewals of its own lease (lock bookkeeping)');
      assert.equal((await ev.lock(MONTH, YEAR)).lockOwner?.startsWith('B @'), true, 'B is still the owner');
      assert.equal(await admin.rewardPointTransaction.count({}), 0, 'nothing was paid by A');

      // B continues from where it was parked and completes
      await B.must('resume', { point: 'BEFORE_REWARDING' });
      const bResult = (await bRun).value;
      assert.equal(bResult.result.status, 'FINALIZED');
      await assertFinalizedCorrectly('after B resumed');
      assert.deepEqual((await ev.raw('leaderboard_entries')).map((e) => e._id.$oid), entryIds, 'same entries to the end');
      assert.equal(await ev.summary(MONTH, YEAR), baseline);
      assert.deepEqual([...new Set(stub.of('notification').map((n) => n.worker))], ['B']);
      assertNoHttpInsideTransaction('S3c');
      t.diagnostic(`MP-FINALIZE-02c: A pid ${A.pid} -> LockLostError(REPLACED) from the DB fence while B pid ${B.pid} (fencing 2, SNAPSHOT_FROZEN, 5 entries) was parked; entries byte-identical; B then FINALIZED; business writes by A: 0`);
    });
  });

  it('MP-FINALIZE-03 the S3 outcome (takeover + fenced old owner) is business-identical to a plain single-process run', async (t) => {
    await traced(async () => {
      // baseline: computed in before() from a one-process run; recompute it here from an independent run for clarity
      await world();
      const { pool, ws: [N] } = await spawnFinalizers(['N'], { ttlMs: 3000, heartbeatMs: 1000 });
      assert.equal((await N.must('finalize', { month: MONTH, year: YEAR, by: 'N' }, 120_000)).result.status, 'FINALIZED');
      const plain = await ev.summary(MONTH, YEAR);
      const plainEntries = (await assertFinalizedCorrectly('plain')).entries.map((e: any) => [e.userId, e.rank, e.isTie]).sort();
      await pool.shutdown();

      const s = await runS3(true);
      assert.equal(s.aResult.result.status, 'ALREADY_FINALIZED');
      const disturbed = await ev.summary(MONTH, YEAR);
      const disturbedEntries = (await assertFinalizedCorrectly('S3')).entries.map((e: any) => [e.userId, e.rank, e.isTie]).sort();

      assert.deepEqual(disturbedEntries, plainEntries, 'same eligible students, same ranks, same tie groups');
      assert.equal(disturbed, plain, 'same periods totals, entries, rewards, wallets, badges, audit trail (ids / timestamps / fencing tokens excluded)');
      assert.equal(disturbed, baseline);
      t.diagnostic(`MP-FINALIZE-03: ranks ${JSON.stringify(Object.fromEntries(plainEntries.map((e: any) => [e[0].slice(-2), e[1]])))}; ties ${plainEntries.filter((e: any) => e[2]).length}; total ${EXPECTED_TOTAL}; plain run == S3 run`);
    });
  });

  describe('MP-FINALIZE-04 recovery after a failure before the snapshot is frozen', () => {
    it('MP-FINALIZE-04a the snapshot transaction fails inside A (rollback), A dies without releasing: nothing half-written, B waits for the lease, takes over and completes without duplicating anything', async (t) => {
      await traced(async () => {
        const { ws: [A, B] } = await spawnFinalizers(['A', 'B'], { ttlMs: 4000, heartbeatMs: 1000 });
        const marker = await ev.oplogMarker();
        await A.must('skipRelease', { on: true });             // A dies before its cleanup: the lease is left behind
        const aResult = await A.must('finalize', { month: MONTH, year: YEAR, by: 'A', options: { simulateFailureAt: 'BEFORE_SNAPSHOT_CONFIRM' } }, 120_000);
        assert.equal(aResult.outcome, 'rejected');
        assert.match(aResult.error.message, /\[SIMULATION\] Crash occurred while writing snapshot entries/);

        const afterFailure = await ev.writesSince(marker);
        assert.equal(writesTo(afterFailure, 'leaderboard_entries').length, 0, 'MongoDB\'s oplog has NO entry write: the half-written snapshot (delete + first insert) was rolled back atomically');
        const state = await ev.lock(MONTH, YEAR);
        assert.equal(state.status, 'SNAPSHOT_BUILDING', 'not frozen');
        assert.equal(await admin.leaderboardEntry.count({}), 0, 'no entries - nothing that could be mistaken for a complete snapshot');
        assert.equal(await admin.rewardPointTransaction.count({}), 0);
        assert.equal(state.lockOwner?.startsWith('A @'), true, 'A\'s lease is still recorded (it never released)');
        assert.equal(state.expired, false);

        const busy = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 60_000);
        assert.equal(busy.result.status, 'BUSY', 'B must wait: A\'s lease is still valid');
        assert.equal(stub.of('eligibility', 'B').length, 0, 'BUSY: B did not even call the User Service');

        const lapsed = await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
        const b = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000);
        assert.equal(b.result.status, 'FINALIZED');
        await assertFinalizedCorrectly('04a');
        assert.equal(await ev.summary(MONTH, YEAR), baseline);
        assert.equal((await ev.lock(MONTH, YEAR)).fencingToken, 2);

        const writes = await ev.writesSince(marker);
        assert.equal(writesTo(writes, 'leaderboard_entries', 'i').length, 5, 'the snapshot exists once, written by B');
        assert.equal(writesTo(writes, 'leaderboard_entries', 'd').length, 0);
        const seq = Evidence.statusSequence(writes);
        assert.deepEqual(seq, ['ACTIVE', 'SNAPSHOT_BUILDING', 'SNAPSHOT_FROZEN', 'REWARDING', 'FINALIZED']);
        assertLegalTransitions(seq, '04a');
        assert.deepEqual([...new Set(stub.of('notification').map((n) => n.worker))], ['B']);
        assertNoHttpInsideTransaction('04a');
        t.diagnostic(`MP-FINALIZE-04a: A pid ${A.pid} failed in the snapshot transaction (oplog: 0 entry writes), lease left until MongoDB ${lapsed.serverNow.toISOString().slice(11, 23)}Z; B pid ${B.pid}: BUSY first, then FINALIZED with fencing 2; path ${seq.join('>')}`);
      });
    });

    it('MP-FINALIZE-04b A is KILLED (SIGKILL) right before the snapshot transaction: B takes over after the lease expired and rebuilds the snapshot exactly once', async (t) => {
      await traced(async () => {
        const { pool, ws: [A, B] } = await spawnFinalizers(['A', 'B'], { ttlMs: 4000, heartbeatMs: 1000 });
        const marker = await ev.oplogMarker();
        await A.must('armPause', { point: 'BEFORE_SNAPSHOT_TX' });
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 60_000);
        aRun.catch(() => undefined);
        await A.waitEvent('paused', (e) => e.detail.point === 'BEFORE_SNAPSHOT_TX', 60_000);
        const apid = A.pid;
        await pool.kill(A);
        assert.equal(isAlive(apid), false, 'A is dead');
        assert.equal((await ev.lock(MONTH, YEAR)).status, 'SNAPSHOT_BUILDING');
        assert.equal(await admin.leaderboardEntry.count({}), 0);

        assert.equal((await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 60_000)).result.status, 'BUSY', 'a dead owner\'s live lease is respected');
        await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
        assert.equal((await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000)).result.status, 'FINALIZED');
        await assertFinalizedCorrectly('04b');
        assert.equal(await ev.summary(MONTH, YEAR), baseline);
        const writes = await ev.writesSince(marker);
        assert.equal(writesTo(writes, 'leaderboard_entries', 'i').length, 5);
        assert.equal(writesTo(writes, 'leaderboard_entries', 'd').length, 0);
        const seq = Evidence.statusSequence(writes);
        assertLegalTransitions(seq, '04b');
        assert.deepEqual(seq, ['ACTIVE', 'SNAPSHOT_BUILDING', 'SNAPSHOT_FROZEN', 'REWARDING', 'FINALIZED']);
        t.diagnostic(`MP-FINALIZE-04b: A pid ${apid} SIGKILLed at BEFORE_SNAPSHOT_TX; B pid ${B.pid} BUSY then FINALIZED (fencing 2); snapshot written once; path ${seq.join('>')}`);
      });
    });

    it('MP-FINALIZE-04c A is KILLED after it froze the snapshot: B continues from the FROZEN snapshot, never deletes or rebuilds it, and pays each reward once', async (t) => {
      await traced(async () => {
        const { pool, ws: [A, B] } = await spawnFinalizers(['A', 'B'], { ttlMs: 4000, heartbeatMs: 1000 });
        await A.must('armPause', { point: 'BEFORE_REWARDING' });
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 60_000);
        aRun.catch(() => undefined);
        await A.waitEvent('paused', (e) => e.detail.point === 'BEFORE_REWARDING', 60_000);
        const frozen = await ev.lock(MONTH, YEAR);
        assert.equal(frozen.status, 'SNAPSHOT_FROZEN');
        const entriesFrozen = JSON.stringify(await ev.raw('leaderboard_entries'));
        const ids = (await ev.raw('leaderboard_entries')).map((e) => e._id.$oid);
        assert.equal(ids.length, 5);
        const marker = await ev.oplogMarker();
        await pool.kill(A);

        await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
        assert.equal((await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000)).result.status, 'FINALIZED');
        await assertFinalizedCorrectly('04c');
        assert.equal(await ev.summary(MONTH, YEAR), baseline);
        assert.deepEqual((await ev.raw('leaderboard_entries')).map((e) => e._id.$oid), ids, 'the frozen snapshot entries are the very same documents');
        const writes = await ev.writesSince(marker);
        assert.equal(writesTo(writes, 'leaderboard_entries', 'd').length, 0, 'no entry deleted');
        assert.equal(writesTo(writes, 'leaderboard_entries', 'i').length, 0, 'no entry (re)created');
        const seq = Evidence.statusSequence(writes);
        assert.deepEqual(seq, ['SNAPSHOT_FROZEN', 'REWARDING', 'FINALIZED']);
        assertLegalTransitions(seq, '04c');
        // ranks / points of the frozen entries untouched (only reward links and notification markers were added)
        const after = await ev.raw('leaderboard_entries');
        const before = JSON.parse(entriesFrozen);
        for (const e of after) {
          const b = before.find((x: any) => x._id.$oid === e._id.$oid);
          for (const f of ['rank', 'points', 'isTie', 'userId', 'lastCompletedAt', 'completedCourses', 'scoreBreakdown']) assert.deepEqual(e[f], b[f], `frozen field ${f} unchanged`);
        }
        t.diagnostic(`MP-FINALIZE-04c: A pid ${A.pid} SIGKILLed at BEFORE_REWARDING (SNAPSHOT_FROZEN, 5 entries); B pid ${B.pid} resumed from the frozen snapshot: entry writes after the kill: 0 inserts, 0 deletes; path ${seq.join('>')}`);
      });
    });
  });
});
