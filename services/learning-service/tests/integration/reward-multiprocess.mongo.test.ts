/**
 * FIX 06C-3: fencing of the REWARD PHASE of the real monthly finalization between independent Node.js PROCESSES.
 *
 * Worker A (a separate OS process, own PID / PrismaClient / pools) runs the production `LeaderboardService.finalizeMonth` and is parked right
 * BEFORE a chosen MongoDB transaction (no transaction is open while parked). Its heartbeat is stopped (the lock is NOT released), MongoDB itself
 * confirms the lease has expired, worker B (another process) takes over and completes the period through the same production flow, and only
 * then A is released with its old LockContext. A must be stopped by the DATABASE fence; MongoDB's oplog must show no write after B finished.
 * The product code is not modified; the barrier lives in the worker (tests/helpers/mp/finalize-worker.ts, a hook that runs in the Prisma client
 * wrapper before an interactive transaction starts). HTTP goes only to the loopback stub (tests/helpers/mp/stub-user-service.ts).
 *
 * WRITE SITES OF THE REWARD PHASE (traced from the code) -> the test that parks A right before them
 *   label                    write                                                                       protection in the product                 test
 *   TRANSITION:REWARDING     status SNAPSHOT_FROZEN|REWARDING -> REWARDING                               fenced tx + CAS (status, tokens)          RP-01/02 (fresh)
 *   WALLET                   create the reward wallet if missing (ensureWalletFenced)                    fenced tx (runTx)                         RP-02 (fresh), RP-03
 *   AWARD                    wallet increment + reward ledger entry (awardLeaderboardPoints)             fenced tx; idempotency key; in-tx dup check   RP-01, RP-02, RP-03
 *   AUDIT:REWARD_INTEGRITY_ERROR     ledger entry vs snapshot disagree (recordRewardIntegrityIssue)       fenced tx (writeAuditOnce)                RP-04 (conflict)
 *   AUDIT:REWARD_LEDGER_MISMATCH     wallet vs ledger disagree (flagIfWalletDisagrees)                    fenced tx (writeAuditOnce)                RP-04 (conflict, walletgap)
 *   BADGE                    leaderboard badge (ensureRewardBadge)                                       fenced tx (runTx); unique (user, badge)   RP-04 (fresh)
 *   CLAIM                    notification claim on the entry (claimNotification)                         fenced tx + claim CAS                     RP-02 (fresh)
 *   notification outcome     delivered / error marker, claim hand-back (finishNotification)              claim-token CAS (no period fence, by design)  RP-05
 *   PERSIST                  badge link + reward points on the entries (persistEntryRewards)             fenced tx                                 RP-04 (fresh)
 *   SKIP                     ineligible learner: entry reward 0 + audit REWARD_SKIPPED_INELIGIBLE       fenced tx per skip                        RP-04 (skip)
 *   TOTALS_INCOMPLETE        totalParticipants / totalPointsAwarded of an unfinished period              fenced tx + CAS (status, tokens)          RP-04 (conflict)
 *   AUDIT:FINALIZE_REWARDS_INCOMPLETE   audit of the unfinished period                                   fenced tx (deduplicated)                  RP-04 (conflict)
 *   TRANSITION:FINALIZED     REWARDING -> FINALIZED (+ finalizedAt, totals)                              fenced tx + CAS (from REWARDING, tokens)  RP-04 (fresh)
 * Not part of the reward phase of finalizeMonth, therefore not parked here: adminAdjustPoints (admin API), the redemption flow, the snapshot
 * transactions (06C-2) and AchievementService.syncExistingCompletions (snapshot build / live view).
 *
 * What this file does NOT claim: notifications stay AT-LEAST-ONCE (RP-05 shows a concrete duplicate); a process that dies after the User Service
 * accepted a request and before the outcome was recorded is FIX 06C-4.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" npm test
 * Own database (`<name>_mpr`), created with `prisma db push`, dropped afterwards. Workers refuse any database whose name lacks "test".
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { resolveTestDb } from '../helpers/test-db-url';
import { FINALIZE_WORKER, Worker, WorkerPool } from '../helpers/mp/harness';
import { Evidence } from '../helpers/mp/evidence';
import { StubUserService } from '../helpers/mp/stub-user-service';
import { E1, MONTH, YEAR, SCENARIOS, Scenario, ScenarioKey, seedCompletions } from '../helpers/mp/dataset';
import { assertRewardInvariants, labelTx, snapshotFields } from '../helpers/mp/reward-evidence';

const target = resolveTestDb('mpr');
const ALLOWED_NEXT: Record<string, string[]> = {
  ACTIVE: ['SNAPSHOT_BUILDING'], SNAPSHOT_BUILDING: ['SNAPSHOT_FROZEN'], SNAPSHOT_FROZEN: ['REWARDING'], REWARDING: ['FINALIZED'],
};

class PrefixMismatch extends Error {}

describe('REAL MULTI-PROCESS: reward-phase fencing of finalizeMonth', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run', timeout: 1_800_000 }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let admin: any;
  let localDb: any;
  let ev: Evidence;
  let stub: StubUserService;
  const pools: WorkerPool[] = [];
  const reference: Record<string, { summary: string; outcome: string }> = {};

  const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const fmt = (d: Date | null | undefined) => (d ? d.toISOString().slice(11, 23) + 'Z' : 'n/a');
  const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const world = async (sc: Scenario) => { await ev.reset(); stub.reset(); await seedCompletions(admin, stub); await sc.setup(admin, stub); };

  const spawnPair = async (lock = { ttlMs: 1500, heartbeatMs: 500 }) => {
    const pool = new WorkerPool();
    pools.push(pool);
    const [A, B] = [
      await pool.spawn('A', target.url as string, { MP_STUB_URL: stub.url, MP_LOCK_TTL_MS: String(lock.ttlMs), MP_LOCK_HB_MS: String(lock.heartbeatMs) }, FINALIZE_WORKER),
      await pool.spawn('B', target.url as string, { MP_STUB_URL: stub.url, MP_LOCK_TTL_MS: String(lock.ttlMs), MP_LOCK_HB_MS: String(lock.heartbeatMs) }, FINALIZE_WORKER),
    ];
    await Promise.all([A.must('connect'), B.must('connect')]);
    return { pool, A, B };
  };

  const traced = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) {
      e.message += `\n--- worker events (latest) ---\n${pools.map((p) => p.dump(70)).join('\n')}\n--- stub requests (latest) ---\n${stub.requests.slice(-16).map((r) => `${r.kind} ${r.worker} openTx=${r.openTx} ${r.userId ? r.userId.slice(-2) : ''}`).join('\n')}`;
      throw e;
    }
  };

  /** The labels of every transaction a plain run of `sc` performs, in order (learned from a dry run on worker A). */
  /**
   * A heartbeat renewal that collides with the write of a fence makes production retry that transaction (fencedTx, event
   * `lock:fence-refused`): the refused attempt is one more (rolled-back) transaction than the plan has, and every ordinal learned after
   * it is one too high. As in crash-recovery-multiprocess, a plan is learned only from a dry run without such a retry (bounded).
   */
  const MAX_DRY_RUNS = 10;
  const fenceRetries = (w: Worker, from = 0) => w.events.slice(from).filter((e) => e.step === 'lock:fence-refused').length;
  const learnLabels = async (sc: Scenario, A: Worker): Promise<string[]> => {
    for (let attempt = 1; ; attempt++) {
      await world(sc);
      await A.must('resetFaults');
      const m = await A.must('mark');
      const evFrom = A.events.length;
      const r = await A.must('finalize', { month: MONTH, year: YEAR, by: 'dry-run' }, 120_000);
      assert.equal(r.outcome, sc.expect === 'FINALIZED' ? 'resolved' : 'rejected', `dry run of "${sc.key}" ends as expected`);
      const retries = fenceRetries(A, evFrom);
      if (retries === 0) return (await A.must('txPlan', { from: m.tx })).map(labelTx);
      assert.ok(attempt < MAX_DRY_RUNS, `${MAX_DRY_RUNS} dry runs of "${sc.key}" in a row had a fenced transaction retried by a heartbeat collision (last: ${retries} retries): the plan cannot be learned`);
    }
  };
  const ordinalsOf = (labels: string[], keep: (label: string, index: number) => boolean) =>
    labels.map((l, i) => ({ l, k: i + 1 })).filter(({ l, k }) => keep(l, k - 1)).map(({ k }) => k);

  interface PointResult {
    scenario: ScenarioKey; ordinal: number; label: string; aOutcome: string; aFence: string; bOutcome: string;
    fencing: { A: number | null; B: number | null }; fpB: string; fpA: string; writesAfterResume: number; ledgerAtBarrier: number;
    paused: any; lapsed: any; takeoverWall: Date | null; settledWall: Date | null; aPid: number; bPid: number; notificationsByA: number; notificationsByB: number;
    attempts: number;
  }

  /**
   * One cell of the matrix, with two real processes. Throws PrefixMismatch if A did not stop where the dry run says (never silently "passes").
   */
  const runPointOnce = async (sc: Scenario, k: number, labels: string[], A: Worker, B: Worker): Promise<Omit<PointResult, 'attempts'>> => {
    const label = labels[k - 1];
    const tag = `[${sc.key} TX#${k} ${label}]`;
    await world(sc);
    await Promise.all([A.must('resetFaults'), B.must('resetFaults')]);
    const markerStart = await ev.oplogMarker();
    const aMark = await A.must('mark');
    const evFrom = A.events.length;

    // ---- A: the production finalizeMonth, parked right before the k-th transaction
    await A.must('armTxPause', { at: k });
    const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 180_000);
    aRun.catch(() => undefined);
    const paused = await A.waitEvent('paused', (e) => e.detail.point === `TX#${k}`, 60_000, evFrom);

    // where exactly is A? the transactions it completed must be exactly the dry run's prefix
    const done = (await A.must('txPlan', { from: aMark.tx })).map(labelTx);
    if (JSON.stringify(done) !== JSON.stringify(labels.slice(0, k - 1))) {
      await A.must('resume', { point: `TX#${k}` });
      await aRun.catch(() => undefined);
      throw new PrefixMismatch(`${tag} A completed ${JSON.stringify(done)} before the barrier, the dry run expected ${JSON.stringify(labels.slice(0, k - 1))}`);
    }
    assert.equal(paused.detail.assertAliveOk, true, `${tag} A passed its local ownership check before the transaction`);
    assert.equal(paused.detail.openTx, 0, `${tag} no MongoDB transaction is open while A is parked`);
    assert.equal(paused.detail.completedTransactions, k - 1);
    const aBarrierMark = await A.must('mark');           // everything A does from here on happens AFTER the barrier
    const lockAtBarrier = await ev.lock(MONTH, YEAR);
    assert.equal(lockAtBarrier.fencingToken, 1, `${tag} A holds fencing token 1`);
    assert.match(lockAtBarrier.lockOwner || '', /^A @/);
    const fpBarrier = await ev.fingerprint();
    const snapBarrier = await snapshotFields(ev);
    const ledgerAtBarrier = (await ev.raw('reward_point_transactions')).length;
    const stubAtBarrier = { A: stub.requests.filter((r) => r.worker === 'A').length, total: stub.requests.length };

    // ---- A "stalls": no heartbeat, lock NOT released, local clock frozen (so the DATABASE fence is what must stop it)
    await A.must('stopHeartbeat');
    await A.must('freezeLocalClock');
    const lapsed = await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
    const lapsedAtMs = Date.now();

    // ---- B: the production finalizeMonth takes over and settles the period
    const bReply = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 180_000);
    if (sc.expect === 'FINALIZED') {
      assert.equal(bReply.outcome, 'resolved', `${tag} B: ${JSON.stringify(bReply.error)}`);
      assert.equal(bReply.result.status, 'FINALIZED');
    } else {
      assert.equal(bReply.outcome, 'rejected', `${tag} B must not finish an unfinishable period`);
      assert.equal(bReply.error.name, 'LeaderboardRewardIncompleteError');
    }
    const fpB = await ev.fingerprint();
    const markerB = await ev.oplogMarker();
    const lockAfterB = await ev.lock(MONTH, YEAR);
    const stubAfterB = stub.requests.length;
    const aRequestsBeforeResume = stub.requests.filter((r) => r.worker === 'A').length;

    // ---- A resumes from exactly where it was parked, with its old LockContext
    await A.must('resume', { point: `TX#${k}` });
    const aReply = (await aRun).value;
    const fpA = await ev.fingerprint();
    const writesAfter = await ev.writesSince(markerB);
    const aState = await A.must('state', { since: aBarrierMark });
    const writesAll = await ev.writesSince(markerStart);

    // ---- A was stopped by the database fence and wrote nothing
    const refusals = aState.fenceLog.filter((f: any) => !f.ok);
    assert.equal(aState.fenceLog.filter((f: any) => f.ok).length, 0, `${tag} A's fence never succeeded after the barrier`);
    assert.equal(refusals.length, 1, `${tag} exactly one refused fence`);
    assert.equal(refusals[0].fencingToken, 1, `${tag} refused with A's old fencing token`);
    if (sc.expect === 'FINALIZED') {
      assert.equal(aReply.outcome, 'resolved', `${tag} A: ${JSON.stringify(aReply.error)}`);
      assert.equal(aReply.result.status, 'ALREADY_FINALIZED', `${tag} A learns the period is final; it does not claim to have finalized it`);
      assert.equal(refusals[0].reason, 'FINALIZED');
    } else {
      assert.equal(aReply.outcome, 'rejected');
      assert.deepEqual({ name: aReply.error.name, reason: aReply.error.reason }, { name: 'LockLostError', reason: 'REPLACED' }, `${tag} A is rejected with LockLostError`);
      assert.equal(refusals[0].reason, 'REPLACED');
    }
    // THE SITE ITSELF: the one transaction A started at the barrier did nothing but the fence. Without this, a missing fence at this site could be
    // hidden by a LATER fence (or by an in-transaction duplicate check) that happens to stop A one step further on.
    const barrierTx = await A.must('txPlan', { from: aBarrierMark.tx });
    assert.equal(barrierTx.length, 1, `${tag} A started exactly one transaction after the barrier (LockLostError ends the run; no retry)`);
    assert.equal(barrierTx[0].outcome, 'rollback', `${tag} and it was rolled back`);
    assert.deepEqual(barrierTx[0].calls.map((c: any) => `${c.model}.${c.op}`), ['$raw.update', '$raw.aggregate'],
      `${tag} its ONLY statements were the fence and the read that classifies the refusal - no business statement of "${label}" was executed`);
    assert.equal(fpA, fpB, `${tag} fingerprint of every collection after A == right after B settled the period`);
    assert.deepEqual(writesAfter, [], `${tag} MongoDB's oplog: not one write after B finished`);
    // (the worker also logs the REFUSED attempt: that is exactly what must happen; no transition may have SUCCEEDED)
    assert.deepEqual(aState.transitions.filter((t: any) => t.at > paused.at && t.ok === true), [], `${tag} A completed no status transition after the barrier`);
    assert.equal(stub.requests.length, stubAfterB, `${tag} the stub saw nothing new after B finished`);
    assert.equal(stub.requests.filter((r) => r.worker === 'A').length, stubAtBarrier.A, `${tag} A sent no request (eligibility or notification) after the barrier`);
    assert.equal(stub.requests.filter((r) => r.worker === 'A').length, aRequestsBeforeResume);

    // ---- the settled data is exactly what an undisturbed run produces
    await assertRewardInvariants(ev, sc, tag);
    assert.equal(await ev.summary(MONTH, YEAR), reference[sc.key].summary, `${tag} business result == a plain single-process run`);
    const snapEnd = await snapshotFields(ev);
    if (JSON.parse(snapBarrier).length > 0) assert.equal(snapEnd, snapBarrier, `${tag} the frozen snapshot was not touched (ids, ranks, points, ties, breakdown)`);
    assert.equal(lockAfterB.lockToken, null, `${tag} B released its lock`);
    assert.equal(lockAfterB.fencingToken, 2, `${tag} B ran with fencing token 2`);

    // ---- history in MongoDB: legal transitions only; after takeover only B notifies; no HTTP inside a transaction
    const seq = Evidence.statusSequence(writesAll);
    for (let i = 1; i < seq.length; i++) assert.ok((ALLOWED_NEXT[seq[i - 1]] || []).includes(seq[i]), `${tag} illegal transition ${seq[i - 1]} -> ${seq[i]} (${seq.join(' > ')})`);
    if (sc.expect === 'FINALIZED') assert.equal(seq[seq.length - 1], 'FINALIZED');
    else assert.ok(!seq.includes('FINALIZED'), `${tag} an unfinished period must not become FINALIZED`);
    for (const r of stub.requests) assert.equal(r.openTx, 0, `${tag} ${r.kind} from ${r.worker} was sent with ${r.openTx} transaction(s) open`);
    const notifications = stub.of('notification');
    assert.ok(notifications.filter((n) => n.at > lapsedAtMs).every((n) => n.worker === 'B'), `${tag} after the takeover only B sends notifications`);
    const expectedRecipients = (JSON.parse(reference[sc.key].summary).entries as any[]).filter((e) => e[8]).map((e) => e[0]).sort();
    const perUser = new Map<string, number>();
    for (const n of notifications) perUser.set(n.userId!, (perUser.get(n.userId!) || 0) + 1);
    assert.deepEqual([...perUser.keys()].sort(), expectedRecipients, `${tag} the right students were notified`);
    for (const [u, c] of perUser) assert.equal(c, 1, `${tag} ${u.slice(-2)} was notified ${c} times (no process crashed in this run)`);
    void fpBarrier;

    const takeover = writesAll.find((w) => w.coll === 'monthly_leaderboards' && w.periodAfter && Number(w.periodAfter.fencingToken) === 2);
    const settled = writesAll.find((w) => w.coll === 'monthly_leaderboards' && w.periodAfter?.status === 'FINALIZED'); // none for an unfinishable period
    return {
      scenario: sc.key, ordinal: k, label,
      aOutcome: aReply.outcome === 'resolved' ? aReply.result.status : `${aReply.error.name}(${aReply.error.reason})`,
      aFence: `refused ${refusals[0].reason} @ fencing ${refusals[0].fencingToken}`,
      bOutcome: bReply.outcome === 'resolved' ? bReply.result.status : bReply.error.name,
      fencing: { A: lockAtBarrier.fencingToken, B: lockAfterB.fencingToken }, fpB, fpA, writesAfterResume: writesAfter.length, ledgerAtBarrier,
      paused, lapsed, takeoverWall: takeover?.wall ?? null, settledWall: settled?.wall ?? null, aPid: A.pid, bPid: B.pid,
      notificationsByA: notifications.filter((n) => n.worker === 'A').length, notificationsByB: notifications.filter((n) => n.worker === 'B').length,
    };
  };

  const runPoint = async (sc: Scenario, k: number, labels: string[], A: Worker, B: Worker): Promise<PointResult> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return { ...(await runPointOnce(sc, k, labels, A, B)), attempts: attempt };
      } catch (e) {
        // A transaction conflict between the heartbeat and a business transaction can add a retry and shift the ordinal: try once more,
        // then FAIL (a point is never reported as tested when the barrier did not land where intended).
        if (e instanceof PrefixMismatch && attempt === 1) continue;
        throw e;
      }
    }
  };

  const line = (r: PointResult) =>
    `${r.scenario.padEnd(9)} TX#${String(r.ordinal).padEnd(2)} ${r.label.padEnd(36)} A(pid ${r.aPid}) fencing ${r.fencing.A} -> ${r.aOutcome} [${r.aFence}] | B(pid ${r.bPid}) fencing ${r.fencing.B} -> ${r.bOutcome} | ledger at barrier ${r.ledgerAtBarrier} | oplog writes after A resumed ${r.writesAfterResume} | fp ${sha(r.fpB)}==${sha(r.fpA)}${r.attempts > 1 ? ' (barrier re-landed once)' : ''}`;

  before(async () => {
    process.env.DATABASE_URL = target.url;
    execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: target.url }, stdio: 'pipe' });
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient();
    localDb = new PrismaClient({ datasources: { db: { url: (target.url as string).replace(/\/[^/?]+\?/, '/local?') } } });
    ev = new Evidence(admin, localDb, target.dbName);
    stub = new StubUserService();
    await stub.start();

    // the reference outcome of each scenario: ONE process, an ordinary run, same data
    const pool = new WorkerPool();
    pools.push(pool);
    const R = await pool.spawn('R', target.url as string, { MP_STUB_URL: stub.url, MP_LOCK_TTL_MS: '3000', MP_LOCK_HB_MS: '1000' }, FINALIZE_WORKER);
    await R.must('connect');
    for (const sc of Object.values(SCENARIOS)) {
      await world(sc);
      const r = await R.must('finalize', { month: MONTH, year: YEAR, by: 'R' }, 120_000);
      assert.equal(r.outcome, sc.expect === 'FINALIZED' ? 'resolved' : 'rejected', `reference run of "${sc.key}"`);
      await assertRewardInvariants(ev, sc, `reference ${sc.key}`);
      reference[sc.key] = { summary: await ev.summary(MONTH, YEAR), outcome: r.outcome };
    }
    await pool.shutdown();
  });

  after(async () => {
    for (const p of pools) await p.shutdown();
    await stub?.stop().catch(() => undefined);
    try { await admin.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
    await localDb?.$disconnect();
  });

  // ==============================================================================================

  it('RP-00 the dry run learns the transactions of a run; the workers are two separate processes confined to the loopback stub', async (t) => {
    await traced(async () => {
      const { A, B } = await spawnPair();
      assert.notEqual(A.pid, B.pid);
      assert.ok(![A.pid, B.pid].includes(process.pid) && isAlive(A.pid) && isAlive(B.pid));
      for (const w of [A, B]) {
        const net = await w.must('probeNetwork');
        assert.equal(net.userServiceUrl, stub.url);
        assert.deepEqual(net.decision, { stub: true, realUserServicePort3002: false, localhost3002: false, anotherLoopbackPort: false, external: false });
      }
      const labels = await learnLabels(SCENARIOS.fresh, A);
      assert.deepEqual(labels.slice(0, 3), ['TRANSITION:SNAPSHOT_BUILDING', 'SNAPSHOT', 'TRANSITION:REWARDING']);
      assert.deepEqual(labels.slice(3, 7), ['WALLET', 'AWARD', 'BADGE', 'CLAIM'], 'per rewarded student: wallet, award, badge, notification claim');
      assert.deepEqual(labels.slice(-2), ['PERSIST', 'TRANSITION:FINALIZED']);
      assert.equal(labels.length, 25);
      const frozen = await learnLabels(SCENARIOS.skip, A);
      assert.ok(frozen.includes('SKIP'));
      const conflict = await learnLabels(SCENARIOS.conflict, A);
      for (const need of ['AUDIT:REWARD_LEDGER_MISMATCH', 'AUDIT:REWARD_INTEGRITY_ERROR', 'TOTALS_INCOMPLETE', 'AUDIT:FINALIZE_REWARDS_INCOMPLETE']) assert.ok(conflict.includes(need), `the "conflict" run performs ${need}`);
      assert.ok((await learnLabels(SCENARIOS.walletgap, A)).includes('AUDIT:REWARD_LEDGER_MISMATCH'));
      t.diagnostic(`controller pid ${process.pid}; A=pid ${A.pid}, B=pid ${B.pid}; fresh run = ${labels.length} transactions: ${labels.join(' ')}`);
      t.diagnostic(`skip run: ${frozen.join(' ')}`);
      t.diagnostic(`conflict run: ${conflict.join(' ')}`);
    });
  });

  it('RP-01 A is parked right before the AWARD transaction of the first student; B takes over and finalizes; A resumes -> the DB fence refuses it and nothing changes', async (t) => {
    await traced(async () => {
      const { A, B } = await spawnPair();
      const sc = SCENARIOS.fresh;
      const labels = await learnLabels(sc, A);
      const k = labels.indexOf('AWARD') + 1;
      assert.equal(labels[k - 1], 'AWARD');
      const r = await runPoint(sc, k, labels, A, B);

      assert.equal(r.ledgerAtBarrier, 0, 'A was parked after the wallet but before the first credit: nothing was paid');
      assert.equal(r.writesAfterResume, 0);
      assert.equal(r.aOutcome, 'ALREADY_FINALIZED');
      // the money, explicitly
      const ledger = await ev.raw('reward_point_transactions');
      assert.equal(ledger.length, 5);
      assert.equal(new Set(ledger.map((x) => x.idempotencyKey)).size, 5, 'no reward twice');
      t.diagnostic(`RP-01: controller pid ${process.pid}, A pid ${r.aPid}, B pid ${r.bPid}`);
      t.diagnostic(`barrier: A parked before transaction #${k} (${r.label}); completed ${r.paused.detail.completedTransactions} transactions; local ownership check passed; open transactions ${r.paused.detail.openTx}; fencing token A=${r.fencing.A}`);
      t.diagnostic(`MongoDB clock: lease ended ${fmt(r.lapsed.lockExpiresAt)}, MongoDB confirmed expiry at ${fmt(r.lapsed.serverNow)}; B took over (oplog wall ${fmt(r.takeoverWall)}) with fencing token ${r.fencing.B}; period settled (oplog wall ${fmt(r.settledWall)})`);
      t.diagnostic(`fingerprint after B: ${sha(r.fpB)} ; after A resumed: ${sha(r.fpA)} (identical); oplog writes after A resumed: ${r.writesAfterResume}; A result ${r.aOutcome} via ${r.aFence}`);
      t.diagnostic(`notifications: by A (before the barrier) ${r.notificationsByA}, by B ${r.notificationsByB}; ledger 5 / wallets 5 / badges 5 / total 2900`);
    });
  });

  it('RP-02 matrix: A is parked before EACH money-path transaction of a full run (REWARDING transition, wallet, award, notification claim of all five students)', async (t) => {
    await traced(async () => {
      const { A, B } = await spawnPair();
      const sc = SCENARIOS.fresh;
      const labels = await learnLabels(sc, A);
      const ordinals = ordinalsOf(labels, (l) => ['TRANSITION:REWARDING', 'WALLET', 'AWARD', 'CLAIM'].includes(l));
      assert.equal(ordinals.length, 16, '1 transition + 5 x (wallet, award, claim)');
      const results: PointResult[] = [];
      for (const k of ordinals) results.push(await runPoint(sc, k, labels, A, B));
      results.forEach((r) => t.diagnostic(line(r)));
      t.diagnostic(`RP-02: ${results.length} points, every one: A refused by the DB fence, 0 oplog writes after A resumed, result == plain run; A pid ${A.pid}, B pid ${B.pid}; ledger progress at the barrier ${results.map((r) => r.ledgerAtBarrier).join(',')}`);
      assert.deepEqual(results.map((r) => r.ledgerAtBarrier), results.map((r) => r.ledgerAtBarrier).slice().sort((a, b) => a - b), 'A was parked at increasingly advanced states of the payout (0..5 ledger entries)');
      assert.equal(results[0].ledgerAtBarrier, 0);
      assert.equal(results[results.length - 1].ledgerAtBarrier, 5);
    });
  });

  it('RP-03 idempotency: A is KILLED (SIGKILL) at several points of the payout; the retry by B pays every student exactly once and keeps every key, amount and balance', async (t) => {
    await traced(async () => {
      const sc = SCENARIOS.fresh;
      const cases: Array<{ name: string; label: string; occurrence: number }> = [
        { name: 'wallet created, award not yet', label: 'AWARD', occurrence: 1 },
        { name: 'first reward committed, its badge not yet', label: 'BADGE', occurrence: 1 },
        { name: 'two students fully paid, third not', label: 'WALLET', occurrence: 3 },
        { name: 'all paid and linked, status not yet FINALIZED', label: 'TRANSITION:FINALIZED', occurrence: 1 },
      ];
      for (const c of cases) {
        const { pool, A, B } = await spawnPair();
        const labels = await learnLabels(sc, A);
        const k = labels.map((l, i) => ({ l, k: i + 1 })).filter((x) => x.l === c.label)[c.occurrence - 1].k;
        await world(sc);
        await Promise.all([A.must('resetFaults'), B.must('resetFaults')]);
        const markerStart = await ev.oplogMarker();
        const aMark = await A.must('mark');
        const evFrom = A.events.length;
        await A.must('armTxPause', { at: k });
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 60_000);
        aRun.catch(() => undefined);
        await A.waitEvent('paused', (e) => e.detail.point === `TX#${k}`, 60_000, evFrom);
        assert.deepEqual((await A.must('txPlan', { from: aMark.tx })).map(labelTx), labels.slice(0, k - 1), `${c.name}: A stopped where intended`);
        const paidByA = await ev.raw('reward_point_transactions');
        const walletsByA = await ev.raw('user_reward_points');
        const apid = A.pid;
        await pool.kill(A);                                               // the process dies: no cleanup, lease left behind
        assert.equal(isAlive(apid), false);

        await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
        const b = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000);
        assert.equal(b.outcome, 'resolved', `${c.name}: ${JSON.stringify(b.error)}`);
        assert.equal(b.result.status, 'FINALIZED');
        await assertRewardInvariants(ev, sc, `kill ${c.name}`);
        assert.equal(await ev.summary(MONTH, YEAR), reference.fresh.summary, `${c.name}: same business result as an undisturbed run`);

        // what A had already committed is still there, untouched (same documents), and was not paid a second time
        const ledgerNow = await ev.raw('reward_point_transactions');
        for (const old of paidByA) assert.deepEqual(ledgerNow.find((x) => x._id.$oid === old._id.$oid), old, `${c.name}: the ledger entry A committed is unchanged`);
        const walletsNow = await ev.raw('user_reward_points');
        for (const old of walletsByA) {
          const now = walletsNow.find((x) => x._id.$oid === old._id.$oid);
          assert.ok(now, `${c.name}: the wallet A created is still the same document (not recreated)`);
          // a wallet A had already credited keeps exactly that balance (no second credit); one A had only created is credited once by B
          if (Number(old.balance?.$numberInt ?? old.balance) > 0) assert.deepEqual(now.balance, old.balance, `${c.name}: a balance A had credited is not credited again`);
        }
        const writes = await ev.writesSince(markerStart);
        assert.equal(writes.filter((w) => w.coll === 'reward_point_transactions' && w.op === 'i').length, 5, `${c.name}: exactly five ledger inserts in the whole history (A's + B's)`);
        assert.equal(writes.filter((w) => w.coll === 'user_reward_points' && w.op === 'i').length, 5, `${c.name}: each wallet created once`);
        assert.equal(writes.filter((w) => w.coll === 'badges' && w.op === 'i').length, 5, `${c.name}: each badge created once`);
        assert.equal(writes.filter((w) => w.op === 'd').length, 0, `${c.name}: nothing deleted`);
        // a further retry has nothing left to do
        const markerDone = await ev.oplogMarker();
        assert.equal((await B.must('finalize', { month: MONTH, year: YEAR, by: 'B2' }, 60_000)).result.status, 'ALREADY_FINALIZED');
        assert.deepEqual(await ev.writesSince(markerDone), [], `${c.name}: the retry of a settled period writes nothing`);
        t.diagnostic(`RP-03 [${c.name}] A pid ${apid} SIGKILLed at TX#${k} (${c.label}) with ${paidByA.length} ledger entries / ${walletsByA.length} wallets; B pid ${B.pid} -> FINALIZED; ledger inserts overall 5, wallets 5, badges 5, no deletes; result == plain run`);
        await pool.shutdown();
      }
    });
  });

  it('RP-04 badge, audit, persist, skip, totals and FINALIZED: A is parked before each of them (four scenarios); the old owner changes nothing and an unfinishable period is never FINALIZED', async (t) => {
    await traced(async () => {
      const { A, B } = await spawnPair();
      const results: PointResult[] = [];
      const plan: Array<{ key: ScenarioKey; keep: (label: string) => boolean }> = [
        { key: 'fresh', keep: (l) => ['BADGE', 'PERSIST', 'TRANSITION:FINALIZED'].includes(l) },
        { key: 'skip', keep: (l) => l === 'SKIP' },
        { key: 'conflict', keep: (l) => l.startsWith('AUDIT:') || l === 'TOTALS_INCOMPLETE' },
        { key: 'walletgap', keep: (l) => l === 'AUDIT:REWARD_LEDGER_MISMATCH' },
      ];
      const covered = new Set<string>();
      for (const p of plan) {
        const sc = SCENARIOS[p.key];
        const labels = await learnLabels(sc, A);
        const ordinals = ordinalsOf(labels, (l) => p.keep(l));
        assert.ok(ordinals.length > 0, `scenario ${p.key} has points to park at`);
        for (const k of ordinals) { results.push(await runPoint(sc, k, labels, A, B)); covered.add(labels[k - 1]); }
      }
      results.forEach((r) => t.diagnostic(line(r)));
      for (const need of ['BADGE', 'PERSIST', 'TRANSITION:FINALIZED', 'SKIP', 'AUDIT:REWARD_INTEGRITY_ERROR', 'AUDIT:REWARD_LEDGER_MISMATCH', 'AUDIT:FINALIZE_REWARDS_INCOMPLETE', 'TOTALS_INCOMPLETE']) {
        assert.ok(covered.has(need), `a point was exercised for ${need}`);
      }
      const incomplete = results.filter((r) => r.scenario === 'conflict');
      assert.ok(incomplete.length >= 4);
      assert.ok(incomplete.every((r) => r.bOutcome === 'LeaderboardRewardIncompleteError' && r.aOutcome.startsWith('LockLostError')), 'the unfinishable period ended unfinished for B and fenced A, in every case');
      assert.equal(results.filter((r) => r.scenario === 'fresh' && r.label === 'TRANSITION:FINALIZED').length, 1);
      t.diagnostic(`RP-04: ${results.length} points, write sites covered: ${[...covered].sort().join(', ')}; A pid ${A.pid}, B pid ${B.pid}`);
    });
  });

  it('RP-05 a stale notification outcome cannot overwrite a claim another process owns: A is on the wire, its claim lapses, B takes over, claims, sends and records; A\'s late outcome changes nothing', async (t) => {
    await traced(async () => {
      const { A, B } = await spawnPair();
      const sc = SCENARIOS.fresh;
      await world(sc);
      await Promise.all([A.must('resetFaults'), B.must('resetFaults')]);
      // hold the FIRST notification request (A's, for E1) at the stub: A has claimed and is "on the wire"
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => { release = r; });
      let reached: () => void = () => undefined;
      const onTheWire = new Promise<void>((r) => { reached = r; });
      let first = true;
      stub.notificationGate = async () => { if (!first) return; first = false; reached(); await held; };

      const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 180_000);
      aRun.catch(() => undefined);
      await onTheWire;
      const entryA = (await ev.raw('leaderboard_entries')).find((e) => e.userId.$oid === E1 || e.userId === E1)!;
      assert.ok(entryA.rewardNotifyClaimToken, 'A holds the notification claim of the first student');
      const claimOfA = entryA.rewardNotifyClaimToken;
      assert.ok(!entryA.rewardNotifiedAt);
      assert.equal(stub.of('notification').length, 1);
      assert.equal(stub.of('notification')[0].worker, 'A');
      assert.equal(stub.of('notification')[0].openTx, 0, 'the request is in flight with no transaction open');

      await A.must('stopHeartbeat');
      await A.must('freezeLocalClock');
      await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
      // the claim TTL (60 s) cannot be waited for in a test: make it lapse in the database, exactly what the passage of time would do
      await admin.$runCommandRaw({ update: 'leaderboard_entries', updates: [{ q: { rewardNotifyClaimToken: claimOfA }, u: { $set: { rewardNotifyClaimExpiresAt: { $date: new Date(Date.now() - 1000).toISOString() } } } }] });

      const b = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000);
      assert.equal(b.result.status, 'FINALIZED');
      const e1AfterB = (await ev.raw('leaderboard_entries')).find((e) => (e.userId.$oid ?? e.userId) === E1)!;
      assert.ok(e1AfterB.rewardNotifiedAt, 'B recorded the delivery');
      assert.equal(e1AfterB.rewardNotifyClaimToken ?? null, null, 'B cleared its own claim');
      const fpB = await ev.fingerprint();
      const markerB = await ev.oplogMarker();

      release();                                                       // A's HTTP call returns; A now tries to record ITS outcome
      const a = (await aRun).value;
      const fpA = await ev.fingerprint();
      const e1AfterA = (await ev.raw('leaderboard_entries')).find((e) => (e.userId.$oid ?? e.userId) === E1)!;

      assert.deepEqual(e1AfterA, e1AfterB, 'A\'s late outcome did not touch the entry B settled');
      assert.equal(fpA, fpB, 'fingerprint unchanged by A\'s late outcome and by everything A did afterwards');
      assert.deepEqual(await ev.writesSince(markerB), [], 'MongoDB\'s oplog: A wrote nothing after B finished');
      assert.equal(a.outcome, 'resolved');
      assert.equal(a.result.status, 'ALREADY_FINALIZED', 'A was stopped by the fence at its next write');
      const toE1 = stub.of('notification').filter((n) => n.userId === E1);
      assert.deepEqual(toE1.map((n) => n.worker).sort(), ['A', 'B'], 'the first student got the message twice: A\'s was already on the wire when its claim lapsed - AT-LEAST-ONCE, not exactly-once');
      for (const u of ['e2', 'e3', 'e4', 'e5']) assert.equal(stub.of('notification').filter((n) => n.userId!.endsWith(u)).length, 1);
      assert.equal(stub.of('notification').filter((n) => n.worker === 'A').length, 1, 'A sent nothing else');
      const e1Requests = stub.of('notification').filter((n) => n.userId === E1);
      assert.deepEqual(e1Requests.map((n) => n.idempotencyKey), [`reward_lb_notify_${MONTH}_${YEAR}_${E1}`, `reward_lb_notify_${MONTH}_${YEAR}_${E1}`], 'both requests carry the same key (FIX 06C-4B2B2)');
      assert.deepEqual(e1Requests.map((n) => n.outcome), ['created', 'deduplicated'], 'the second is a replay for the User Service');
      assert.equal(stub.notifications.filter((n) => n.userId === E1).length, 1, 'ONE notification stored for E1');
      assert.equal(stub.pushes, 5, 'one push per learner');

      for (const r of stub.requests) assert.equal(r.openTx, 0);
      await assertRewardInvariants(ev, sc, 'RP-05');
      assert.equal(await ev.summary(MONTH, YEAR), reference.fresh.summary);
      t.diagnostic(`RP-05: A pid ${A.pid} had claim ${String(claimOfA).slice(0, 8)}… on the wire (stub held the request); B pid ${B.pid} took over after MongoDB confirmed the lease expiry, claimed after the claim lapsed, sent and recorded; A's late outcome: entry byte-identical, oplog writes 0. 2 requests for E1 (A+B, same key; requests stay at-least-once), 1 notification stored, ${stub.pushes} pushes for 5 learners.`);
    });
  });
});
