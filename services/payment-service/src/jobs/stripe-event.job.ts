import { PrismaClient } from '@prisma/client';
import { PaymentService } from '../services/payment.service';
import logger from '../utils/logger';

/**
 * B: Stripe Event Worker — processes unfinished StripeEvents from the durable inbox.
 *
 * Features:
 * - Distributed lease lock (processLockUntil) prevents concurrent processing.
 * - Exponential backoff avoids hammering failing events.
 * - Events that exhaust MAX_ATTEMPTS are marked `exhausted=true` (not silently dropped).
 * - Admin replay: `replayExhaustedEvent()` re-queues a specific event for retry.
 * - Idempotent: downstream handlers (handleStripeWebhook) are safe for replay.
 */

let isRunning = false;

const LOCK_DURATION_MS = 60_000; // 1 minute lease
const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 30_000; // 30 seconds

function getBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts - 1), 30 * 60 * 1000);
}

export async function processUnfinishedStripeEvents(options?: {
  prismaClient?: PrismaClient;
  pageSize?: number;
  maxPages?: number;
}): Promise<{ processed: number; failed: number; skipped: number; exhausted: number }> {
  if (isRunning) {
    logger.debug('[StripeEventWorker] Already running, skipping');
    return { processed: 0, failed: 0, skipped: 0, exhausted: 0 };
  }

  isRunning = true;
  const prisma = options?.prismaClient || new PrismaClient();
  const pageSize = options?.pageSize || 20;
  const maxPages = options?.maxPages || 5;
  const now = new Date();
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let exhaustedCount = 0;

  try {
    for (let page = 0; page < maxPages; page++) {
      // Find unprocessed, non-exhausted events that are not locked
      const events = await prisma.stripeEvent.findMany({
        where: {
          processed: false,
          exhausted: false,
          OR: [
            { processLockUntil: null },
            { processLockUntil: { isSet: false } },
            { processLockUntil: { lt: now } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: pageSize,
      });

      if (events.length === 0) break;

      for (const event of events) {
        // Check backoff
        if (event.lastProcessedAt && event.processAttempts > 0) {
          const backoffMs = getBackoffMs(event.processAttempts);
          const nextAllowed = new Date(event.lastProcessedAt.getTime() + backoffMs);
          if (now < nextAllowed) {
            skipped++;
            continue;
          }
        }

        // Acquire lease lock via conditional update
        const lockResult = await prisma.stripeEvent.updateMany({
          where: {
            id: event.id,
            processed: false,
            exhausted: false,
            OR: [
              { processLockUntil: null },
              { processLockUntil: { isSet: false } },
              { processLockUntil: { lt: now } },
            ],
          },
          data: {
            processLockUntil: new Date(now.getTime() + LOCK_DURATION_MS),
          },
        });

        if (lockResult.count === 0) {
          skipped++;
          continue;
        }

        // Process the event
        try {
          const eventData = {
            id: event.stripeEventId,
            type: event.type,
            data: event.data,
          };

          await PaymentService.handleStripeWebhook(eventData, { skipEventTracking: true });

          // Mark as processed
          await prisma.stripeEvent.update({
            where: { id: event.id },
            data: {
              processed: true,
              processedAt: new Date(),
              lastProcessedAt: new Date(),
              processLockUntil: null,
              error: null,
            },
          });

          processed++;
          logger.info(`[StripeEventWorker] Processed event ${event.stripeEventId} (type: ${event.type})`);
        } catch (err: any) {
          const newAttempts = event.processAttempts + 1;
          const isExhausted = newAttempts >= MAX_ATTEMPTS;

          // B.3: Mark exhausted if max attempts reached
          await prisma.stripeEvent.update({
            where: { id: event.id },
            data: {
              processAttempts: newAttempts,
              lastProcessedAt: new Date(),
              processLockUntil: null, // Release lock
              error: err.message?.substring(0, 500),
              exhausted: isExhausted,
            },
          });

          failed++;

          if (isExhausted) {
            exhaustedCount++;
            // B.4: Clear alert for operations team
            logger.error(
              `[StripeEventWorker] ⚠️ ALERT: Event ${event.stripeEventId} (type: ${event.type}) ` +
              `EXHAUSTED ${MAX_ATTEMPTS} attempts. Last error: ${err.message}. ` +
              `Manual intervention required. Use replayExhaustedEvent('${event.stripeEventId}') to retry after fixing root cause.`
            );
          } else {
            logger.warn(
              `[StripeEventWorker] Event ${event.stripeEventId} failed (attempt ${newAttempts}/${MAX_ATTEMPTS}): ${err.message}`
            );
          }
        }
      }
    }
  } catch (err: any) {
    logger.error('[StripeEventWorker] Worker error:', err);
  } finally {
    isRunning = false;
    if (!options?.prismaClient) {
      await prisma.$disconnect();
    }
  }

  if (processed > 0 || failed > 0 || exhaustedCount > 0) {
    logger.info(
      `[StripeEventWorker] Run complete: processed=${processed}, failed=${failed}, skipped=${skipped}, exhausted=${exhaustedCount}`
    );
  }

  return { processed, failed, skipped, exhausted: exhaustedCount };
}

/**
 * B.5: Admin replay — re-queue an exhausted event for retry.
 * 
 * Call this after fixing the root cause of the failure.
 * The event's processAttempts is reset to 0 and exhausted=false,
 * allowing the worker to pick it up again.
 * 
 * B.6: Processing is idempotent — replay will not create duplicate records
 * because handleStripeWebhook uses upsert for StripeEvent and
 * all downstream handlers check for existing records.
 */
export async function replayExhaustedEvent(
  stripeEventId: string,
  options?: { prismaClient?: PrismaClient }
): Promise<{ success: boolean; message: string }> {
  const prisma = options?.prismaClient || new PrismaClient();

  try {
    const event = await prisma.stripeEvent.findUnique({
      where: { stripeEventId },
    });

    if (!event) {
      return { success: false, message: `Event ${stripeEventId} not found` };
    }

    if (event.processed) {
      return { success: false, message: `Event ${stripeEventId} is already processed` };
    }

    if (!event.exhausted) {
      return { success: false, message: `Event ${stripeEventId} is not exhausted (still being retried)` };
    }

    await prisma.stripeEvent.update({
      where: { stripeEventId },
      data: {
        processAttempts: 0,
        exhausted: false,
        processLockUntil: null,
        error: `[Replayed at ${new Date().toISOString()}] Previous error: ${event.error || 'unknown'}`,
      },
    });

    logger.info(`[StripeEventWorker] Event ${stripeEventId} re-queued for retry by admin`);
    return { success: true, message: `Event ${stripeEventId} re-queued for processing` };
  } finally {
    if (!options?.prismaClient) {
      await prisma.$disconnect();
    }
  }
}

/**
 * B.5: List all exhausted events for admin review.
 */
export async function listExhaustedEvents(
  options?: { prismaClient?: PrismaClient; limit?: number }
): Promise<any[]> {
  const prisma = options?.prismaClient || new PrismaClient();
  const limit = options?.limit || 50;

  try {
    return await prisma.stripeEvent.findMany({
      where: { exhausted: true, processed: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        stripeEventId: true,
        type: true,
        processAttempts: true,
        lastProcessedAt: true,
        error: true,
        createdAt: true,
      },
    });
  } finally {
    if (!options?.prismaClient) {
      await prisma.$disconnect();
    }
  }
}
