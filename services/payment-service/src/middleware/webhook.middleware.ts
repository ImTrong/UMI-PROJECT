import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import logger from '../utils/logger';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

export const verifyStripeWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    logger.error('Missing webhook signature or secret');
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: ERROR_MESSAGES.WEBHOOK_SIGNATURE_INVALID,
    });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret
    );

    req.body = event;
    next();
  } catch (error: any) {
    logger.error('Webhook signature verification failed:', error.message);
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: ERROR_MESSAGES.WEBHOOK_SIGNATURE_INVALID,
    });
  }
};
