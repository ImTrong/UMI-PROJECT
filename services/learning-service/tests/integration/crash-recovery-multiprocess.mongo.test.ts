/**
 * FIX 06C-4A: CRASH RECOVERY of the real monthly finalization between independent Node.js PROCESSES.
 *
 * Worker A (a separate OS process: own PID, own PrismaClient / pools) runs the production `LeaderboardService.finalizeMonth` and is stopped at a
 * chosen boundary by a barrier placed from the worker side; the controller then SIGKILLs it (a real death: no cleanup, no release, no outcome).
 * It records the database at the crash, waits until MongoDB itself says the lease has expired, lets worker B (another process) take over through
 * the normal lock and finish through the normal flow, and compares the result - field by field - with a plain single-process run.
 * 06C-3 parked A and RESUMED it (a stalled process); here A is DEAD. Both are needed: a stalled process can still wake up, a dead one cannot.
 *
 * CRASH POINTS DERIVED FROM THE CODE (LeaderboardService.finalizeMonth -> finalizeOwned -> buildSnapshot / rewardPhase)
 *   barrier                         period status / what is durable when A dies                                   B's first step               re-runnable
 *   before TX#1 (after acquire)     ACTIVE, lock row of A, nothing else                                           claim ACTIVE->BUILDING       everything
 *   before TX#2                     SNAPSHOT_BUILDING (claim committed), no entries                               claim BUILDING->BUILDING     snapshot build
 *   INSIDE the snapshot tx          SNAPSHOT_BUILDING; the tx is OPEN: fence + delete done, NOT committed -> the   claim BUILDING->BUILDING     snapshot build
 *                                   server aborts it when the connection dies; stale leftovers must still exist
 *   before TX#3                     SNAPSHOT_FROZEN, 5 entries (snapshot committed atomically with the status)    ->REWARDING (no rebuild)     reward phase only
 *   before/after each reward tx     REWARDING; wallet / ledger / badge / claim committed so far; entries NOT yet   ->REWARDING; idempotent       per student: award (key), badge
 *                                   linked (persistEntryRewards runs after the loop); notification outcomes are    per-student steps
 *                                   separate single-document writes
 *   after CLAIM commit              claim of A on the entry (60 s), nothing sent                                  skips that entry (claim live) until the claim lapses, then retry sends once
 *   HTTP received, outcome unsaved  claim of A, the User Service HAS the message                                 same: retry after the claim lapses sends it AGAIN (at-least-once)
 *   before FINALIZED tx             REWARDING, every reward committed and linked                                  ->FINALIZED
 *   after FINALIZED commit          FINALIZED; A's lock row left behind (inert: a FINALIZED period cannot be locked)   read-only ALREADY_FINALIZED
 * Atomic together: lock fence + CAS + the writes of one transaction (snapshot: delete + insert + status; award: wallet + ledger).
 * Independent commits: each transaction above, each notification outcome, the lock row (acquire / renew / release).
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" npm test
 * Own database (`<name>_mpc`), created with `prisma db push`, dropped afterwards. Workers refuse any database whose name lacks "test".
 * Notifications stay AT-LEAST-ONCE (CR-05 shows the duplicate); the idempotency contract needed to remove it is FIX 06C-4B.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { resolveTestDb } from '../helpers/test-db-url';
import { FINALIZE_WORKER, Worker, WorkerPool } from '../helpers/mp/harness';
import { Evidence } from '../helpers/mp/evidence';
import { StubUserService } from '../helpers/mp/stub-user-service';
import { E1, E2, MONTH, YEAR, SCENARIOS, Scenario, seedCompletions } from '../helpers/mp/dataset';
import { assertRewardInvariants, labelTx, snapshotFields } from '../helpers/mp/reward-evidence';

const target = resolveTestDb('mpc');
const ALLOWED_NEXT: Record<string, string[]> = {
  ACTIVE: ['SNAPSHOT_BUILDING'], SNAPSHOT_BUILDING: ['SNAPSHOT_FROZEN'], SNAPSHOT_FROZEN: ['REWARDING'], REWARDING: ['FINALIZED'],
};
class PrefixMismatch extends Error {}

describe('REAL MULTI-PROCESS: crash recovery of finalizeMonth', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run', timeout: 3_000_000 }, () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  let admin: any;
  let localDb: any;
  let ev: Evidence;
  let stub: StubUserService;
  const pools: WorkerPool[] = [];
  const reference: Record<string, { deep: string; summary: string }> = {};

  const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const fmt = (d: Date | null | undefined) => (d ? d.toISOString().slice(11, 23) + 'Z' : 'n/a');
  const HEARTBEAT_FIELDS = /"(lockExpiresAt|lockHeartbeatAt)":\{"\$date":"[^"]*"\}/g;
  const withoutHeartbeat = (fingerprint: string) => fingerprint.replace(HEARTBEAT_FIELDS, '"$1":"<renewed by the live owner>"');
  const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const idOf = (v: any): string => (v && typeof v === 'object' && '$oid' in v ? v.$oid : String(v));

  /** months 4..8 of the test year are FINALIZED, so that the production catch-up (current month = 10/2026) has exactly one open period: 9/2026 */
  const seedPastMonths = async () => {
    for (let m = 4; m <= 8; m++) {
      await admin.monthlyLeaderboard.create({ data: { month: m, year: YEAR, status: 'FINALIZED', finalizedAt: new Date('2026-01-01T00:00:00Z'), totalParticipants: 0, totalPointsAwarded: 0, finalizedBy: 'earlier' } });
    }
  };
  const world = async (sc: Scenario, opts: { pastMonths?: boolean } = {}) => {
    await ev.reset();
    stub.reset();
    await seedCompletions(admin, stub);
    await sc.setup(admin, stub);
    if (opts.pastMonths) await seedPastMonths();
  };

  const LOCK = { ttlMs: 1500, heartbeatMs: 500 };
  const spawnOne = async (pool: WorkerPool, label: string, lock = LOCK) => {
    const w = await pool.spawn(label, target.url as string, { MP_STUB_URL: stub.url, MP_LOCK_TTL_MS: String(lock.ttlMs), MP_LOCK_HB_MS: String(lock.heartbeatMs) }, FINALIZE_WORKER);
    await w.must('connect');
    return w;
  };
  const newPool = () => { const p = new WorkerPool(); pools.push(p); return p; };

  const traced = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) {
      e.message += `\n--- worker events (latest) ---\n${pools.map((p) => p.dump(60)).join('\n')}\n--- stub requests (latest) ---\n${stub.requests.slice(-14).map((r) => `${r.kind} ${r.worker} openTx=${r.openTx} ${r.userId ? r.userId.slice(-2) : ''}`).join('\n')}`;
      throw e;
    }
  };

  /** What is durable in MongoDB right now. */
  const captureState = async () => {
    const lock = await ev.lock(MONTH, YEAR);
    const entries = await ev.raw('leaderboard_entries');
    return {
      status: lock.status, fencing: lock.fencingToken, owner: lock.lockOwner, token: lock.lockToken, expired: lock.expired,
      entries: entries.length, ledger: (await ev.raw('reward_point_transactions')).length, wallets: (await ev.raw('user_reward_points')).length,
      badges: (await ev.raw('badges')).length, audits: (await ev.raw('leaderboard_audit_logs')).length,
      linked: entries.filter((e) => e.rewardBadgeId).length, notified: entries.filter((e) => e.rewardNotifiedAt).length, claims: entries.filter((e) => e.rewardNotifyClaimToken).length,
    };
  };
  type State = Awaited<ReturnType<typeof captureState>>;
  const fmtState = (s: State) => `${s.status} entries=${s.entries} ledger=${s.ledger} wallets=${s.wallets} badges=${s.badges} linked=${s.linked} notified=${s.notified} claims=${s.claims} audits=${s.audits}`;

  /**
   * A heartbeat renewal that collides with the write of a fence makes production retry that transaction (fencedTx): the refused attempt is
   * one more transaction than the plan has, and every ordinal armed after it would land one transaction early. A plan is therefore learned
   * only from a run without such a retry, and a barrier that landed after one is thrown away (PrefixMismatch) and armed again.
   */
  const shifts = { planRelearned: 0, barrierRelanded: 0 };       // reported once at the end: how often a heartbeat/fence collision had to be absorbed
  const fenceRetries = (w: Worker, from = 0) => w.events.slice(from).filter((e) => e.step === 'lock:fence-refused').length;
  const learnLabels = async (sc: Scenario, w: Worker): Promise<string[]> => {
    for (let attempt = 1; ; attempt++) {
      await world(sc);
      await w.must('resetFaults');
      const m = await w.must('mark');
      const evFrom = w.events.length;
      const r = await w.must('finalize', { month: MONTH, year: YEAR, by: 'dry-run' }, 120_000);
      assert.equal(r.outcome, sc.expect === 'FINALIZED' ? 'resolved' : 'rejected');
      if (fenceRetries(w, evFrom) === 0) return (await w.must('txPlan', { from: m.tx })).map(labelTx);
      assert.ok(attempt < 5, 'five dry runs in a row had a fenced transaction retried by a heartbeat collision: the plan cannot be learned');
      shifts.planRelearned++;
    }
  };
  const ordinalsOf = (labels: string[], keep: (label: string, index: number) => boolean) =>
    labels.map((l, i) => ({ l, k: i + 1 })).filter(({ l, k }) => keep(l, k - 1)).map(({ k }) => k);

  interface CrashPlan {
    name: string;
    arm: (A: Worker) => Promise<string>;           // arms the barrier; returns the name of the barrier point
    expectPrefix?: string[];                       // labels of the transactions A must have completed before a before-transaction barrier
    expectOpenTx?: number;
    lock?: { ttlMs: number; heartbeatMs: number };
    busyFirst?: boolean;
    allowEntryDeletes?: number;                    // stale leftovers B is expected to delete (oplog 'd' on leaderboard_entries)
  }
  interface CrashResult {
    name: string; apid: number; bpid: number; exit: string; atCrash: State; afterRecovery: State; bFirstStep: string; bOutcome: string;
    lapsed: any; takeoverMs: number; fpAtCrash: string; fpAfterKill: string; ledgerInsertsAfter: number;
  }

  /**
   * One crash: A (fresh process) is parked at the barrier and SIGKILLed; B (persistent process) recovers. Everything is verified in MongoDB.
   */
  const crashRun = async (sc: Scenario, plan: CrashPlan, pool: WorkerPool, B: Worker): Promise<CrashResult> => {
    const tag = `[${sc.key} ${plan.name}]`;
    await world(sc);
    await B.must('resetFaults');
    const markerStart = await ev.oplogMarker();
    const A = await spawnOne(pool, 'A', plan.lock);
    const aMark = await A.must('mark');
    const point = await plan.arm(A);
    const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 180_000);
    aRun.catch(() => undefined);
    const paused = await A.waitEvent('paused', (e) => e.detail.point === point, 60_000);
    if (plan.expectPrefix) {
      const done = (await A.must('txPlan', { from: aMark.tx })).map(labelTx);
      if (JSON.stringify(done) !== JSON.stringify(plan.expectPrefix)) {
        await pool.kill(A);
        throw new PrefixMismatch(`${tag} A completed ${JSON.stringify(done)} but ${JSON.stringify(plan.expectPrefix)} was expected`);
      }
    }
    assert.equal(paused.detail.openTx, plan.expectOpenTx ?? 0, `${tag} open transactions of A at the barrier`);

    // ---- the state A leaves behind
    const atCrash = await captureState();
    const fpAtCrash = await ev.fingerprint();
    const ledgerAtCrash = await ev.raw('reward_point_transactions');
    const walletsAtCrash = await ev.raw('user_reward_points');
    const badgesAtCrash = await ev.raw('badges');
    const snapAtCrash = await snapshotFields(ev);
    const stubAtCrash = stub.requests.length;
    assert.equal(atCrash.fencing, 1, `${tag} A holds fencing token 1`);
    assert.match(atCrash.owner || '', /^A @/);

    // ---- A DIES: a real SIGKILL, no cleanup of any kind
    const apid = A.pid;
    await pool.kill(A);
    assert.ok(A.exited, `${tag} the controller saw A exit`);
    assert.equal(isAlive(apid), false, `${tag} pid ${apid} no longer exists`);
    await new Promise((r) => setTimeout(r, 50));
    const fpAfterKill = await ev.fingerprint();
    // A is alive until the SIGKILL and its heartbeat keeps renewing the lease, so a renewal can land between the capture and the kill. That
    // is the live owner's own write and touches only these two fields; everything else must be byte for byte what A had left.
    assert.equal(withoutHeartbeat(fpAfterKill), withoutHeartbeat(fpAtCrash), `${tag} the death itself changed nothing in MongoDB`);
    // ... and a dead process renews nothing: after more than one heartbeat period the row is exactly as it was right after the kill
    await new Promise((r) => setTimeout(r, (plan.lock ?? LOCK).heartbeatMs + 200));
    assert.equal(await ev.fingerprint(), fpAfterKill, `${tag} nothing at all (heartbeat included) was written after the kill`);
    const afterKill = await ev.lock(MONTH, YEAR);
    assert.equal(afterKill.lockToken, atCrash.token, `${tag} A's lock row was left behind`);
    const markerKill = await ev.oplogMarker();
    if (plan.busyFirst && afterKill.expired === false) {
      const busy = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 60_000);
      assert.equal(busy.result.status, 'BUSY', `${tag} a dead owner's lease is respected until MongoDB says it lapsed`);
      assert.deepEqual(Evidence.businessWrites(await ev.writesSince(markerKill)), [], `${tag} BUSY wrote nothing`);
    }

    // ---- MongoDB declares the lease over; B takes over through the normal lock and finishes through the normal flow
    const lapsed = await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
    const bEvFrom = B.events.length;
    const t0 = Date.now();
    const bReply = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 180_000);
    const takeoverMs = Date.now() - t0;
    if (sc.expect === 'FINALIZED') {
      assert.equal(bReply.outcome, 'resolved', `${tag} B: ${JSON.stringify(bReply.error)}`);
      assert.equal(bReply.result.status, 'FINALIZED');
    } else {
      assert.equal(bReply.outcome, 'rejected', `${tag} an unfinishable period must not be finished`);
      assert.equal(bReply.error.name, 'LeaderboardRewardIncompleteError');
    }
    const bFirst = B.events.slice(bEvFrom).find((e) => e.step === 'transition' || e.step === 'transition:error');
    const bFirstStep = bFirst ? `${(bFirst.detail.from || []).join('|')}->${bFirst.detail.to}` : 'none';
    const afterRecovery = await captureState();

    // ---- everything verified in MongoDB
    await assertRewardInvariants(ev, sc, tag);
    assert.equal(await ev.deepSummary(MONTH, YEAR), reference[sc.key].deep, `${tag} the recovered period equals a plain run, field by field`);
    // what A had committed is still there, unchanged
    const ledgerNow = await ev.raw('reward_point_transactions');
    for (const old of ledgerAtCrash) assert.deepEqual(ledgerNow.find((x) => idOf(x._id) === idOf(old._id)), old, `${tag} a ledger entry A committed is unchanged`);
    const walletsNow = await ev.raw('user_reward_points');
    for (const old of walletsAtCrash) {
      const now = walletsNow.find((x) => idOf(x._id) === idOf(old._id));
      assert.ok(now, `${tag} the wallet A created is the same document`);
      if (Number(old.balance?.$numberInt ?? old.balance) > 0) assert.deepEqual(now.balance, old.balance, `${tag} a balance A had credited is not credited again`);
    }
    const badgesNow = await ev.raw('badges');
    for (const old of badgesAtCrash) assert.deepEqual(badgesNow.find((x) => idOf(x._id) === idOf(old._id)), old, `${tag} a badge A created is unchanged`);
    if (JSON.parse(snapAtCrash).length > 0 && atCrash.status !== 'SNAPSHOT_BUILDING') assert.equal(await snapshotFields(ev), snapAtCrash, `${tag} the frozen snapshot (ids and content) was not rebuilt`);
    // the history after the crash: exactly the missing work, nothing twice, nothing deleted
    const after = await ev.writesSince(markerKill);
    const inserts = (coll: string) => after.filter((w) => w.coll === coll && w.op === 'i').length;
    assert.equal(inserts('reward_point_transactions'), ledgerNow.length - ledgerAtCrash.length, `${tag} ledger inserts after the crash = the missing entries, no more`);
    assert.equal(inserts('user_reward_points'), walletsNow.length - walletsAtCrash.length, `${tag} wallet inserts after the crash = the missing wallets`);
    assert.equal(inserts('badges'), badgesNow.length - badgesAtCrash.length, `${tag} badge inserts after the crash = the missing badges`);
    const snapshotCommitted = atCrash.status !== 'ACTIVE' && atCrash.status !== 'SNAPSHOT_BUILDING';
    assert.equal(inserts('leaderboard_entries'), snapshotCommitted ? 0 : 5, `${tag} the snapshot is ${snapshotCommitted ? 'not rebuilt' : 'built exactly once'}`);
    assert.equal(after.filter((w) => w.op === 'd' && w.coll !== 'monthly_leaderboards').length, plan.allowEntryDeletes ?? 0, `${tag} deletions after the crash`);
    const seq = Evidence.statusSequence(await ev.writesSince(markerStart));
    for (let i = 1; i < seq.length; i++) assert.ok((ALLOWED_NEXT[seq[i - 1]] || []).includes(seq[i]), `${tag} illegal transition ${seq[i - 1]} -> ${seq[i]} (${seq.join(' > ')})`);
    if (sc.expect === 'INCOMPLETE') assert.ok(!seq.includes('FINALIZED'), `${tag} an unfinishable period must not become FINALIZED`);
    // notifications: nothing pending, nothing sent twice (no process died between a send and its outcome here), nothing inside a transaction
    for (const r of stub.requests) assert.equal(r.openTx, 0, `${tag} ${r.kind} request sent with ${r.openTx} transaction(s) open`);
    const expectedRecipients = (JSON.parse(reference[sc.key].summary).entries as any[]).filter((e) => e[8]).map((e) => e[0]).sort();
    const perUser = new Map<string, number>();
    for (const n of stub.of('notification')) perUser.set(n.userId!, (perUser.get(n.userId!) || 0) + 1);
    assert.deepEqual([...perUser.keys()].sort(), expectedRecipients, `${tag} the right students were notified`);
    for (const [u, c] of perUser) assert.equal(c, 1, `${tag} ${u.slice(-2)} notified ${c} times`);
    void stubAtCrash;
    // a FINALIZED period answers every later call read-only
    if (sc.expect === 'FINALIZED') {
      const markerDone = await ev.oplogMarker();
      const again = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B-again' }, 60_000);
      assert.equal(again.result.status, 'ALREADY_FINALIZED', `${tag} a retry after FINALIZED`);
      assert.deepEqual(await ev.writesSince(markerDone), [], `${tag} the retry wrote nothing`);
    }
    return {
      name: plan.name, apid, bpid: B.pid, exit: `${A.exited!.signal ?? 'code ' + A.exited!.code}`, atCrash, afterRecovery, bFirstStep,
      bOutcome: bReply.outcome === 'resolved' ? bReply.result.status : bReply.error.name, lapsed, takeoverMs, fpAtCrash, fpAfterKill, ledgerInsertsAfter: inserts('reward_point_transactions'),
    };
  };

  const crashPoint = async (sc: Scenario, plan: CrashPlan, pool: WorkerPool, B: Worker): Promise<CrashResult> => {
    for (let attempt = 1; ; attempt++) {
      try { return await crashRun(sc, plan, pool, B); } catch (e) {
        if (e instanceof PrefixMismatch && attempt === 1) { shifts.barrierRelanded++; continue; }   // a heartbeat/transaction conflict shifted the ordinal: land the barrier again, once; never report an unlanded point as tested
        throw e;
      }
    }
  };
  /** The barrier armed by ordinal landed after a fence retry of A (see fenceRetries): drop A (and the helpers of that attempt), the caller lands the barrier again. */
  const assertNoShift = async (pool: WorkerPool, A: Worker, what: string, others: Worker[] = []) => {
    if (fenceRetries(A) === 0) return;
    for (const w of [A, ...others]) await pool.kill(w).catch(() => undefined);
    throw new PrefixMismatch(`${what}: A had a fenced transaction retried before the barrier, the armed ordinal is off by one`);
  };
  /** Runs `body` again (up to `attempts` runs in all) when its barrier landed one transaction early; any other failure is final. */
  const onceMoreOnShift = async (body: () => Promise<void>, attempts = 2) => {
    for (let attempt = 1; ; attempt++) {
      try { return await body(); } catch (e) {
        if (e instanceof PrefixMismatch && attempt < attempts) { shifts.barrierRelanded++; continue; }
        throw e;
      }
    }
  };
  const beforeTx = (k: number, labels: string[]): CrashPlan['arm'] => async (A) => { await A.must('armTxPause', { at: k }); void labels; return `TX#${k}`; };
  const line = (r: CrashResult) =>
    `${r.name.padEnd(34)} A pid ${r.apid} killed (${r.exit}) | at crash: ${fmtState(r.atCrash)} | B pid ${r.bpid}: first step ${r.bFirstStep} -> ${r.bOutcome} | after: ${fmtState(r.afterRecovery)} | lease over per MongoDB ${fmt(r.lapsed.serverNow)} | fp at crash ${sha(r.fpAtCrash)} == after kill ${sha(r.fpAfterKill)}`;

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
    const pool = newPool();
    const R = await spawnOne(pool, 'R', { ttlMs: 3000, heartbeatMs: 1000 });
    for (const sc of Object.values(SCENARIOS)) {
      await world(sc);
      const r = await R.must('finalize', { month: MONTH, year: YEAR, by: 'R' }, 120_000);
      assert.equal(r.outcome, sc.expect === 'FINALIZED' ? 'resolved' : 'rejected', `reference run of "${sc.key}"`);
      await assertRewardInvariants(ev, sc, `reference ${sc.key}`);
      reference[sc.key] = { deep: await ev.deepSummary(MONTH, YEAR), summary: await ev.summary(MONTH, YEAR) };
    }
    assert.equal(reference.leftover.deep, reference.fresh.deep, 'a rebuilt leftover snapshot ends exactly like a fresh one');
    await pool.shutdown();
  });

  after(async () => {
    const spawnRetries = pools.reduce((n, p) => n + (p.spawnRetries || 0), 0);
    console.log(`# crash-recovery harness: worker start-up retries ${spawnRetries}, plans learned again ${shifts.planRelearned}, barriers landed again ${shifts.barrierRelanded} (heartbeat/fence collisions or start-up crashes absorbed; an unlanded point is never reported as tested)`);
    for (const p of pools) await p.shutdown();
    await stub?.stop().catch(() => undefined);
    try { await admin.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
    await localDb?.$disconnect();
  });

  // ==============================================================================================

  it('CR-00 the transactions of a plain run are learned from the real flow (they define the crash boundaries), and a killed worker is really gone', async (t) => {
    await traced(async () => {
      const pool = newPool();
      const A = await spawnOne(pool, 'A');
      const labels = await learnLabels(SCENARIOS.fresh, A);
      assert.equal(labels.length, 25);
      assert.deepEqual(labels.slice(0, 3), ['TRANSITION:SNAPSHOT_BUILDING', 'SNAPSHOT', 'TRANSITION:REWARDING']);
      // every reward notification of the plain run carried the shared internal token (the loopback User Service refuses the others, FIX 06C-4B2A)
      const sentNotifications = stub.of('notification');
      assert.equal(sentNotifications.length, 5, 'one notification per rewarded learner');
      assert.ok(sentNotifications.every((n) => n.authenticated === true && n.status === 201 && n.outcome === 'created'), 'all authenticated and created');
      assert.ok(sentNotifications.every((n) => n.idempotencyKey === `reward_lb_notify_${MONTH}_${YEAR}_${n.userId}`), 'each carries the key of its reward event (FIX 06C-4B2B2)');
      const pid = A.pid;
      await pool.kill(A);
      assert.ok(A.exited);
      assert.equal(isAlive(pid), false);
      await assert.rejects(A.send('ping'), /not running/, 'a dead worker answers nothing');
      t.diagnostic(`controller pid ${process.pid}; worker pid ${pid} SIGKILLed: exit ${JSON.stringify(A.exited)}, process.kill(pid,0) throws; fresh run = ${labels.length} transactions: ${labels.join(' ')}`);
    });
  });

  describe('CR-01 crash before and during the snapshot', () => {
    it('CR-01a/b/c A dies right after the lock (before TX#1), in SNAPSHOT_BUILDING (before TX#2), and just after the snapshot was frozen (before TX#3); B recovers; a frozen snapshot is never rebuilt', async (t) => {
      await traced(async () => {
        const pool = newPool();
        const B = await spawnOne(pool, 'B', { ttlMs: 4000, heartbeatMs: 1000 });
        const labels = await learnLabels(SCENARIOS.fresh, await spawnOne(pool, 'dry', LOCK));
        const results: CrashResult[] = [];
        for (const k of [1, 2, 3]) {
          const r = await crashPoint(SCENARIOS.fresh, { name: `before TX#${k} ${labels[k - 1]}`, arm: beforeTx(k, labels), expectPrefix: labels.slice(0, k - 1), lock: { ttlMs: 4000, heartbeatMs: 1000 }, busyFirst: true }, pool, B);
          results.push(r);
        }
        assert.deepEqual(results.map((r) => r.atCrash.status), ['ACTIVE', 'SNAPSHOT_BUILDING', 'SNAPSHOT_FROZEN']);
        assert.deepEqual(results.map((r) => r.atCrash.entries), [0, 0, 5]);
        assert.equal(results[2].afterRecovery.entries, 5);
        results.forEach((r) => t.diagnostic(line(r)));
      });
    });

    it('CR-01d A is SIGKILLed INSIDE the snapshot transaction (open: fence and delete done): nothing is committed and the stale leftover survives; MongoDB keeps the transaction of the dead owner until its lifetime limit, which delays B - and the lease B ends up with must be usable', async (t) => {
      await traced(async () => {
        const pool = newPool();
        const B = await spawnOne(pool, 'B');
        const sc = SCENARIOS.leftover;
        const r = await crashPoint(sc, { name: 'inside the snapshot transaction', arm: async (A) => { await A.must('armInsideSnapshotTx'); return 'INSIDE_SNAPSHOT_TX'; }, expectOpenTx: 1, allowEntryDeletes: 1 }, pool, B);
        // at the crash the leftover of the older run was still the only content of the table: A's delete + insert were never committed
        assert.equal(r.atCrash.status, 'SNAPSHOT_BUILDING');
        assert.equal(r.atCrash.entries, 1, 'the stale leftover is still there (the delete of the open transaction was NOT committed)');
        // B finished although its first acquire attempt was blocked by the orphaned transaction: the lease it ended up with is a fresh, usable one
        assert.ok(r.afterRecovery.fencing === 2 || r.afterRecovery.fencing === 3, `fencing token after recovery: ${r.afterRecovery.fencing}`);
        assert.ok(r.takeoverMs < 150_000, `B finished ${r.takeoverMs} ms after the lease expiry`);
        t.diagnostic(line(r));
        t.diagnostic(`CR-01d: B needed ${r.takeoverMs} ms from the lease expiry to a FINALIZED period; fencing token after recovery ${r.afterRecovery.fencing} (${r.afterRecovery.fencing === 3 ? 'its first acquire was blocked by an open transaction of the dead owner past the lease it was granted, was handed back, and repeated' : 'no blocking this time'}). MongoDB (server transactionLifetimeLimitSeconds 60) keeps an orphaned transaction - and its write lock on the period row - until its lifetime limit plus the period of the abort job; a minimal probe (one raw update, then idle) was released at once, the real snapshot transaction was not - the reason for that difference is not established.`);
      });
    });
  });

  describe('CR-02 crash during the payout', () => {
    it('CR-02 A is SIGKILLed before EACH transaction of the reward phase of a full run (22 points: wallet, award, badge, claim of five students, persist, FINALIZED); B recovers every time with no duplicate and an identical result', async (t) => {
      await traced(async () => {
        const pool = newPool();
        const B = await spawnOne(pool, 'B');
        const dry = await spawnOne(pool, 'dry');
        const labels = await learnLabels(SCENARIOS.fresh, dry);
        await pool.kill(dry);
        const ordinals = ordinalsOf(labels, (_l, i) => i >= 3);
        assert.equal(ordinals.length, 22);
        const results: CrashResult[] = [];
        for (const k of ordinals) results.push(await crashPoint(SCENARIOS.fresh, { name: `before TX#${k} ${labels[k - 1]}`, arm: beforeTx(k, labels), expectPrefix: labels.slice(0, k - 1) }, pool, B));
        results.forEach((r) => t.diagnostic(line(r)));
        // the payout progressed through every stage and each crash resumed from exactly what was durable
        assert.equal(results[0].atCrash.ledger, 0);
        assert.equal(results[results.length - 1].atCrash.ledger, 5);
        assert.equal(results[results.length - 1].atCrash.linked, 5, 'by the last transaction every entry already links its badge');
        assert.ok(results.every((r) => r.afterRecovery.status === 'FINALIZED' && r.afterRecovery.ledger === 5 && r.afterRecovery.badges === 5 && r.afterRecovery.wallets === 5));
        t.diagnostic(`CR-02: ${results.length} real kills, A pids ${[...new Set(results.map((r) => r.apid))].length} distinct, B pid ${B.pid}; ledger durable at the crash by point: ${results.map((r) => r.atCrash.ledger).join(',')}`);
      });
    });

    it('CR-02e A is SIGKILLed on paths a clean run never takes: a learner skipped for eligibility, an integrity conflict (audits, incomplete totals), a wallet that disagrees with its ledger; an unfinishable period is never FINALIZED', async (t) => {
      await traced(async () => {
        const pool = newPool();
        const B = await spawnOne(pool, 'B');
        const dry = await spawnOne(pool, 'dry');
        const plans: Array<{ key: keyof typeof SCENARIOS; keep: (l: string) => boolean }> = [
          { key: 'skip', keep: (l) => l === 'SKIP' },
          { key: 'conflict', keep: (l) => l.startsWith('AUDIT:') || l === 'TOTALS_INCOMPLETE' },
          { key: 'walletgap', keep: (l) => l === 'AUDIT:REWARD_LEDGER_MISMATCH' },
        ];
        const results: CrashResult[] = [];
        for (const p of plans) {
          const sc = SCENARIOS[p.key];
          const labels = await learnLabels(sc, dry);
          for (const k of ordinalsOf(labels, (l) => p.keep(l))) results.push(await crashPoint(sc, { name: `${p.key} before TX#${k} ${labels[k - 1]}`, arm: beforeTx(k, labels), expectPrefix: labels.slice(0, k - 1) }, pool, B));
        }
        results.forEach((r) => t.diagnostic(line(r)));
        const conflict = results.filter((r) => r.name.startsWith('conflict'));
        assert.equal(conflict.length, 4);
        assert.ok(conflict.every((r) => r.bOutcome === 'LeaderboardRewardIncompleteError' && r.afterRecovery.status === 'REWARDING'), 'with a required reward missing the period stays REWARDING, in every case');
        assert.equal(results.filter((r) => r.name.startsWith('skip')).length, 1);
        assert.equal(results.filter((r) => r.name.startsWith('walletgap')).length, 1);
      });
    });
  });

  describe('CR-03 crash around the final transition', () => {
    it('CR-03b A is SIGKILLed right AFTER the FINALIZED transaction committed (before it got its result); B and the production catch-up (another process) only read; the period is never reopened', async (t) => {
      await traced(async () => {
        const sc = SCENARIOS.fresh;
        await world(sc, { pastMonths: true });
        const pool = newPool();
        const A = await spawnOne(pool, 'A');
        const B = await spawnOne(pool, 'B');
        const C = await spawnOne(pool, 'C');
        await C.must('setClock', { month: 10, year: YEAR });
        await A.must('armAfterTx', { label: 'TRANSITION:FINALIZED', occurrence: 1 });
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 120_000);
        aRun.catch(() => undefined);
        await A.waitEvent('paused', (e) => e.detail.point === 'AFTER_TX:TRANSITION:FINALIZED#1', 60_000);
        const atCrash = await captureState();
        assert.equal(atCrash.status, 'FINALIZED', 'the FINALIZED transaction is durable');
        assert.ok(atCrash.token, 'and A never released its lock');
        const fpCrash = await ev.fingerprint();
        const apid = A.pid;
        await pool.kill(A);
        assert.equal(isAlive(apid), false);
        const marker = await ev.oplogMarker();

        const race = await pool.raceJobs([{ worker: B, cmd: 'finalize', args: { month: MONTH, year: YEAR, by: 'B' } }, { worker: C, cmd: 'reconcile', args: { initiator: 'SYSTEM_RECONCILE' } }], { timeoutMs: 60_000 });
        assert.equal(race.replies[0].value.result.status, 'ALREADY_FINALIZED', 'finalizeMonth in B answers read-only, although A\'s lease is still recorded and valid');
        assert.deepEqual(race.replies[1].value.result, { finalizedMonths: [], busyMonths: [] }, 'the production catch-up (current month 10/2026, window 4..9) finds nothing to do');
        assert.equal(await ev.fingerprint(), fpCrash, 'MongoDB is byte-identical after B and the catch-up ran');
        assert.deepEqual(await ev.writesSince(marker), [], 'not one write');
        const lock = await ev.lock(MONTH, YEAR);
        assert.equal(lock.lockToken, atCrash.token, 'the leftover lock of the dead owner is inert');
        // nothing can lock a FINALIZED period, whoever asks
        assert.deepEqual((await B.must('finalize', { month: MONTH, year: YEAR, by: 'again', options: { simulateFailureAt: 'BEFORE_FINALIZED' } })).result.status, 'ALREADY_FINALIZED');
        await assertRewardInvariants(ev, sc, 'CR-03b', { allowLeftoverLock: true });
        assert.equal(await ev.deepSummary(MONTH, YEAR), reference.fresh.deep);
        t.diagnostic(`CR-03b: A pid ${apid} killed after the FINALIZED commit (lock row of A still recorded, fencing ${atCrash.fencing}); B pid ${B.pid} finalizeMonth -> ALREADY_FINALIZED, C pid ${C.pid} catch-up -> nothing to do, oplog writes 0, fingerprint ${sha(fpCrash)} unchanged`);
      });
    });

    it('CR-03c the same moment, but A is only PAUSED and then resumed (a stalled process is not a dead one): it returns FINALIZED, releases its lock, and the data equals the plain run', async (t) => {
      await traced(async () => {
        const sc = SCENARIOS.fresh;
        await world(sc);
        const pool = newPool();
        const A = await spawnOne(pool, 'A');
        await A.must('armAfterTx', { label: 'TRANSITION:FINALIZED', occurrence: 1 });
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 120_000);
        aRun.catch(() => undefined);
        await A.waitEvent('paused', (e) => e.detail.point === 'AFTER_TX:TRANSITION:FINALIZED#1', 60_000);
        assert.equal((await captureState()).status, 'FINALIZED');
        await A.must('resume', { point: 'AFTER_TX:TRANSITION:FINALIZED#1' });
        const a = (await aRun).value;
        assert.equal(a.outcome, 'resolved');
        assert.equal(a.result.status, 'FINALIZED', 'A receives its result');
        await assertRewardInvariants(ev, sc, 'CR-03c');
        assert.equal(await ev.deepSummary(MONTH, YEAR), reference.fresh.deep);
        t.diagnostic(`CR-03c: A pid ${A.pid} resumed after the FINALIZED commit -> FINALIZED, lock released; == plain run`);
      });
    });

    it('CR-03d A is SIGKILLed before the FINALIZED transaction; after MongoDB declares the lease over, finalizeMonth in B and the production catch-up in C start at the same instant: exactly one completes the period', async (t) => {
      await traced(async () => {
        const sc = SCENARIOS.fresh;
        const pool = newPool();
        const dry = await spawnOne(pool, 'dry');
        const labels = await learnLabels(sc, dry);
        await pool.kill(dry);
        for (let round = 1; round <= 3; round++) await onceMoreOnShift(async () => {          // the unit that is landed again is one round, not the whole test
          await world(sc, { pastMonths: true });
          const B = await spawnOne(pool, 'B');
          const C = await spawnOne(pool, 'C');
          await C.must('setClock', { month: 10, year: YEAR });
          const A = await spawnOne(pool, 'A');
          const marker = await ev.oplogMarker();
          const k = labels.length;                       // the FINALIZED transaction
          await A.must('armTxPause', { at: k });
          const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 120_000);
          aRun.catch(() => undefined);
          await A.waitEvent('paused', (e) => e.detail.point === `TX#${k}`, 60_000);
          await assertNoShift(pool, A, `CR-03d round ${round}`, [B, C]);
          const atCrash = await captureState();
          assert.equal(atCrash.status, 'REWARDING');
          assert.equal(atCrash.ledger, 5);
          assert.equal(atCrash.linked, 5);
          await pool.kill(A);
          await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
          const race = await pool.raceJobs([{ worker: B, cmd: 'finalize', args: { month: MONTH, year: YEAR, by: 'B' } }, { worker: C, cmd: 'reconcile', args: { initiator: 'SYSTEM_RECONCILE' } }], { timeoutMs: 120_000 });
          const bStatus = race.replies[0].value.outcome === 'resolved' ? race.replies[0].value.result.status : `rejected ${race.replies[0].value.error.name}`;
          const cRes = race.replies[1].value;
          assert.equal(cRes.outcome, 'resolved', JSON.stringify(cRes.error));
          const cFinalized = cRes.result.finalizedMonths.includes(`${MONTH}/${YEAR}`);
          assert.equal((bStatus === 'FINALIZED' ? 1 : 0) + (cFinalized ? 1 : 0), 1, `round ${round}: exactly one of them completed the period (B: ${bStatus}; catch-up: ${JSON.stringify(cRes.result)})`);
          assert.ok(['FINALIZED', 'BUSY', 'ALREADY_FINALIZED'].includes(bStatus));
          await assertRewardInvariants(ev, sc, `CR-03d round ${round}`);
          assert.equal(await ev.deepSummary(MONTH, YEAR), reference.fresh.deep, `round ${round}: == plain run`);
          const writes = await ev.writesSince(marker);
          assert.equal(writes.filter((w) => w.coll === 'reward_point_transactions' && w.op === 'i').length, 5, `round ${round}: five ledger inserts in the whole history`);
          assert.equal(writes.filter((w) => w.coll === 'badges' && w.op === 'i').length, 5);
          assert.equal(writes.filter((w) => w.coll === 'leaderboard_entries' && (w.op === 'i' || w.op === 'd')).length, 5, `round ${round}: the snapshot exists once and was never deleted`);
          assert.equal((await ev.lock(MONTH, YEAR)).fencingToken, 2, `round ${round}: one takeover after A`);
          t.diagnostic(`CR-03d round ${round}: A pid ${A.pid} killed before FINALIZED (REWARDING, ledger 5, linked 5); B pid ${B.pid} -> ${bStatus}; catch-up C pid ${C.pid} -> finalizedMonths ${JSON.stringify(cRes.result.finalizedMonths)} busy ${JSON.stringify(cRes.result.busyMonths)}; start skew ${race.startSkewMs} ms`);
        }, 3);
      });
    });

    it('CR-03e a LIVE owner parked before the FINALIZED transaction (heartbeat running) is respected by finalizeMonth and by the catch-up in other processes; it then completes normally', async (t) => {
      await traced(() => onceMoreOnShift(async () => {
        const sc = SCENARIOS.fresh;
        await world(sc, { pastMonths: true });
        const pool = newPool();
        const dry = await spawnOne(pool, 'dry');
        const labels = await learnLabels(sc, dry);
        await pool.kill(dry);
        await world(sc, { pastMonths: true });
        const A = await spawnOne(pool, 'A');
        const B = await spawnOne(pool, 'B');
        const C = await spawnOne(pool, 'C');
        await C.must('setClock', { month: 10, year: YEAR });
        await A.must('armTxPause', { at: labels.length });
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 120_000);
        aRun.catch(() => undefined);
        await A.waitEvent('paused', (e) => e.detail.point === `TX#${labels.length}`, 60_000);
        await assertNoShift(pool, A, 'CR-03e', [B, C]);
        await new Promise((r) => setTimeout(r, 2200));                    // longer than the lease: only the heartbeat keeps A the owner
        assert.equal((await ev.lock(MONTH, YEAR)).expired, false, 'MongoDB: the lease is alive thanks to the heartbeat');
        const marker = await ev.oplogMarker();
        const race = await pool.raceJobs([{ worker: B, cmd: 'finalize', args: { month: MONTH, year: YEAR, by: 'B' } }, { worker: C, cmd: 'reconcile', args: {} }], { timeoutMs: 60_000 });
        assert.equal(race.replies[0].value.result.status, 'BUSY');
        assert.deepEqual(race.replies[1].value.result, { finalizedMonths: [], busyMonths: [`${MONTH}/${YEAR}`] });
        assert.deepEqual(Evidence.businessWrites(await ev.writesSince(marker)), [], 'only lock bookkeeping (A\'s heartbeat) was written');
        await A.must('resume', { point: `TX#${labels.length}` });
        const a = (await aRun).value;
        assert.equal(a.result.status, 'FINALIZED', 'the live owner finishes the period');
        assert.equal((await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' })).result.status, 'ALREADY_FINALIZED');
        await assertRewardInvariants(ev, sc, 'CR-03e');
        assert.equal(await ev.deepSummary(MONTH, YEAR), reference.fresh.deep);
        t.diagnostic(`CR-03e: A pid ${A.pid} alive and parked for 2.2 s (> lease 1.5 s, kept by its heartbeat); B pid ${B.pid} -> BUSY, catch-up C pid ${C.pid} -> busy [${MONTH}/${YEAR}]; A then FINALIZED`);
      }, 3));
    });
  });

  describe('CR-04 the claim hand-back after the lock was lost', () => {
    /** A parked right after its notification claim committed (E1's claim held by A, nothing sent yet), its lease lapsed in MongoDB. */
    const parkedClaimOfA = async (pool: WorkerPool, opts: { heartbeat: boolean }) => {
      const sc = SCENARIOS.fresh;
      await world(sc);
      const A = await spawnOne(pool, 'A');
      const B = await spawnOne(pool, 'B');
      await A.must('armAfterTx', { label: 'CLAIM', occurrence: 1 });
      const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 120_000);
      aRun.catch(() => undefined);
      await A.waitEvent('paused', (e) => e.detail.point === 'AFTER_TX:CLAIM#1', 60_000);
      const entryA = (await ev.raw('leaderboard_entries')).find((e) => idOf(e.userId) === E1)!;
      assert.ok(entryA.rewardNotifyClaimToken, 'A holds the claim of the first student');
      assert.equal(stub.of('notification').length, 0, 'nothing has been sent yet');
      if (!opts.heartbeat) {
        await A.must('stopHeartbeat');
        await A.must('freezeLocalClock');
        await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
        // the claim TTL (60 s) cannot be waited for in a test: let it lapse in the database, as the passage of time would
        await admin.$runCommandRaw({ update: 'leaderboard_entries', updates: [{ q: { rewardNotifyClaimToken: entryA.rewardNotifyClaimToken }, u: { $set: { rewardNotifyClaimExpiresAt: { $date: new Date(Date.now() - 1000).toISOString() } } } }] });
      }
      return { sc, A, B, aRun, claimOfA: entryA.rewardNotifyClaimToken as string };
    };
    const entryOf = async (userId: string) => (await ev.raw('leaderboard_entries')).find((e) => idOf(e.userId) === userId)!;

    it('CR-04a A resumes (its local deadline has passed) and runs the hand-back while B owns a LIVE claim on the same entry: the hand-back changes nothing and B\'s claim and result stand', async (t) => {
      await traced(async () => {
        const pool = newPool();
        const { sc, A, B, aRun, claimOfA } = await parkedClaimOfA(pool, { heartbeat: false });
        await B.must('armAfterTx', { label: 'CLAIM', occurrence: 1 });
        const bRun = B.send('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000);
        bRun.catch(() => undefined);
        await B.waitEvent('paused', (e) => e.detail.point === 'AFTER_TX:CLAIM#1', 60_000);
        const claimDoc = await entryOf(E1);
        assert.ok(claimDoc.rewardNotifyClaimToken && claimDoc.rewardNotifyClaimToken !== claimOfA, 'B now owns a different, live claim on the same entry');
        const marker = await ev.oplogMarker();
        const aMark = await A.must('mark');

        await A.must('advanceLocalClock', { ms: 10_000 });                // A wakes up long after its lease: its local deadline has passed
        await A.must('resume', { point: 'AFTER_TX:CLAIM#1' });
        const a = (await aRun).value;
        assert.equal(a.outcome, 'rejected');
        assert.deepEqual({ name: a.error.name, reason: a.error.reason }, { name: 'LockLostError', reason: 'LOCAL_DEADLINE' }, 'A took the hand-back branch');
        assert.deepEqual(await entryOf(E1), claimDoc, 'the entry - B\'s claim token, expiry, everything - is byte-identical after A\'s hand-back');
        assert.deepEqual(Evidence.businessWrites(await ev.writesSince(marker)), [], 'the hand-back wrote nothing (B\'s heartbeat renewals aside)');
        const aState = await A.must('state', { since: aMark });
        assert.equal((await A.must('txPlan', { from: aMark.tx })).length, 0, 'A started no transaction');
        assert.deepEqual(aState.calls.map((c: any) => `${c.model}.${c.op}`), ['leaderboardEntry.updateMany', 'monthlyLeaderboard.updateMany'], 'A\'s only database calls: the hand-back (conditioned on A\'s token) and its ineffective lock release');
        assert.equal(stub.requests.filter((r) => r.worker === 'A' && r.kind === 'notification').length, 0, 'A sent nothing');

        await B.must('resume', { point: 'AFTER_TX:CLAIM#1' });
        const b = (await bRun).value;
        assert.equal(b.result.status, 'FINALIZED');
        await assertRewardInvariants(ev, sc, 'CR-04a');
        assert.equal(await ev.deepSummary(MONTH, YEAR), reference.fresh.deep);
        assert.equal(stub.of('notification').filter((n) => n.userId === E1).length, 1, 'the first student was notified once, by B');
        assert.deepEqual([...new Set(stub.of('notification').map((n) => n.worker))], ['B']);
        for (const r of stub.requests) assert.equal(r.openTx, 0);
        t.diagnostic(`CR-04a: A pid ${A.pid} (claim ${claimOfA.slice(0, 8)}…) took the hand-back branch (LockLostError LOCAL_DEADLINE) while B pid ${B.pid} held claim ${String(claimDoc.rewardNotifyClaimToken).slice(0, 8)}…; entry byte-identical, oplog business writes 0, A transactions 0; B then sent and recorded; E1 notified once`);
      });
    });

    it('CR-04b A resumes with its clock believing it still owns the lock: it SENDS and tries to record - the record cannot overwrite B\'s live claim, B\'s claim survives, and A is then fenced out at its next write (the extra message is the documented at-least-once case)', async (t) => {
      await traced(async () => {
        const pool = newPool();
        const { sc, A, B, aRun, claimOfA } = await parkedClaimOfA(pool, { heartbeat: false });
        await B.must('armAfterTx', { label: 'CLAIM', occurrence: 1 });
        const bRun = B.send('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000);
        bRun.catch(() => undefined);
        await B.waitEvent('paused', (e) => e.detail.point === 'AFTER_TX:CLAIM#1', 60_000);
        const claimDoc = await entryOf(E1);
        const aMark = await A.must('mark');

        await A.must('resume', { point: 'AFTER_TX:CLAIM#1' });            // A's frozen clock says it is still the owner
        const a = (await aRun).value;
        assert.equal(a.outcome, 'rejected');
        assert.equal(a.error.name, 'LockLostError');
        assert.equal(a.error.reason, 'REPLACED', 'stopped by the database fence at its next write');
        const toE1 = stub.of('notification').filter((n) => n.userId === E1);
        assert.deepEqual(toE1.map((n) => n.worker), ['A'], 'A did send the message (nothing outside the database can stop it)');
        assert.deepEqual(await entryOf(E1), claimDoc, 'but its outcome could not be recorded over B\'s live claim: entry byte-identical, still undelivered');
        const aTx = await A.must('txPlan', { from: aMark.tx });
        assert.equal(aTx.length, 1, 'A started one more transaction');
        assert.deepEqual(aTx[0].calls.map((c: any) => `${c.model}.${c.op}`), ['$raw.update', '$raw.aggregate'], 'which was refused by the fence');

        await B.must('resume', { point: 'AFTER_TX:CLAIM#1' });
        const b = (await bRun).value;
        assert.equal(b.result.status, 'FINALIZED');
        await assertRewardInvariants(ev, sc, 'CR-04b');
        assert.equal(stub.of('notification').filter((n) => n.userId === E1).length, 2, 'E1 received the message from A and again from B');
        assert.deepEqual(stub.of('notification').filter((n) => n.userId === E1).map((n) => n.worker).sort(), ['A', 'B']);
        for (const u of ['e2', 'e3', 'e4', 'e5']) assert.equal(stub.of('notification').filter((n) => n.userId!.endsWith(u)).length, 1);
        const e1Requests = stub.of('notification').filter((n) => n.userId === E1);
        assert.deepEqual(e1Requests.map((n) => n.idempotencyKey), [`reward_lb_notify_${MONTH}_${YEAR}_${E1}`, `reward_lb_notify_${MONTH}_${YEAR}_${E1}`], 'both requests carry the same key (FIX 06C-4B2B2)');
        assert.deepEqual(e1Requests.map((n) => n.outcome), ['created', 'deduplicated'], 'the second is a replay for the User Service');
        assert.equal(stub.notifications.filter((n) => n.userId === E1).length, 1, 'ONE notification stored for E1');
        assert.equal(stub.pushes, 5, 'one push per learner');
        t.diagnostic(`CR-04b: A pid ${A.pid} (claim ${claimOfA.slice(0, 8)}…) sent E1's message, its outcome did not overwrite B pid ${B.pid}'s live claim; A fenced out (REPLACED); B then sent too: 2 requests for E1 with the same key, 1 notification stored, ${stub.pushes} pushes for 5 learners`);
      });
    });

    it('CR-04c the hand-back works for the owner\'s OWN claim: a process that notices its lease is gone before sending frees its claim at once, so the next owner does not wait for the claim to lapse', async (t) => {
      await traced(async () => {
        const pool = newPool();
        const { sc, A, B, aRun, claimOfA } = await parkedClaimOfA(pool, { heartbeat: true });
        await A.must('advanceLocalClock', { ms: 10_000 });
        await A.must('resume', { point: 'AFTER_TX:CLAIM#1' });
        const a = (await aRun).value;
        assert.equal(a.outcome, 'rejected');
        assert.deepEqual({ name: a.error.name, reason: a.error.reason }, { name: 'LockLostError', reason: 'LOCAL_DEADLINE' });
        const e1 = await entryOf(E1);
        assert.equal(e1.rewardNotifyClaimToken ?? null, null, 'A handed its own claim back');
        assert.equal(e1.rewardNotifyClaimExpiresAt ?? null, null);
        assert.ok(!e1.rewardNotifiedAt);
        assert.equal(stub.of('notification').length, 0, 'nothing was sent');
        assert.equal((await ev.lock(MONTH, YEAR)).lockToken, null, 'and A released its lock (it still owned it in the database)');
        const b = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000);
        assert.equal(b.result.status, 'FINALIZED', 'B continues at once - no waiting for a lease or a claim');
        await assertRewardInvariants(ev, sc, 'CR-04c');
        assert.equal(await ev.deepSummary(MONTH, YEAR), reference.fresh.deep);
        assert.equal(stub.of('notification').filter((n) => n.userId === E1).length, 1);
        t.diagnostic(`CR-04c: A pid ${A.pid} freed its claim ${claimOfA.slice(0, 8)}… and the lock; B pid ${B.pid} finished immediately; E1 notified once`);
      });
    });
  });

  describe('CR-05 a process dies around the notification request', () => {
    const KEY_E1 = `reward_lb_notify_${MONTH}_${YEAR}_${E1}`;
    /** Common tail: B finishes the period (the dead A's claim is still live), then the claim lapses and the production retry runs. */
    const recoverAndRetry = async (sc: Scenario, B: Worker, claimOfA: string, label: string) => {
      await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
      const b = await B.must('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000);
      assert.equal(b.result.status, 'FINALIZED', `${label}: the period finishes although one notification is outstanding`);
      assert.ok((b.result.notificationsPending ?? 0) >= 1, `${label}: B reports the outstanding notification`);
      const e1 = (await ev.raw('leaderboard_entries')).find((e) => idOf(e.userId) === E1)!;
      assert.equal(e1.rewardNotifyClaimToken, claimOfA, `${label}: the dead owner's claim is still on the entry`);
      assert.ok(!e1.rewardNotifiedAt, `${label}: no delivery was recorded`);
      assert.equal(stub.of('notification').filter((n) => n.userId === E1).length, 1, `${label}: the User Service received the message once so far`);
      // while the dead owner's claim is live nobody may send it again
      const blocked = await B.must('retryNotifications', { month: MONTH, year: YEAR });
      assert.equal(blocked.remaining, 1);
      assert.equal(stub.of('notification').filter((n) => n.userId === E1).length, 1, `${label}: the live claim kept the retry from sending`);
      // the claim lapses (60 s in real life) -> the production retry delivers it
      await admin.$runCommandRaw({ update: 'leaderboard_entries', updates: [{ q: { rewardNotifyClaimToken: claimOfA }, u: { $set: { rewardNotifyClaimExpiresAt: { $date: new Date(Date.now() - 1000).toISOString() } } } }] });
      const done = await B.must('retryNotifications', { month: MONTH, year: YEAR });
      assert.equal(done.remaining, 0);
      const toE1 = stub.of('notification').filter((n) => n.userId === E1);
      assert.equal(toE1.length, 2, `${label}: the REQUEST reached the User Service twice (the dead process's, and the retry's) - requests stay at-least-once`);
      assert.deepEqual(toE1.map((n) => n.worker).sort(), ['A', 'B']);
      assert.deepEqual(toE1.map((n) => n.idempotencyKey), [KEY_E1, KEY_E1], `${label}: both carry the same key (FIX 06C-4B2B2)`);
      const storedForE1 = stub.notifications.filter((n) => n.userId === E1).length;
      if (stub.notificationMode === 'idempotent') {
        assert.deepEqual(toE1.map((n) => n.outcome), ['created', 'deduplicated'], `${label}: the retry is recognised as a replay`);
        assert.equal(storedForE1, 1, `${label}: ONE notification exists for E1`);
        assert.equal(stub.pushes, 5, `${label}: one push per learner, none for the replay`);
      } else {
        assert.equal(storedForE1, 2, `${label}: a legacy server (key ignored) stores the duplicate - what the key protects against`);
      }
      for (const u of ['e2', 'e3', 'e4', 'e5']) assert.equal(stub.of('notification').filter((n) => n.userId!.endsWith(u)).length, 1);
      await assertRewardInvariants(ev, sc, label);
      assert.equal(await ev.deepSummary(MONTH, YEAR), reference.fresh.deep, `${label}: the final data equals the plain run (delivery marker set, claim cleared)`);
      for (const r of stub.requests) assert.equal(r.openTx, 0);
    };

    it('CR-05a A is SIGKILLed while the User Service HAS RECEIVED the request and has not answered: B finishes the period; the retry (after the claim lapsed) sends the message AGAIN', async (t) => {
      await traced(async () => {
        const sc = SCENARIOS.fresh;
        await world(sc);
        const pool = newPool();
        const A = await spawnOne(pool, 'A');
        const B = await spawnOne(pool, 'B');
        let releaseStub: () => void = () => undefined;
        const held = new Promise<void>((r) => { releaseStub = r; });
        let first = true;
        stub.notificationGate = async () => { if (!first) return; first = false; await held; };
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 120_000);
        aRun.catch(() => undefined);
        const received = await stub.waitForRequest((r) => r.kind === 'notification' && r.worker === 'A' && r.userId === E1);
        assert.equal(received.openTx, 0);
        const claimOfA = (await ev.raw('leaderboard_entries')).find((e) => idOf(e.userId) === E1)!.rewardNotifyClaimToken as string;
        assert.ok(claimOfA);
        const apid = A.pid;
        await pool.kill(A);                                                // the service has the message, A will never record it
        assert.equal(isAlive(apid), false);
        releaseStub();
        await recoverAndRetry(sc, B, claimOfA, 'CR-05a');
        t.diagnostic(`CR-05a: A pid ${apid} SIGKILLed with the request received (and stored) but unanswered; B pid ${B.pid} finished the period; after the claim lapsed the retry re-sent with the same key: requests to E1 ${stub.of('notification').filter((n) => n.userId === E1).length}, notifications stored for E1 ${stub.notifications.filter((n) => n.userId === E1).length}, pushes in total ${stub.pushes} (5 learners); key ${KEY_E1}`);
      });
    });

    it('CR-05b A is SIGKILLed after the User Service ANSWERED 200 but before the delivery outcome was saved: the same duplicate', async (t) => {
      await traced(async () => {
        const sc = SCENARIOS.fresh;
        await world(sc);
        const pool = newPool();
        const A = await spawnOne(pool, 'A');
        const B = await spawnOne(pool, 'B');
        await A.must('armPause', { point: 'BEFORE_FINISH_NOTIFICATION' });
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 120_000);
        aRun.catch(() => undefined);
        await A.waitEvent('paused', (e) => e.detail.point === 'BEFORE_FINISH_NOTIFICATION', 60_000);
        assert.equal(stub.of('notification').length, 1);
        assert.equal(stub.of('notification')[0].status, 201, 'the service stored it and answered');
        const claimOfA = (await ev.raw('leaderboard_entries')).find((e) => idOf(e.userId) === E1)!.rewardNotifyClaimToken as string;
        const apid = A.pid;
        await pool.kill(A);
        assert.equal(isAlive(apid), false);
        await recoverAndRetry(sc, B, claimOfA, 'CR-05b');
        t.diagnostic(`CR-05b: A pid ${apid} SIGKILLed between the 201 answer and the outcome write; the retry re-sent with the same key: requests to E1 ${stub.of('notification').filter((n) => n.userId === E1).length}, notifications stored for E1 ${stub.notifications.filter((n) => n.userId === E1).length}, pushes in total ${stub.pushes}`);
      });
    });

    it('CR-05d (contrast) the CR-05b crash against a LEGACY User Service that ignores the key: the duplicate notification comes back - the tests can see a lost header', async (t) => {
      await traced(async () => {
        const sc = SCENARIOS.fresh;
        await world(sc);
        stub.notificationMode = 'legacy';
        const pool = newPool();
        const A = await spawnOne(pool, 'A');
        const B = await spawnOne(pool, 'B');
        await A.must('armPause', { point: 'BEFORE_FINISH_NOTIFICATION' });
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 120_000);
        aRun.catch(() => undefined);
        await A.waitEvent('paused', (e) => e.detail.point === 'BEFORE_FINISH_NOTIFICATION', 60_000);
        const claimOfA = (await ev.raw('leaderboard_entries')).find((e) => idOf(e.userId) === E1)!.rewardNotifyClaimToken as string;
        const apid = A.pid;
        await pool.kill(A);
        assert.equal(isAlive(apid), false);
        await recoverAndRetry(sc, B, claimOfA, 'CR-05d');
        assert.equal(stub.notifications.filter((n) => n.userId === E1).length, 2);
        t.diagnostic(`CR-05d: legacy server - requests to E1 ${stub.of('notification').filter((n) => n.userId === E1).length}, notifications stored for E1 ${stub.notifications.filter((n) => n.userId === E1).length} (the duplicate the key removes)`);
      });
    });

    it('CR-05c A is only PAUSED between the 200 answer and the outcome write while B takes over and holds a live claim: when A resumes, its late outcome cannot overwrite B\'s claim', async (t) => {
      await traced(async () => {
        const sc = SCENARIOS.fresh;
        await world(sc);
        const pool = newPool();
        const A = await spawnOne(pool, 'A');
        const B = await spawnOne(pool, 'B');
        await A.must('armPause', { point: 'BEFORE_FINISH_NOTIFICATION' });
        const aRun = A.send('finalize', { month: MONTH, year: YEAR, by: 'A' }, 120_000);
        aRun.catch(() => undefined);
        await A.waitEvent('paused', (e) => e.detail.point === 'BEFORE_FINISH_NOTIFICATION', 60_000);
        const claimOfA = (await ev.raw('leaderboard_entries')).find((e) => idOf(e.userId) === E1)!.rewardNotifyClaimToken as string;
        await A.must('stopHeartbeat');
        await A.must('freezeLocalClock');
        await ev.waitUntilMongoSaysExpired(MONTH, YEAR);
        await admin.$runCommandRaw({ update: 'leaderboard_entries', updates: [{ q: { rewardNotifyClaimToken: claimOfA }, u: { $set: { rewardNotifyClaimExpiresAt: { $date: new Date(Date.now() - 1000).toISOString() } } } }] });
        await B.must('armAfterTx', { label: 'CLAIM', occurrence: 1 });
        const bRun = B.send('finalize', { month: MONTH, year: YEAR, by: 'B' }, 120_000);
        bRun.catch(() => undefined);
        await B.waitEvent('paused', (e) => e.detail.point === 'AFTER_TX:CLAIM#1', 60_000);
        const claimDoc = (await ev.raw('leaderboard_entries')).find((e) => idOf(e.userId) === E1)!;
        assert.notEqual(claimDoc.rewardNotifyClaimToken, claimOfA);
        const marker = await ev.oplogMarker();

        await A.must('resume', { point: 'BEFORE_FINISH_NOTIFICATION' });   // A records "delivered" - too late
        const a = (await aRun).value;
        assert.equal(a.outcome, 'rejected');
        assert.equal(a.error.name, 'LockLostError');
        assert.deepEqual((await ev.raw('leaderboard_entries')).find((e) => idOf(e.userId) === E1), claimDoc, 'A\'s late outcome left B\'s claim and the undelivered state untouched');
        assert.deepEqual(Evidence.businessWrites(await ev.writesSince(marker)), []);
        await B.must('resume', { point: 'AFTER_TX:CLAIM#1' });
        assert.equal((await bRun).value.result.status, 'FINALIZED');
        await assertRewardInvariants(ev, sc, 'CR-05c');
        assert.equal(await ev.deepSummary(MONTH, YEAR), reference.fresh.deep);
        const toE1 = stub.of('notification').filter((n) => n.userId === E1);
        assert.deepEqual(toE1.map((n) => n.worker).sort(), ['A', 'B'], 'A had already sent it; B sent it again');
        assert.deepEqual(toE1.map((n) => n.idempotencyKey), [KEY_E1, KEY_E1], 'with the same key');
        assert.deepEqual(toE1.map((n) => n.outcome), ['created', 'deduplicated'], 'B\'s request is recognised as a replay');
        assert.equal(stub.notifications.filter((n) => n.userId === E1).length, 1, 'ONE notification for E1');
        assert.equal(stub.pushes, 5, 'one push per learner');
        t.diagnostic(`CR-05c: A pid ${A.pid} (late outcome for claim ${claimOfA.slice(0, 8)}…) could not overwrite B pid ${B.pid}'s live claim; entry byte-identical; requests to E1 ${toE1.length} (same key), notifications stored for E1 1, pushes ${stub.pushes}`);
      });
    });
  });
});
