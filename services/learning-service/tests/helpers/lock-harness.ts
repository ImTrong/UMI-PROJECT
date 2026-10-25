/**
 * Wires a LeaderboardLockService backed by the in-memory FakeLockStore into LeaderboardService, so the REAL
 * finalize code runs against the fake database.
 *
 * Default: a MANUAL server clock (tests advance `clock` to expire leases deterministically), a long lease (60 s) and
 * a slow heartbeat (20 s), so an ordinary test never sees a renew.
 * `realClock`: the store uses Date.now() and real (short) timers - for the heartbeat tests.
 * `monotonicNow`: replaces performance.now() for the local "stop early" deadline.
 */
import { FakeLockStore, ManualClock } from './fake-lock-store';

export function installTestLocks(
  LeaderboardService: any,
  config: { ttlMs: number; heartbeatMs: number } = { ttlMs: 60_000, heartbeatMs: 20_000 },
  options: { realClock?: boolean; monotonicNow?: () => number } = {}
) {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { LeaderboardLockService } = require('../../src/services/leaderboard-lock.service');
  const clock: ManualClock = options.realClock
    ? ({ now: () => Date.now(), advance() { throw new Error('a real clock cannot be advanced'); } } as unknown as ManualClock)
    : new ManualClock();
  const store = new FakeLockStore(clock);
  const service = new LeaderboardLockService({ store, config, monotonicNow: options.monotonicNow });
  LeaderboardService.useLockService(service);
  return { clock, store, service };
}
