/**
 * FIX 06B1 + 06B2 unit tests for the leaderboard lock service (acquire / renew / release / assertHeld /
 * fenceTransaction / heartbeat / LockContext / configuration).
 *
 * The real service code runs against the in-memory Prisma fake and a FakeLockStore with a controllable clock.
 * What a fake CANNOT prove - true atomicity of the conditional write, MongoDB's $$NOW clock, real transaction
 * conflicts - is proven on a real replica set in tests/integration/leaderboard-lock.mongo.test.ts.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePrisma, db } from './helpers/fake-prisma';
import { FakeLockStore, ManualClock } from './helpers/fake-lock-store';

installFakePrisma();

/* eslint-disable @typescript-eslint/no-var-requires */
const logger = require('../src/utils/logger').default;
const lockModule = require('../src/services/leaderboard-lock.service');
const { runTx } = require('../src/services/course-redemption.service');
const {
  LeaderboardLockService, resolveLockConfig, LockConfigError, LockNotAcquiredError, LockLostError, LockStoreError,
  LockContext, DEFAULT_LOCK_TTL_MS, DEFAULT_LOCK_HEARTBEAT_MS, MAX_ACQUIRE_ATTEMPTS,
} = lockModule;

logger.transports.forEach((t: any) => { t.silent = true; });

const MONTH = 9;
const YEAR = 2026;
const TTL = 60_000;

let clock: InstanceType<typeof ManualClock>;
let store: FakeLockStore;
let svc: any;

const make = (config: any = { ttlMs: TTL, heartbeatMs: 20_000 }, st: FakeLockStore = store) =>
  new LeaderboardLockService({ store: st, config });

beforeEach(() => {
  db.reset();
  clock = new ManualClock();
  store = new FakeLockStore(clock);
  svc = make();
});

