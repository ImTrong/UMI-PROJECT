/**
 * Leaderboard Finalize Job (Production-Ready)
 *
 * Cron job that runs on the 1st of every month at 00:05 in timezone "Asia/Ho_Chi_Minh"
 * to finalize the previous month's leaderboard, snapshot rankings, and distribute rewards.
 *
 * Also runs on startup to catch up all missed past months chronologically, and reconciles unfinished
 * periods periodically (see RECONCILE_INTERVAL_MS). All of it goes through the per-period lock (FIX 06B2).
 */

import cron from 'node-cron';
import { LeaderboardService } from '../services/leaderboard.service';
import { resolveLockConfig } from '../services/leaderboard-lock.service';
import logger from '../utils/logger';

/** Period between reconciliation passes (0 disables). Must exceed the lock lease so that a period left by a crashed owner is picked up. */
const RECONCILE_INTERVAL_MS = (() => {
  const raw = process.env.LEADERBOARD_RECONCILE_INTERVAL_MS;
  if (raw === undefined || raw === '') return 5 * 60_000;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 5 * 60_000;
})();

export function startLeaderboardFinalizeJob() {
  // Settings that are present but invalid are rejected (never silently replaced): say so at startup, not at the first finalize
  try {
    const lock = resolveLockConfig();
    logger.info(`🔒 Leaderboard lock: lease ${lock.ttlMs} ms, heartbeat ${lock.heartbeatMs} ms`);
    if (RECONCILE_INTERVAL_MS > 0 && RECONCILE_INTERVAL_MS <= lock.ttlMs) {
      logger.warn(`🔒 LEADERBOARD_RECONCILE_INTERVAL_MS (${RECONCILE_INTERVAL_MS}) should be larger than the lock lease (${lock.ttlMs}); a period left by a crashed owner would be found busy`);
    }
  } catch (e) {
    logger.error('🔒 Invalid leaderboard lock configuration - finalization will refuse to run until it is fixed:', e);
  }

  // 1. Run on startup: catch-up all past unfinalized months chronologically. This is the same plain lock acquire as
  //    every other caller: a period still owned by a live process is skipped (BUSY), a period whose owner died is
  //    taken over only once its lease has lapsed - and the reconciliation below picks it up then. FINALIZED periods
  //    are never touched.
  LeaderboardService.checkAndFinalizeAllPastMonths({ initiator: 'SYSTEM_STARTUP_CATCHUP' })
    .then((res) => {
      if (res.finalizedMonths.length > 0) {
        logger.info(`🏆 Catch-up finalization finished: finalized [${res.finalizedMonths.join(', ')}]`);
      }
      if (res.busyMonths.length > 0) {
        logger.info(`🏆 Catch-up skipped [${res.busyMonths.join(', ')}]: owned by another process (reconciliation will retry)`);
      }
    })
    .catch((err) => {
      logger.error('🏆 Failed to catch-up past months on startup:', err);
    });

  // 2. Schedule monthly cron at 00:05 on the 1st of each month (Asia/Ho_Chi_Minh timezone)
  cron.schedule(
    '5 0 1 * *',
    async () => {
      logger.info('🏆 Leaderboard finalize cron job triggered for Asia/Ho_Chi_Minh timezone');
      try {
        await LeaderboardService.checkAndFinalizeAllPastMonths({ initiator: 'SYSTEM_CRON' });
      } catch (error) {
        logger.error('🏆 Leaderboard finalize cron job error:', error);
      }
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
    }
  );

  // 3. Periodic reconciliation of unfinished periods (a crashed owner, a period left REWARDING, undelivered
  //    notifications). Only the plain acquire is used - never a force, never a take-over of a live lease - and one
  //    pass at a time per process; across processes the per-period lock keeps owners apart.
  if (RECONCILE_INTERVAL_MS > 0) {
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const res = await LeaderboardService.checkAndFinalizeAllPastMonths({ initiator: 'SYSTEM_RECONCILE' });
        if (res.finalizedMonths.length > 0) logger.info(`🏆 Reconciliation finalized [${res.finalizedMonths.join(', ')}]`);
      } catch (error) {
        logger.error('🏆 Leaderboard reconciliation error:', error);
      } finally {
        running = false;
      }
    }, RECONCILE_INTERVAL_MS);
    timer.unref?.();
    logger.info(`🏆 Leaderboard reconciliation enabled (every ${Math.round(RECONCILE_INTERVAL_MS / 1000)}s)`);
  }

  logger.info('🏆 Leaderboard finalize cron job initialized (runs at 00:05 on 1st of each month, Asia/Ho_Chi_Minh)');
}
