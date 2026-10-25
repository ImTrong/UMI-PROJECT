/**
 * In-memory LockStore over the fake Prisma tables, with a CONTROLLABLE clock so lease expiry can be tested
 * deterministically. It mirrors the semantics of MongoLockStore (single atomic conditional write, server-side
 * time, FINALIZED never lockable, absent fields == free). The REAL atomicity is proven against MongoDB in
 * tests/integration/leaderboard-lock.mongo.test.ts - this fake only lets the service logic be tested fast.
 */
import type { FenceOutcome, LockSnapshot, LockStore, StoredLock } from '../../src/services/leaderboard-lock.service';
import { db } from './fake-prisma';

export interface FakeClock {
  now(): number;
}

export class ManualClock implements FakeClock {
  constructor(private t = Date.parse('2026-10-22T00:00:00.000Z')) {}
  now() { return this.t; }
  advance(ms: number) { this.t += ms; }
}

type Op = 'tryAcquire' | 'tryRenew' | 'fenceInTransaction' | 'inspectById' | 'inspectByPeriod';

export class FakeLockStore implements LockStore {
  calls: Op[] = [];
  private failures: Array<{ op: Op; error: Error; remaining: number }> = [];

  constructor(public clock: FakeClock = { now: () => Date.now() }) {}

  failNext(op: Op, error: Error = new Error(`injected ${op} failure`), times = 1) {
    this.failures.push({ op, error, remaining: times });
  }

  private afterHooks: Array<{ op: Op; fn: () => void | Promise<void> }> = [];
  /** Runs `fn` after the next `op` has changed the state but BEFORE it returns - i.e. the call "took long" (e.g. was blocked by a transaction). */
  afterNext(op: Op, fn: () => void | Promise<void>) {
    this.afterHooks.push({ op, fn });
  }
  private async runAfter(op: Op) {
    const i = this.afterHooks.findIndex((h) => h.op === op);
    if (i >= 0) await this.afterHooks.splice(i, 1)[0].fn();
  }

  private hangs: Op[] = [];
  /** The next call of `op` never settles (a database that stopped answering). */
  hangNext(op: Op) {
    this.hangs.push(op);
  }

  count(op: Op) {
    return this.calls.filter((c) => c === op).length;
  }

  /** Let concurrent callers interleave, then run the check-and-set synchronously (= atomic). */
  private async enter(op: Op) {
    this.calls.push(op);
    const hang = this.hangs.indexOf(op);
    if (hang >= 0) {
      this.hangs.splice(hang, 1);
      await new Promise<never>(() => undefined);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    const f = this.failures.find((x) => x.op === op && x.remaining > 0);
    if (f) {
      f.remaining--;
      throw f.error;
    }
  }

  private isFree(row: any) {
    return (
      row.lockToken == null ||
      row.lockExpiresAt == null ||
      row.lockExpiresAt.getTime() < this.clock.now()
    );
  }

  private toStored(row: any): StoredLock {
    return { periodId: row.id, lockToken: row.lockToken, fencingToken: row.fencingToken, lockOwner: row.lockOwner, expiresAt: row.lockExpiresAt };
  }

  async tryAcquire(a: { month: number; year: number; owner: string; token: string; ttlMs: number }) {
    await this.enter('tryAcquire');
    const row = db.tables.monthlyLeaderboard.find((r) => r.month === a.month && r.year === a.year);
    if (!row || row.status === 'FINALIZED' || !this.isFree(row)) return null;
    row.lockToken = a.token;
    row.lockOwner = a.owner;
    row.lockExpiresAt = new Date(this.clock.now() + a.ttlMs);
    row.lockHeartbeatAt = new Date(this.clock.now());
    row.fencingToken = (row.fencingToken ?? 0) + 1;
    const stored = this.toStored(row);
    await this.runAfter('tryAcquire');
    return stored;
  }

  async tryRenew(a: { periodId: string; token: string; fencingToken: number; ttlMs: number }) {
    await this.enter('tryRenew');
    const row = db.tables.monthlyLeaderboard.find((r) => r.id === a.periodId);
    if (!row || row.status === 'FINALIZED' || row.lockToken !== a.token || row.fencingToken !== a.fencingToken) return null;
    if (this.isFree(row)) return null; // lapsed lease: never revived (exact complement of isFree, as in MongoLockStore)
    row.lockExpiresAt = new Date(this.clock.now() + a.ttlMs);
    row.lockHeartbeatAt = new Date(this.clock.now());
    return this.toStored(row);
  }

  /**
   * Mirrors MongoLockStore.fenceInTransaction: ONE conditional write issued through the transaction client (so it is
   * the first recorded DB call of the transaction, is undone with it, and takes part in the fake's fault injection).
   */
  async fenceInTransaction(tx: any, a: { periodId: string; month: number; year: number; token: string; fencingToken: number }): Promise<FenceOutcome> {
    this.calls.push('fenceInTransaction');
    const f = this.failures.find((x) => x.op === 'fenceInTransaction' && x.remaining > 0);
    if (f) {
      f.remaining--;
      throw f.error;
    }
    const touched = await tx.monthlyLeaderboard.updateMany({
      where: {
        id: a.periodId,
        month: a.month,
        year: a.year,
        lockToken: a.token,
        fencingToken: a.fencingToken,
        status: { not: 'FINALIZED' },
        lockExpiresAt: { gte: new Date(this.clock.now()) }, // valid on the (controllable) server clock
      },
      data: { lockHeartbeatAt: new Date(this.clock.now()), fenceSeq: { increment: 1 } },
    });
    if (touched.count === 1) return { ok: true };

    const row = await tx.monthlyLeaderboard.findUnique({ where: { id: a.periodId } });
    if (!row) return { ok: false, state: 'MISSING' };
    if (row.status === 'FINALIZED') return { ok: false, state: 'FINALIZED' };
    if (row.lockToken !== a.token || row.fencingToken !== a.fencingToken) return { ok: false, state: 'REPLACED' };
    if (this.isFree(row)) return { ok: false, state: 'EXPIRED' };
    throw new Error('fake fence refused although the lock looks held');
  }

  private snapshot(row: any): LockSnapshot {
    const hasLease = row.lockExpiresAt != null;
    return {
      periodId: row.id,
      status: row.status,
      lockToken: row.lockToken ?? null,
      lockOwner: row.lockOwner ?? null,
      fencingToken: row.fencingToken ?? null,
      expired: hasLease ? row.lockExpiresAt.getTime() < this.clock.now() : null,
      remainingMs: hasLease ? row.lockExpiresAt.getTime() - this.clock.now() : null,
    };
  }

  async inspectById(periodId: string) {
    await this.enter('inspectById');
    const row = db.tables.monthlyLeaderboard.find((r) => r.id === periodId);
    return row ? this.snapshot(row) : null;
  }

  async inspectByPeriod(month: number, year: number) {
    await this.enter('inspectByPeriod');
    const row = db.tables.monthlyLeaderboard.find((r) => r.month === month && r.year === year);
    return row ? this.snapshot(row) : null;
  }
}
