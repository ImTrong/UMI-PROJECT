import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service';
import { HTTP_STATUS, SUCCESS_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class StripeWebhook {
  static async handleWebhook(req: Request, res: Response) {
    try {
      const event = req.body;
      
      logger.info(`Received Stripe webhook: ${event.type}`);

      // Process webhook asynchronously
      setImmediate(async () => {
        try {
          await PaymentService.handleStripeWebhook(event);
          logger.info(`Webhook processed: ${event.id}`);
        } catch (error) {
          logger.error(`Failed to process webhook ${event.id}:`, error);
        }
      });

      // Acknowledge receipt immediately
      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.WEBHOOK_PROCESSED,
      });
    } catch (error: any) {
      logger.error('Webhook error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Webhook processing failed',
      });
    }
  }
}