const rows = () => db.tables.monthlyLeaderboard;
const row = () => rows().find((r) => r.month === MONTH && r.year === YEAR)!;
const acquire = async (service = svc, owner = 'owner-A') => {
  const r = await service.acquire(MONTH, YEAR, { owner });
  assert.equal(r.status, 'ACQUIRED', JSON.stringify(r));
  return r.handle;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ====================================================================================

describe('LOCK config: the lease settings are validated, never silently replaced', () => {
  it('documented initial values apply when nothing is configured', () => {
    const c = resolveLockConfig({}, {});
    assert.deepEqual(c, { ttlMs: DEFAULT_LOCK_TTL_MS, heartbeatMs: DEFAULT_LOCK_HEARTBEAT_MS });
    assert.equal(DEFAULT_LOCK_TTL_MS, 60_000);
    assert.equal(DEFAULT_LOCK_HEARTBEAT_MS, 20_000);
  });

  it('environment values are read; heartbeat is derived (<= TTL/3) only when it is not specified', () => {
    assert.deepEqual(resolveLockConfig({}, { LEADERBOARD_LOCK_TTL_MS: '30000', LEADERBOARD_LOCK_HEARTBEAT_MS: '10000' }), { ttlMs: 30000, heartbeatMs: 10000 });
    assert.deepEqual(resolveLockConfig({}, { LEADERBOARD_LOCK_TTL_MS: '3000' }), { ttlMs: 3000, heartbeatMs: 1000 });
    assert.deepEqual(resolveLockConfig({ ttlMs: 9000 }, { LEADERBOARD_LOCK_TTL_MS: '30000' }), { ttlMs: 9000, heartbeatMs: 3000 }, 'explicit overrides beat the environment');
  });

  for (const [label, overrides, env] of [
    ['zero TTL', { ttlMs: 0 }, {}],
    ['negative TTL', { ttlMs: -1000 }, {}],
    ['TTL below the minimum', { ttlMs: 999 }, {}],
    ['TTL above the maximum', { ttlMs: 10 * 60_000 + 1 }, {}],
    ['fractional TTL', { ttlMs: 1500.5 }, {}],
    ['NaN TTL', { ttlMs: Number.NaN }, {}],
    ['Infinity TTL', { ttlMs: Infinity }, {}],
    ['text TTL in the environment', {}, { LEADERBOARD_LOCK_TTL_MS: 'soon' }],
    ['negative TTL in the environment', {}, { LEADERBOARD_LOCK_TTL_MS: '-5' }],
    ['fractional TTL in the environment', {}, { LEADERBOARD_LOCK_TTL_MS: '1.5' }],
    ['heartbeat not below a third of the TTL', { ttlMs: 60000, heartbeatMs: 30000 }, {}],
    ['heartbeat equal to the TTL', { ttlMs: 5000, heartbeatMs: 5000 }, {}],
    ['heartbeat below the minimum', { ttlMs: 60000, heartbeatMs: 10 }, {}],
    ['text heartbeat in the environment', {}, { LEADERBOARD_LOCK_HEARTBEAT_MS: 'fast' }],
    ['heartbeat too large for an environment TTL', {}, { LEADERBOARD_LOCK_TTL_MS: '3000', LEADERBOARD_LOCK_HEARTBEAT_MS: '2000' }],
  ] as const) {
    it(`rejects: ${label}`, () => {
      assert.throws(() => resolveLockConfig(overrides as any, env as any), LockConfigError);
    });
  }

  it('the service refuses to be built with an invalid configuration and validates per-acquire TTLs', async () => {
    assert.throws(() => new LeaderboardLockService({ store, config: { ttlMs: 0 } }), LockConfigError);
    await assert.rejects(svc.acquire(MONTH, YEAR, { ttlMs: 5 }), LockConfigError);
    assert.equal(rows().length, 0, 'rejected before touching the database');
  });

  it('an invalid period or handle is rejected before the database is touched', async () => {
    for (const [m, y] of [[0, 2026], [13, 2026], [1.5, 2026], [9, 1999], [9, 3000], [Number.NaN, 2026]]) {
      await assert.rejects(svc.acquire(m, y), RangeError);
    }
    await assert.rejects(svc.renew({}), TypeError);
    assert.equal(store.calls.length, 0);
    assert.equal(rows().length, 0);
  });
});

describe('LOCK acquire', () => {
  it('ACQUIRED: random >=128-bit token, fencing token 1, period row created once with the default status', async () => {
    const h = await acquire();
    assert.match(h.lockToken, /^[0-9a-f]{64}$/, '256-bit hex token');
    assert.ok(h.lockToken.length * 4 >= 128);
    assert.equal(h.fencingToken, 1);
    assert.equal(h.periodId, row().id);
    assert.equal(h.owner, 'owner-A');
    assert.equal(h.expiresAt.getTime(), clock.now() + TTL);
    assert.equal(rows().length, 1);
    assert.equal(row().status, 'ACTIVE', 'the lock service does not decide business states');
    assert.equal(row().lockToken, h.lockToken);
    assert.equal(row().fencingToken, 1);
  });

  it('every acquisition gets a fresh token', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const h = await acquire();
      seen.add(h.lockToken);
      assert.deepEqual(await svc.release(h), { released: true });
    }
    assert.equal(seen.size, 20);
  });

  it('20 concurrent acquires of one period: exactly one ACQUIRED, the rest BUSY, one row', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => svc.acquire(MONTH, YEAR, { owner: `p${i}` })));
    assert.equal(results.filter((r: any) => r.status === 'ACQUIRED').length, 1);
    assert.equal(results.filter((r: any) => r.status === 'BUSY').length, 19);
    assert.equal(rows().length, 1);
    assert.equal(row().fencingToken, 1);
    const winner = results.find((r: any) => r.status === 'ACQUIRED');
    assert.equal(row().lockToken, winner.handle.lockToken);
  });

  it('concurrent first-time creation of the period row converges on a single row', async () => {
    assert.equal(rows().length, 0);
    await Promise.all(Array.from({ length: 25 }, () => svc.acquire(MONTH, YEAR)));
    assert.equal(rows().length, 1);
  });

  it('BUSY carries who holds it and for how long (server-evaluated remaining time)', async () => {
    await acquire(svc, 'owner-A');
    clock.advance(10_000);
    const r = await svc.acquire(MONTH, YEAR, { owner: 'owner-B' });
    assert.equal(r.status, 'BUSY');
    assert.equal(r.owner, 'owner-A');
    assert.equal(r.fencingToken, 1);
    assert.equal(r.expiresInMs, TTL - 10_000);
  });

  it('different periods lock independently', async () => {
    const a = await svc.acquire(9, 2026);
    const b = await svc.acquire(10, 2026);
    assert.equal(a.status, 'ACQUIRED');
    assert.equal(b.status, 'ACQUIRED');
    assert.equal(rows().length, 2);
  });

  it('rows written before the lock existed (no lock fields at all) are acquirable, fencing starts at 1', async () => {
    db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 3, finalizedBy: 'old-run' });
    assert.equal('fencingToken' in row(), false);
    const h = await acquire();
    assert.equal(h.fencingToken, 1);
    assert.equal(row().status, 'SNAPSHOT_BUILDING', 'status untouched');
    assert.equal(row().totalParticipants, 3);
    assert.equal(row().finalizedBy, 'old-run');
  });

  it('rows with explicit nulls (after a release) and rows with a lapsed lease are acquirable', async () => {
    db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'REWARDING', lockToken: null, lockOwner: null, lockExpiresAt: null, fencingToken: 4 });
    const h = await acquire();
    assert.equal(h.fencingToken, 5);
    clock.advance(TTL + 1);
    const h2 = await acquire(svc, 'owner-B');
    assert.equal(h2.fencingToken, 6);
  });

  for (const options of [{}, { force: true }, { takeOver: true }, { force: true, takeOver: true }]) {
    it(`a FINALIZED period is refused, even with ${JSON.stringify(options) === '{}' ? 'no flags' : JSON.stringify(options)}`, async () => {
      db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'FINALIZED', totalParticipants: 4, totalPointsAwarded: 2400, lockToken: 'old', lockExpiresAt: new Date(clock.now() - 1000), fencingToken: 3 });
      const before = JSON.stringify(row());
      const r = await svc.acquire(MONTH, YEAR, { owner: 'x', ...options });
      assert.deepEqual(r, { status: 'FINALIZED' });
      assert.equal(JSON.stringify(row()), before, 'not a single field changed');
    });
  }

  it('acquireOrThrow throws LockNotAcquiredError for BUSY and FINALIZED, returns the handle otherwise', async () => {
    const h = await svc.acquireOrThrow(MONTH, YEAR);
    assert.ok(h.lockToken);
    await assert.rejects(svc.acquireOrThrow(MONTH, YEAR), (e: any) => e instanceof LockNotAcquiredError && e.result.status === 'BUSY');
    row().status = 'FINALIZED';
    await assert.rejects(svc.acquireOrThrow(MONTH, YEAR), (e: any) => e instanceof LockNotAcquiredError && e.result.status === 'FINALIZED');
  });

  it('a live lease is never taken over; after expiry the next acquirer takes over with a higher fencing token', async () => {
    const a = await acquire(svc, 'A');
    clock.advance(TTL - 1);
    assert.equal((await svc.acquire(MONTH, YEAR, { owner: 'B' })).status, 'BUSY', '1 ms before expiry');
    clock.advance(2);
    const b = await svc.acquire(MONTH, YEAR, { owner: 'B' });
    assert.equal(b.status, 'ACQUIRED');
    assert.equal(b.handle.fencingToken, a.fencingToken + 1);
    assert.notEqual(b.handle.lockToken, a.lockToken);
    assert.equal(row().lockOwner, 'B');
  });

  it('the fencing token never goes backwards - across take-overs AND release / acquire cycles', async () => {
    const seen: number[] = [];
    let h = await acquire();
    seen.push(h.fencingToken);
    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) { await svc.release(h); } else { clock.advance(TTL + 1); }
      h = await acquire(svc, `o${i}`);
      seen.push(h.fencingToken);
    }
    assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7]);
  });

  describe('database failures are never reported as success', () => {
    it('the conditional write fails -> rejects with LockStoreError, nothing is ACQUIRED', async () => {
      store.failNext('tryAcquire', new Error('connection reset'));
      await assert.rejects(svc.acquire(MONTH, YEAR), (e: any) => e instanceof LockStoreError || /connection reset/.test(e.message));
      assert.equal(row().lockToken, undefined);
    });

    it('creating the period row fails (not a duplicate) -> LockStoreError', async () => {
      db.failNext('monthlyLeaderboard', 'create', new Error('disk full'));
      await assert.rejects(svc.acquire(MONTH, YEAR), LockStoreError);
      assert.equal(rows().length, 0);
    });

    it('looking the row up fails -> LockStoreError', async () => {
      db.failNext('monthlyLeaderboard', 'findUnique', new Error('timeout'));
      await assert.rejects(svc.acquire(MONTH, YEAR), LockStoreError);
    });

    it('classifying a refusal fails -> rejects instead of guessing BUSY / FINALIZED', async () => {
      await acquire();
      store.failNext('inspectByPeriod', new Error('network down'));
      await assert.rejects(svc.acquire(MONTH, YEAR, { owner: 'B' }));
    });

    it('a duplicate-key error while creating is NOT a failure (another process created the row first)', async () => {
      // our findUnique saw nothing; right before our create another process inserts the row -> real P2002 from the unique key
      let raced = false;
      db.beforeNext('monthlyLeaderboard', 'create', () => {
        raced = true;
        db.seed('monthlyLeaderboard', { month: MONTH, year: YEAR, status: 'SNAPSHOT_BUILDING', totalParticipants: 7 });
      });
      const r = await svc.acquire(MONTH, YEAR);
      assert.ok(raced, 'the race really happened');
      assert.equal(r.status, 'ACQUIRED');
      assert.equal(rows().length, 1);
      assert.equal(row().totalParticipants, 7, 'the row created by the other process is the one we locked');
    });
  });
});

