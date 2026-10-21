import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PaymentService } from '../services/payment.service';
import { HTTP_STATUS, SUCCESS_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * C3: Durable Webhook Inbox for Stripe events.
 * 
 * Flow:
 * 1. Verify signature (done by middleware before this handler).
 * 2. Persist event to StripeEvent collection BEFORE returning HTTP 200.
 * 3. Attempt processing synchronously.
 * 4. If processing fails, event is saved with processed=false — StripeEventWorker will retry.
 * 5. Only return HTTP 200 after event is durably persisted (or already exists).
 * 6. If DB write fails, return 503 so Stripe retries delivery.
 */
export class StripeWebhook {
  static async handleWebhook(req: Request, res: Response) {
    const event = req.body;

    try {
      // Step 1: Check for existing event (idempotency)
      const existing = await prisma.stripeEvent.findUnique({
        where: { stripeEventId: event.id },
      });

      if (existing) {
        if (existing.processed) {
          // Already fully processed — idempotent ACK
          logger.info(`Stripe webhook: Event ${event.id} already processed, returning 200`);
          return res.status(HTTP_STATUS.OK).json({
            message: 'Event already processed',
            idempotent: true,
          });
        }

        // Event saved but NOT yet processed — attempt processing again
        logger.info(`Stripe webhook: Event ${event.id} saved but unprocessed, attempting processing`);
        try {
          await PaymentService.handleStripeWebhook(event);
        } catch (processErr: any) {
          logger.error(`Stripe webhook: Failed to process saved event ${event.id}:`, processErr.message);
          // Event is already persisted — worker will retry
        }

        return res.status(HTTP_STATUS.OK).json({
          message: SUCCESS_MESSAGES.WEBHOOK_PROCESSED,
        });
      }

      // Step 2: Persist event to durable inbox BEFORE acknowledging
      try {
        await prisma.stripeEvent.create({
          data: {
            stripeEventId: event.id,
            type: event.type,
            data: event.data,
            processed: false,
          },
        });
      } catch (dbErr: any) {
        // Unique constraint violation — another worker saved it first (race condition)
        if (dbErr.code === 'P2002') {
          logger.info(`Stripe webhook: Event ${event.id} already saved by another worker`);
          return res.status(HTTP_STATUS.OK).json({
            message: 'Event already received',
          });
        }

        // Database is down — return 503 so Stripe retries
        logger.error(`Stripe webhook: Failed to save event ${event.id} to DB:`, dbErr.message);
        return res.status(503).json({
          error: 'Database unavailable, please retry',
        });
      }

      // Step 3: Attempt synchronous processing
      try {
        await PaymentService.handleStripeWebhook(event);
        logger.info(`Stripe webhook: Event ${event.id} processed successfully`);
      } catch (processErr: any) {
        logger.error(`Stripe webhook: Processing failed for ${event.id}, worker will retry:`, processErr.message);
        // Event is already saved — StripeEventWorker will pick it up
      }

      // Step 4: ACK — event is durably persisted regardless of processing outcome
      return res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.WEBHOOK_PROCESSED,
      });
    } catch (error: any) {
      logger.error('Stripe webhook: Unexpected error:', error);
      // Return 500 — Stripe will retry
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Webhook processing failed',
      });
    }
  }
}
