import Stripe from 'stripe';
import logger from '../utils/logger';

const ZERO_DECIMAL_CURRENCIES = ['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'];
const isZeroDecimal = (currency: string) => ZERO_DECIMAL_CURRENCIES.includes(currency.toLowerCase());

function isPlaceholder(value?: string): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  return (
    v.startsWith('your_') ||
    v.includes('placeholder') ||
    v === 'xxx' ||
    v === 'changeme'
  );
}

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || isPlaceholder(key)) {
    throw new Error('Stripe secret key is not configured or using placeholder value. Set real STRIPE_SECRET_KEY.');
  }
  if (!stripeInstance) {
    stripeInstance = new Stripe(key, {
      apiVersion: '2023-10-16',
      maxNetworkRetries: 3,
    });
  }
  return stripeInstance;
}

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

/**
 * The error a refund call throws: the message as before, plus what Stripe said (FIX 07B-2A.2) - its error type and HTTP status -
 * so the caller can tell a rejected request (nothing refunded) from a timeout / 5xx (outcome unknown).
 */
function stripeError(context: string, error: any): Error {
  logger.error(`${context}: ${error?.type ?? 'error'} ${error?.statusCode ?? ''} ${error?.message ?? ''}`);
  return Object.assign(new Error(`Stripe error: ${error?.message}`), { stripeType: error?.type, statusCode: error?.statusCode, stripeCode: error?.code });
}

export class StripeService {
  static isConfigured(): boolean {
    const key = process.env.STRIPE_SECRET_KEY;
    return !!key && !isPlaceholder(key);
  }

  static async createPaymentIntent(data: CreatePaymentIntentData): Promise<PaymentIntentResult> {
    try {
      const stripe = getStripe();
      const paymentIntent = await stripe.paymentIntents.create({
        amount: isZeroDecimal(data.currency) ? Math.round(data.amount) : Math.round(data.amount * 100),
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
        amount: isZeroDecimal(paymentIntent.currency) ? paymentIntent.amount : paymentIntent.amount / 100,
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
      const paymentIntent = await getStripe().paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });

      logger.info(`Payment confirmed: ${paymentIntent.id}, status: ${paymentIntent.status}`);

      return {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: isZeroDecimal(paymentIntent.currency) ? paymentIntent.amount : paymentIntent.amount / 100,
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
      const paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId);

      return {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: isZeroDecimal(paymentIntent.currency) ? paymentIntent.amount : paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        customerId: paymentIntent.customer as string | undefined,
        metadata: paymentIntent.metadata,
      };
    } catch (error: any) {
      logger.error('Stripe get payment intent error:', error);
      throw new Error(`Stripe error: ${error.message}`);
    }
  }

  static async refundPayment(paymentIntentId: string, amount?: number, reason?: string, currency?: string, idempotencyKey?: string, metadata?: Record<string, string>) {
    try {
      let refundAmount: number | undefined;
      if (amount) {
        // Luôn sử dụng currency để xác định cách chuyển đổi.
        // VND là zero-decimal: Stripe nhận amount = giá trị thực (VD: 100000 cho 100.000₫).
        // USD cần nhân 100: Stripe nhận amount in cents.
        const effectiveCurrency = currency || 'vnd'; // Mặc định VND
        refundAmount = isZeroDecimal(effectiveCurrency) ? Math.round(amount) : Math.round(amount * 100);
      }

      const createParams: Stripe.RefundCreateParams = {
        payment_intent: paymentIntentId,
        amount: refundAmount,
        reason: reason as Stripe.RefundCreateParams.Reason,
        // FIX 07B-2A.2: lets the webhook find the local Refund row even if this process never stored Stripe's refund id
        ...(metadata && { metadata }),
      };

      // A.4: Pass idempotency key for safe retries
      const requestOptions: Stripe.RequestOptions = {};
      if (idempotencyKey) {
        requestOptions.idempotencyKey = idempotencyKey;
      }

      const refund = await getStripe().refunds.create(createParams, requestOptions);

      logger.info(`Refund created: ${refund.id} for payment: ${paymentIntentId}${idempotencyKey ? ` (idem: ${idempotencyKey})` : ''}`);

      return {
        id: refund.id,
        status: refund.status,
        amount: isZeroDecimal(refund.currency) ? refund.amount : refund.amount / 100,
        currency: refund.currency,
      };
    } catch (error: any) {
      throw stripeError('Stripe refund error', error);
    }
  }

  /** The current state of a refund Stripe already created (FIX 07B-2A.2) - used to resume a refund whose outcome was not recorded. */
  static async getRefund(refundId: string) {
    try {
      const refund = await getStripe().refunds.retrieve(refundId);
      return {
        id: refund.id,
        status: refund.status,
        amount: isZeroDecimal(refund.currency) ? refund.amount : refund.amount / 100,
        currency: refund.currency,
      };
    } catch (error: any) {
      throw stripeError('Stripe get refund error', error);
    }
  }

  static async cancelPaymentIntent(paymentIntentId: string) {
    try {
      const paymentIntent = await getStripe().paymentIntents.cancel(paymentIntentId);

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
      const customer = await getStripe().customers.create({
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
