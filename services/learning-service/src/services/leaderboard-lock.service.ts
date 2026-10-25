import { randomBytes } from 'crypto';
import os from 'os';
import { performance } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';
import { SCORING_POLICY_VERSION } from '../config/scoring-policy';
import logger from '../utils/logger';

/**
 * Distributed lock for finalizing one monthly leaderboard period (FIX 06B1 primitives, refined in FIX 06B2).
 *
 * WHAT THIS GIVES
 *   - acquire / renew / release / inspect / assertHeld / fenceTransaction for one (month, year).
 *   - The lock lives on the MonthlyLeaderboard row itself (unique on (month, year)), so "who owns the period"
 *     and "what state is the period in" are in ONE document and can be changed by ONE atomic write.
 *   - Atomicity: acquire / renew are single-document conditional writes (MongoDB findAndModify with an update
 *     pipeline). Two processes can never both succeed; no find-then-update gap.
 *   - Time: lease expiry is computed and compared with the MongoDB SERVER clock ($$NOW) - container clocks
 *     never matter. A lease is VALID while lockExpiresAt >= $$NOW and FREE when lockExpiresAt < $$NOW; acquire
 *     (free?) and renew / fence (valid?) use exactly complementary conditions, so there is no instant at which
 *     both an acquirer and the old owner are admitted.
 *   - Ownership: a random >=128-bit lockToken per acquisition + a monotonic fencingToken (+1 on every
 *     acquire / take-over; absent on old rows == 0). Both must match for renew / release / fence.
 *   - Fencing: fenceTransaction() is a conditional WRITE on the period row INSIDE the caller's transaction,
 *     issued as the FIRST statement of that transaction. It matches only when month/year, lockToken,
 *     fencingToken match, the period is not FINALIZED AND the lease is still valid on the server clock. The write
 *     always changes the row (fenceSeq is incremented; a no-op update takes no write lock and fences nothing).
 *     A take-over is a write to the same row, so MongoDB either orders it after the transaction (the take-over
 *     waits for the commit) or aborts one of them with a write conflict. A previous owner can therefore never
 *     slip a business write in after its ownership was replaced - and a lease that merely LAPSED (nobody took
 *     over yet) no longer admits business writes either.
 *   - A FINALIZED period can never be locked, renewed or fenced, whatever the caller asks for.
 *
 * THREE DIFFERENT SAFETY MECHANISMS, deliberately kept apart:
 *   status compare-and-set (leaderboard.service transitionStatus) ... valid state transitions
 *   this lock + fencing ............................................... which process may act at all
 *   idempotency keys / unique indexes ................................. side effects are not duplicated
 *
 * Lease semantics:
 *   inspect()/assertHeld()  HELD      token+fencing match and lease valid (server clock)
 *                           EXPIRED   token+fencing match but the lease lapsed; nobody replaced us yet
 *                           REPLACED  someone else acquired, or the lock was released
 *                           FINALIZED the period is final - nothing may be locked or written any more
 *                           MISSING   the period row does not exist
 *   renew()                 succeeds ONLY while the lease is still valid on the server clock. A lapsed lease is
 *                           never revived, even if nobody took it over: the owner may already have lost the
 *                           right to write, and after expiry any other process is allowed to take over.
 *   fenceTransaction()      same validity rule as renew (plus month/year), evaluated inside the transaction.
 *   Failures are told apart: LockLostError (reason EXPIRED / REPLACED / FINALIZED / MISSING / RENEW_FAILED /
 *   LOCAL_DEADLINE) means "stop"; LockStoreError means the database could not tell us (never read as success);
 *   a transaction write conflict is passed through untouched so callers can retry it a bounded number of times
 *   (and must fence again at the start of every attempt).
 *
 * Local deadline: besides the database check, the owner keeps a MONOTONIC local deadline for the lease
 * (start of the last successful acquire / renew + ttl, the earliest moment the server could consider it lapsed).
 * LockContext.assertAlive() uses it so no new step (and no HTTP call) is started on a lease that may be gone,
 * even if the heartbeat is stuck. It is an optimisation of "stop early"; correctness never depends on it - the
 * fence is what protects the data.
 *
 * Initial configuration (a starting point to be validated, NOT a proven production threshold):
 *   LEADERBOARD_LOCK_TTL_MS        default 60000   lease length
 *   LEADERBOARD_LOCK_HEARTBEAT_MS  default 20000   renew interval (must be <= TTL / 3)
 */

// ─── Configuration ───────────────────────────────────────────────────────────