describe('LOCK acquire: a lease that is already (almost) over when the call returns is never handed out (FIX 06C-4A)', () => {
  /** A service whose monotonic clock the test controls, so a "blocked" acquire can be simulated deterministically. */
  const withClock = (hb = 20_000) => {
    let mono = 1_000;
    const service = new LeaderboardLockService({ store, config: { ttlMs: TTL, heartbeatMs: hb }, monotonicNow: () => mono });
    return { service, advance: (ms: number) => { mono += ms; } };
  };

  it('an attempt that outlives the lease it was granted is handed back and repeated with a FRESH token; the caller gets a usable lease', async () => {
    const { service, advance } = withClock();
    let discarded = '';
    store.afterNext('tryAcquire', () => { discarded = row().lockToken; advance(TTL + 5_000); });   // the first attempt is blocked for longer than the lease
    const r = await service.acquire(MONTH, YEAR, { owner: 'B' });
    assert.equal(r.status, 'ACQUIRED');
    assert.equal(store.count('tryAcquire'), 2);
    assert.equal(r.handle.fencingToken, 2, 'the discarded attempt consumed fencing token 1 - tokens never go back');
    assert.notEqual(r.handle.lockToken, discarded, 'the repeat uses a new token');
    assert.equal(row().lockToken, r.handle.lockToken);
    assert.equal(await service.inspect(r.handle), 'HELD');
    assert.ok(service.isLeaseLocallyValid(r.handle), 'and the local deadline agrees');
  });

  it('the margin is one heartbeat: less than that left -> repeated; enough left -> kept without a second attempt', async () => {
    const tight = withClock(20_000);
    store.afterNext('tryAcquire', () => tight.advance(TTL - 20_000 + 1_000));                      // 19 s of 60 s left, below the 20 s heartbeat
    assert.equal((await tight.service.acquire(MONTH, YEAR)).status, 'ACQUIRED');
    assert.equal(store.count('tryAcquire'), 2, 'repeated');

    db.reset();
    store.calls.length = 0;
    const roomy = withClock(20_000);
    store.afterNext('tryAcquire', () => roomy.advance(TTL - 20_000 - 1_000));                      // 21 s left
    const r = await roomy.service.acquire(MONTH, YEAR);
    assert.equal(r.status, 'ACQUIRED');
    assert.equal(store.count('tryAcquire'), 1, 'kept');
    assert.equal(r.handle.fencingToken, 1);
  });

  it('a slow but still usable acquire (a few ms) is untouched', async () => {
    const { service } = withClock();
    const r = await service.acquire(MONTH, YEAR);
    assert.equal(r.status, 'ACQUIRED');
    assert.equal(store.count('tryAcquire'), 1);
  });

  it('if EVERY attempt is blocked past its lease it gives up after MAX_ACQUIRE_ATTEMPTS with a LockStoreError and leaves nothing held', async () => {
    const { service, advance } = withClock();
    for (let i = 0; i < MAX_ACQUIRE_ATTEMPTS; i++) store.afterNext('tryAcquire', () => advance(TTL + 1));
    await assert.rejects(service.acquire(MONTH, YEAR), (e: any) => e instanceof LockStoreError && /usable lease/.test(e.message));
    assert.equal(store.count('tryAcquire'), MAX_ACQUIRE_ATTEMPTS, 'bounded');
    assert.equal(row().lockToken, null, 'every discarded lease was handed back');
    assert.equal(row().fencingToken, MAX_ACQUIRE_ATTEMPTS);
  });

  it('failing to hand a useless lease back is an error - never ACQUIRED', async () => {
    const { service, advance } = withClock();
    store.afterNext('tryAcquire', () => advance(TTL + 1));
    db.failNext('monthlyLeaderboard', 'updateMany', new Error('io error while releasing'));
    await assert.rejects(service.acquire(MONTH, YEAR), (e: any) => e instanceof LockStoreError);
  });
});

