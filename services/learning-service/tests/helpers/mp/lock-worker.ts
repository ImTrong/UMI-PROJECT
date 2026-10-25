/**
 * Child process for the MULTI-PROCESS lock tests (FIX 06C-1). Started with child_process.fork by tests/helpers/mp/harness.ts,
 * so every worker is a separate Node.js process: its own PID, its own PrismaClient / connection pool, its own LeaderboardLockService.
 *
 * Talks to the controller ONLY over IPC (process.send / process.on('message')). It
 *   - refuses to start unless MP_DATABASE_URL names a *test* database,
 *   - never makes an HTTP request (http / https / fetch are disabled; axios and the product services are never loaded),
 *   - starts no server and no cron job.
 * It only exercises the lock primitives of src/services/leaderboard-lock.service.ts against the isolated replica set.
 *
 * Protocol (controller -> worker):  { type: 'cmd', id, cmd, args }
 *          (worker -> controller):  { type: 'result', id, ok, value | error, pid, startedAt, endedAt }
 *                                   { type: 'event', pid, step, detail, at }      (progress log; also the barrier signals)
 *   cmd 'prepare' {job:{cmd,args}}   park a job and acknowledge: the worker is now ARMED at the barrier
 *   cmd 'fire'    {startAt}          wait for the common start instant (epoch ms, same machine clock), then run the parked job
 *   any other cmd runs immediately (see `handlers`).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const databaseUrl = process.env.MP_DATABASE_URL || '';
const dbName = databaseUrl.split('?')[0].split('/').pop() || '';
const label = process.env.MP_WORKER_LABEL || `worker-${process.pid}`;

const send = (msg: any) => {
  if (process.send) process.send(msg);
};
const emit = (step: string, detail: any = {}) => send({ type: 'event', pid: process.pid, label, step, detail, at: Date.now() });

if (!/test/i.test(dbName)) {
  send({ type: 'fatal', pid: process.pid, label, message: `refusing to start: database "${dbName}" does not look like a test database` });
  process.exit(2);
}

// ---- no outbound HTTP, ever ----
const forbidden = (what: string) => () => {
  throw new Error(`multi-process lock worker must not make network calls (${what})`);
};
for (const mod of ['http', 'https']) {
  const m = require(mod);
  m.request = forbidden(`${mod}.request`);
  m.get = forbidden(`${mod}.get`);
}
(globalThis as any).fetch = forbidden('fetch');

const root = '../../..';
const { PrismaClient } = require('@prisma/client');
const lockModule = require(`${root}/src/services/leaderboard-lock.service`);
require(`${root}/src/utils/logger`).default.transports.forEach((t: any) => { t.silent = true; });

const CONFIG = { ttlMs: 1500, heartbeatMs: 500 };

interface Db {
  url: string;
  prisma: any;
  svc: any;
}
const makeDb = (url: string): Db => {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { url, prisma, svc: new lockModule.LeaderboardLockService({ prisma, config: CONFIG }) };
};
const defaultDb = makeDb(databaseUrl);
let current: Db = defaultDb;
const otherDbs: Db[] = [];

const handles = new Map<string, any>();
let parked: { cmd: string; args: any } | null = null;

const serializeHandle = (h: any) => ({
  periodId: h.periodId, month: h.month, year: h.year, lockToken: h.lockToken, fencingToken: h.fencingToken,
  owner: h.owner, ttlMs: h.ttlMs, expiresAt: h.expiresAt instanceof Date ? h.expiresAt.toISOString() : h.expiresAt,
});
const need = (key: string) => {
  const h = handles.get(key);
  if (!h) throw new Error(`worker ${label} has no handle "${key}"`);
  return h;
};

const sleepUntil = async (t: number) => {
  const wait = t - Date.now() - 3;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  while (Date.now() < t) { /* spin the last milliseconds so all workers leave the barrier together */ }
};