export const DEFAULT_LOCK_TTL_MS = 60_000;
export const DEFAULT_LOCK_HEARTBEAT_MS = 20_000;
export const MIN_LOCK_TTL_MS = 1_000;
/** acquire() repeats an attempt whose lease was already (almost) over when the call returned, at most this many attempts in all. */
export const MAX_ACQUIRE_ATTEMPTS = 3;
export const MAX_LOCK_TTL_MS = 10 * 60_000;
export const MIN_LOCK_HEARTBEAT_MS = 100;

export interface LockConfig {
  ttlMs: number;
  heartbeatMs: number;
}

export class LockConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockConfigError';
  }
}

const parseIntegerSetting = (name: string, raw: unknown): number => {
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) throw new LockConfigError(`${name} must be an integer number of milliseconds (got ${raw})`);
    return raw;
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  throw new LockConfigError(`${name} must be an integer number of milliseconds (got ${JSON.stringify(raw)})`);
};

/** Validates a lease length (also used for per-acquire overrides). */
export function validateLockTtl(raw: unknown): number {
  const ttlMs = parseIntegerSetting('lock TTL', raw);
  if (ttlMs < MIN_LOCK_TTL_MS || ttlMs > MAX_LOCK_TTL_MS) {
    throw new LockConfigError(`lock TTL must be between ${MIN_LOCK_TTL_MS} and ${MAX_LOCK_TTL_MS} ms (got ${ttlMs})`);
  }
  return ttlMs;
}

/**
 * Resolves and validates the lease configuration. Absent settings fall back to the documented defaults;
 * settings that are present but invalid are REJECTED (never silently replaced).
 */
export function resolveLockConfig(
  overrides: Partial<LockConfig> = {},
  env: Record<string, string | undefined> = process.env
): LockConfig {
  const rawTtl = overrides.ttlMs ?? env.LEADERBOARD_LOCK_TTL_MS;
  const ttlMs = rawTtl === undefined || rawTtl === '' ? DEFAULT_LOCK_TTL_MS : validateLockTtl(rawTtl);

  const rawHeartbeat = overrides.heartbeatMs ?? env.LEADERBOARD_LOCK_HEARTBEAT_MS;
  const heartbeatMs =
    rawHeartbeat === undefined || rawHeartbeat === ''
      ? Math.min(DEFAULT_LOCK_HEARTBEAT_MS, Math.floor(ttlMs / 3)) // derived only when NOT specified
      : parseIntegerSetting('lock heartbeat', rawHeartbeat);
  if (heartbeatMs < MIN_LOCK_HEARTBEAT_MS) {
    throw new LockConfigError(`lock heartbeat must be at least ${MIN_LOCK_HEARTBEAT_MS} ms (got ${heartbeatMs})`);
  }
  if (heartbeatMs * 3 > ttlMs) {
    throw new LockConfigError(
      `lock heartbeat (${heartbeatMs} ms) must be at most a third of the TTL (${ttlMs} ms) so that two missed beats do not lose the lock`
    );
  }
  return { ttlMs, heartbeatMs };
}

// ─── Results and errors ──────────────────────────────────────────────────────

/** Proof of ownership. Pass it to renew / release / assertHeld / fenceTransaction. */
export interface LockHandle {
  readonly periodId: string;
  readonly month: number;
  readonly year: number;
  readonly lockToken: string;
  readonly fencingToken: number;
  readonly owner: string;
  readonly ttlMs: number;
  /** Lease end as last confirmed by the database (server clock). Informational. */
  expiresAt: Date;
  /**
   * Local MONOTONIC time (performance.now) taken just BEFORE the acquire / renew request that last succeeded.
   * The server computed the lease end after this moment, so `leaseStartedAtMono + ttlMs` is the earliest moment
   * the lease can have lapsed. Used only for the local "stop early" deadline.
   */
  leaseStartedAtMono: number;
}

export type AcquireResult =
  | { status: 'ACQUIRED'; handle: LockHandle }
  | { status: 'BUSY'; owner: string | null; fencingToken: number | null; expiresInMs: number | null }
  | { status: 'FINALIZED' };

export type RenewResult =
  | { renewed: true; expiresAt: Date }
  | { renewed: false; reason: 'EXPIRED' | 'REPLACED' | 'FINALIZED' | 'MISSING' };

export type ReleaseResult = { released: true } | { released: false; reason: 'NOT_OWNER' };

export type HeldState = 'HELD' | 'EXPIRED' | 'REPLACED' | 'FINALIZED' | 'MISSING';

export class LockNotAcquiredError extends Error {
  constructor(public readonly result: Exclude<AcquireResult, { status: 'ACQUIRED' }>, month: number, year: number) {
    super(
      result.status === 'FINALIZED'
        ? `Leaderboard ${month}/${year} is FINALIZED and cannot be locked`
        : `Leaderboard ${month}/${year} is locked by another process`
    );
    this.name = 'LockNotAcquiredError';
  }
}