describe('LOCK renew / release / assertHeld', () => {
  it('renew by the owner extends the lease (and the handle)', async () => {
    const h = await acquire();
    clock.advance(30_000);
    const r = await svc.renew(h);
    assert.equal(r.renewed, true);
    assert.equal(h.expiresAt.getTime(), clock.now() + TTL);
    assert.equal(row().lockExpiresAt.getTime(), clock.now() + TTL);
    clock.advance(TTL - 1);
    assert.equal(await svc.inspect(h), 'HELD');
  });

  it('a lapsed lease is NOT revived - not even when nobody replaced it (FIX 06B2); the owner is told EXPIRED', async () => {
    const h = await acquire();
    const expiryBefore = row().lockExpiresAt.getTime();
    const handleExpiryBefore = h.expiresAt.getTime();
    clock.advance(TTL + 5_000);
    assert.equal(await svc.inspect(h), 'EXPIRED');

    assert.deepEqual(await svc.renew(h), { renewed: false, reason: 'EXPIRED' });
    assert.equal(row().lockExpiresAt.getTime(), expiryBefore, 'the stored lease was not extended');
    assert.equal(h.expiresAt.getTime(), handleExpiryBefore, 'the handle was not extended either');
    assert.equal(await svc.inspect(h), 'EXPIRED', 'and it stays expired');

    // after expiry anybody may take over; the former owner is then simply REPLACED
    const b = await acquire(svc, 'B');
    assert.equal(b.fencingToken, h.fencingToken + 1);
    assert.deepEqual(await svc.renew(h), { renewed: false, reason: 'REPLACED' });
    assert.equal(await svc.inspect(b), 'HELD');
  });

  it('the lease is valid up to and INCLUDING its end instant and free from the next millisecond: renew and acquire never overlap', async () => {
    const h = await acquire();
    clock.advance(TTL);                       // exactly at lockExpiresAt
    assert.equal(await svc.inspect(h), 'HELD');
    assert.equal((await svc.acquire(MONTH, YEAR, { owner: 'B' })).status, 'BUSY', 'not free yet');
    assert.equal((await svc.renew(h)).renewed, true, 'still valid, so renewable');

    clock.advance(TTL + 1);                   // one millisecond past the new end
    assert.equal(await svc.inspect(h), 'EXPIRED');
    assert.deepEqual(await svc.renew(h), { renewed: false, reason: 'EXPIRED' });
    assert.equal((await svc.acquire(MONTH, YEAR, { owner: 'B' })).status, 'ACQUIRED', 'free now');
  });

  it('the previous owner cannot renew after a take-over and does not disturb the new lease', async () => {
    const a = await acquire(svc, 'A');
    clock.advance(TTL + 1);
    const b = await acquire(svc, 'B');
    const expiryBefore = row().lockExpiresAt.getTime();
    clock.advance(1000);
    assert.deepEqual(await svc.renew(a), { renewed: false, reason: 'REPLACED' });
    assert.equal(row().lockExpiresAt.getTime(), expiryBefore, 'B lease untouched by the stale renew');
    assert.equal(row().lockToken, b.lockToken);
  });

  it('renew is refused for a FINALIZED period and for a vanished row', async () => {
    const h = await acquire();
    row().status = 'FINALIZED';
    assert.deepEqual(await svc.renew(h), { renewed: false, reason: 'FINALIZED' });
    db.tables.monthlyLeaderboard.length = 0;
    assert.deepEqual(await svc.renew(h), { renewed: false, reason: 'MISSING' });
  });

  it('a database failure while renewing throws; it is neither "renewed" nor "lost"', async () => {
    const h = await acquire();
    store.failNext('tryRenew', new Error('socket hang up'));
    await assert.rejects(svc.renew(h), /socket hang up/);
    assert.equal((await svc.renew(h)).renewed, true, 'and the lock is still ours afterwards');
  });

  it('release by the owner clears the lock but keeps the fencing token; the next acquirer needs no waiting', async () => {
    const a = await acquire();
    assert.deepEqual(await svc.release(a), { released: true });
    assert.equal(row().lockToken, null);
    assert.equal(row().lockOwner, null);
    assert.equal(row().lockExpiresAt, null);
    assert.equal(row().fencingToken, 1);
    const b = await acquire(svc, 'B');
    assert.equal(b.fencingToken, 2);
  });

  it('a previous owner can NOT release the new owner\'s lock', async () => {
    const a = await acquire(svc, 'A');
    clock.advance(TTL + 1);
    const b = await acquire(svc, 'B');
    assert.deepEqual(await svc.release(a), { released: false, reason: 'NOT_OWNER' });
    assert.equal(await svc.inspect(b), 'HELD');
    assert.equal(row().lockToken, b.lockToken);
  });

  it('release needs BOTH the token and the fencing token', async () => {
    const a = await acquire();
    assert.deepEqual(await svc.release({ ...a, fencingToken: a.fencingToken + 1 }), { released: false, reason: 'NOT_OWNER' });
    assert.deepEqual(await svc.release({ ...a, lockToken: 'f'.repeat(64) }), { released: false, reason: 'NOT_OWNER' });
    assert.equal(await svc.inspect(a), 'HELD');
    assert.deepEqual(await svc.release(a), { released: true });
    assert.deepEqual(await svc.release(a), { released: false, reason: 'NOT_OWNER' }, 'second release is a harmless no-op');
  });

  it('the owner of a period that has just been FINALIZED can still release its lock', async () => {
    const a = await acquire();
    row().status = 'FINALIZED';
    assert.deepEqual(await svc.release(a), { released: true });
    assert.equal(row().lockToken, null);
  });

  it('a database failure while releasing throws LockStoreError', async () => {
    const a = await acquire();
    db.failNext('monthlyLeaderboard', 'updateMany', new Error('io error'));
    await assert.rejects(svc.release(a), LockStoreError);
  });

  it('inspect / assertHeld tell HELD, EXPIRED, REPLACED, FINALIZED and MISSING apart', async () => {
    const a = await acquire(svc, 'A');
    assert.equal(await svc.inspect(a), 'HELD');
    await svc.assertHeld(a);

    clock.advance(TTL + 1);
    assert.equal(await svc.inspect(a), 'EXPIRED');
    await assert.rejects(svc.assertHeld(a), (e: any) => e instanceof LockLostError && e.reason === 'EXPIRED');

    const b = await acquire(svc, 'B');
    assert.equal(await svc.inspect(a), 'REPLACED');
    await assert.rejects(svc.assertHeld(a), (e: any) => e instanceof LockLostError && e.reason === 'REPLACED');
    await svc.assertHeld(b);

    row().status = 'FINALIZED';
    assert.equal(await svc.inspect(b), 'FINALIZED');
    await assert.rejects(svc.assertHeld(b), (e: any) => e instanceof LockLostError && e.reason === 'FINALIZED');

    db.tables.monthlyLeaderboard.length = 0;
    assert.equal(await svc.inspect(b), 'MISSING');
  });

  it('a released lock reads as REPLACED for its former owner', async () => {
    const a = await acquire();
    await svc.release(a);
    assert.equal(await svc.inspect(a), 'REPLACED');
  });
});

