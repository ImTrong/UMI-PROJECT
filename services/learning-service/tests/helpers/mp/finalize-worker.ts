/**
 * Child process that runs the REAL monthly finalization (FIX 06C-2). Started with child_process.fork by the harness: a separate OS process with
 * its own PID, its own PrismaClient / connection pools and its own lock service. The business flow is the production code, untouched:
 *
 *     LeaderboardService.finalizeMonth(month, year, finalizedBy, options)     <- the very function the admin controller / job call
 *
 * What the test harness adds around it (all of it lives HERE, in the test worker; nothing is exposed by the product):
 *   - Network: the worker refuses to start unless MP_STUB_URL is a loopback address (and not a known service port), and every outbound
 *     request that is not addressed to exactly that stub is blocked (http / https / fetch). USER_SERVICE_URL is pointed at the stub, so the
 *     production default http://localhost:3002 (the real User Service container) can never be reached.
 *   - Instrumentation: the real PrismaClient wrapped by tests/helpers/faulty-prisma.ts (call log with transaction boundaries, raw commands),
 *     an axios request interceptor that labels every request with the worker and with the number of MongoDB transactions open at that moment,
 *     and wrappers (same function, same arguments, same result) around the lock service (acquire / fence / heartbeat / release) and around
 *     LeaderboardService.fencedTx / fencedTransition that only LOG and, when armed by the test, PARK the worker at a named point.
 *   - Barrier points (named by the test, parked exactly BEFORE the guarded call, never inside a MongoDB transaction):
 *         BEFORE_SNAPSHOT_TX   right before the one transaction that deletes / creates the snapshot entries (after the ownership check)
 *         BEFORE_REWARDING     right before the SNAPSHOT_FROZEN -> REWARDING transition
 *         BEFORE_FINALIZED     right before the REWARDING -> FINALIZED transition
 *   - Barrier before the n-th TRANSACTION (armTxPause {at}): the worker is parked right before the n-th interactive MongoDB transaction it starts
 *     (counted from arming) - whichever write that transaction performs (wallet, ledger, badge, audit, claim, persist, status ...). The hook runs
 *     in the Prisma client wrapper BEFORE the transaction is started, so no transaction is open while parked. At that moment the worker also
 *     evaluates the local ownership check (LockContext.assertAlive) and reports it.
 *   - Crash windows (FIX 06C-4A): armAfterTx {label, occurrence} parks the worker right AFTER the n-th committed transaction of a given business
 *     label (e.g. CLAIM, AWARD, TRANSITION:FINALIZED) - nothing is open, the write is durable; BEFORE_FINISH_NOTIFICATION parks it after the HTTP call
 *     but before the delivery outcome is saved; armInsideSnapshotTx parks it INSIDE the snapshot transaction (the transaction is open - used to
 *     kill a process mid-transaction). The controller then SIGKILLs the process (a real death) or resumes it.
 *   - Controlled faults: stop the heartbeat without releasing the lock; freeze the local monotonic clock (a suspended VM / paused container whose
 *     clock did not advance - so the DATABASE fence, not the local check, is what has to stop the old owner); skip the release (a crash before cleanup).
 *
 * Protocol: same IPC as lock-worker.ts ({type:'cmd'} -> {type:'result'}, plus {type:'event'} progress / barrier signals).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
import { STUB_TOKEN } from './stub-user-service';

const databaseUrl = process.env.MP_DATABASE_URL || '';
const dbName = databaseUrl.split('?')[0].split('/').pop() || '';
const label = process.env.MP_WORKER_LABEL || `worker-${process.pid}`;
const stubUrl = process.env.MP_STUB_URL || '';

const send = (msg: any) => { if (process.send) process.send(msg); };
const emit = (step: string, detail: any = {}) => send({ type: 'event', pid: process.pid, label, step, detail, at: Date.now() });
const fatal = (message: string): never => {
  send({ type: 'fatal', pid: process.pid, label, message });
  process.exit(2);
};

// ---- safety: isolated test database, loopback stub only ------------------------------------------------------------------
if (!/test/i.test(dbName)) fatal(`refusing to start: database "${dbName}" does not look like a test database`);
let stub: URL;
try { stub = new URL(stubUrl); } catch { stub = new URL('http://invalid.invalid'); }
const stubPort = Number(stub.port);
if (!['127.0.0.1', 'localhost'].includes(stub.hostname) || !Number.isInteger(stubPort) || stubPort < 1024 || (stubPort >= 3000 && stubPort <= 3099)) {
  fatal(`refusing to start: MP_STUB_URL must be a loopback test stub on an unprivileged, non-service port (got "${stubUrl}")`);
}
process.env.USER_SERVICE_URL = stubUrl;               // the production code builds its URLs from this (default would be http://localhost:3002)
process.env.INTERNAL_SERVICE_TOKEN = STUB_TOKEN;      // a test-only token; the stub checks it, like the real endpoint does

const blocked = (what: string) => () => { throw new Error(`finalize worker must not make this network call (${what}); only the loopback stub is allowed`); };
const targetOf = (args: any[]): { host: string; port: number } => {
  const [a0, a1] = args;
  const o: any = typeof a0 === 'string' || a0 instanceof URL ? Object.assign({}, new URL(String(a0)), typeof a1 === 'object' ? a1 : {}) : a0 || {};
  return { host: String(o.hostname || o.host || 'localhost').replace(/:\d+$/, ''), port: Number(o.port || 80) };
};
const isAllowedTarget = (t: { host: string; port: number }) => ['127.0.0.1', 'localhost'].includes(t.host) && t.port === stubPort;
const nodeHttp = require('http');
const nodeHttps = require('https');
const realHttpRequest = nodeHttp.request;
nodeHttp.request = function (...args: any[]) {
  const t = targetOf(args);
  if (!isAllowedTarget(t)) throw new Error(`finalize worker blocked an outbound request to ${t.host}:${t.port}; only ${stub.host} is allowed`);
  return realHttpRequest.apply(this, args);
};
nodeHttp.get = function (...args: any[]) { const r = nodeHttp.request(...args); r.end(); return r; };
nodeHttps.request = blocked('https.request');
nodeHttps.get = blocked('https.get');
(globalThis as any).fetch = blocked('fetch');

// ---- the real Prisma client, instrumented; then the product code -------------------------------------------------------------
const root = '../../..';
const faulty = require('../faulty-prisma').installFaultyPrisma();
const openTx = () =>
  faulty.txEvents.filter((e: any) => e.kind === 'begin').length - faulty.txEvents.filter((e: any) => e.kind !== 'begin').length;

const axios = require('axios').default || require('axios');
const httpLog: Array<{ at: number; path: string; openTx: number }> = [];
axios.interceptors.request.use((cfg: any) => {
  const path = (() => { try { return new URL(cfg.url, cfg.baseURL).pathname; } catch { return String(cfg.url); } })();
  const open = openTx();
  const set = (k: string, v: string) => (cfg.headers && typeof cfg.headers.set === 'function' ? cfg.headers.set(k, v) : (cfg.headers = { ...(cfg.headers || {}), [k]: v }));
  set('x-test-worker', label);
  set('x-test-open-tx', String(open));
  httpLog.push({ at: Date.now(), path, openTx: open });
  emit('http', { path, openTx: open });
  return cfg;
});

const { labelTx } = require('./reward-evidence');
const { LeaderboardService } = require(`${root}/src/services/leaderboard.service`);
const lockModule = require(`${root}/src/services/leaderboard-lock.service`);
require(`${root}/src/utils/logger`).default.transports.forEach((t: any) => { t.silent = true; });

// ---- lock service: the real one, with logging wrappers and test-controlled faults --------------------------------------------
let frozenMono: number | null = null;
let skipRelease = false;
const heartbeats: any[] = [];
const fenceLog: Array<{ at: number; ok: boolean; reason?: string; fencingToken: number }> = [];
const lockLog: Array<{ at: number; op: string; detail: any }> = [];
const transitions: Array<{ at: number; from: string[]; to: string; ok?: boolean; error?: string }> = [];

let currentCtx: any = null;     // the LockContext of the finalize run in progress (for the barrier's ownership check)
const lockPrisma = new faulty.FaultyPrismaClient();
const locks = new lockModule.LeaderboardLockService({
  prisma: lockPrisma,
  config: { ttlMs: Number(process.env.MP_LOCK_TTL_MS || 1500), heartbeatMs: Number(process.env.MP_LOCK_HB_MS || 500) },
  monotonicNow: () => (frozenMono !== null ? frozenMono : performance.now()),
});
const origAcquire = locks.acquire.bind(locks);
locks.acquire = async (month: number, year: number, opts: any) => {
  const r = await origAcquire(month, year, opts);
  const detail = r.status === 'ACQUIRED' ? { status: r.status, fencingToken: r.handle.fencingToken, expiresAt: r.handle.expiresAt.toISOString() } : { status: r.status };
  lockLog.push({ at: Date.now(), op: 'acquire', detail });
  emit('lock:acquire', detail);
  return r;
};
const origStartHeartbeat = locks.startHeartbeat.bind(locks);
locks.startHeartbeat = (handle: any, onLost: any) => {
  const hb = origStartHeartbeat(handle, onLost);
  heartbeats.push(hb);
  emit('lock:heartbeat-started', { fencingToken: handle.fencingToken });
  return hb;
};
const origFence = locks.fenceTransaction.bind(locks);
locks.fenceTransaction = async (tx: any, handle: any) => {
  try {
    await origFence(tx, handle);
    fenceLog.push({ at: Date.now(), ok: true, fencingToken: handle.fencingToken });
  } catch (e: any) {
    fenceLog.push({ at: Date.now(), ok: false, reason: e?.reason || e?.name, fencingToken: handle.fencingToken });
    emit('lock:fence-refused', { reason: e?.reason || e?.name, fencingToken: handle.fencingToken });
    throw e;
  }
};
const origRelease = locks.release.bind(locks);
locks.release = async (handle: any) => {
  if (skipRelease) {
    lockLog.push({ at: Date.now(), op: 'release', detail: { skipped: 'simulated crash before cleanup' } });
    emit('lock:release-skipped');
    return { released: false, reason: 'NOT_OWNER' };
  }
  const r = await origRelease(handle);
  lockLog.push({ at: Date.now(), op: 'release', detail: r });
  emit('lock:release', r);
  return r;
};
const origCreateContext = locks.createContext.bind(locks);
locks.createContext = (handle: any, hb: any) => {
  currentCtx = origCreateContext(handle, hb);
  return currentCtx;
};
LeaderboardService.useLockService(locks);

// ---- barrier points ---------------------------------------------------------------------------------------------------------
const pauses = new Map<string, { armed: boolean; release?: () => void }>();
let txBase = 0;     // number of transactions already completed when the barrier was armed
const maybePause = async (point: string, guard: any) => {
  const p = pauses.get(point);
  if (!p || !p.armed) return;
  p.armed = false;
  let assertAliveOk = true;
  let aliveReason: string | undefined;
  try { guard.assertAlive(); } catch (e: any) { assertAliveOk = false; aliveReason = e?.reason; }
  const since = Date.now();
  emit('paused', {
    point, assertAliveOk, aliveReason, openTx: openTx(), fencingToken: guard.fencingToken, month: guard.month, year: guard.year,
    completedTransactions: faulty.txSegments().length - txBase,
  });
  await new Promise<void>((resolve) => { p.release = resolve; });
  emit('resumed', { point, pausedMs: Date.now() - since });
};
// barrier before the n-th interactive transaction: the Prisma wrapper calls this BEFORE it starts the transaction
let txCounter = 0;
faulty.txHooks.push(async () => {
  txCounter++;
  await maybePause(`TX#${txCounter}`, currentCtx || { assertAlive() {}, fencingToken: null, month: null, year: null });
});
// barrier right AFTER the n-th committed transaction with a given business label (no transaction open, the write is durable)
const afterCounts = new Map<string, number>();
faulty.txAfterHooks.push(async (seg: any) => {
  if (seg.outcome !== 'commit') return;
  const label = labelTx(seg);
  const n = (afterCounts.get(label) || 0) + 1;
  afterCounts.set(label, n);
  await maybePause(`AFTER_TX:${label}#${n}`, currentCtx || { assertAlive() {}, fencingToken: null, month: null, year: null });
});
// barrier between "the HTTP call is done" and "the delivery outcome is saved"
const origFinishNotification = LeaderboardService.finishNotification.bind(LeaderboardService);
LeaderboardService.finishNotification = async function (leaderboardId: string, userId: string, token: string, error: string | null) {
  await maybePause('BEFORE_FINISH_NOTIFICATION', currentCtx || { assertAlive() {}, fencingToken: null, month: null, year: null });
  emit('notification:outcome', { user: String(userId).slice(-2), error: error === null ? null : 'send-error' });
  return origFinishNotification(leaderboardId, userId, token, error);
};
const origFencedTx = LeaderboardService.fencedTx.bind(LeaderboardService);
LeaderboardService.fencedTx = async function (guard: any, fn: any, opts: any = {}) {
  if (opts && opts.timeoutMs) await maybePause('BEFORE_SNAPSHOT_TX', guard);   // only the snapshot transaction passes a timeout
  return origFencedTx(guard, fn, opts);
};
const origTransition = LeaderboardService.fencedTransition.bind(LeaderboardService);
LeaderboardService.fencedTransition = async function (ctx: any, from: string[], to: string, data: any) {
  await maybePause(`BEFORE_${to}`, ctx);
  try {
    const ok = await origTransition(ctx, from, to, data);
    transitions.push({ at: Date.now(), from, to, ok });
    emit('transition', { from, to, ok });
    return ok;
  } catch (e: any) {
    transitions.push({ at: Date.now(), from, to, error: `${e?.name}${e?.reason ? `:${e.reason}` : ''}` });
    emit('transition:error', { from, to, error: `${e?.name}${e?.reason ? `:${e.reason}` : ''}` });
    throw e;
  }
};

// ---- commands -------------------------------------------------------------------------------------------------------------------
const serializeError = (e: any) => ({
  name: e?.name || 'Error',
  message: String(e?.message || e).slice(0, 400),
  reason: e?.reason,
});
let parked: { cmd: string; args: any } | null = null;

const handlers: Record<string, (a: any) => Promise<any>> = {
  async ping() {
    return { pid: process.pid, label, database: dbName, stub: stub.host };
  },
  /**
   * Network guard self-check. Reports the guard's DECISION for the real User Service port without sending anything there, and tries the
   * forbidden calls only against targets that cannot answer anyway (a closed loopback port, a .invalid host).
   */
  async probeNetwork() {
    const attempt = (fn: () => any) => {
      try {
        const r = fn();
        r?.on?.('error', () => undefined);
        r?.destroy?.();
        return { blocked: false };
      } catch (e: any) {
        return { blocked: /must not make|blocked an outbound/.test(String(e?.message)), message: String(e?.message).slice(0, 120) };
      }
    };
    return {
      decision: {
        stub: isAllowedTarget({ host: stub.hostname, port: stubPort }),
        realUserServicePort3002: isAllowedTarget({ host: '127.0.0.1', port: 3002 }),
        localhost3002: isAllowedTarget({ host: 'localhost', port: 3002 }),
        anotherLoopbackPort: isAllowedTarget({ host: '127.0.0.1', port: stubPort + 1 }),
        external: isAllowedTarget({ host: 'example.com', port: 80 }),
      },
      http: attempt(() => nodeHttp.request('http://127.0.0.1:1/')),
      httpExternal: attempt(() => nodeHttp.get('http://example.invalid/')),
      https: attempt(() => nodeHttps.request('https://example.invalid/')),
      fetch: attempt(() => (globalThis as any).fetch('https://example.invalid/')),
      userServiceUrl: process.env.USER_SERVICE_URL,
    };
  },
  async connect() {
    await lockPrisma.$connect();
    const hello = await lockPrisma.$runCommandRaw({ hello: 1 });
    await LeaderboardService.getAvailableMonths();            // read-only: opens the product's own connection pool now
    return { pid: process.pid, isWritablePrimary: hello.isWritablePrimary };
  },
  /** The production entry point, called exactly as the admin controller / the job call it. */
  async finalize({ month, year, by, options }: any) {
    emit('finalize:start', { month, year });
    try {
      const r = await LeaderboardService.finalizeMonth(month, year, by || label, options);
      emit('finalize:result', { status: r.status });
      return { outcome: 'resolved', result: r };
    } catch (e: any) {
      emit('finalize:error', serializeError(e));
      return { outcome: 'rejected', error: serializeError(e) };
    }
  },
  async armPause({ point }: any) {
    pauses.set(point, { armed: true });
    return { armed: point };
  },
  /** Park right before the n-th interactive transaction started from now on (n = 1 is the next one). */
  async armTxPause({ at }: any) {
    txCounter = 0;
    txBase = faulty.txSegments().length;
    pauses.set(`TX#${at}`, { armed: true });
    return { armed: `TX#${at}` };
  },
  /** Park right after the occurrence-th COMMITTED transaction whose business label is `label` (counted from now). */
  async armAfterTx({ label, occurrence = 1 }: any) {
    afterCounts.clear();
    pauses.set(`AFTER_TX:${label}#${occurrence}`, { armed: true });
    return { armed: `AFTER_TX:${label}#${occurrence}` };
  },
  /** Park INSIDE the snapshot transaction (fence and delete already done, the new entries not yet inserted): the transaction is OPEN. */
  async armInsideSnapshotTx() {
    pauses.set('INSIDE_SNAPSHOT_TX', { armed: true });
    faulty.beforeNext('leaderboardEntry', 'createMany', () => maybePause('INSIDE_SNAPSHOT_TX', currentCtx || { assertAlive() {}, fencingToken: null, month: null, year: null }));
    return { armed: 'INSIDE_SNAPSHOT_TX' };
  },
  /** Make the local ownership deadline pass (a long stall): assertAlive() will now throw LOCAL_DEADLINE. */
  async advanceLocalClock({ ms }: any) {
    frozenMono = (frozenMono !== null ? frozenMono : performance.now()) + ms;
    return { localClock: frozenMono };
  },
  /** The product's idea of "now" (month / year) - so the production catch-up scans a deterministic window. */
  async setClock({ month, year }: any) {
    require(`${root}/src/config/scoring-policy`).getCurrentVietnamMonthYear = () => ({ month, year });
    return { month, year };
  },
  /** The production reconciliation / startup / cron entry point. */
  async reconcile({ initiator }: any = {}) {
    emit('reconcile:start');
    try {
      const r = await LeaderboardService.checkAndFinalizeAllPastMonths({ initiator: initiator || 'SYSTEM_RECONCILE' });
      emit('reconcile:result', r);
      return { outcome: 'resolved', result: r };
    } catch (e: any) {
      emit('reconcile:error', serializeError(e));
      return { outcome: 'rejected', error: serializeError(e) };
    }
  },
  /** The production notification retry (what the admin API and the job call). */
  async retryNotifications({ month, year }: any) {
    emit('retry:start');
    try {
      const remaining = await LeaderboardService.retryFailedNotifications(month, year);
      emit('retry:result', { remaining });
      return { outcome: 'resolved', remaining };
    } catch (e: any) {
      emit('retry:error', serializeError(e));
      return { outcome: 'rejected', error: serializeError(e) };
    }
  },
  /** Forget every fault and barrier so the same process can run the next scenario. */
  async resetFaults() {
    frozenMono = null;
    skipRelease = false;
    pauses.clear();
    afterCounts.clear();
    faulty.hooks.length = 0;
    txCounter = 0;
    txBase = faulty.txSegments().length;
    currentCtx = null;
    return { reset: true };
  },
  /** The transactions completed since `from` (an index returned by mark()), with what each one wrote. */
  async txPlan({ from = 0 }: any = {}) {
    return faulty.txSegments().slice(from).map((seg: any) => ({ outcome: seg.outcome, calls: seg.calls }));
  },
  async resume({ point }: any) {
    const p = pauses.get(point);
    if (!p || !p.release) throw new Error(`worker ${label} is not parked at ${point}`);
    p.release();
    return { resumed: point };
  },
  /** Stop the heartbeat(s) WITHOUT releasing the lock and without touching any transaction. */
  async stopHeartbeat() {
    heartbeats.forEach((hb) => hb.stop());
    emit('heartbeat:stopped', { count: heartbeats.length, lost: heartbeats.map((h) => h.lost) });
    return { stopped: heartbeats.length, lost: heartbeats.map((h) => h.lost) };
  },
  /** From now on the local monotonic clock does not advance (a suspended VM): only the DATABASE can still tell this worker it lost the lock. */
  async freezeLocalClock() {
    frozenMono = performance.now();
    return { frozenAt: frozenMono };
  },
  async skipRelease({ on = true }: any) {
    skipRelease = !!on;
    return { skipRelease };
  },
  async mark() {
    return { calls: faulty.calls.length, fences: fenceLog.length, http: httpLog.length, tx: faulty.txSegments().length };
  },
  async state({ since }: any = {}) {
    const from = since || { calls: 0, fences: 0, http: 0 };
    return {
      pid: process.pid,
      openTx: openTx(),
      lockLog,
      fenceLog: fenceLog.slice(from.fences),
      transitions,
      http: httpLog.slice(from.http),
      calls: faulty.calls.slice(from.calls),
      txSegments: faulty.txSegments().length,
    };
  },
  async die() {
    emit('die');
    process.exit(137);
  },
};