export type LockLostReason = Exclude<HeldState, 'HELD'> | 'RENEW_FAILED' | 'LOCAL_DEADLINE';

/**
 * The caller no longer owns the lock. It must stop writing immediately. This is FINAL: unlike a transaction
 * write conflict it must never be retried (the message deliberately avoids the words callers match on for conflicts).
 */
export class LockLostError extends Error {
  constructor(public readonly reason: LockLostReason, month: number, year: number) {
    super(`Lock on leaderboard ${month}/${year} is no longer held (${reason}); stop all writes`);
    this.name = 'LockLostError';
  }
}

/** A database failure while talking to the lock. Never to be read as "acquired", "held" or "released". */
export class LockStoreError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'LockStoreError';
  }
}

// ─── Store (the only part that needs the MongoDB server clock) ───────────────

export interface StoredLock {
  periodId: string;
  lockToken: string;
  fencingToken: number;
  lockOwner: string;
  expiresAt: Date;
}

export interface LockSnapshot {
  periodId: string;
  status: string;
  lockToken: string | null;
  lockOwner: string | null;
  fencingToken: number | null;
  /** null when no lease is recorded; otherwise evaluated by the database against its own clock */
  expired: boolean | null;
  remainingMs: number | null;
}

/** Result of the in-transaction fence write. `state` says WHY it was refused (never 'HELD'). */
export type FenceOutcome = { ok: true } | { ok: false; state: Exclude<HeldState, 'HELD'> };

export interface LockStore {
  /** Atomically take the lease if the period is not FINALIZED and the lock is free or expired. */
  tryAcquire(a: { month: number; year: number; owner: string; token: string; ttlMs: number }): Promise<StoredLock | null>;
  /** Atomically extend the lease if token + fencing still match, the period is not FINALIZED and the lease is still VALID. */
  tryRenew(a: { periodId: string; token: string; fencingToken: number; ttlMs: number }): Promise<StoredLock | null>;
  /**
   * The fence: ONE conditional write on the period row, inside the caller's transaction `tx`. It matches only when
   * month/year, token and fencing token match, the period is not FINALIZED and the lease is valid on the server
   * clock; it always changes the row. A transaction write conflict is thrown UNCHANGED (callers retry it); any other
   * database failure is a LockStoreError. It must never answer ok:true unless the write matched.
   */
  fenceInTransaction(tx: any, a: { periodId: string; month: number; year: number; token: string; fencingToken: number }): Promise<FenceOutcome>;
  inspectById(periodId: string): Promise<LockSnapshot | null>;
  inspectByPeriod(month: number, year: number): Promise<LockSnapshot | null>;
}

/** Same detection as course-redemption.service.isTxConflict (kept local: this module must not import the Prisma-owning service). */
const isTransactionConflict = (e: any) =>
  e?.code === 'P2034' || /write conflict|WriteConflict|TransientTransactionError/i.test(e?.message || '');

const COLLECTION = 'monthly_leaderboards'; // @@map in schema.prisma

// Extended-JSON helpers: Prisma returns raw MongoDB documents as EJSON.
const ejsonNumber = (v: any): number | null => {
  if (typeof v === 'number') return v;
  const wrapped = v?.$numberInt ?? v?.$numberLong ?? v?.$numberDouble;
  if (wrapped !== undefined) return Number(wrapped);
  return null;
};
const ejsonDate = (v: any): Date | null => {
  const d = v?.$date;
  if (d === undefined) return null;
  if (typeof d === 'string') return new Date(d);
  const ms = d?.$numberLong ?? d;
  return new Date(Number(ms));
};
const ejsonId = (v: any): string | null => (typeof v?.$oid === 'string' ? v.$oid : null);

/**
 * MongoDB implementation. Every decision about time uses the server's $$NOW; strings written to the document
 * go through $literal so a value that happens to start with '$' is never read as a field path.
 */
export class MongoLockStore implements LockStore {
  constructor(private readonly prisma: PrismaClient) {}

  private async command(cmd: Record<string, unknown>, what: string): Promise<any> {
    try {
      return (await (this.prisma as any).$runCommandRaw(cmd)) as any;
    } catch (e) {
      throw new LockStoreError(`Leaderboard lock ${what} failed: ${(e as Error)?.message || e}`, e);
    }
  }

