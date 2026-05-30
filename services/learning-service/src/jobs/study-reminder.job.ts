import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import logger from '../utils/logger';

const prisma = new PrismaClient();
const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';

// Run every minute to check for precise start times
export function startStudyReminderJob() {
  cron.schedule('* * * * *', async () => {
    
    try {
      const now = new Date();
      const currentDay = now.getDay(); // 0 (Sun) to 6 (Sat)
      const currentHour = now.getHours(); // 0 to 23
      const currentMinute = now.getMinutes(); // 0 to 59
      
      // Fetch all schedules
      // In a very large scale system, this would be chunked or optimized,
      // but for this implementation, we fetch all active schedules.
      const schedules = await prisma.studySchedule.findMany();
      
      for (const schedule of schedules) {
        if (!schedule.slots || !Array.isArray(schedule.slots)) continue;
        
        // Find if this user has any slot starting at the current hour and minute on the current day
        const matchingSlots = schedule.slots.filter(
          (slot: any) => 
            slot.dayOfWeek === currentDay && 
            slot.startHour === currentHour &&
            (slot.startMinute || 0) === currentMinute
        );
        
        if (matchingSlots.length > 0) {
          // Found a study session for right now!
          const slot = matchingSlots[0] as any;
          
          try {
            const startStr = `${slot.startHour}:${(slot.startMinute || 0).toString().padStart(2, '0')}`;
            const endStr = `${slot.endHour}:${(slot.endMinute || 0).toString().padStart(2, '0')}`;
            
            await axios.post(`${userServiceUrl}/api/users/internal/notifications`, {
              userId: schedule.userId,
              title: 'Đến giờ học rồi! ⏰',
              message: `Bạn có một lịch học: ${slot.activityLabel || 'Học tập'} lúc ${startStr} - ${endStr}`,
              type: 'INFO',
              link: '/my-learning'
            });
            logger.info(`Sent study reminder to user ${schedule.userId} for slot ${startStr}`);
          } catch (error: any) {
            logger.error(`Failed to send reminder to user ${schedule.userId}: ${error.message}`);
          }
        }
      }
      
    } catch (error) {
      logger.error('Error in study reminder cron job:', error);
    }
  });
  
  logger.info('Study reminder cron job initialized (runs at minute 0 of every hour)');
}