const handlers: Record<string, (a: any) => Promise<any>> = {
  async ping() {
    return { pid: process.pid, label, database: dbName };
  },
  /** Open the connection pool now, so a later race is a race on the lock and not on connection set-up. */
  async connect() {
    await current.prisma.$connect();
    const hello = await current.prisma.$runCommandRaw({ hello: 1 });
    return { pid: process.pid, isWritablePrimary: hello.isWritablePrimary, setName: hello.setName };
  },
  /** Point this worker at another database (an unreachable one, to simulate an outage) or back to the default. */
  async useDatabase({ url }: { url: string | 'default' }) {
    if (url === 'default') current = defaultDb;
    else {
      const existing = otherDbs.find((d) => d.url === url);
      current = existing || makeDb(url);
      if (!existing) otherDbs.push(current);
    }
    return { using: current === defaultDb ? 'default' : current.url };
  },
  async acquire({ month, year, owner, ttlMs, key = 'h' }: any) {
    emit('acquire:start', { month, year, owner });
    const r = await current.svc.acquire(month, year, { owner: owner || label, ttlMs });
    if (r.status === 'ACQUIRED') {
      handles.set(key, r.handle);
      emit('acquire:ACQUIRED', { fencingToken: r.handle.fencingToken });
      return { status: 'ACQUIRED', handle: serializeHandle(r.handle) };
    }
    emit(`acquire:${r.status}`, r.status === 'BUSY' ? { holder: r.owner, fencingToken: r.fencingToken } : {});
    return r.status === 'BUSY'
      ? { status: 'BUSY', holder: r.owner, fencingToken: r.fencingToken, expiresInMs: r.expiresInMs }
      : { status: r.status };
  },
  async renew({ key = 'h' }: any) {
    const h = need(key);
    const r = await current.svc.renew(h);
    emit('renew', r.renewed ? { renewed: true } : { renewed: false, reason: r.reason });
    return r.renewed ? { renewed: true, expiresAt: r.expiresAt.toISOString() } : r;
  },
  async release({ key = 'h' }: any) {
    const r = await current.svc.release(need(key));
    emit('release', r);
    return r;
  },
  async inspect({ key = 'h' }: any) {
    return { state: await current.svc.inspect(need(key)) };
  },
  /** Take over a COPY of a handle that another worker obtained (to model a duplicated / split owner). */
  async adopt({ key = 'h', handle }: any) {
    handles.set(key, { ...handle, expiresAt: new Date(handle.expiresAt), leaseStartedAtMono: 0 });
    return { adopted: handle.fencingToken };
  },
  /** Never answers (harness self-test: the controller must time out and clean the worker up). */
  async hang() {
    emit('hang');
    await new Promise(() => undefined);
  },
  /** Abrupt death: no cleanup of any kind, the lease is left behind. */
  async die() {
    emit('die');
    process.exit(137);
  },
};

const run = async (cmd: string, args: any) => {
  const fn = handlers[cmd];
  if (!fn) throw new Error(`unknown command "${cmd}"`);
  return fn(args || {});
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
      const lateByMs = Date.now() - args.startAt;
      await sleepUntil(args.startAt);
      ranAt = Date.now();
      emit('fire', { job: job.cmd, lateByMs: Math.max(0, lateByMs) });
      value = await run(job.cmd, job.args);
    } else {
      value = await run(cmd, args);
    }
    send({ type: 'result', id, ok: true, value, pid: process.pid, startedAt: ranAt, endedAt: Date.now() });
  } catch (e: any) {
    send({
      type: 'result', id, ok: false, pid: process.pid, startedAt, endedAt: Date.now(),
      error: { name: e?.name || 'Error', message: String(e?.message || e).slice(0, 400), cause: e?.cause ? String(e.cause?.message || e.cause).slice(0, 200) : undefined },
    });
  }
});

emit('ready', { database: dbName });
send({ type: 'ready', pid: process.pid, label });