  private toStored(doc: any): StoredLock {
    const periodId = ejsonId(doc?._id);
    const fencingToken = ejsonNumber(doc?.fencingToken);
    const expiresAt = ejsonDate(doc?.lockExpiresAt);
    if (!periodId || fencingToken === null || !expiresAt || typeof doc?.lockToken !== 'string') {
      throw new LockStoreError('Leaderboard lock returned an unreadable document');
    }
    return { periodId, lockToken: doc.lockToken, fencingToken, lockOwner: String(doc.lockOwner ?? ''), expiresAt };
  }

  async tryAcquire(a: { month: number; year: number; owner: string; token: string; ttlMs: number }) {
    const res = await this.command(
      {
        findAndModify: COLLECTION,
        query: {
          month: a.month,
          year: a.year,
          status: { $ne: 'FINALIZED' },
          // free = never locked | released | expired according to the SERVER clock
          $or: [{ lockToken: null }, { lockExpiresAt: null }, { $expr: { $lt: ['$lockExpiresAt', '$$NOW'] } }],
        },
        update: [
          {
            $set: {
              lockToken: { $literal: a.token },
              lockOwner: { $literal: a.owner },
              lockExpiresAt: { $add: ['$$NOW', a.ttlMs] },
              lockHeartbeatAt: '$$NOW',
              fencingToken: { $add: [{ $ifNull: ['$fencingToken', 0] }, 1] },
            },
          },
        ],
        new: true,
      },
      'acquire'
    );
    return res?.value ? this.toStored(res.value) : null;
  }

  async tryRenew(a: { periodId: string; token: string; fencingToken: number; ttlMs: number }) {
    const res = await this.command(
      {
        findAndModify: COLLECTION,
        query: {
          _id: { $oid: a.periodId },
          lockToken: a.token,
          fencingToken: a.fencingToken,
          status: { $ne: 'FINALIZED' },
          // still VALID on the server clock (the exact complement of "free" in tryAcquire): a lapsed lease is not revived
          $expr: { $gte: ['$lockExpiresAt', '$$NOW'] },
        },
        update: [{ $set: { lockExpiresAt: { $add: ['$$NOW', a.ttlMs] }, lockHeartbeatAt: '$$NOW' } }],
        new: true,
      },
      'renew'
    );
    return res?.value ? this.toStored(res.value) : null;
  }

  async fenceInTransaction(tx: any, a: { periodId: string; month: number; year: number; token: string; fencingToken: number }): Promise<FenceOutcome> {
    let res: any;
    try {
      res = await tx.$runCommandRaw({
        update: COLLECTION,
        updates: [
          {
            q: {
              _id: { $oid: a.periodId },
              month: a.month,
              year: a.year,
              lockToken: a.token,
              fencingToken: a.fencingToken,
              status: { $ne: 'FINALIZED' },
              $expr: { $gte: ['$lockExpiresAt', '$$NOW'] }, // lease still valid on the SERVER clock
            },
            // A pipeline update with a counter: the row is ALWAYS modified, so the transaction really holds a write
            // on it (a no-op update would take no write lock and would not conflict with a take-over).
            u: [{ $set: { lockHeartbeatAt: '$$NOW', fenceSeq: { $add: [{ $ifNull: ['$fenceSeq', 0] }, 1] } } }],
            multi: false,
          },
        ],
      });
    } catch (e) {
      if (isTransactionConflict(e)) throw e; // the caller's bounded retry re-fences from scratch
      throw new LockStoreError(`Leaderboard lock fence failed: ${(e as Error)?.message || e}`, e);
    }
    if (res?.ok !== 1 || (Array.isArray(res?.writeErrors) && res.writeErrors.length > 0)) {
      throw new LockStoreError(`Leaderboard lock fence was not accepted by the database: ${JSON.stringify(res?.writeErrors ?? res)}`);
    }
    if (res.n === 1 && res.nModified === 1) return { ok: true };
    if (res.n === 1) throw new LockStoreError('Leaderboard lock fence matched but did not write; ownership cannot be proven');

    // Refused: find out why, inside the same transaction snapshot (read-only, server clock)
    let doc: any;
    try {
      const r = await tx.$runCommandRaw({
        aggregate: COLLECTION,
        pipeline: [
          { $match: { _id: { $oid: a.periodId } } },
          {
            $project: {
              status: 1,
              lockToken: 1,
              fencingToken: 1,
              expired: { $cond: [{ $eq: [{ $ifNull: ['$lockExpiresAt', null] }, null] }, null, { $lt: ['$lockExpiresAt', '$$NOW'] }] },
            },
          },
        ],
        cursor: {},
      });
      doc = r?.cursor?.firstBatch?.[0];
    } catch (e) {
      if (isTransactionConflict(e)) throw e;
      throw new LockStoreError(`Leaderboard lock fence classification failed: ${(e as Error)?.message || e}`, e);
    }
    if (!doc) return { ok: false, state: 'MISSING' };
    if (doc.status === 'FINALIZED') return { ok: false, state: 'FINALIZED' };
    if (doc.lockToken !== a.token || ejsonNumber(doc.fencingToken) !== a.fencingToken) return { ok: false, state: 'REPLACED' };
    if (doc.expired !== false) return { ok: false, state: 'EXPIRED' };
    throw new LockStoreError('Leaderboard lock fence refused although the lock looks held; ownership cannot be proven');
  }

