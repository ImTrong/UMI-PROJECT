/**
 * Controller side of the MULTI-PROCESS lock tests (FIX 06C-1).
 *
 * WorkerPool forks real Node.js processes (child_process.fork) running tests/helpers/mp/lock-worker.ts. Every worker has its own
 * PID and its own PrismaClient / connection pool; all of them talk to the same isolated test database. The controller drives them
 * over IPC and never performs the contested operation itself.
 *
 *   - send()      one command to one worker, with a finite timeout (a hung worker fails the test instead of hanging it)
 *   - race()      deterministic barrier: 1) every worker is told to PREPARE a job and acknowledges ("armed" - the controller
 *                 now knows exactly where each worker is), 2) only when all are armed the controller picks a common start
 *                 instant and sends FIRE; the workers wait for that instant (spinning the last ms) and run the job at once.
 *   - events      progress log of every worker (pid, step, detail, time): who acquired, which fencing token, etc.
 *   - kill()      SIGKILL a worker (real abrupt death, no chance to clean up)
 *   - shutdown()  kills every remaining worker; also used by the tests' `after` hook so a failed test never leaks processes
 *
 * Keeping the race in separate processes is the point: a Promise.all inside one process shares one event loop and one pool.
 */
import { ChildProcess, fork } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKER = path.join(__dirname, 'lock-worker.ts');
export const FINALIZE_WORKER = path.join(__dirname, 'finalize-worker.ts');

export interface WorkerReply {
  ok: boolean;
  value?: any;
  error?: { name: string; message: string; cause?: string };
  pid: number;
  startedAt: number;
  endedAt: number;
}

export interface MpEvent {
  at: number;
  worker: string;
  pid: number;
  step: string;
  detail: any;
}

export class Worker {
  readonly pid: number;
  exited: { code: number | null; signal: string | null } | null = null;
  /** Events this worker has emitted (progress log and barrier signals), oldest first. */
  readonly events: MpEvent[] = [];
  private eventWaiters: Array<{ step: string; pred: (e: MpEvent) => boolean; resolve: (e: MpEvent) => void }> = [];
  private pending = new Map<number, { resolve: (r: WorkerReply) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; cmd: string }>();
  private nextId = 1;
  output = '';

  constructor(readonly label: string, readonly child: ChildProcess, private readonly pool: WorkerPool) {
    this.pid = child.pid as number;
    child.on('message', (m: any) => this.onMessage(m));
    child.on('exit', (code, signal) => {
      this.exited = { code, signal };
      this.pool.log(this, 'exit', { code, signal });
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`${this.label} (pid ${this.pid}) exited (code ${code}, signal ${signal}) while "${p.cmd}" was pending`));
        this.pending.delete(id);
      }
    });
    child.stdout?.on('data', (d) => { this.output += String(d); });
    child.stderr?.on('data', (d) => { this.output += String(d); });
  }

  /** Called by the pool for every event of this worker: feeds the log and wakes up waitEvent(). */
  noteEvent(ev: MpEvent) {
    this.events.push(ev);
    this.eventWaiters = this.eventWaiters.filter((w) => {
      if (w.step === ev.step && w.pred(ev)) { w.resolve(ev); return false; }
      return true;
    });
  }

  /**
   * Resolves when this worker emits an event `step` accepted by `pred` - also if it was emitted a moment ago
   * (`fromIndex` = number of events to skip, to ignore earlier ones). This is the deterministic barrier signal:
   * "the worker is parked exactly here". Rejects after a finite timeout, naming what was awaited.
   */
  waitEvent(step: string, pred: (e: MpEvent) => boolean = () => true, timeoutMs = 30_000, fromIndex = 0): Promise<MpEvent> {
    const past = this.events.slice(fromIndex).find((e) => e.step === step && pred(e));
    if (past) return Promise.resolve(past);
    return new Promise<MpEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((w) => w.resolve !== wrapped);
        reject(new Error(`${this.label} (pid ${this.pid}) did not reach "${step}" within ${timeoutMs} ms`));
      }, timeoutMs);
      const wrapped = (e: MpEvent) => { clearTimeout(timer); resolve(e); };
      this.eventWaiters.push({ step, pred, resolve: wrapped });
    });
  }

  private onMessage(m: any) {
    if (m.type === 'event') this.pool.log(this, m.step, m.detail, m.at);
    else if (m.type === 'result') {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.resolve(m as WorkerReply);
    }
  }

  /** Send one command; resolves with the worker's reply (ok or not), rejects on timeout / worker death. */
  send(cmd: string, args: any = {}, timeoutMs = 20_000): Promise<WorkerReply> {
    if (this.exited) return Promise.reject(new Error(`${this.label} (pid ${this.pid}) is not running`));
    const id = this.nextId++;
    return new Promise<WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} (pid ${this.pid}) did not answer "${cmd}" within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, cmd });
      this.child.send({ type: 'cmd', id, cmd, args });
    });
  }

  /** Like send, but a worker-side error fails the test with the worker's message. */
  async must(cmd: string, args: any = {}, timeoutMs?: number): Promise<any> {
    const r = await this.send(cmd, args, timeoutMs);
    if (!r.ok) throw new Error(`${this.label} (pid ${this.pid}) "${cmd}" failed: ${r.error?.name}: ${r.error?.message}`);
    return r.value;
  }
}

export class WorkerPool {
  readonly workers: Worker[] = [];
  readonly events: MpEvent[] = [];

  log(w: Worker, step: string, detail: any = {}, at = Date.now()) {
    const ev: MpEvent = { at, worker: w.label, pid: w.pid, step, detail };
    this.events.push(ev);
    w.noteEvent(ev);
  }

