/**
 * Leaderboard Finalize Job (Production-Ready)
 *
 * Cron job that runs on the 1st of every month at 00:05 in timezone "Asia/Ho_Chi_Minh"
 * to finalize the previous month's leaderboard, snapshot rankings, and distribute rewards.
 *
 * Also runs on startup to catch up all missed past months chronologically.
 */

import cron from 'node-cron';
import { LeaderboardService } from '../services/leaderboard.service';
import logger from '../utils/logger';

export function startLeaderboardFinalizeJob() {
  // 1. Run on startup: catch-up all past unfinalized months chronologically
  LeaderboardService.checkAndFinalizeAllPastMonths()
    .then((res) => {
      if (res.finalizedMonths.length > 0) {
        logger.info(`🏆 Catch-up finalization finished: finalized [${res.finalizedMonths.join(', ')}]`);
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
        await LeaderboardService.checkAndFinalizeAllPastMonths();
      } catch (error) {
        logger.error('🏆 Leaderboard finalize cron job error:', error);
      }
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
    }
  );

  logger.info('🏆 Leaderboard finalize cron job initialized (runs at 00:05 on 1st of each month, Asia/Ho_Chi_Minh)');
}