  private async inspect(match: Record<string, unknown>): Promise<LockSnapshot | null> {
    const res = await this.command(
      {
        aggregate: COLLECTION,
        pipeline: [
          { $match: match },
          {
            $project: {
              status: 1,
              lockToken: 1,
              lockOwner: 1,
              fencingToken: 1,
              expired: { $cond: [{ $eq: [{ $ifNull: ['$lockExpiresAt', null] }, null] }, null, { $lt: ['$lockExpiresAt', '$$NOW'] }] },
              remainingMs: { $cond: [{ $eq: [{ $ifNull: ['$lockExpiresAt', null] }, null] }, null, { $subtract: ['$lockExpiresAt', '$$NOW'] }] },
            },
          },
        ],
        cursor: {},
      },
      'inspect'
    );
    const doc = res?.cursor?.firstBatch?.[0];
    if (!doc) return null;
    return {
      periodId: ejsonId(doc._id) as string,
      status: String(doc.status),
      lockToken: typeof doc.lockToken === 'string' ? doc.lockToken : null,
      lockOwner: typeof doc.lockOwner === 'string' ? doc.lockOwner : null,
      fencingToken: ejsonNumber(doc.fencingToken),
      expired: typeof doc.expired === 'boolean' ? doc.expired : null,
      remainingMs: ejsonNumber(doc.remainingMs),
    };
  }

  inspectById(periodId: string) {
    return this.inspect({ _id: { $oid: periodId } });
  }

