import Stripe from 'stripe';
import logger from '../utils/logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
  maxNetworkRetries: 3,
});

export interface CreatePaymentIntentData {
  amount: number;
  currency: string;
  metadata: Record<string, string>;
  customerId?: string;
  paymentMethodId?: string;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
  customerId?: string;
}

export class StripeService {
  static async createPaymentIntent(data: CreatePaymentIntentData): Promise<PaymentIntentResult> {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(data.amount * 100), // Stripe uses cents
        currency: data.currency.toLowerCase(),
        metadata: data.metadata,
        ...(data.customerId && { customer: data.customerId }),
        ...(data.paymentMethodId && { payment_method: data.paymentMethodId }),
        automatic_payment_methods: {
          enabled: true,
        },
      });

      logger.info(`Payment intent created: ${paymentIntent.id}`);

      return {
        id: paymentIntent.id,
        clientSecret: paymentIntent.client_secret!,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        customerId: paymentIntent.customer as string | undefined,
      };
    } catch (error: any) {
      logger.error('Stripe create payment intent error:', error);
      throw new Error(`Stripe error: ${error.message}`);
    }
  }

  static async confirmPayment(paymentIntentId: string, paymentMethodId: string) {
    try {
      const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });

      logger.info(`Payment confirmed: ${paymentIntent.id}, status: ${paymentIntent.status}`);

      return {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        customerId: paymentIntent.customer as string | undefined,
      };
    } catch (error: any) {
      logger.error('Stripe confirm payment error:', error);
      throw new Error(`Stripe error: ${error.message}`);
    }
  }

  static async getPaymentIntent(paymentIntentId: string) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      return {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        customerId: paymentIntent.customer as string | undefined,
        metadata: paymentIntent.metadata,
      };
    } catch (error: any) {
      logger.error('Stripe get payment intent error:', error);
      throw new Error(`Stripe error: ${error.message}`);
    }
  }

  static async refundPayment(paymentIntentId: string, amount?: number, reason?: string) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: amount ? Math.round(amount * 100) : undefined,
        reason: reason as Stripe.RefundCreateParams.Reason,
      });

      logger.info(`Refund created: ${refund.id} for payment: ${paymentIntentId}`);

      return {
        id: refund.id,
        status: refund.status,
        amount: refund.amount / 100,
        currency: refund.currency,
      };
    } catch (error: any) {
      logger.error('Stripe refund error:', error);
      throw new Error(`Stripe error: ${error.message}`);
    }
  }

  static async cancelPaymentIntent(paymentIntentId: string) {
    try {
      const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);

      logger.info(`Payment intent cancelled: ${paymentIntentId}`);

      return {
        id: paymentIntent.id,
        status: paymentIntent.status,
      };
    } catch (error: any) {
      logger.error('Stripe cancel payment intent error:', error);
      throw new Error(`Stripe error: ${error.message}`);
    }
  }

  static async createCustomer(email: string, name?: string, metadata?: Record<string, string>) {
    try {
      const customer = await stripe.customers.create({
        email,
        name,
        metadata,
      });

      logger.info(`Customer created: ${customer.id} - ${email}`);
      return customer;
    } catch (error: any) {
      logger.error('Stripe create customer error:', error);
      throw new Error(`Stripe error: ${error.message}`);
    }
  }
}