describe('LOCK fenceTransaction', () => {
  let walletSeq = 0;
  const business = (_tag: string) => (tx: any) =>
    tx.userRewardPoint.create({ data: { userId: `u${++walletSeq}`.padEnd(24, '0'), balance: 1, totalEarned: 1, totalSpent: 0 } });

  it('the owner fences and its business write commits together with the fence', async () => {
    const a = await acquire();
    await runTx(async (tx: any) => {
      await svc.fenceTransaction(tx, a);
      await business('ok')(tx);
    });
    assert.equal(db.count('userRewardPoint'), 1);
    assert.ok(row().lockHeartbeatAt, 'the fence really wrote the period row');
  });

  it('the fence is a REAL write every time (fenceSeq moves) and is the FIRST database call of the transaction', async () => {
    const a = await acquire();
    assert.equal(row().fenceSeq, undefined);
    for (let i = 1; i <= 3; i++) {
      const segmentsBefore = db.txSegments().length;
      await runTx(async (tx: any) => { await svc.fenceTransaction(tx, a); await business('seq')(tx); });
      const inTx = db.txSegments()[segmentsBefore].calls;
      assert.deepEqual([inTx[0].table, inTx[0].op], ['monthlyLeaderboard', 'updateMany'], 'the conditional write on the period row comes first');
      assert.equal(row().fenceSeq, i);
    }
  });

  it('an owner whose lease LAPSED (nobody took over yet) must not begin business writes: EXPIRED, nothing written, row untouched', async () => {
    const a = await acquire();
    clock.advance(TTL + 1);
    assert.equal(row().lockToken, a.lockToken, 'precondition: still the owner of record, just lapsed');
    const snapshot = JSON.stringify(row());
    let businessRan = false;
    await assert.rejects(
      runTx(async (tx: any) => { await svc.fenceTransaction(tx, a); businessRan = true; await business('lapsed')(tx); }),
      (e: any) => e instanceof LockLostError && e.reason === 'EXPIRED'
    );
    assert.equal(businessRan, false);
    assert.equal(db.count('userRewardPoint'), 0);
    assert.equal(JSON.stringify(row()), snapshot, 'a refused fence changes nothing');
  });

  it('a handle that does not belong to the period row (wrong month / year) never fences, and says so with an error rather than success', async () => {
    const a = await acquire();
    let businessRan = false;
    for (const forged of [{ ...a, month: MONTH === 1 ? 2 : 1 }, { ...a, year: YEAR + 1 }]) {
      await assert.rejects(runTx(async (tx: any) => { await svc.fenceTransaction(tx, forged); businessRan = true; }));
    }
    assert.equal(businessRan, false);
  });

  it('a database failure while fencing is neither "fenced" nor "lost": it propagates and the business write does not happen', async () => {
    const a = await acquire();
    store.failNext('fenceInTransaction', new Error('socket closed'));
    let businessRan = false;
    await assert.rejects(
      runTx(async (tx: any) => { await svc.fenceTransaction(tx, a); businessRan = true; await business('x')(tx); }),
      (e: any) => !(e instanceof LockLostError) && /socket closed/.test(e.message)
    );
    assert.equal(businessRan, false);
    assert.equal(db.count('userRewardPoint'), 0);
    await runTx(async (tx: any) => { await svc.fenceTransaction(tx, a); await business('y')(tx); });
    assert.equal(db.count('userRewardPoint'), 1, 'and the owner is still the owner afterwards');
  });

  it('a replaced owner is fenced out: LockLostError, and its business write never happens', async () => {
    const a = await acquire(svc, 'A');
    clock.advance(TTL + 1);
    const b = await acquire(svc, 'B');
    let businessRan = false;
    await assert.rejects(
      runTx(async (tx: any) => {
        await svc.fenceTransaction(tx, a);
        businessRan = true;
        await business('stale')(tx);
      }),
      (e: any) => e instanceof LockLostError && e.reason === 'REPLACED'
    );
    assert.equal(businessRan, false);
    assert.equal(db.count('userRewardPoint'), 0);
    assert.equal(row().lockToken, b.lockToken, 'the new owner is untouched');

    // and the new owner passes
    await runTx(async (tx: any) => { await svc.fenceTransaction(tx, b); await business('new')(tx); });
    assert.equal(db.count('userRewardPoint'), 1);
  });

  it('the fencing token must match too: right token + wrong fencing token is rejected', async () => {
    const a = await acquire();
    await assert.rejects(
      runTx((tx: any) => svc.fenceTransaction(tx, { ...a, fencingToken: a.fencingToken + 1 })),
      (e: any) => e instanceof LockLostError
    );
    await assert.rejects(
      runTx((tx: any) => svc.fenceTransaction(tx, { ...a, fencingToken: a.fencingToken - 1 })),
      (e: any) => e instanceof LockLostError
    );
  });

  it('a released lock and a FINALIZED / missing period all fence out', async () => {
    const a = await acquire();
    await svc.release(a);
    await assert.rejects(runTx((tx: any) => svc.fenceTransaction(tx, a)), (e: any) => e instanceof LockLostError && e.reason === 'REPLACED');

    const b = await acquire(svc, 'B');
    row().status = 'FINALIZED';
    await assert.rejects(runTx((tx: any) => svc.fenceTransaction(tx, b)), (e: any) => e instanceof LockLostError && e.reason === 'FINALIZED');

    db.tables.monthlyLeaderboard.length = 0;
    await assert.rejects(runTx((tx: any) => svc.fenceTransaction(tx, b)), (e: any) => e instanceof LockLostError && e.reason === 'MISSING');
  });

  it('a failed fence rolls back EVERYTHING the transaction wrote before it', async () => {
    const a = await acquire(svc, 'A');
    clock.advance(TTL + 1);
    await acquire(svc, 'B');
    await assert.rejects(
      runTx(async (tx: any) => {
        await tx.userRewardPoint.create({ data: { userId: 'w'.repeat(24), balance: 5, totalEarned: 5, totalSpent: 0 } }); // written first
        await svc.fenceTransaction(tx, a);                                                                                  // then fenced out
      }),
      LockLostError
    );
    assert.equal(db.count('userRewardPoint'), 0, 'the earlier write was undone with the transaction');
    assert.ok(db.rollbacks >= 1);
  });

  it('a transient transaction conflict is retried a bounded number of times and the business write happens once', async () => {
    const a = await acquire();
    db.failNext('monthlyLeaderboard', 'updateMany', Object.assign(new Error('Transaction failed due to a write conflict'), { code: 'P2034' }), 2);
    let runs = 0;
    await runTx(async (tx: any) => { runs++; await svc.fenceTransaction(tx, a); await business('retry')(tx); });
    assert.equal(runs, 3, 'two conflicts, then success');
    assert.equal(db.count('userRewardPoint'), 1);
  });

  it('a persistent conflict stops after a bounded number of attempts (no endless loop) and writes nothing', async () => {
    const a = await acquire();
    db.failNext('monthlyLeaderboard', 'updateMany', Object.assign(new Error('write conflict'), { code: 'P2034' }), 1000);
    let runs = 0;
    await assert.rejects(runTx(async (tx: any) => { runs++; await svc.fenceTransaction(tx, a); await business('never')(tx); }), /conflict/);
    assert.ok(runs >= 2 && runs <= 5, `attempts: ${runs}`);
    assert.equal(db.count('userRewardPoint'), 0);
  });

  it('LockLostError is final: it is NOT retried like a conflict', async () => {
    const a = await acquire(svc, 'A');
    clock.advance(TTL + 1);
    await acquire(svc, 'B');
    let runs = 0;
    await assert.rejects(runTx(async (tx: any) => { runs++; await svc.fenceTransaction(tx, a); }), LockLostError);
    assert.equal(runs, 1);
  });
});