  /** Fork one worker and wait until it reports ready. `env` entries override the defaults (e.g. a dead database URL). */
  /** Number of workers that crashed while STARTING (before running any test code) and were started again. Reported, never hidden. */
  spawnRetries = 0;

  /**
   * Fork a worker. A process that dies while starting (observed once on Windows: exit code 0xC0000409 inside the process, before any test code
   * ran) is started again, at most twice; every such retry is counted in `spawnRetries`, logged as an event, and left visible to the tests.
   * Any other failure (a worker that refuses to start, a timeout) is NOT retried.
   */
  async spawn(label: string, databaseUrl: string, env: Record<string, string> = {}, script: string = WORKER): Promise<Worker> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.spawnOnce(label, databaseUrl, env, script);
      } catch (e: any) {
        if (attempt < 3 && /exited during start/.test(String(e?.message))) {
          this.spawnRetries++;
          this.events.push({ at: Date.now(), worker: label, pid: 0, step: 'spawn-retry', detail: { attempt, reason: String(e.message).split(String.fromCharCode(10))[0] } });
          continue;
        }
        throw e;
      }
    }
  }

  private async spawnOnce(label: string, databaseUrl: string, env: Record<string, string> = {}, script: string = WORKER): Promise<Worker> {
    const childEnv: Record<string, string | undefined> = { ...process.env, ...env };
    delete childEnv.NODE_TEST_CONTEXT; // the worker is not a node:test child
    childEnv.MP_DATABASE_URL = env.MP_DATABASE_URL || databaseUrl;
    childEnv.DATABASE_URL = childEnv.MP_DATABASE_URL;
    childEnv.MP_WORKER_LABEL = label;
    const child = fork(script, [], {
      cwd: ROOT,
      execArgv: ['-r', 'ts-node/register/transpile-only'],
      env: childEnv as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const worker = new Worker(label, child, this);
    this.workers.push(worker);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} (pid ${child.pid}) did not become ready in 30 s\n${worker.output}`)), 30_000);
      child.on('message', (m: any) => {
        if (m.type === 'ready') { clearTimeout(timer); resolve(); }
        if (m.type === 'fatal') { clearTimeout(timer); reject(new Error(`${label}: ${m.message}`)); }
      });
      child.on('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`${label} exited during start (code ${code}, signal ${signal})\n${worker.output}`)); });
    });
    return worker;
  }

  static async start(n: number, databaseUrl: string): Promise<WorkerPool> {
    const pool = new WorkerPool();
    try {
      for (let i = 0; i < n; i++) await pool.spawn(`w${i}`, databaseUrl);
      await Promise.all(pool.workers.map((w) => w.must('connect')));
    } catch (e) {
      await pool.shutdown();
      throw e;
    }
    return pool;
  }

  /**
   * The barrier. Phase 1: every given worker is told to PREPARE the job and acknowledges, i.e. it is armed and waiting.
   * Phase 2: the controller chooses a start instant `leadMs` ahead and sends FIRE; each worker leaves the barrier at that
   * instant. Returns the replies in the order of `workers`, plus how far apart the workers really started.
   */
  async race(
    workers: Worker[],
    cmd: string,
    argsFor: (w: Worker, i: number) => any,
    opts: { leadMs?: number; timeoutMs?: number } = {}
  ): Promise<{ replies: WorkerReply[]; startSkewMs: number }> {
    const leadMs = opts.leadMs ?? 250;
    const timeoutMs = opts.timeoutMs ?? 30_000;
    // phase 1: armed
    await Promise.all(workers.map((w, i) => w.must('prepare', { job: { cmd, args: argsFor(w, i) } }, timeoutMs)));
    // phase 2: fire at a common instant
    const startAt = Date.now() + leadMs;
    const replies = await Promise.all(workers.map((w) => w.send('fire', { startAt }, timeoutMs + leadMs)));
    const starts = replies.map((r) => r.startedAt);
    return { replies, startSkewMs: Math.max(...starts) - Math.min(...starts) };
  }

  /**
   * Like race(), but every worker gets its OWN job (e.g. one calls finalizeMonth, another the reconciliation) - all armed first, then fired at
   * one common instant.
   */
  async raceJobs(
    jobs: Array<{ worker: Worker; cmd: string; args?: any }>,
    opts: { leadMs?: number; timeoutMs?: number } = {}
  ): Promise<{ replies: WorkerReply[]; startSkewMs: number }> {
    const leadMs = opts.leadMs ?? 250;
    const timeoutMs = opts.timeoutMs ?? 30_000;
    await Promise.all(jobs.map((j) => j.worker.must('prepare', { job: { cmd: j.cmd, args: j.args || {} } }, timeoutMs)));
    const startAt = Date.now() + leadMs;
    const replies = await Promise.all(jobs.map((j) => j.worker.send('fire', { startAt }, timeoutMs + leadMs)));
    const starts = replies.map((r) => r.startedAt);
    return { replies, startSkewMs: Math.max(...starts) - Math.min(...starts) };
  }

  async kill(w: Worker): Promise<void> {
    if (w.exited) return;
    const done = new Promise<void>((resolve) => w.child.once('exit', () => resolve()));
    w.child.kill('SIGKILL');
    await done;
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.workers.filter((w) => !w.exited).map((w) => this.kill(w)));
  }

  /** Compact text of the latest events, for failure messages. */
  dump(last = 60): string {
    return this.events
      .slice(-last)
      .map((e) => `${new Date(e.at).toISOString().slice(11, 23)} ${e.worker}(pid ${e.pid}) ${e.step} ${JSON.stringify(e.detail)}`)
      .join('\n');
  }
}