const sleepUntil = async (t: number) => {
  const wait = t - Date.now() - 3;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  while (Date.now() < t) { /* spin the last milliseconds */ }
};

process.on('message', async (msg: any) => {
  if (!msg || msg.type !== 'cmd') return;
  const { id, cmd, args } = msg;
  const startedAt = Date.now();
  try {
    let value: any;
    let ranAt = startedAt;
    if (cmd === 'prepare') {
      parked = args.job;
      emit('armed', { job: parked!.cmd });
      value = { armed: true };
    } else if (cmd === 'fire') {
      if (!parked) throw new Error('fire without prepare');
      const job = parked;
      parked = null;
      await sleepUntil(args.startAt);
      ranAt = Date.now();
      emit('fire', { job: job.cmd, lateByMs: Math.max(0, ranAt - args.startAt) });
      value = await handlers[job.cmd](job.args || {});
    } else {
      const fn = handlers[cmd];
      if (!fn) throw new Error(`unknown command "${cmd}"`);
      value = await fn(args || {});
    }
    send({ type: 'result', id, ok: true, value, pid: process.pid, startedAt: ranAt, endedAt: Date.now() });
  } catch (e: any) {
    send({ type: 'result', id, ok: false, pid: process.pid, startedAt, endedAt: Date.now(), error: serializeError(e) });
  }
});

emit('ready', { database: dbName, stub: stub.host });
send({ type: 'ready', pid: process.pid, label });
