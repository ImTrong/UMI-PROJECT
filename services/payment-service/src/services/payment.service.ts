import { PrismaClient, PaymentStatus, RefundStatus } from '@prisma/client';
import axios from 'axios';
import { StripeService } from './stripe.service';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import Stripe from 'stripe';

const prisma = new PrismaClient();

export interface CreatePaymentData {
  orderId?: string;
  orderNumber?: string;
  userId: string;
  amount: number;
  currency?: string;
  type?: string; // New field
  metadata?: Record<string, string>;
}

export interface ConfirmPaymentData {
  paymentIntentId: string;
  paymentMethodId: string;
}

export class PaymentService {
  static async createPaymentIntent(data: CreatePaymentData) {
    const { orderId, orderNumber, userId, amount, currency = 'usd', type = 'COURSE_PURCHASE', metadata = {} } = data;

    // Validation for course purchase
    if (type === 'COURSE_PURCHASE' && (!orderId || !orderNumber)) {
      throw new Error('orderId and orderNumber are required for course purchase');
    }

    // Check if payment already exists
    const where: any = {
      userId,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED] },
      type: type as any,
    };
    if (orderId) where.orderId = orderId;

    const existingPayment = await prisma.payment.findFirst({
      where,
    });

    if (existingPayment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // Create Stripe payment intent
    const stripePaymentIntent = await StripeService.createPaymentIntent({
      amount,
      currency,
      metadata: {
        orderId: orderId ?? '',
        orderNumber: orderNumber ?? '',
        userId,
        type,
        ...metadata,
      },
    });

    // Create payment record in database
    const payment = await prisma.payment.create({
      data: {
        orderId: (orderId || undefined) as any,
        orderNumber: (orderNumber || undefined) as any,
        userId,
        amount,
        currency,
        type: type as any,
        status: PaymentStatus.PENDING,
        stripePaymentIntentId: stripePaymentIntent.id,
        clientSecret: stripePaymentIntent.clientSecret,
        metadata: metadata as any,
      },
    });

    logger.info(`Payment intent created: ${stripePaymentIntent.id} for ${type}`);

    return {
      id: payment.id,
      stripePaymentIntentId: stripePaymentIntent.id,
      clientSecret: stripePaymentIntent.clientSecret,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    };
  }

  static async confirmPayment(data: ConfirmPaymentData) {
    const { paymentIntentId, paymentMethodId } = data;

    // Check if paymentIntentId is a MongoDB ObjectId (24 hex chars) or a Stripe ID (pi_...)
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(paymentIntentId);

    // Find payment in database
    const payment = await prisma.payment.findFirst({
      where: isObjectId 
        ? { id: paymentIntentId } 
        : { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    // If already succeeded, return it directly
    if (payment.status === PaymentStatus.SUCCEEDED) {
      return payment;
    }

    if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.PROCESSING) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // Update status to processing
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.PROCESSING },
    });

    try {
      // Verify payment status from Stripe (frontend already confirmed via stripe.confirmCardPayment)
      // Make sure we pass the Stripe ID, not the internal MongoDB ID
      const stripePaymentId = payment.stripePaymentIntentId;
      if (!stripePaymentId) {
          throw new Error('Payment does not have a valid Stripe intent ID');
      }
      const stripePayment = await StripeService.getPaymentIntent(stripePaymentId);

      let newStatus: PaymentStatus;
      let completedAt = null;

      if (stripePayment.status === 'succeeded') {
        newStatus = PaymentStatus.SUCCEEDED;
        completedAt = new Date();

        // Notify services based on payment type
        if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
          await this.notifyOrderService(payment.orderId, 'PAID');
        } else if ((payment as any).type === ('INSTRUCTOR_REGISTRATION' as any)) {
          await this.notifyUserService(payment.userId, 'INSTRUCTOR_REGISTRATION_SUCCESS');
        }
      } else if (stripePayment.status === 'requires_payment_method') {
        newStatus = PaymentStatus.FAILED;
      } else if (stripePayment.status === 'canceled') {
        newStatus = PaymentStatus.CANCELLED;
      } else {
        newStatus = PaymentStatus.PENDING;
      }

      // Update payment record
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: newStatus,
          paymentMethodId,
          completedAt,
        },
      });

      logger.info(`Payment confirmed: ${paymentIntentId}, status: ${newStatus}`);

      return updatedPayment;
    } catch (error: any) {
      // Update payment as failed
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          errorMessage: error.message,
        },
      });

      // Notify services about failure
      if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'FAILED');
      }

      throw error;
    }
  }

  static async getPaymentByOrder(orderId: string, userId: string) {
    const payment = await prisma.payment.findFirst({
      where: {
        orderId,
        userId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    return {
      id: payment.id,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      clientSecret: payment.clientSecret,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    };
  }

  static async getPaymentById(paymentId: string, userId: string, isAdmin: boolean = false) {
    const where: any = { id: paymentId };
    if (!isAdmin) {
      where.userId = userId;
    }

    const payment = await prisma.payment.findUnique({
      where,
      include: {
        refunds: true,
      },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    // Get latest status from Stripe
    if (payment.stripePaymentIntentId) {
      try {
        const stripePayment = await StripeService.getPaymentIntent(payment.stripePaymentIntentId);
        if (stripePayment.status !== payment.status.toLowerCase()) {
          // Update status if changed
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: stripePayment.status.toUpperCase() as PaymentStatus },
          });
          payment.status = stripePayment.status.toUpperCase() as PaymentStatus;
        }
      } catch (error) {
        logger.error('Failed to sync payment status from Stripe:', error);
      }
    }

    return payment;
  }

  static async getPaymentByStripeId(stripePaymentIntentId: string) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId },
      include: {
        refunds: true,
      },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    return payment;
  }

  static async getUserPayments(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.count({ where: { userId } }),
    ]);

    return {
      payments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async refundPayment(
    paymentId: string,
    userId: string,
    amount?: number,
    reason?: string,
    isAdmin: boolean = false
  ) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    if (!isAdmin && payment.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // Check if refund already exists
    const existingRefund = await prisma.refund.findFirst({
      where: { paymentId, status: RefundStatus.SUCCEEDED },
    });

    if (existingRefund) {
      throw new Error(ERROR_MESSAGES.REFUND_ALREADY_PROCESSED);
    }

    const refundAmount = amount || payment.amount;

    if (refundAmount > payment.amount) {
      throw new Error(ERROR_MESSAGES.INSUFFICIENT_PAYMENT_AMOUNT);
    }

    try {
      // Process refund with Stripe
      const stripeRefund = await StripeService.refundPayment(
        payment.stripePaymentIntentId!,
        refundAmount,
        reason
      );

      // Create refund record
      const refund = await prisma.refund.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.orderNumber,
          userId: payment.userId,
          amount: refundAmount,
          currency: payment.currency,
          reason,
          status: stripeRefund.status === 'succeeded' ? RefundStatus.SUCCEEDED : RefundStatus.PENDING,
          stripeRefundId: stripeRefund.id,
          completedAt: stripeRefund.status === 'succeeded' ? new Date() : undefined,
        },
      });

      // Update payment status if fully refunded
      if (refundAmount === payment.amount) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REFUNDED },
        });
      }

      // Notify order service
      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'REFUNDED');
      }

      logger.info(`Refund processed: ${stripeRefund.id} for payment ${payment.stripePaymentIntentId}`);

      return refund;
    } catch (error: any) {
      // Create failed refund record
      await prisma.refund.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.orderNumber,
          userId: payment.userId,
          amount: refundAmount,
          currency: payment.currency,
          reason,
          status: RefundStatus.FAILED,
          errorMessage: error.message,
        },
      });

      throw error;
    }
  }

  static async handleStripeWebhook(event: any) {
    const { type, data } = event;

    // Save webhook event
    await prisma.stripeEvent.create({
      data: {
        stripeEventId: event.id,
        type,
        data,
        processed: false,
      },
    });

    let processed = false;
    let error = null;

    try {
      switch (type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(data.object);
          processed = true;
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(data.object);
          processed = true;
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(data.object);
          processed = true;
          break;

        case 'charge.refunded':
          await this.handleChargeRefunded(data.object);
          processed = true;
          break;

        case 'charge.refund.updated':
          await this.handleRefundUpdated(data.object);
          processed = true;
          break;

        default:
          logger.info(`Unhandled webhook event type: ${type}`);
          processed = true;
      }
    } catch (err: any) {
      error = err.message;
      logger.error(`Error processing webhook event ${type}:`, err);
    }

    // Update webhook event
    await prisma.stripeEvent.update({
      where: { stripeEventId: event.id },
      data: {
        processed,
        processedAt: processed ? new Date() : undefined,
        error,
      },
    });
  }

  private static async handlePaymentIntentSucceeded(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.SUCCEEDED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          completedAt: new Date(),
        },
      });

      if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'PAID');
      } else if ((payment as any).type === ('INSTRUCTOR_REGISTRATION' as any)) {
        await this.notifyUserService(payment.userId, 'INSTRUCTOR_REGISTRATION_SUCCESS');
      }

      logger.info(`Payment succeeded: ${paymentIntent.id}`);
    }
  }

  private static async handlePaymentIntentFailed(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.FAILED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          errorMessage: paymentIntent.last_payment_error?.message,
        },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'FAILED');
      }
      logger.info(`Payment failed: ${paymentIntent.id}`);
    }
  }

  private static async handleChargeRefunded(charge: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: charge.payment_intent },
    });

    if (payment) {
      // Update refund records if exists
      const refund = await prisma.refund.findFirst({
        where: { paymentId: payment.id, status: RefundStatus.PENDING },
      });

      if (refund) {
        await prisma.refund.update({
          where: { id: refund.id },
          data: { status: RefundStatus.SUCCEEDED, completedAt: new Date() },
        });
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'REFUNDED');
      }
      logger.info(`Payment refunded: ${charge.payment_intent}`);
    }
  }

  private static async handlePaymentIntentCanceled(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.CANCELLED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CANCELLED,
          completedAt: new Date(),
        },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'CANCELLED');
      }
      logger.info(`Payment cancelled via webhook: ${paymentIntent.id}`);
    }
  }

  private static async handleRefundUpdated(refundObject: any) {
    // Find the related refund record by stripe refund id
    const refund = await prisma.refund.findFirst({
      where: { stripeRefundId: refundObject.id },
    });

    if (refund) {
      let newStatus: RefundStatus;
      if (refundObject.status === 'succeeded') {
        newStatus = RefundStatus.SUCCEEDED;
      } else if (refundObject.status === 'failed') {
        newStatus = RefundStatus.FAILED;
      } else {
        newStatus = RefundStatus.PENDING;
      }

      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: newStatus,
          completedAt: newStatus === RefundStatus.SUCCEEDED ? new Date() : undefined,
          errorMessage: refundObject.failure_reason || undefined,
        },
      });

      logger.info(`Refund updated: ${refundObject.id}, status: ${newStatus}`);
    }
  }

  private static async notifyOrderService(orderId: string, status: string) {
    try {
      const orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:3004';
      await axios.post(`${orderServiceUrl}/api/orders/webhook/payment`, {
        orderId,
        status,
      });
      logger.info(`Notified order service about payment ${status} for order ${orderId}`);
    } catch (error) {
      logger.error(`Failed to notify order service:`, error);
    }
  }

  private static async notifyUserService(userId: string, status: string) {
    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      await axios.post(`${userServiceUrl}/api/users/become-instructor/confirm`, {
        userId,
        status,
      });
      logger.info(`Notified user service about ${status} for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to notify user service:`, error);
    }
  }

  static async cancelPayment(paymentId: string, userId: string, isAdmin: boolean = false) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    if (!isAdmin && payment.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    try {
      // Cancel with Stripe
      await StripeService.cancelPaymentIntent(payment.stripePaymentIntentId!);

      // Update payment record
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CANCELLED,
          completedAt: new Date(),
        },
      });

      // Notify order service
      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'CANCELLED');
      }

      logger.info(`Payment cancelled: ${payment.stripePaymentIntentId}`);
      return updatedPayment;
    } catch (error: any) {
      logger.error('Failed to cancel payment:', error);
      throw error;
    }
  }

  static async getPaymentStats(userId?: string, fromDate?: Date, toDate?: Date) {
    const where: any = {};
    
    if (userId) {
      where.userId = userId;
    }
    
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const stats = await prisma.payment.aggregate({
      where: {
        ...where,
        status: PaymentStatus.SUCCEEDED,
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const byStatus = await prisma.payment.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: {
        amount: true,
      },
    });

    return {
      totalRevenue: stats._sum.amount || 0,
      totalTransactions: stats._count,
      byStatus,
    };
  }

  static async getRefundStats(userId?: string) {
    const where: any = {};
    if (userId) {
      where.userId = userId;
    }

    const stats = await prisma.refund.aggregate({
      where: {
        ...where,
        status: RefundStatus.SUCCEEDED,
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const byStatus = await prisma.refund.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: {
        amount: true,
      },
    });

    return {
      totalRefunded: stats._sum.amount || 0,
      totalRefunds: stats._count,
      byStatus,
    };
  }

  static async getRefundById(refundId: string, userId: string, isAdmin: boolean = false) {
    const where: any = { id: refundId };
    if (!isAdmin) {
      where.userId = userId;
    }

    const refund = await prisma.refund.findUnique({
      where,
      include: {
        payment: true,
      },
    });

    if (!refund) {
      throw new Error(ERROR_MESSAGES.REFUND_NOT_FOUND);
    }

    return refund;
  }

  static async getUserRefunds(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [refunds, total] = await Promise.all([
      prisma.refund.findMany({
        where: { userId },
        skip,
        take: limit,
        include: {
          payment: {
            select: {
              amount: true,
              currency: true,
              stripePaymentIntentId: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.refund.count({ where: { userId } }),
    ]);

    return {
      refunds,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getWebhookEvents(
    page: number = 1,
    limit: number = 10,
    type?: string,
    processed?: boolean
  ) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (type) where.type = type;
    if (processed !== undefined) where.processed = processed;

    const [events, total] = await Promise.all([
      prisma.stripeEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stripeEvent.count({ where }),
    ]);

    return {
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async reprocessWebhookEvent(eventId: string) {
    const event = await prisma.stripeEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error('Webhook event not found');
    }

    // Reprocess the event
    await this.handleStripeWebhook({
      id: event.stripeEventId,
      type: event.type,
      data: event.data,
    });

    return { success: true };
  }

  static async createSetupIntent(userId: string, email: string) {
    try {
      // Create or get customer
      let customerId: string;
      
      const existingPayment = await prisma.payment.findFirst({
        where: { userId, stripeCustomerId: { not: null } },
      });

      if (existingPayment?.stripeCustomerId) {
        customerId = existingPayment.stripeCustomerId;
      } else {
        const customer = await StripeService.createCustomer(email, undefined, {
          userId,
        });
        customerId = customer.id;
      }

      // Create setup intent for saving payment method
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16',
      });

      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
      });

      return {
        clientSecret: setupIntent.client_secret,
        customerId,
      };
    } catch (error: any) {
      logger.error('Failed to create setup intent:', error);
      throw new Error(`Setup intent error: ${error.message}`);
    }
  }

  static async savePaymentMethod(userId: string, paymentMethodId: string) {
    try {
      // Attach payment method to customer
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16',
      });

      // Get or create customer
      let customerId: string;
      
      const existingPayment = await prisma.payment.findFirst({
        where: { userId, stripeCustomerId: { not: null } },
      });

      if (existingPayment?.stripeCustomerId) {
        customerId = existingPayment.stripeCustomerId;
      } else {
        // Get user email
        const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
        const userResponse = await axios.get(`${userServiceUrl}/api/users/${userId}`);
        const userEmail = userResponse.data.data.email;

        const customer = await StripeService.createCustomer(userEmail, undefined, {
          userId,
        });
        customerId = customer.id;
      }

      // Attach payment method
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      // Set as default payment method
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      logger.info(`Payment method saved for user ${userId}`);

      return {
        success: true,
        customerId,
      };
    } catch (error: any) {
      logger.error('Failed to save payment method:', error);
      throw new Error(`Save payment method error: ${error.message}`);
    }
  }

  static async getPaymentMethods(userId: string) {
    try {
      // Get customer ID
      const payment = await prisma.payment.findFirst({
        where: { userId, stripeCustomerId: { not: null } },
      });

      if (!payment?.stripeCustomerId) {
        return { paymentMethods: [] };
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16',
      });

      const paymentMethods = await stripe.paymentMethods.list({
        customer: payment.stripeCustomerId,
        type: 'card',
      });

      return {
        paymentMethods: paymentMethods.data.map(pm => ({
          id: pm.id,
          type: pm.type,
          card: {
            brand: pm.card?.brand,
            last4: pm.card?.last4,
            expMonth: pm.card?.exp_month,
            expYear: pm.card?.exp_year,
          },
          isDefault: pm.id === (payment.metadata as any)?.defaultPaymentMethod,
        })),
      };
    } catch (error: any) {
      logger.error('Failed to get payment methods:', error);
      throw new Error(`Get payment methods error: ${error.message}`);
    }
  }

  static async healthCheck() {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      
      // Check Stripe connection
      let stripeStatus = 'connected';
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: '2023-10-16',
        });
        await stripe.balance.retrieve();
      } catch (error) {
        stripeStatus = 'disconnected';
      }
      
      return {
        service: 'payment-service',
        status: 'active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
        stripe: stripeStatus,
      };
    } catch (error) {
      return {
        service: 'payment-service',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
        stripe: 'unknown',
      };
    }
  }
}
