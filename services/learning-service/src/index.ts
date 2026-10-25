import dotenv from 'dotenv';
import app from './app';
import logger from './utils/logger';
import fs from 'fs';
import { startStudyReminderJob } from './jobs/study-reminder.job';
import { startLeaderboardFinalizeJob } from './jobs/leaderboard-finalize.job';
import { startRedemptionRecoveryJob } from './jobs/redemption-recovery.job';

dotenv.config();

const PORT = process.env.PORT || 3006;
const certificatePath = process.env.CERTIFICATE_STORAGE_PATH || './certificates';

if (!fs.existsSync(certificatePath)) {
  fs.mkdirSync(certificatePath, { recursive: true });
}

app.listen(PORT, () => {
  logger.info(`Learning service running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  
  // Start background jobs
  startStudyReminderJob();
  startLeaderboardFinalizeJob();
  startRedemptionRecoveryJob();
});