  inspectByPeriod(month: number, year: number) {
    return this.inspect({ month, year });
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export interface LeaderboardLockDeps {
  prisma?: PrismaClient;
  store?: LockStore;
  config?: Partial<LockConfig>;
  /** Monotonic clock in ms (default performance.now). Injectable so the local deadline can be tested without waiting. */
  monotonicNow?: () => number;
}

export interface LockHeartbeat {
  /** Stop renewing (idempotent). Does not release the lock. */
  stop(): void;
  readonly lost: boolean;
  readonly lostReason: LockLostReason | null;
}

const isUniqueViolation = (e: any) => e?.code === 'P2002' || /Unique constraint|E11000/i.test(e?.message || '');

export class LeaderboardLockService {
  readonly config: LockConfig;
  private readonly prisma: PrismaClient;
  private readonly store: LockStore;
  private readonly mono: () => number;

  constructor(deps: LeaderboardLockDeps = {}) {
    this.config = resolveLockConfig(deps.config);
    this.prisma = deps.prisma ?? new PrismaClient();
    this.store = deps.store ?? new MongoLockStore(this.prisma);
    this.mono = deps.monotonicNow ?? (() => performance.now());
  }

  /** Current monotonic time of this service (ms). */
  now(): number {
    return this.mono();
  }

  private static assertPeriod(month: number, year: number) {
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new RangeError(`Invalid leaderboard period ${month}/${year}`);
    }
  }

  private static assertHandle(handle: LockHandle) {
    if (!handle || typeof handle.lockToken !== 'string' || handle.lockToken.length < 32 || !Number.isInteger(handle.fencingToken) || !handle.periodId) {
      throw new TypeError('A valid lock handle is required');
    }
  }

  /** Default owner label: host:pid plus a short random suffix (informational only). */
  static defaultOwner(): string {
    return `${os.hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  }

  /**
   * Try to become the owner of the period. Never waits (by design) and never takes over a live lease:
   *   ACQUIRED  you own it (handle carries the new token + fencing token) and the lease is USABLE (see below)
   *   BUSY      another owner holds an un-expired lease (or just took it)
   *   FINALIZED the period is final; it cannot be locked - not by force, not by take-over
   * Database failures throw LockStoreError; they are never reported as ACQUIRED.
   *
   * A lease that is already (almost) over when the call returns is never handed out. MongoDB computes the new lease from the instant the
   * conditional write STARTED; if that write was blocked - typically by the still-open transaction of a process that died mid-transaction,
   * which the server only aborts after its transaction lifetime limit (60 s by default, observed ~80 s) - the lease is over before the caller
   * even gets it. Reporting ACQUIRED for it would send the caller on a run that its own ownership check stops at once, leaving the period
   * recorded as "owned" by a dead lease. Such a lease is handed back (token + fencing token must match) and the acquisition is repeated with a
   * fresh token, at most MAX_ACQUIRE_ATTEMPTS times in all.
   */
  async acquire(month: number, year: number, options: { owner?: string; ttlMs?: number } = {}): Promise<AcquireResult> {
    LeaderboardLockService.assertPeriod(month, year);
    const ttlMs = options.ttlMs === undefined ? this.config.ttlMs : validateLockTtl(options.ttlMs);
    const owner = options.owner ?? LeaderboardLockService.defaultOwner();
    // the lease must outlive at least one heartbeat, otherwise the first renewal would arrive too late
    const minUsefulLeaseMs = Math.min(this.config.heartbeatMs, Math.floor(ttlMs / 3));

    for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS; attempt++) {
      await this.ensurePeriod(month, year);

      const token = randomBytes(32).toString('hex'); // 256 bit from the OS CSPRNG, fresh for every attempt
      const startedMono = this.mono(); // BEFORE the request: the server computes the lease end after this moment
      const stored = await this.store.tryAcquire({ month, year, owner, token, ttlMs });
      if (stored) {
        const handle: LockHandle = {
          periodId: stored.periodId,
          month,
          year,
          lockToken: stored.lockToken,
          fencingToken: stored.fencingToken,
          owner: stored.lockOwner,
          ttlMs,
          expiresAt: stored.expiresAt,
          leaseStartedAtMono: startedMono,
        };
        const remainingMs = ttlMs - (this.mono() - startedMono);
        if (remainingMs <= minUsefulLeaseMs) {
          logger.warn(
            `🔒 [Lock] acquire of ${month}/${year} (fencing=${stored.fencingToken}) was delayed ${ttlMs - remainingMs} ms - the lease it granted has ${Math.max(0, remainingMs)} ms left and is useless; handing it back` +
              (attempt < MAX_ACQUIRE_ATTEMPTS ? ' and trying again' : '')
          );
          await this.release(handle); // a failure here is a LockStoreError: never "acquired"
          continue;
        }
        logger.info(`🔒 [Lock] acquired ${month}/${year} owner=${stored.lockOwner} fencing=${stored.fencingToken} ttl=${ttlMs}ms${stored.fencingToken > 1 ? ' (earlier lease on this period lapsed or was released)' : ''}`);
        return { status: 'ACQUIRED', handle };
      }

      const snapshot = await this.store.inspectByPeriod(month, year);
      if (!snapshot) continue; // the row disappeared between the two steps: recreate it (bounded)
      if (snapshot.status === 'FINALIZED') return { status: 'FINALIZED' };
      logger.info(`🔒 [Lock] ${month}/${year} is busy (held by ${snapshot.lockOwner ?? 'unknown'}, fencing=${snapshot.fencingToken}, ${snapshot.remainingMs ?? '?'}ms left)`);
      return { status: 'BUSY', owner: snapshot.lockOwner, fencingToken: snapshot.fencingToken, expiresInMs: snapshot.remainingMs };
    }
    throw new LockStoreError(`Leaderboard period ${month}/${year} could not be created, found, or locked with a usable lease`);
  }

  /** Like acquire, but throws LockNotAcquiredError unless ACQUIRED. */
  async acquireOrThrow(month: number, year: number, options: { owner?: string; ttlMs?: number } = {}): Promise<LockHandle> {
    const result = await this.acquire(month, year, options);
    if (result.status !== 'ACQUIRED') throw new LockNotAcquiredError(result, month, year);
    return result.handle;
  }

  /** Makes sure exactly one row exists for (month, year); concurrent creators converge on the same row. */
  private async ensurePeriod(month: number, year: number): Promise<void> {
    try {
      const existing = await this.prisma.monthlyLeaderboard.findUnique({
        where: { month_year: { month, year } },
        select: { id: true },
      });
      if (existing) return;
      await this.prisma.monthlyLeaderboard.create({ data: { month, year, policyVersion: SCORING_POLICY_VERSION } });
    } catch (e) {
      if (isUniqueViolation(e)) return; // another process created it first: that row is the one
      throw new LockStoreError(`Leaderboard period ${month}/${year} could not be ensured: ${(e as Error)?.message || e}`, e);
    }
  }

  /**
   * Extend the lease. Succeeds ONLY while the lease is still valid on the database clock and token + fencing token
   * still match: a lease that already lapsed is NOT revived (the owner may have stopped being allowed to write, and
   * another process may take over at any moment). A lost lock is a result - { renewed: false, reason } with
   * EXPIRED / REPLACED / FINALIZED / MISSING - not an exception; database failures throw LockStoreError and are
   * never reported as "renewed".
   */
  async renew(handle: LockHandle): Promise<RenewResult> {
    LeaderboardLockService.assertHandle(handle);
    const startedMono = this.mono();
    const stored = await this.store.tryRenew({
      periodId: handle.periodId,
      token: handle.lockToken,
      fencingToken: handle.fencingToken,
      ttlMs: handle.ttlMs,
    });
    if (stored) {
      handle.expiresAt = stored.expiresAt;
      handle.leaseStartedAtMono = startedMono;
      return { renewed: true, expiresAt: stored.expiresAt };
    }
    const state = await this.inspect(handle);
    const reason = state === 'FINALIZED' ? 'FINALIZED' : state === 'MISSING' ? 'MISSING' : state === 'EXPIRED' ? 'EXPIRED' : 'REPLACED';
    logger.warn(`🔒 [Lock] renew refused for ${handle.month}/${handle.year} fencing=${handle.fencingToken}: ${reason}`);
    return { renewed: false, reason };
  }

  /**
   * Local, database-free check: is the lease still inside the earliest possible server-side lifetime
   * (start of the last successful acquire / renew + ttl)? Used to stop starting new work early.
   */
  isLeaseLocallyValid(handle: LockHandle): boolean {
    return this.mono() < handle.leaseStartedAtMono + handle.ttlMs;
  }

  /** Give the lock up. Only the exact (token, fencing token) pair can release; a previous owner cannot release a newer lock. */
  async release(handle: LockHandle): Promise<ReleaseResult> {
    LeaderboardLockService.assertHandle(handle);
    try {
      const res = await this.prisma.monthlyLeaderboard.updateMany({
        where: { id: handle.periodId, lockToken: handle.lockToken, fencingToken: handle.fencingToken },
        data: { lockToken: null, lockOwner: null, lockExpiresAt: null }, // fencingToken is kept: it must never go backwards
      });
      if (res.count !== 1) {
        logger.warn(`🔒 [Lock] release of ${handle.month}/${handle.year} fencing=${handle.fencingToken} ignored: not the owner any more`);
        return { released: false, reason: 'NOT_OWNER' };
      }
      logger.info(`🔒 [Lock] released ${handle.month}/${handle.year} fencing=${handle.fencingToken}`);
      return { released: true };
    } catch (e) {
      throw new LockStoreError(`Leaderboard lock release failed: ${(e as Error)?.message || e}`, e);
    }
  }

  /** Non-throwing ownership check, evaluated by the database (server clock for the expiry). */
  async inspect(handle: LockHandle): Promise<HeldState> {
    LeaderboardLockService.assertHandle(handle);
    const s = await this.store.inspectById(handle.periodId);
    if (!s) return 'MISSING';
    if (s.status === 'FINALIZED') return 'FINALIZED';
    if (s.lockToken !== handle.lockToken || s.fencingToken !== handle.fencingToken) return 'REPLACED';
    return s.expired === false ? 'HELD' : 'EXPIRED';
  }

  /** Throws LockLostError unless the lock is HELD right now (valid and not expired). */
  async assertHeld(handle: LockHandle): Promise<void> {
    const state = await this.inspect(handle);
    if (state !== 'HELD') throw new LockLostError(state, handle.month, handle.year);
  }

  /**
   * Fence a business transaction. Call it as the FIRST statement inside the caller's $transaction: it performs a
   * conditional WRITE on the period row (month/year + token + fencing token + not FINALIZED + lease valid on the
   * database clock). Because a take-over writes the same row, MongoDB either orders the two or aborts one with a
   * write conflict - a replaced owner can never write after its successor, and an owner whose lease lapsed can no
   * longer write at all. If the conditions do not hold it throws LockLostError (reason EXPIRED / REPLACED /
   * FINALIZED / MISSING), which rolls the transaction back and is final (never retried). A transaction write
   * conflict is rethrown unchanged for the caller's bounded retry, which MUST call this again at the start of every
   * attempt; any other database failure is a LockStoreError (never "fenced"). `tx` is a Prisma interactive-
   * transaction client.
   */
  async fenceTransaction(tx: any, handle: LockHandle): Promise<void> {
    LeaderboardLockService.assertHandle(handle);
    const outcome = await this.store.fenceInTransaction(tx, {
      periodId: handle.periodId,
      month: handle.month,
      year: handle.year,
      token: handle.lockToken,
      fencingToken: handle.fencingToken,
    });
    if (outcome.ok) return;
    logger.warn(`🔒 [Lock] fence refused for ${handle.month}/${handle.year} fencing=${handle.fencingToken}: ${outcome.state}; the transaction is rolled back`);
    throw new LockLostError(outcome.state, handle.month, handle.year);
  }

  /**
   * Keep the lease alive while the owner works. Renews every config.heartbeatMs. The owner is told it LOST the lock
   * (once, via onLost, and `lost` turns true) when
   *   - a renew is refused (EXPIRED / REPLACED / FINALIZED / MISSING), or
   *   - the local deadline passes without a successful renew (renew failing, or even hanging, for a whole TTL):
   *     ownership can no longer be proven. The deadline is measured from the START of the last successful renew,
   *     i.e. it is never later than the server's view.
   * The heartbeat then stops. It never releases the lock.
   */
  startHeartbeat(handle: LockHandle, onLost?: (reason: LockLostReason) => void): LockHeartbeat {
    LeaderboardLockService.assertHandle(handle);
    let stopped = false;
    let lost = false;
    let lostReason: LockLostReason | null = null;
    let inFlight = false;
    let renewFailing = false; // the last renew attempt threw (database unreachable), as opposed to simply not being attempted

    const markLost = (reason: LockLostReason) => {
      if (lost) return;
      lost = true;
      lostReason = reason;
      stop();
      logger.error(`🔒 [Lock] ${handle.month}/${handle.year} fencing=${handle.fencingToken} LOST (${reason}); the owner must stop all work`);
      try {
        onLost?.(reason);
      } catch (e) {
        logger.error('onLost callback failed:', e);
      }
    };

    const timer = setInterval(async () => {
      if (stopped) return;
      // Ownership can no longer be proven (no successful renew for a whole TTL): lost, even if a renew is still hanging.
      if (!this.isLeaseLocallyValid(handle)) return markLost(renewFailing ? 'RENEW_FAILED' : 'LOCAL_DEADLINE');
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await this.renew(handle);
        renewFailing = false;
        if (stopped) return;
        if (!r.renewed) markLost(r.reason);
      } catch (e) {
        renewFailing = true;
        logger.warn(`🔒 [Lock] renew of ${handle.month}/${handle.year} failed (will retry): ${(e as Error)?.message}`);
        if (!stopped && !this.isLeaseLocallyValid(handle)) markLost('RENEW_FAILED');
      } finally {
        inFlight = false;
      }
    }, this.config.heartbeatMs);
    timer.unref?.();

    function stop() {
      stopped = true;
      clearInterval(timer);
    }

    return {
      stop,
      get lost() {
        return lost;
      },
      get lostReason() {
        return lostReason;
      },
    };
  }

  /** Builds the context that is handed to every step that writes. */
  createContext(handle: LockHandle, heartbeat: LockHeartbeat | null = null): LockContext {
    return new LockContext(this, handle, heartbeat);
  }
}

/** What a writing step needs from the lock: a cheap local liveness check and the in-transaction fence. LockContext implements it. */
export interface FenceGuard {
  assertAlive(): void;
  fence(tx: any): Promise<void>;
}

/**
 * Everything a writing step needs to prove it still owns the period: the handle (month, year, period id, lock
 * token, fencing token) and the heartbeat. Pass it to EVERY step that writes.
 *   assertAlive()  local, database-free: throws LockLostError when the heartbeat reported a loss or the local
 *                  deadline passed. Call it before starting a step and before every HTTP call.
 *   fence(tx)      assertAlive + the in-transaction fence write; call it as the first statement of the transaction
 *                  (and again at the start of every retry attempt).
 */
export class LockContext implements FenceGuard {
  constructor(
    readonly service: LeaderboardLockService,
    readonly handle: LockHandle,
    private heartbeat: LockHeartbeat | null = null
  ) {}

  get month() { return this.handle.month; }
  get year() { return this.handle.year; }
  get periodId() { return this.handle.periodId; }
  get lockToken() { return this.handle.lockToken; }
  get fencingToken() { return this.handle.fencingToken; }

  attachHeartbeat(heartbeat: LockHeartbeat) {
    this.heartbeat = heartbeat;
  }

  assertAlive(): void {
    if (this.heartbeat?.lost) throw new LockLostError(this.heartbeat.lostReason ?? 'RENEW_FAILED', this.handle.month, this.handle.year);
    if (!this.service.isLeaseLocallyValid(this.handle)) throw new LockLostError('LOCAL_DEADLINE', this.handle.month, this.handle.year);
  }

  async fence(tx: any): Promise<void> {
    this.assertAlive();
    await this.service.fenceTransaction(tx, this.handle);
  }
}
