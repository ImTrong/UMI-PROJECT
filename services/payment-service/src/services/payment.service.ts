import { PrismaClient, PaymentStatus, RefundStatus } from '@prisma/client';
import axios from 'axios';
import { StripeService } from './stripe.service';
import { PayosService } from './payos.service';
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
    const { orderId, orderNumber, userId, amount, currency = 'vnd', type = 'COURSE_PURCHASE', metadata = {} } = data;

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
      if (existingPayment.status === PaymentStatus.SUCCEEDED) {
        throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
      }
      return {
        id: existingPayment.id,
        stripePaymentIntentId: existingPayment.stripePaymentIntentId || '',
        clientSecret: existingPayment.clientSecret || '',
        amount: existingPayment.amount,
        currency: existingPayment.currency,
        status: existingPayment.status,
        isMock: !StripeService.isConfigured() || !!(existingPayment.metadata as any)?.isMock,
      };
    }

    // Create Stripe payment intent
    let stripePaymentIntent: { id: string; clientSecret: string };
    const isMockStripe = !StripeService.isConfigured();

    if (isMockStripe) {
      logger.info(`Stripe is not configured, running in Mock / Sandbox mode for order ${orderNumber || 'intent'}`);
      const mockId = `pi_mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      stripePaymentIntent = {
        id: mockId,
        clientSecret: `${mockId}_secret_mock`,
      };
    } else {
      stripePaymentIntent = await StripeService.createPaymentIntent({
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
    }

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
        provider: 'stripe',
        stripePaymentIntentId: stripePaymentIntent.id,
        clientSecret: stripePaymentIntent.clientSecret,
        metadata: {
          ...metadata,
          isMock: isMockStripe,
        } as any,
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
      isMock: isMockStripe,
    };
  }

  /**
   * Tạo thanh toán qua payOS (QR ngân hàng).
   */
  static async createPayosPayment(data: {
    orderId: string;
    orderNumber: string;
    orderCode: number;
    userId: string;
    amount: number;
    description: string;
    items?: Array<{ name: string; quantity: number; price: number }>;
    regenerate?: boolean;
  }) {
    const { orderId, orderNumber, orderCode, userId, amount, description, items, regenerate } = data;

    const baseUrl = process.env.PAYOS_RETURN_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    const mockCheckoutUrl = `${baseUrl}/checkout/success/${orderId}?mock=true`;
    const mockQrCode = `https://img.vietqr.io/image/MB-0987654321-compact2.png?amount=${Math.round(amount)}&addInfo=${encodeURIComponent(`UMI ${orderNumber}`)}&accountName=${encodeURIComponent('UMI E-LEARNING')}`;

    if (!PayosService.isConfigured()) {
      logger.info(`PayOS is not configured, running in Mock / Sandbox mode for orderCode: ${orderCode}`);

      const existingPayment = await prisma.payment.findFirst({
        where: {
          orderId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED] },
          provider: 'payos',
        },
      });

      if (existingPayment) {
        if (existingPayment.status === PaymentStatus.SUCCEEDED) {
          throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
        }
        return {
          paymentId: existingPayment.id,
          checkoutUrl: existingPayment.payosCheckoutUrl || mockCheckoutUrl,
          qrCode: existingPayment.payosQrCode || mockQrCode,
          orderCode: existingPayment.payosOrderCode ? Number(existingPayment.payosOrderCode) : orderCode,
          isMock: true,
        };
      }

      const payment = await prisma.payment.create({
        data: {
          orderId,
          orderNumber,
          userId,
          amount,
          currency: 'vnd',
          status: PaymentStatus.PENDING,
          type: 'COURSE_PURCHASE',
          provider: 'payos',
          payosOrderCode: String(orderCode),
          payosCheckoutUrl: mockCheckoutUrl,
          payosQrCode: mockQrCode,
          orderSynced: false,
          metadata: { orderCode, orderSynced: false, isMock: true } as any,
        },
      });

      logger.info(`Mock PayOS payment created: orderCode=${orderCode} for order ${orderNumber}`);

      return {
        paymentId: payment.id,
        checkoutUrl: mockCheckoutUrl,
        qrCode: mockQrCode,
        orderCode,
        isMock: true,
      };
    }

    // Check if payment already exists for this order
    const existingPayment = await prisma.payment.findFirst({
      where: {
        orderId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED] },
        provider: 'payos',
      },
    });

    if (existingPayment) {
      if (existingPayment.status === PaymentStatus.SUCCEEDED) {
        throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
      }

      // If client requests to regenerate, cancel old payment link on payOS
      if (regenerate) {
        if (existingPayment.payosOrderCode) {
          try {
            await PayosService.cancelPaymentLink(Number(existingPayment.payosOrderCode), 'Regenerating new payment QR');
          } catch (e: any) {
            logger.warn(`Could not cancel old payOS link: ${e.message}`);
          }
        }
        await prisma.payment.update({
          where: { id: existingPayment.id },
          data: {
            status: PaymentStatus.CANCELLED,
            errorMessage: 'Superseded by new payment link',
          },
        });
      } else if (existingPayment.payosCheckoutUrl && existingPayment.payosQrCode) {
        // Reuse existing pending payment link
        return {
          paymentId: existingPayment.id,
          checkoutUrl: existingPayment.payosCheckoutUrl,
          qrCode: existingPayment.payosQrCode,
          orderCode: existingPayment.payosOrderCode!,
        };
      }
    }

    const returnUrl = `${baseUrl}/checkout/success/${orderId}`;
    const cancelUrl = `${baseUrl}/orders/${orderId}`;

    // Create payOS payment link
    const payosResult = await PayosService.createPaymentLink({
      orderCode,
      amount: Math.round(amount),
      description,
      returnUrl,
      cancelUrl,
      items,
    });

    // Save payment record with initial orderSynced = false
    const payment = await prisma.payment.create({
      data: {
        orderId,
        orderNumber,
        userId,
        amount,
        currency: 'vnd',
        status: PaymentStatus.PENDING,
        type: 'COURSE_PURCHASE',
        provider: 'payos',
        payosOrderCode: String(orderCode),
        payosPaymentLinkId: (payosResult as any).paymentLinkId || undefined,
        payosCheckoutUrl: (payosResult as any).checkoutUrl || undefined,
        payosQrCode: (payosResult as any).qrCode || undefined,
        orderSynced: false,
        metadata: { orderCode, orderSynced: false } as any,
      },
    });

    logger.info(`PayOS payment created: orderCode=${orderCode} for order ${orderNumber}`);

    return {
      paymentId: payment.id,
      checkoutUrl: (payosResult as any).checkoutUrl,
      qrCode: (payosResult as any).qrCode,
      orderCode,
    };
  }

  /**
   * Xử lý webhook từ payOS.
   * Xác minh chữ ký, kiểm tra dữ liệu, cập nhật trạng thái thanh toán và đồng bộ Order bền vững.
   */
  static async handlePayosWebhook(webhookBody: any) {
    // 1. Verify webhook signature
    const webhookData = await PayosService.verifyWebhook(webhookBody);

    const orderCode = Number(webhookData.orderCode);
    const code = webhookData.code;

    if (isNaN(orderCode)) {
      logger.error(`PayOS webhook: Invalid orderCode ${webhookData.orderCode}`);
      return { success: false, httpStatus: 400, message: 'Invalid orderCode' };
    }

    // 2. Find payment by orderCode (stored as String in DB)
    const orderCodeStr = String(orderCode);
    const payment = await prisma.payment.findFirst({
      where: { payosOrderCode: orderCodeStr },
    });

    if (!payment) {
      logger.error(`PayOS webhook: Payment not found for orderCode ${orderCode}`);
      return { success: false, httpStatus: 400, message: 'Payment not found' };
    }

    // 3. Verify paymentLinkId if recorded
    if (
      payment.payosPaymentLinkId &&
      webhookData.paymentLinkId &&
      payment.payosPaymentLinkId !== webhookData.paymentLinkId
    ) {
      logger.error(
        `PayOS webhook: PaymentLinkId mismatch for orderCode ${orderCode}. Expected ${payment.payosPaymentLinkId}, received ${webhookData.paymentLinkId}`
      );
      return { success: false, httpStatus: 400, message: 'PaymentLinkId mismatch' };
    }

    // 4. Verify amount matches
    if (webhookData.amount !== undefined && Math.round(Number(webhookData.amount)) !== Math.round(payment.amount)) {
      logger.error(
        `PayOS webhook: Amount mismatch for orderCode ${orderCode}. Expected ${payment.amount}, received ${webhookData.amount}`
      );
      return { success: false, httpStatus: 400, message: 'Amount mismatch' };
    }

    // 5. Verify currency matches (normalize both: trimmed, lowercase)
    const webhookCurrency = (webhookData.currency || 'vnd').trim().toLowerCase();
    const paymentCurrency = (payment.currency || 'vnd').trim().toLowerCase();
    if (webhookCurrency !== paymentCurrency) {
      logger.error(
        `PayOS webhook: Currency mismatch for orderCode ${orderCode}. Expected ${paymentCurrency}, received ${webhookCurrency}`
      );
      return { success: false, httpStatus: 400, message: 'Currency mismatch' };
    }

    // 6. Xử lý Retry khi Payment đã SUCCEEDED từ trước nhưng orderSync chưa hoàn tất
    if (payment.status === PaymentStatus.SUCCEEDED) {
      const isOrderSynced = payment.orderSynced === true || (payment.metadata as any)?.orderSynced === true;
      if (isOrderSynced) {
        logger.info(`PayOS webhook: Payment already succeeded and order already synced for orderCode ${orderCode}`);
        return { success: true, httpStatus: 200, message: 'Already processed', idempotent: true };
      }

      logger.warn(
        `PayOS webhook: Payment ${orderCode} was SUCCEEDED but orderSync was incomplete. Retrying downstream order sync...`
      );

      // C4/I1: Thử lại đồng bộ đơn hàng — wrap in try/catch, rely on Outbox for recovery
      if (payment.orderId) {
        try {
          await this.notifyOrderService(payment.orderId, 'PAID');
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              orderSynced: true,
              orderSyncedAt: new Date(),
              syncLockUntil: null,
              lastSyncError: null,
              metadata: {
                ...(payment.metadata as any),
                orderSynced: true,
                orderSyncedAt: new Date(),
              },
            },
          });
          logger.info(`PayOS webhook: Order sync succeeded on retry for orderCode ${orderCode}`);
        } catch (syncErr: any) {
          logger.warn(`PayOS webhook: Order sync retry failed for ${orderCode}, Outbox worker will recover: ${syncErr.message}`);
          // Payment is already SUCCEEDED with orderSynced=false — Outbox worker will pick it up
        }
      }

      return { success: true, httpStatus: 200, message: 'Payment already succeeded, sync attempted' };
    }

    // 7. Xử lý Thanh toán muộn (Late Payment) khi đơn đã bị CANCELLED
    if (payment.status === PaymentStatus.CANCELLED) {
      if (code === '00') {
        // Học viên thực tế đã chuyển tiền thành công vào tài khoản cho đơn đã hủy!
        // KHÔNG âm thầm bỏ qua khoản tiền thật này!
        logger.warn(
          `PayOS webhook: LATE PAYMENT received for CANCELLED payment orderCode ${orderCode}. Updating payment and notifying order-service for reconciliation...`
        );

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            completedAt: new Date(),
            orderSynced: false,
            metadata: {
              ...(payment.metadata as any),
              payosReference: webhookData.reference,
              payosTransactionDateTime: webhookData.transactionDateTime,
              counterAccountName: webhookData.counterAccountName,
              counterAccountNumber: webhookData.counterAccountNumber,
              reconciliationStatus: 'LATE_PAYMENT_ON_CANCELLED_ORDER',
              reconciliationRequired: true,
              orderSynced: false,
            },
          },
        });

        // C4/I1: wrap notifyOrderService in try/catch — rely on Outbox for recovery
        if (payment.orderId) {
          try {
            await this.notifyOrderService(payment.orderId, 'PAID');
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                orderSynced: true,
                orderSyncedAt: new Date(),
                syncLockUntil: null,
                metadata: {
                  ...(payment.metadata as any),
                  orderSynced: true,
                  orderSyncedAt: new Date(),
                },
              },
            });
          } catch (syncErr: any) {
            logger.warn(`PayOS late payment: Order sync failed for orderCode ${orderCode}, Outbox will recover: ${syncErr.message}`);
          }
        }

        return {
          success: true,
          httpStatus: 200,
          message: 'Late payment recorded and order notified for reconciliation',
        };
      } else {
        logger.info(`PayOS webhook: Cancelled payment received non-success code ${code} for orderCode ${orderCode}`);
        return { success: true, httpStatus: 200, message: 'Payment is already cancelled and failed' };
      }
    }

    // 8. Xử lý thanh toán thành công (Normal Success)
    if (code === '00') {
      // Đánh dấu Payment SUCCEEDED nhưng orderSynced = false trước khi gọi order-service
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          completedAt: new Date(),
          orderSynced: false,
          metadata: {
            ...(payment.metadata as any),
            payosReference: webhookData.reference,
            payosTransactionDateTime: webhookData.transactionDateTime,
            counterAccountName: webhookData.counterAccountName,
            counterAccountNumber: webhookData.counterAccountNumber,
            orderSynced: false,
          },
        },
      });

      // C4/I1: Gọi đồng bộ đơn hàng — wrap in try/catch, rely on Outbox worker if fails
      if (payment.orderId) {
        try {
          await this.notifyOrderService(payment.orderId, 'PAID');
          // Đánh dấu orderSynced = true sau khi thông báo thành công
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              orderSynced: true,
              orderSyncedAt: new Date(),
              syncLockUntil: null,
              metadata: {
                ...(payment.metadata as any),
                payosReference: webhookData.reference,
                payosTransactionDateTime: webhookData.transactionDateTime,
                counterAccountName: webhookData.counterAccountName,
                counterAccountNumber: webhookData.counterAccountNumber,
                orderSynced: true,
                orderSyncedAt: new Date(),
              },
            },
          });
          logger.info(`PayOS payment succeeded and order synced: orderCode=${orderCode}`);
        } catch (syncErr: any) {
          logger.warn(`PayOS webhook: Order sync failed for orderCode ${orderCode}, Outbox will recover: ${syncErr.message}`);
          // Payment is SUCCEEDED with orderSynced=false — Outbox worker will pick it up
        }
      }

      return { success: true, httpStatus: 200, message: 'Payment confirmed' };
    } else {
      // Payment failed or cancelled on payOS
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          errorMessage: webhookData.desc || `PayOS error code: ${code}`,
        },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'FAILED');
      }

      logger.info(`PayOS payment failed: orderCode=${orderCode}, code=${code}`);
      return { success: true, httpStatus: 200, message: webhookData.desc || 'Payment failed' };
    }
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
      const stripePaymentId = payment.stripePaymentIntentId;
      const isMockPayment =
        (payment.metadata as any)?.isMock ||
        !StripeService.isConfigured() ||
        stripePaymentId?.startsWith('pi_mock_');

      let newStatus: PaymentStatus;
      let completedAt: Date | null = null;

      if (isMockPayment) {
        newStatus = PaymentStatus.SUCCEEDED;
        completedAt = new Date();

        if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
          await this.notifyOrderService(payment.orderId, 'PAID');
        } else if ((payment as any).type === ('INSTRUCTOR_REGISTRATION' as any)) {
          await this.notifyUserService(payment.userId, 'INSTRUCTOR_REGISTRATION_SUCCESS');
        }
      } else {
        if (!stripePaymentId) {
          throw new Error('Payment does not have a valid Stripe intent ID');
        }
        const stripePayment = await StripeService.getPaymentIntent(stripePaymentId);

        if (stripePayment.status === 'succeeded') {
          newStatus = PaymentStatus.SUCCEEDED;
          completedAt = new Date();

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
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    return {
      id: payment.id,
      provider: payment.provider,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      clientSecret: payment.clientSecret,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      payosOrderCode: payment.payosOrderCode,
      payosCheckoutUrl: payment.payosCheckoutUrl,
      payosQrCode: payment.payosQrCode,
      isMock: !!(payment.metadata as any)?.isMock,
    };
  }

  /**
   * Giả lập hoàn thành thanh toán trong chế độ Sandbox/Demo.
   */
  static async completeMockPayment(orderId: string, userId: string) {
    const payment = await prisma.payment.findFirst({
      where: {
        orderId,
        userId,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    if (payment.status === PaymentStatus.SUCCEEDED) {
      return { success: true, message: 'Payment already completed', payment };
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        completedAt: new Date(),
        orderSynced: true,
        orderSyncedAt: new Date(),
        metadata: {
          ...((payment.metadata as any) || {}),
          completedViaMock: true,
          mockCompletedAt: new Date(),
          orderSynced: true,
        },
      },
    });

    if (payment.orderId) {
      try {
        await this.notifyOrderService(payment.orderId, 'PAID');
      } catch (err: any) {
        logger.warn(`Could not notify order service synchronously: ${err.message}`);
      }
    }

    logger.info(`Mock payment completed successfully for order ${orderId}`);
    return { success: true, message: 'Payment completed successfully (Demo Mode)', payment: updatedPayment };
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

  static async getAllPayments(page: number = 1, limit: number = 10, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) {
      where.status = status;
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.count({ where }),
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


  /**
   * A: Atomic refund with optimistic concurrency control.
   *
   * Flow:
   * 1. Validate payment state.
   * 2. Aggregate Refund records (source of truth) to compute remaining refundable.
   * 3. Reserve atomically using refundVersion conditional update (CAS).
   *    If version mismatch → concurrent request got there first → retry or reject.
   * 4. Create Refund record (PENDING).
   * 5. Call provider (Stripe) OUTSIDE transaction — with Stripe idempotency key.
   * 6. On success/failure: update Refund + Payment accounting.
   * 7. On provider error: release reservation safely.
   */
  static async refundPayment(
    paymentId: string,
    userId: string,
    amount?: number,
    reason?: string,
    isAdmin: boolean = false
  ) {
    // ── Step 1: Validate ─────────────────────────────────────────────────
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    if (!isAdmin && payment.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    if (payment.status !== PaymentStatus.SUCCEEDED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // ── Step 2: Source of truth = Refund records ─────────────────────────
    const refundAgg = await prisma.refund.aggregate({
      where: {
        paymentId,
        status: { in: [RefundStatus.SUCCEEDED, RefundStatus.PENDING] },
      },
      _sum: { amount: true },
    });
    const totalCommitted = refundAgg._sum.amount || 0;
    const remainingRefundable = payment.amount - totalCommitted;

    if (remainingRefundable <= 0) {
      throw new Error(ERROR_MESSAGES.REFUND_ALREADY_PROCESSED);
    }

    const refundAmount = amount || remainingRefundable;

    if (refundAmount > remainingRefundable) {
      throw new Error(`Refund amount (${refundAmount}) exceeds remaining refundable amount (${remainingRefundable})`);
    }

    if (refundAmount <= 0) {
      throw new Error(ERROR_MESSAGES.INVALID_PAYMENT_AMOUNT);
    }

    // ── Step 3: Atomic reserve with optimistic concurrency (CAS) ────────
    // updateMany with version guard: only succeeds if nobody else changed refundVersion
    const currentVersion = payment.refundVersion || 0;
    const newPendingTotal = (payment.pendingRefundTotal || 0) + refundAmount;

    const reserveResult = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        refundVersion: currentVersion,
        // Double-check status hasn't changed to terminal
        status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED] },
      },
      data: {
        pendingRefundTotal: newPendingTotal,
        refundVersion: currentVersion + 1,
      },
    });

    if (reserveResult.count === 0) {
      throw new Error('Concurrent refund detected — please retry. Another refund request is being processed.');
    }

    // ── Step 4: Generate idempotency key ────────────────────────────────
    const idempotencyKey = `refund_${paymentId}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    // ── Step 5: PayOS / Manual refund path ──────────────────────────────
    if (payment.provider === 'payos' || !payment.stripePaymentIntentId) {
      try {
        const refund = await prisma.refund.create({
          data: {
            paymentId: payment.id,
            orderId: payment.orderId,
            orderNumber: payment.orderNumber,
            userId: payment.userId,
            amount: refundAmount,
            currency: payment.currency,
            reason,
            status: RefundStatus.PENDING,
            idempotencyKey,
            errorMessage: null,
          },
        });

        // Update metadata (reservation already committed via CAS above)
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            metadata: {
              ...((payment.metadata as any) || {}),
              pendingRefundId: refund.id,
              pendingRefundAmount: newPendingTotal,
              refundableAmount: payment.amount - (payment.refundedTotal || 0) - newPendingTotal,
              manualRefundRequired: true,
              reconciliationStatus: 'MANUAL_REFUND_PENDING',
            },
          },
        });

        logger.info(
          `PayOS manual refund created (PENDING, admin confirmation required): refund ${refund.id} for payment ${payment.id}`
        );
        return refund;
      } catch (error: any) {
        // Rollback reservation
        await this.releaseRefundReservation(payment.id, currentVersion + 1, refundAmount);
        throw error;
      }
    }

    // ── Step 6: Stripe refund path ──────────────────────────────────────
    let stripeRefund: any;
    try {
      stripeRefund = await StripeService.refundPayment(
        payment.stripePaymentIntentId!,
        refundAmount,
        reason,
        payment.currency,
        idempotencyKey // A.4: Pass idempotency key to Stripe
      );
    } catch (stripeError: any) {
      // A.4: If timeout/network error, we don't know if Stripe processed it.
      // Release reservation; the charge.refunded webhook will reconcile if Stripe did process.
      logger.error(`Stripe refund call failed for payment ${paymentId}: ${stripeError.message}`);
      await this.releaseRefundReservation(payment.id, currentVersion + 1, refundAmount);

      // Create FAILED refund record for audit trail
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
          idempotencyKey,
          errorMessage: stripeError.message,
        },
      });

      throw stripeError;
    }

    // ── Step 7: Record result ───────────────────────────────────────────
    const isSucceeded = stripeRefund.status === 'succeeded';

    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        orderId: payment.orderId,
        orderNumber: payment.orderNumber,
        userId: payment.userId,
        amount: refundAmount,
        currency: payment.currency,
        reason,
        status: isSucceeded ? RefundStatus.SUCCEEDED : RefundStatus.PENDING,
        stripeRefundId: stripeRefund.id,
        idempotencyKey,
        completedAt: isSucceeded ? new Date() : undefined,
      },
    });

    // A.5: Update accounting — refundedTotal and pendingRefundTotal
    const newRefundedTotal = (payment.refundedTotal || 0) + (isSucceeded ? refundAmount : 0);
    const updatedPendingTotal = newPendingTotal - (isSucceeded ? refundAmount : 0);
    const isFullRefund = newRefundedTotal >= payment.amount;

    let newPaymentStatus: PaymentStatus;
    if (isFullRefund && isSucceeded) {
      newPaymentStatus = PaymentStatus.REFUNDED;
    } else if (newRefundedTotal > 0 && isSucceeded) {
      newPaymentStatus = PaymentStatus.PARTIALLY_REFUNDED;
    } else {
      newPaymentStatus = payment.status;
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: newPaymentStatus,
        refundedTotal: newRefundedTotal,
        pendingRefundTotal: Math.max(0, updatedPendingTotal),
        metadata: {
          ...((payment.metadata as any) || {}),
          refundedAmount: newRefundedTotal,
          refundableAmount: payment.amount - newRefundedTotal - Math.max(0, updatedPendingTotal),
          reconciliationStatus: isFullRefund ? 'RECONCILED' : (newRefundedTotal > 0 ? 'PARTIALLY_REFUNDED' : 'REFUND_PENDING'),
        },
      },
    });

    // Notify order service only for full refund
    if (isFullRefund && payment.orderId) {
      await this.notifyOrderService(payment.orderId, 'REFUNDED').catch((err) =>
        logger.error(`Failed notifying order service about refund: ${err.message}`)
      );
    }

    logger.info(`Refund processed: ${stripeRefund.id} (status: ${stripeRefund.status}) for payment ${payment.stripePaymentIntentId}`);
    return refund;
  }

  /**
   * Atomically release a refund reservation.
   * Uses version guard to ensure we're releasing the correct reservation.
   */
  private static async releaseRefundReservation(
    paymentId: string,
    expectedVersion: number,
    amountToRelease: number
  ) {
    try {
      const current = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (!current) return;

      const releasedPending = Math.max(0, (current.pendingRefundTotal || 0) - amountToRelease);
      await prisma.payment.updateMany({
        where: {
          id: paymentId,
          refundVersion: expectedVersion,
        },
        data: {
          pendingRefundTotal: releasedPending,
          refundVersion: expectedVersion + 1,
        },
      });
      logger.info(`Released refund reservation: ${amountToRelease} for payment ${paymentId}`);
    } catch (err: any) {
      logger.error(`Failed to release refund reservation for ${paymentId}: ${err.message}`);
    }
  }

  /**
   * Quản trị viên xác nhận đã thực hiện chuyển khoản hoàn tiền thủ công (VietQR/PayOS).
   * Yêu cầu bắt buộc phải có mã tham chiếu chuyển khoản ngân hàng (transferReference),
   * thời điểm, người xác nhận và trạng thái thực tế.
   */
  static async confirmManualRefund(
    params: {
      refundId: string;
      adminUserId: string;
      transferReference: string;
      actualAmount?: number;
      notes?: string;
    } | string,
    legacyAdminUserId?: string
  ) {
    const refundId = typeof params === 'string' ? params : params.refundId;
    const adminUserId = typeof params === 'string' ? legacyAdminUserId! : params.adminUserId;
    const transferReference = typeof params === 'string' ? '' : (params.transferReference || '').trim();
    const actualAmount = typeof params === 'object' ? params.actualAmount : undefined;
    const notes = typeof params === 'object' ? params.notes : undefined;

    if (!transferReference) {
      throw new Error('Mã tham chiếu giao dịch chuyển khoản ngân hàng (transferReference) là bắt buộc để xác nhận hoàn tiền');
    }

    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });

    if (!refund) {
      throw new Error('Refund record not found');
    }

    if (refund.status === RefundStatus.SUCCEEDED) {
      return refund;
    }

    if (refund.status !== RefundStatus.PENDING) {
      throw new Error('Refund is not in PENDING status and cannot be confirmed');
    }

    const refundAmount = actualAmount && actualAmount > 0 ? actualAmount : refund.amount;

    // C6: Validate actualAmount does not exceed remaining refundable
    if (refundAmount <= 0) {
      throw new Error('Refund amount must be greater than 0');
    }

    const payment = refund.payment;
    const otherSucceededRefunds = await prisma.refund.aggregate({
      where: {
        paymentId: refund.paymentId,
        status: RefundStatus.SUCCEEDED,
        id: { not: refund.id },
      },
      _sum: { actualAmount: true, amount: true },
    });
    const alreadyRefunded = otherSucceededRefunds._sum.actualAmount || otherSucceededRefunds._sum.amount || 0;
    const maxRefundable = payment.amount - alreadyRefunded;

    if (refundAmount > maxRefundable) {
      throw new Error(`Actual amount (${refundAmount}) exceeds remaining refundable amount (${maxRefundable})`);
    }

    if (refundAmount > refund.amount * 1.01) {
      throw new Error(`Actual amount (${refundAmount}) cannot exceed requested refund amount (${refund.amount})`);
    }
    const confirmedAt = new Date();

    // A.6: Atomically confirm refund using CAS on refundVersion
    const currentVersion = payment.refundVersion || 0;
    const casResult = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        refundVersion: currentVersion,
      },
      data: {
        refundVersion: currentVersion + 1,
      },
    });

    if (casResult.count === 0) {
      throw new Error('Concurrent refund confirmation detected — please retry.');
    }

    const updatedRefund = await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: RefundStatus.SUCCEEDED,
        actualAmount: refundAmount,
        transferReference,
        confirmedBy: adminUserId,
        confirmedAt,
        notes: notes?.trim() || null,
        completedAt: confirmedAt,
      },
    });

    // Recompute totals from source of truth (Refund records)
    const allSucceededRefunds = await prisma.refund.aggregate({
      where: { paymentId: refund.paymentId, status: RefundStatus.SUCCEEDED },
      _sum: { amount: true, actualAmount: true },
    });
    // Use actualAmount if available (manual refunds), else amount
    const totalRefunded = allSucceededRefunds._sum.actualAmount || allSucceededRefunds._sum.amount || 0;

    const isFullyRefunded = totalRefunded >= payment.amount;

    // Recompute pending from Refund records too
    const pendingAgg = await prisma.refund.aggregate({
      where: { paymentId: refund.paymentId, status: RefundStatus.PENDING },
      _sum: { amount: true },
    });
    const remainingPending = pendingAgg._sum.amount || 0;

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: isFullyRefunded ? PaymentStatus.REFUNDED : (totalRefunded > 0 ? PaymentStatus.PARTIALLY_REFUNDED : payment.status),
        refundedTotal: totalRefunded,
        pendingRefundTotal: remainingPending,
        metadata: {
          ...((payment.metadata as any) || {}),
          pendingRefundAmount: remainingPending,
          refundableAmount: payment.amount - totalRefunded - remainingPending,
          refundedAmount: totalRefunded,
          reconciliationStatus: isFullyRefunded ? 'RECONCILED' : 'PARTIALLY_REFUNDED',
          manualRefundConfirmedBy: adminUserId,
          manualRefundConfirmedAt: confirmedAt,
          transferReference,
          manualRefundNotes: notes?.trim() || null,
        },
      },
    });

    if (isFullyRefunded && payment.orderId) {
      await this.notifyOrderService(payment.orderId, 'REFUNDED').catch((err) =>
        logger.error('[confirmManualRefund] Failed notifying order service:', err)
      );
    }

    logger.info(
      `Manual refund ${refundId} confirmed by admin ${adminUserId} (Ref: ${transferReference}, Amount: ${refundAmount}). Total refunded: ${totalRefunded}`
    );
    return updatedRefund;
  }

  static async handleStripeWebhook(event: any, options?: { skipEventTracking?: boolean }) {
    const { type, data } = event;
    const skipTracking = options?.skipEventTracking || false;

    if (!skipTracking) {
      // Save webhook event idempotently (no upsert — avoids MongoDB transaction requirement)
      const existingEvent = await prisma.stripeEvent.findUnique({
        where: { stripeEventId: event.id },
      });
      if (!existingEvent) {
        try {
          await prisma.stripeEvent.create({
            data: {
              stripeEventId: event.id,
              type,
              data,
              processed: false,
            },
          });
        } catch (createErr: any) {
          if (createErr.code !== 'P2002') throw createErr;
        }
      }
    }

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
      // When called from worker, rethrow so worker can track failures
      if (skipTracking) throw err;
    }

    if (!skipTracking) {
      // Update webhook event record
      await prisma.stripeEvent.update({
        where: { stripeEventId: event.id },
        data: {
          processed,
          processedAt: processed ? new Date() : undefined,
          error,
        },
      });
    }
  }

  private static async handlePaymentIntentSucceeded(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.SUCCEEDED) {
      const meta = (payment.metadata as any) || {};

      // Đánh dấu Payment SUCCEEDED và khởi tạo orderSynced: false trước khi gọi order-service
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          completedAt: new Date(),
          orderSynced: false,
          metadata: {
            ...meta,
            orderSynced: false,
          },
        },
      });

      if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
        try {
          await this.notifyOrderService(payment.orderId, 'PAID');

          // Đánh dấu orderSynced = true sau khi thông báo thành công
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              orderSynced: true,
              orderSyncedAt: new Date(),
              syncLockUntil: null,
              metadata: {
                ...meta,
                orderSynced: true,
                orderSyncedAt: new Date(),
              },
            },
          });
        } catch (err: any) {
          logger.error(
            `Failed downstream order sync for Stripe payment ${payment.id}. Leaving orderSynced=false for Outbox worker:`,
            err
          );
        }
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

  /**
   * I3: Handle charge.refunded — supports partial and full refunds.
   * A single Charge can be refunded multiple times. Only mark REFUNDED when fully refunded.
   */
  private static async handleChargeRefunded(charge: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: charge.payment_intent },
    });

    if (!payment) {
      logger.warn(`charge.refunded: No payment found for payment_intent ${charge.payment_intent}`);
      return;
    }

    // I3: Calculate total refunded from Stripe's perspective
    const isZeroDecimal = ['vnd', 'jpy', 'krw'].includes((charge.currency || '').toLowerCase());
    const chargeAmountLocal = isZeroDecimal ? charge.amount : charge.amount / 100;
    const totalStripeRefunded = isZeroDecimal ? charge.amount_refunded : charge.amount_refunded / 100;
    const isFullyRefunded = totalStripeRefunded >= chargeAmountLocal;

    // Process each refund in the charge.refunds list
    if (charge.refunds?.data) {
      for (const stripeRefund of charge.refunds.data) {
        if (stripeRefund.status !== 'succeeded') continue;

        // Find or update local refund record by stripeRefundId (idempotent)
        const existingRefund = await prisma.refund.findFirst({
          where: { stripeRefundId: stripeRefund.id },
        });

        if (existingRefund) {
          if (existingRefund.status !== RefundStatus.SUCCEEDED) {
            await prisma.refund.update({
              where: { id: existingRefund.id },
              data: { status: RefundStatus.SUCCEEDED, completedAt: new Date() },
            });
          }
        } else {
          // Create refund record from webhook if not exists
          const refundAmountLocal = isZeroDecimal ? stripeRefund.amount : stripeRefund.amount / 100;
          await prisma.refund.create({
            data: {
              paymentId: payment.id,
              orderId: payment.orderId,
              orderNumber: payment.orderNumber,
              userId: payment.userId,
              amount: refundAmountLocal,
              currency: charge.currency,
              reason: stripeRefund.reason || 'Refund via Stripe',
              status: RefundStatus.SUCCEEDED,
              stripeRefundId: stripeRefund.id,
              completedAt: new Date(),
            },
          });
        }
      }
    } else {
      // Fallback: update first pending refund
      const pendingRefund = await prisma.refund.findFirst({
        where: { paymentId: payment.id, status: RefundStatus.PENDING },
      });
      if (pendingRefund) {
        await prisma.refund.update({
          where: { id: pendingRefund.id },
          data: { status: RefundStatus.SUCCEEDED, completedAt: new Date() },
        });
      }
    }

    // A.5: Recompute totals from source of truth (Refund records), not from Stripe amounts
    // This prevents double-counting when both refundPayment and webhook update the same payment
    const succeededRefundAgg = await prisma.refund.aggregate({
      where: { paymentId: payment.id, status: RefundStatus.SUCCEEDED },
      _sum: { amount: true },
    });
    const pendingRefundAgg = await prisma.refund.aggregate({
      where: { paymentId: payment.id, status: RefundStatus.PENDING },
      _sum: { amount: true },
    });

    const computedRefundedTotal = succeededRefundAgg._sum.amount || 0;
    const computedPendingTotal = pendingRefundAgg._sum.amount || 0;
    const computedFullyRefunded = computedRefundedTotal >= payment.amount;

    const newStatus = computedFullyRefunded ? PaymentStatus.REFUNDED :
      (computedRefundedTotal > 0 ? PaymentStatus.PARTIALLY_REFUNDED : payment.status);

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: newStatus,
        refundedTotal: computedRefundedTotal,
        pendingRefundTotal: computedPendingTotal,
      },
    });

    if (computedFullyRefunded && payment.orderId) {
      await this.notifyOrderService(payment.orderId, 'REFUNDED').catch((err) =>
        logger.error(`Failed notifying order service about full refund: ${err.message}`)
      );
    }
    logger.info(`Payment ${computedFullyRefunded ? 'fully' : 'partially'} refunded via webhook: ${charge.payment_intent} (refunded: ${computedRefundedTotal}/${payment.amount})`);
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

  private static async notifyOrderService(orderId: string, status: string, maxRetries = 3) {
    const orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:3004';
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN || '';

    let lastError: any = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await axios.post(
          `${orderServiceUrl}/api/orders/webhook/payment`,
          { orderId, status },
          { headers: { 'X-Internal-Service-Token': internalToken }, timeout: 5000 }
        );
        logger.info(`Notified order service about payment ${status} for order ${orderId} (attempt ${attempt})`);
        return;
      } catch (error: any) {
        lastError = error;
        logger.warn(
          `Failed attempt ${attempt}/${maxRetries} to notify order service for order ${orderId}: ${error.message}`
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    logger.error(`Exhausted all ${maxRetries} retries notifying order service for order ${orderId}:`, lastError);
    throw new Error(`Failed to notify order service after ${maxRetries} attempts: ${lastError?.message}`);
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
      if (payment.provider === 'payos' && payment.payosOrderCode) {
        try {
          await PayosService.cancelPaymentLink(Number(payment.payosOrderCode), 'Payment cancelled by user');
        } catch (err: any) {
          logger.warn(`Could not cancel payOS link on gateway: ${err.message}`);
        }
      } else if (payment.stripePaymentIntentId) {
        await StripeService.cancelPaymentIntent(payment.stripePaymentIntentId);
      }

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

      logger.info(`Payment cancelled: ${payment.id} (provider: ${payment.provider})`);
      return updatedPayment;
    } catch (error: any) {
      logger.error('Failed to cancel payment:', error);
      throw error;
    }
  }

  static async cancelPayosPaymentByOrderCode(orderCode: number | string, reason?: string) {
    const orderCodeStr = String(orderCode);
    const payment = await prisma.payment.findFirst({
      where: { payosOrderCode: orderCodeStr },
    });

    try {
      await PayosService.cancelPaymentLink(Number(orderCodeStr), reason || 'Order expired or cancelled');
    } catch (err: any) {
      logger.warn(`PayOS cancelPaymentLink API error for orderCode ${orderCode}: ${err.message}`);
    }

    if (payment && payment.status === PaymentStatus.PENDING) {
      return prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CANCELLED,
          errorMessage: reason || 'Cancelled by system/order service',
          completedAt: new Date(),
        },
      });
    }
    return payment;
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

    // Đối chiếu chi tiết các Payment SUCCEEDED:
    // Tìm các giao dịch chưa đồng bộ (orderSynced !== true), thanh toán muộn đơn CANCELLED, hoặc chờ hoàn tiền
    const succeededPayments = await prisma.payment.findMany({
      where: {
        ...where,
        status: PaymentStatus.SUCCEEDED,
      },
      select: {
        id: true,
        orderId: true,
        orderNumber: true,
        amount: true,
        metadata: true,
      },
    });

    let unsyncedCount = 0;
    let unsyncedRevenue = 0;
    let lateOnCancelledCount = 0;
    let lateOnCancelledRevenue = 0;
    let pendingRefundAmount = 0;

    for (const p of succeededPayments) {
      const meta = (p.metadata as any) || {};
      const isSynced = (p as any).orderSynced === true || meta.orderSynced === true;
      if (!isSynced && p.orderId) {
        unsyncedCount++;
        unsyncedRevenue += p.amount;
      }
      if (meta.reconciliationStatus === 'LATE_PAYMENT_ON_CANCELLED_ORDER') {
        lateOnCancelledCount++;
        lateOnCancelledRevenue += p.amount;
      }
      if (meta.pendingRefundAmount) {
        pendingRefundAmount += Number(meta.pendingRefundAmount);
      }
    }

    const refundStats = await prisma.refund.aggregate({
      where: { status: RefundStatus.SUCCEEDED },
      _sum: { amount: true },
      _count: true,
    });
    const completedRefundAmount = refundStats._sum.amount || 0;
    const totalRevenue = stats._sum.amount || 0;

    return {
      totalRevenue,
      totalTransactions: stats._count,
      byStatus,
      unsyncedCount,
      unsyncedRevenue,
      lateOnCancelledCount,
      lateOnCancelledRevenue,
      pendingRefundAmount,
      completedRefundAmount,
      netRevenue: totalRevenue - completedRefundAmount,
    };
  }

  /**
   * Báo cáo tài chính đối chiếu chi tiết:
   * Trả về danh sách các giao dịch đã thu tiền nhưng chưa đồng bộ, đơn CANCELLED, hoặc chờ hoàn tiền.
   */
  /**
   * I4: Reconciliation report with pagination support.
   * Summary aggregates are computed across ALL matching records (not just current page).
   */
  static async getReconciliationReport(page: number = 1, limit: number = 50, filters?: { status?: string; provider?: string; fromDate?: Date; toDate?: Date }) {
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [
        { status: PaymentStatus.SUCCEEDED, orderSynced: { not: true } },
        { status: PaymentStatus.PARTIALLY_REFUNDED },
      ],
    };

    if (filters?.provider) where.provider = filters.provider;
    if (filters?.fromDate || filters?.toDate) {
      where.createdAt = {};
      if (filters?.fromDate) where.createdAt.gte = filters.fromDate;
      if (filters?.toDate) where.createdAt.lte = filters.toDate;
    }

    // Summary aggregates across ALL matching records
    const [totalCount, succeededPayments, pendingRefunds] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { refunds: true },
      }),
      prisma.refund.aggregate({
        where: { status: RefundStatus.PENDING },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    // Summary for ALL matching records (not just current page)
    const summaryAgg = await prisma.payment.aggregate({
      where,
      _sum: { amount: true, refundedTotal: true, pendingRefundTotal: true },
      _count: true,
    });

    const records = succeededPayments.map((p) => {
      const meta = (p.metadata as any) || {};
      const isSynced = p.orderSynced === true || meta.orderSynced === true;
      return {
        paymentId: p.id,
        orderId: p.orderId,
        orderNumber: p.orderNumber,
        amount: p.amount,
        provider: p.provider,
        status: p.status,
        orderSynced: isSynced,
        syncAttempts: p.syncAttempts || 0,
        lastSyncError: p.lastSyncError,
        refundedTotal: p.refundedTotal || 0,
        pendingRefundTotal: p.pendingRefundTotal || 0,
        reconciliationStatus: meta.reconciliationStatus || 'NONE',
        createdAt: p.createdAt,
        refunds: p.refunds,
      };
    });

    return {
      records,
      summary: {
        totalRecords: summaryAgg._count,
        totalAmount: summaryAgg._sum.amount || 0,
        totalRefunded: summaryAgg._sum.refundedTotal || 0,
        totalPendingRefund: summaryAgg._sum.pendingRefundTotal || 0,
        pendingManualRefunds: pendingRefunds._count,
        pendingManualRefundAmount: pendingRefunds._sum.amount || 0,
      },
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
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

      // Check PayOS configuration
      const payosStatus = PayosService.isConfigured() ? 'configured' : 'not_configured';

      return {
        service: 'payment-service',
        status: 'active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
        stripe: stripeStatus,
        payos: payosStatus,
      };
    } catch (error) {
      return {
        service: 'payment-service',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
        stripe: 'unknown',
        payos: 'unknown',
      };
    }
  }
}