describe('LOCK context (what every writing step receives)', () => {
  it('exposes month / year / period / tokens and passes while the lease is alive', async () => {
    const h = await acquire();
    const ctx = svc.createContext(h);
    assert.ok(ctx instanceof LockContext);
    assert.deepEqual([ctx.month, ctx.year, ctx.periodId, ctx.lockToken, ctx.fencingToken], [MONTH, YEAR, h.periodId, h.lockToken, h.fencingToken]);
    ctx.assertAlive();
    await runTx(async (tx: any) => { await ctx.fence(tx); });
  });

  it('assertAlive() fails locally (no database call) once the heartbeat reported a loss', async () => {
    const h = await acquire();
    let lostCb = (_r: string) => undefined;
    const fakeHeartbeat = { stop() {}, lost: false, lostReason: null as string | null };
    const ctx = svc.createContext(h, fakeHeartbeat);
    ctx.assertAlive();
    fakeHeartbeat.lost = true;
    fakeHeartbeat.lostReason = 'REPLACED';
    const dbCalls = store.calls.length;
    assert.throws(() => ctx.assertAlive(), (e: any) => e instanceof LockLostError && e.reason === 'REPLACED');
    await assert.rejects(runTx((tx: any) => ctx.fence(tx)), (e: any) => e instanceof LockLostError && e.reason === 'REPLACED');
    assert.equal(store.calls.length, dbCalls, 'no lock-store call was made');
    void lostCb;
  });

  it('assertAlive() enforces the local monotonic deadline: start of the last successful acquire / renew + TTL', async () => {
    let mono = 1_000;
    const local = new LeaderboardLockService({ store, config: { ttlMs: TTL, heartbeatMs: 20_000 }, monotonicNow: () => mono });
    const r = await local.acquire(MONTH, YEAR, { owner: 'A' });
    const ctx = local.createContext(r.handle);
    mono += TTL - 1;
    ctx.assertAlive();
    mono += 1;
    assert.throws(() => ctx.assertAlive(), (e: any) => e instanceof LockLostError && e.reason === 'LOCAL_DEADLINE');

    // a successful renew moves the deadline forward - measured from when the renew was SENT
    clock.advance(1000);
    mono = 5_000;
    const sentAt = mono;
    assert.equal((await local.renew(r.handle)).renewed, true);
    assert.equal(r.handle.leaseStartedAtMono, sentAt);
    mono = sentAt + TTL - 1;
    ctx.assertAlive();
    mono = sentAt + TTL;
    assert.throws(() => ctx.assertAlive(), /LOCAL_DEADLINE|no longer held/);
  });
});

