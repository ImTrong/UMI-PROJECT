/**
 * Redemption Recovery Job
 *
 * Finishes course redemptions left in PENDING_ENROLLMENT (server restart, course-service outage,
 * lost response...). Per stale row it reconciles the real enrollment, completes the redemption if
 * the learner is enrolled, retries otherwise, and refunds ONLY after course-service has definitively
 * rejected the enrollment. Several instances can run it: each row is guarded by a DB lease and every
 * state change is a conditional write, so nothing is enrolled, completed or refunded twice.
 *
 * Proposed defaults (override via env, to be confirmed by operations):
 *   REDEMPTION_RECOVERY_STALE_MS  120000  a PENDING row idle longer than this is picked up
 *                                         (> processing lease of 60s, > 2 x course-service timeout)
 *   REDEMPTION_RECOVERY_ENABLED   true
 * Runs every minute.
 */

import cron from 'node-cron';
import { CourseRedemptionService } from '../services/course-redemption.service';
import logger from '../utils/logger';

let running = false;

export function startRedemptionRecoveryJob() {
  if (process.env.REDEMPTION_RECOVERY_ENABLED === 'false') {
    logger.info('🎁 Redemption recovery job disabled (REDEMPTION_RECOVERY_ENABLED=false)');
    return;
  }

  const staleMs = parseInt(process.env.REDEMPTION_RECOVERY_STALE_MS || '120000', 10);

  // One-off: bring PENDING ledger entries written before the redemption state machine into it.
  CourseRedemptionService.adoptLegacyPendingEntries()
    .then((r) => logger.info(`🎁 Legacy pending redemptions adopted: ${r.adopted}`))
    .catch((e) => logger.error('🎁 Legacy redemption adoption failed:', e));

  cron.schedule('* * * * *', async () => {
    if (running) return; // never overlap within one instance
    running = true;
    try {
      const summary = await CourseRedemptionService.recoverStale(staleMs);
      if (summary.examined > 0) {
        logger.info(`🎁 Redemption recovery: ${JSON.stringify(summary)}`);
      }
    } catch (error) {
      logger.error('🎁 Redemption recovery job error:', error);
    } finally {
      running = false;
    }
  });

  logger.info(`🎁 Redemption recovery job initialized (every minute, stale after ${staleMs}ms)`);
}