describe('LOCK heartbeat', () => {
  const fast = () => {
    const realStore = new FakeLockStore(); // real clock: heartbeat uses real timers
    return { realStore, service: make({ ttlMs: 1000, heartbeatMs: 200 }, realStore) };
  };

  it('keeps the lease alive beyond one TTL and keeps others out; stopping lets it lapse', async () => {
    const { realStore, service } = fast();
    const r = await service.acquire(MONTH, YEAR, { owner: 'A' });
    const hb = service.startHeartbeat(r.handle);
    await sleep(1700);
    assert.equal(await service.inspect(r.handle), 'HELD', 'still held after 1.7 x TTL');
    assert.equal((await service.acquire(MONTH, YEAR, { owner: 'B' })).status, 'BUSY');
    assert.ok(realStore.count('tryRenew') >= 4);
    assert.equal(hb.lost, false);

    hb.stop();
    hb.stop(); // idempotent
    const renews = realStore.count('tryRenew');
    await sleep(1300);
    assert.equal(realStore.count('tryRenew'), renews, 'no renewals after stop');
    assert.equal((await service.acquire(MONTH, YEAR, { owner: 'B' })).status, 'ACQUIRED', 'lapsed after stop');
  });

  it('detects that the lock was taken over, calls onLost once and stops renewing', async () => {
    const { realStore, service } = fast();
    const r = await service.acquire(MONTH, YEAR, { owner: 'A' });
    const reasons: string[] = [];
    const hb = service.startHeartbeat(r.handle, (reason: string) => reasons.push(reason));
    row().lockToken = 'e'.repeat(64);                // someone else owns it now
    row().fencingToken = r.handle.fencingToken + 1;
    await sleep(600);
    assert.equal(hb.lost, true);
    assert.equal(hb.lostReason, 'REPLACED');
    assert.deepEqual(reasons, ['REPLACED']);
    const renews = realStore.count('tryRenew');
    await sleep(500);
    assert.equal(realStore.count('tryRenew'), renews);
    assert.equal(row().lockToken, 'e'.repeat(64), 'the stale heartbeat never overwrote the new owner');
  });

  it('renew failures are tolerated for less than a TTL, then the owner is told it can no longer prove ownership', async () => {
    const { realStore, service } = fast();
    const r = await service.acquire(MONTH, YEAR, { owner: 'A' });
    realStore.failNext('tryRenew', new Error('db unreachable'), 1000);
    let lostAt = 0;
    const t0 = Date.now();
    const hb = service.startHeartbeat(r.handle, () => { lostAt = Date.now() - t0; });
    await sleep(500);
    assert.equal(hb.lost, false, 'still within the TTL');
    await sleep(900);
    assert.equal(hb.lost, true);
    assert.equal(hb.lostReason, 'RENEW_FAILED');
    assert.ok(lostAt >= 900, `declared lost only after a full TTL (${lostAt} ms)`);
  });

  it('a renew that HANGS cannot keep the owner alive: the local deadline declares the loss after one TTL', async () => {
    const { realStore, service } = fast();
    const r = await service.acquire(MONTH, YEAR, { owner: 'A' });
    realStore.hangNext('tryRenew');
    const t0 = Date.now();
    let lostAt = 0;
    const hb = service.startHeartbeat(r.handle, () => { lostAt = Date.now() - t0; });
    await sleep(600);
    assert.equal(hb.lost, false, 'not before the deadline');
    await sleep(700);
    assert.equal(hb.lost, true);
    assert.equal(hb.lostReason, 'LOCAL_DEADLINE');
    assert.ok(lostAt >= 800 && lostAt <= 1300, `lost at ${lostAt} ms (TTL 1000 ms)`);
  });

  it('a renew refused because the lease LAPSED reports EXPIRED (not REPLACED) and stops the heartbeat', async () => {
    const { service } = fast();
    const r = await service.acquire(MONTH, YEAR, { owner: 'A' });
    row().lockExpiresAt = new Date(Date.now() - 10);   // lapsed, nobody replaced us
    const hb = service.startHeartbeat(r.handle);
    await sleep(450);
    assert.equal(hb.lost, true);
    assert.equal(hb.lostReason, 'EXPIRED');
    assert.ok(row().lockExpiresAt.getTime() < Date.now(), 'the heartbeat did not revive the lease');
  });

  it('a heartbeat on a FINALIZED period reports the loss', async () => {
    const { service } = fast();
    const r = await service.acquire(MONTH, YEAR);
    const hb = service.startHeartbeat(r.handle);
    row().status = 'FINALIZED';
    await sleep(500);
    assert.equal(hb.lost, true);
    assert.equal(hb.lostReason, 'FINALIZED');
  });
});
