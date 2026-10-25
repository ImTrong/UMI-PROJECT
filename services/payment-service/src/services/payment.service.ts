import { PrismaClient, PaymentStatus, RefundStatus } from '@prisma/client';
import { assertMockPaymentEnabled } from '../utils/mock-payment';
import { PaymentConfirmationRejectedError, stripeConfirmationProblem } from '../utils/payment-confirmation';
import { isDefiniteStripeRejection, verdictFromStripeRefund } from '../utils/stripe-refund-result';
import {
  isObjectId,
  OrderRefundRejectedError,
  OrderRefundRequest,
  paymentEvidenceView,
  paymentStatusView,
  refundIdempotencyKey,
  refundOutcome,
  refundProviderOf,
  refundView,
} from '../utils/order-refund';
import { readServiceToken, SERVICE_TOKEN_HEADER } from '../utils/service-token';
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

/**
 * Who asks to confirm a payment (FIX 07B-1.1):
 *   - 'user': a signed-in user - `userId` comes from the authenticated request (never from the body) and may only confirm a payment
 *     whose Payment.userId in the database is that user;
 *   - 'internal': the order-service, authenticated with ORDER_PAYMENT_TOKEN (it checks the order owner itself).
 */
export type PaymentActor = { kind: 'user'; userId: string } | { kind: 'internal' };

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** Extra `where` condition for the caller; throws (fail-closed) when the caller cannot be identified. */
function paymentOwnerFilter(actor: PaymentActor | undefined): { userId?: string } {
  if (actor?.kind === 'internal') return {};
  if (actor?.kind === 'user') {
    // a malformed identity cannot own anything: answered like an unknown payment, before the database is touched
    if (typeof actor.userId !== 'string' || !OBJECT_ID.test(actor.userId)) throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    return { userId: actor.userId };
  }
  throw new Error('Payment confirmation requires an authenticated caller');
}

export class PaymentService {
  static async createPaymentIntent(data: CreatePaymentData) {
    const { orderId, orderNumber, userId, amount, currency = 'vnd', type = 'COURSE_PURCHASE', metadata = {} } = data;

    // IMPLEMENT-01: only course purchases. INSTRUCTOR_REGISTRATION (a fee that used to upgrade the payer's role) is no longer
    // created - instructor applications are free and reviewed by an ADMIN in the user-service. Refused before anything else.
    if (type !== 'COURSE_PURCHASE') {
      throw new Error(ERROR_MESSAGES.UNSUPPORTED_PAYMENT_TYPE);
    }

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

  static async confirmPayment(data: ConfirmPaymentData, actor: PaymentActor) {
    const { paymentIntentId, paymentMethodId } = data;
    // Ownership first (FIX 07B-1.1): a user's lookup is limited to their own payments, so someone else's payment is "not found"
    // exactly like a missing one, and nothing below (status writes, order / user notifications) can run for it.
    const ownerFilter = paymentOwnerFilter(actor);

    // Check if paymentIntentId is a MongoDB ObjectId (24 hex chars) or a Stripe ID (pi_...)
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(paymentIntentId);

    // Find payment in database
    const payment = await prisma.payment.findFirst({
      where: isObjectId
        ? { id: paymentIntentId, ...ownerFilter }
        : { stripePaymentIntentId: paymentIntentId, ...ownerFilter },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    if (ownerFilter.userId && String(payment.userId).toLowerCase() !== ownerFilter.userId.toLowerCase()) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);   // second check on the row itself: never trust the filter alone
    }

    // Only Stripe payments are confirmed here (FIX 07B-1.2): a payOS payment, or one whose provider is unclear, is refused before
    // anything is written or any provider is asked - never "failed" because Stripe has no intent for it.
    const providerProblem = stripeConfirmationProblem(payment);
    if (providerProblem) {
      throw new PaymentConfirmationRejectedError(providerProblem);
    }

    // If already succeeded, return it directly
    if (payment.status === PaymentStatus.SUCCEEDED) {
      return payment;
    }

    if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.PROCESSING) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    const stripePaymentId = payment.stripePaymentIntentId;
    const isMockPayment =
      (payment.metadata as any)?.isMock ||
      !StripeService.isConfigured() ||
      stripePaymentId?.startsWith('pi_mock_');
    // Without a real Stripe intent "confirming" marks the payment SUCCEEDED with no money involved: that is the demo flow,
    // development / test only (FIX 07B-1). Checked before anything is written, so a refusal changes nothing.
    if (isMockPayment) assertMockPaymentEnabled();
    if (!isMockPayment && !stripePaymentId) {
      throw new PaymentConfirmationRejectedError('STRIPE_INTENT_MISSING');   // nothing to ask Stripe about: refused, not failed
    }

    // Update status to processing
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.PROCESSING },
    });

    let updatedPayment;
    try {
      let newStatus: PaymentStatus;
      let completedAt: Date | null = null;

      if (isMockPayment) {
        newStatus = PaymentStatus.SUCCEEDED;
        completedAt = new Date();
      } else {
        const stripePayment = await StripeService.getPaymentIntent(stripePaymentId as string);

        if (stripePayment.status === 'succeeded') {
          newStatus = PaymentStatus.SUCCEEDED;
          completedAt = new Date();
        } else if (stripePayment.status === 'requires_payment_method') {
          newStatus = PaymentStatus.FAILED;
        } else if (stripePayment.status === 'canceled') {
          newStatus = PaymentStatus.CANCELLED;
        } else {
          newStatus = PaymentStatus.PENDING;
        }
      }

      // Update payment record. A success is recorded BEFORE anyone is told (like the Stripe webhook): orderSynced stays false
      // until the order service has the news, so the outbox delivers it if the call below fails.
      const succeeded = newStatus === PaymentStatus.SUCCEEDED;
      updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: newStatus,
          paymentMethodId,
          completedAt,
          ...(succeeded && { orderSynced: false, metadata: { ...((payment.metadata as any) || {}), orderSynced: false } }),
        },
      });
    } catch (error: any) {
      // A technical error (Stripe unreachable or without this intent, database) is no evidence that THIS payment failed
      // (FIX 07B-1.2): it gets back the status it had, nobody is told FAILED, and the caller / the Stripe webhook can decide later.
      await prisma.payment
        .updateMany({
          where: { id: payment.id, status: PaymentStatus.PROCESSING },
          data: { status: payment.status, errorMessage: String(error?.message || 'unknown error').slice(0, 500) },
        })
        .catch((restoreError: any) => logger.error(`Could not restore payment ${payment.id} after a confirmation error: ${restoreError?.message}`));
      throw error;
    }

    if (updatedPayment.status === PaymentStatus.SUCCEEDED) {
      if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
        try {
          await this.notifyOrderService(payment.orderId, 'PAID');
          updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
              orderSynced: true,
              orderSyncedAt: new Date(),
              metadata: { ...((updatedPayment.metadata as any) || {}), orderSynced: true, orderSyncedAt: new Date() },
            },
          });
        } catch (err: any) {
          // the payment DID succeed: it stays SUCCEEDED with orderSynced=false and the outbox worker tells the order service
          logger.warn(`Payment ${payment.id} confirmed, order sync deferred to the outbox: ${err?.message}`);
        }
      } else if ((payment as any).type === ('INSTRUCTOR_REGISTRATION' as any)) {
        // a registration fee created before IMPLEMENT-01: the user-service only queues an application for ADMIN review
        await this.notifyUserService(payment.userId, 'INSTRUCTOR_REGISTRATION_SUCCESS');
      }
    }

    logger.info(`Payment confirmed: ${paymentIntentId}, status: ${updatedPayment.status}`);

    return updatedPayment;
  }

  /**
   * Internal (order-service, ORDER_PAYMENT_TOKEN - FIX 07B-2A.1): the status of the payment of ONE order, read from the database
   * (kept current by the provider webhooks / outbox). A payment of another order and a missing one get the same "not found".
   */
  static async getPaymentStatusForOrder(paymentId: string, orderId: string) {
    if (!isObjectId(paymentId) || !isObjectId(orderId)) throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orderId !== orderId) throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    return paymentStatusView(payment);
  }

  /**
   * Internal (order-service, ORDER_PAYMENT_TOKEN - ADMIN-DASHBOARD-01): the stored course-purchase payments of several orders, for
   * the sales statistics. Read-only, database state as written by the provider webhooks / outbox (no provider call); an order
   * with no payment simply has no row. The caller decides what counts as "paid" - this only reports what is stored.
   */
  static async getPaymentEvidenceForOrders(orderIds: string[]) {
    const payments = await prisma.payment.findMany({
      where: { orderId: { in: orderIds }, type: 'COURSE_PURCHASE' },
      orderBy: { createdAt: 'asc' },
    });
    return payments.map(paymentEvidenceView);
  }

  /**
   * Internal (order-service, ORDER_PAYMENT_TOKEN - FIX 07B-2A.1/2A.2): refund the payment of ONE order through the refund core
   * (refundPayment). Checked here: the payment belongs to that order, the currency matches, the provider is clear. The request's
   * idempotency key becomes the Refund row's unique key and Stripe's idempotency key: a replay resumes or returns that refund.
   */
  static async refundForOrder(request: OrderRefundRequest) {
    const payment = await prisma.payment.findUnique({ where: { id: request.paymentId } });
    if (!payment || payment.orderId !== request.orderId) throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    if (request.currency !== undefined && request.currency.trim().toLowerCase() !== String(payment.currency || 'vnd').toLowerCase()) {
      throw new OrderRefundRejectedError('CURRENCY_MISMATCH', 422, 'Refund currency does not match the payment');
    }
    if (!refundProviderOf(payment)) throw new OrderRefundRejectedError('PAYMENT_PROVIDER_UNKNOWN', 409, 'Payment provider is not clear');

    const result = await this.refundPayment(payment.id, payment.userId, request.amount, request.reason, false, refundIdempotencyKey(request.idempotencyKey));
    return { outcome: result.outcome, replayed: result.replayed, refund: refundView(result.refund) };
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
    // development / test only - checked here too, so no caller can reach the demo completion around the route (FIX 07B-1)
    assertMockPaymentEnabled();
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
   * Refund core (FIX 07B-2A.2). Invariant, for every payment and at every moment:
   *     refundedTotal + pendingRefundTotal <= amount
   * where both counters are DERIVED from the payment's Refund rows (PENDING = reserved, SUCCEEDED = refunded) inside the same MongoDB
   * transaction that changes a row. Every such transaction also writes the payment document, so concurrent refund writers - in any
   * process - conflict on it and are serialised (the loser is retried and sees the winner's rows).
   *
   *   1. reserve      one transaction: re-check the payment, compute what is left from the rows, insert the PENDING row (its
   *                   idempotencyKey is unique in the collection) and the counters. Two keys can never reserve more than is left;
   *                   the same key twice is one row.
   *   2. provider     Stripe is called only after that commit, with the row's key as Stripe idempotency key and the row id in the
   *                   refund metadata; a lease on the row (processingUntil) keeps other instances from calling at the same time.
   *   3. outcome      succeeded -> SUCCEEDED; Stripe rejected / refund failed -> FAILED (reservation released); timeout, network,
   *                   5xx, unknown -> UNVERIFIED: the row stays PENDING and RESERVED - a retry with the same key re-sends the SAME
   *                   request (or reads the known Stripe refund), and the charge.refunded / charge.refund.updated webhooks settle it.
   *   payOS / no Stripe intent: the row stays PENDING for the admin's manual confirmation (confirmManualRefund), as before.
   *
   * Returns { refund, outcome, replayed }. A key already used for another payment / amount -> 422; a refund with this key being
   * sent by another instance right now -> 409 REFUND_IN_PROGRESS (never a success).
   */
  static async refundPayment(
    paymentId: string,
    userId: string,
    amount?: number,
    reason?: string,
    isAdmin: boolean = false,
    requestIdempotencyKey?: string
  ): Promise<{ refund: any; outcome: 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'UNVERIFIED'; replayed: boolean }> {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }
    if (!isAdmin && payment.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    // a caller-supplied key (internal order refund) makes a retry land on the same Refund row and the same Stripe refund
    const idempotencyKey = requestIdempotencyKey ?? `refund_${paymentId}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    if (requestIdempotencyKey) {
      const earlier = await prisma.refund.findUnique({ where: { idempotencyKey } });
      if (earlier) return this.resumeRefund(earlier, payment, amount);
    }

    const manual = payment.provider === 'payos' || !payment.stripePaymentIntentId;
    let refund: any;
    try {
      refund = await this.refundTx(async (tx) => {
        const current = await tx.payment.findUnique({ where: { id: paymentId } });
        if (current.status !== PaymentStatus.SUCCEEDED && current.status !== PaymentStatus.PARTIALLY_REFUNDED) {
          throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
        }
        const { refunded, pending } = await this.refundRowTotals(tx, paymentId);
        const remainingRefundable = current.amount - refunded - pending;
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
        const created = await tx.refund.create({
          data: {
            paymentId: current.id,
            orderId: current.orderId,
            orderNumber: current.orderNumber,
            userId: current.userId,
            amount: refundAmount,
            currency: current.currency,
            reason,
            status: RefundStatus.PENDING,
            idempotencyKey,
            processingUntil: manual ? null : new Date(Date.now() + PaymentService.REFUND_LEASE_MS),
          },
        });
        await this.syncRefundTotals(tx, current.id, manual
          ? { pendingRefundId: created.id, manualRefundRequired: true, reconciliationStatus: 'MANUAL_REFUND_PENDING' }
          : {});
        return created;
      });
    } catch (error: any) {
      if (requestIdempotencyKey && error?.code === 'P2002') {
        const recorded = await prisma.refund.findUnique({ where: { idempotencyKey } });   // the same key reserved by another instance
        if (recorded) return this.resumeRefund(recorded, payment, amount);
      }
      throw error;
    }

    if (manual) {
      logger.info(`Manual refund created (PENDING, admin confirmation required): refund ${refund.id} for payment ${payment.id}`);
      return { refund, outcome: 'PENDING', replayed: false };
    }
    return this.sendStripeRefund(refund, payment, false);
  }

  /** A refund row that already exists for the request's key: same payment and amount -> continue / report it; otherwise 422. */
  private static async resumeRefund(existing: any, payment: any, amount?: number) {
    if (existing.paymentId !== payment.id || (amount !== undefined && amount !== null && existing.amount !== amount)) {
      throw new OrderRefundRejectedError('IDEMPOTENCY_KEY_REUSED', 422, 'This idempotency key belongs to another refund');
    }
    if (existing.status === RefundStatus.SUCCEEDED) return { refund: existing, outcome: 'SUCCEEDED' as const, replayed: true };
    if (existing.status === RefundStatus.FAILED) return { refund: existing, outcome: 'FAILED' as const, replayed: true };
    const current = await prisma.payment.findUnique({ where: { id: payment.id } });
    if (current!.provider === 'payos' || !current!.stripePaymentIntentId) return { refund: existing, outcome: 'PENDING' as const, replayed: true };
    return this.sendStripeRefund(existing, current, true);
  }

  private static readonly REFUND_LEASE_MS = 120_000;                         // longer than one Stripe call incl. the SDK's retries
  private static readonly STRIPE_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;   // Stripe keeps idempotency keys for ~24 h

  /** Talk to Stripe for one PENDING refund row and record what Stripe proved. Never releases a reservation on an unknown outcome. */
  private static async sendStripeRefund(refund: any, payment: any, replayed: boolean) {
    const now = new Date();
    if (replayed) {
      // only one instance at a time: take the row's lease (free, or expired because its holder stopped)
      const claim = await prisma.refund.updateMany({
        where: { id: refund.id, status: RefundStatus.PENDING, OR: [{ processingUntil: null }, { processingUntil: { lt: now } }] },
        data: { processingUntil: new Date(now.getTime() + PaymentService.REFUND_LEASE_MS) },
      });
      if (claim.count === 0) {
        const current = await prisma.refund.findUnique({ where: { id: refund.id } });
        if (current && current.status !== RefundStatus.PENDING) return { refund: current, outcome: refundOutcome(current.status), replayed: true };
        throw new OrderRefundRejectedError('REFUND_IN_PROGRESS', 409, 'This refund is being processed by another request');
      }
    }

    let answer: { id: string; status: string | null };
    try {
      if (refund.stripeRefundId) {
        answer = await StripeService.getRefund(refund.stripeRefundId);
      } else if (replayed && now.getTime() - new Date(refund.createdAt).getTime() > PaymentService.STRIPE_IDEMPOTENCY_WINDOW_MS) {
        // Stripe would no longer recognise the key: re-sending could refund a second time. Left for the webhook / reconciliation.
        await prisma.refund.updateMany({ where: { id: refund.id, status: RefundStatus.PENDING }, data: { processingUntil: null } });
        return { refund: await prisma.refund.findUnique({ where: { id: refund.id } }), outcome: 'UNVERIFIED' as const, replayed };
      } else {
        answer = await this.requestStripeRefund(payment.stripePaymentIntentId, refund);
      }
    } catch (error: any) {
      if (!refund.stripeRefundId && isDefiniteStripeRejection(error)) {
        const failed = await this.markRefundFailed(refund.id, error.message);
        logger.warn(`Stripe rejected refund ${refund.id}: ${error.message}`);
        return { refund: failed, outcome: 'FAILED' as const, replayed };
      }
      await prisma.refund.updateMany({
        where: { id: refund.id, status: RefundStatus.PENDING },
        data: { processingUntil: null, errorMessage: `UNVERIFIED: ${String(error?.message || 'unknown error')}`.slice(0, 500) },
      });
      logger.error(`Refund ${refund.id} not verified (reservation kept, retry with the same key): ${error?.message}`);
      return { refund: await prisma.refund.findUnique({ where: { id: refund.id } }), outcome: 'UNVERIFIED' as const, replayed };
    }

    const verdict = verdictFromStripeRefund(answer);
    if (verdict === 'SUCCEEDED') {
      const done = await this.markRefundSucceeded(refund.id, answer.id);
      logger.info(`Refund processed: ${answer.id} (succeeded) for payment ${payment.stripePaymentIntentId}`);
      return { refund: done, outcome: refundOutcome(done?.status), replayed };
    }
    if (verdict === 'FAILED') {
      const failed = await this.markRefundFailed(refund.id, `Stripe refund ${answer.status}`, answer.id);
      return { refund: failed, outcome: refundOutcome(failed?.status), replayed };
    }
    const pending = await this.markRefundPending(refund.id, answer.id);
    return { refund: pending, outcome: refundOutcome(pending?.status), replayed };
  }

  /** The one place that asks Stripe to create a refund: always the row's own amount, currency, reason, key and id. */
  private static requestStripeRefund(paymentIntentId: string, refund: any) {
    return StripeService.refundPayment(
      paymentIntentId,
      refund.amount,
      refund.reason ?? undefined,
      refund.currency,
      refund.idempotencyKey,
      { localRefundId: refund.id, idempotencyKey: refund.idempotencyKey }
    );
  }

  /** Runs fn in a MongoDB transaction, retried when another refund writer touched the same payment at the same time. */
  private static async refundTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await prisma.$transaction(fn, { maxWait: 5000, timeout: 15000 });
      } catch (error: any) {
        const conflict = error?.code === 'P2034' || /write ?conflict|TransientTransactionError/i.test(String(error?.message));
        if (!conflict || attempt >= 10) throw error;
        await new Promise((resolve) => setTimeout(resolve, 15 * attempt + Math.floor(Math.random() * 25)));
      }
    }
  }

  /** Reserved (PENDING) and refunded (SUCCEEDED, the confirmed actual amount when there is one) of a payment, from its rows. */
  private static async refundRowTotals(tx: any, paymentId: string) {
    const rows = await tx.refund.findMany({
      where: { paymentId, status: { in: [RefundStatus.PENDING, RefundStatus.SUCCEEDED] } },
      select: { status: true, amount: true, actualAmount: true },
    });
    let pending = 0;
    let refunded = 0;
    for (const row of rows) {
      if (row.status === RefundStatus.PENDING) pending += row.amount;
      else refunded += row.actualAmount ?? row.amount;
    }
    return { pending, refunded };
  }

  /**
   * Inside a refund transaction: write the payment's counters and status derived from its rows (always writing the payment, which
   * is what serialises concurrent refund writers). Reports whether the payment became fully refunded by this transaction.
   */
  private static async syncRefundTotals(tx: any, paymentId: string, extraMetadata: Record<string, unknown> = {}) {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    const { pending, refunded } = await this.refundRowTotals(tx, paymentId);
    const isFull = refunded >= payment.amount;
    const status = isFull
      ? PaymentStatus.REFUNDED
      : refunded > 0
        ? PaymentStatus.PARTIALLY_REFUNDED
        : payment.status === PaymentStatus.PARTIALLY_REFUNDED || payment.status === PaymentStatus.REFUNDED
          ? PaymentStatus.SUCCEEDED
          : payment.status;
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status,
        refundedTotal: refunded,
        pendingRefundTotal: pending,
        refundVersion: { increment: 1 },
        metadata: {
          ...((payment.metadata as any) || {}),
          refundedAmount: refunded,
          pendingRefundAmount: pending,
          refundableAmount: payment.amount - refunded - pending,
          reconciliationStatus: isFull ? 'RECONCILED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : pending > 0 ? 'REFUND_PENDING' : (payment.metadata as any)?.reconciliationStatus ?? null,
          ...extraMetadata,
        },
      },
    });
    return { payment, refunded, pending, becameFullyRefunded: isFull && payment.status !== PaymentStatus.REFUNDED };
  }

  /** Stripe proved the refund succeeded. Idempotent: a SUCCEEDED row changes nothing (no double counting, no 2nd notice); FAILED is final. */
  private static async markRefundSucceeded(refundId: string, stripeRefundId?: string) {
    const outcome = await this.refundTx(async (tx) => {
      const row = await tx.refund.findUnique({ where: { id: refundId } });
      if (!row) return { refund: null, totals: null };
      if (row.status === RefundStatus.SUCCEEDED) {
        if (!row.stripeRefundId && stripeRefundId) {
          return { refund: await tx.refund.update({ where: { id: refundId }, data: { stripeRefundId } }), totals: null };
        }
        return { refund: row, totals: null };
      }
      if (row.status === RefundStatus.FAILED) {
        // FAILED is final (only written when Stripe rejected the request or reported the refund failed): a stray or late
        // "succeeded" event does not revive it - it is logged for reconciliation instead
        logger.error(`Refund ${refundId} is FAILED but a provider event says succeeded (${stripeRefundId ?? 'no id'}): reconciliation needed`);
        return { refund: row, totals: null };
      }
      const refund = await tx.refund.update({
        where: { id: refundId },
        data: { status: RefundStatus.SUCCEEDED, stripeRefundId: stripeRefundId ?? row.stripeRefundId, completedAt: new Date(), processingUntil: null, errorMessage: null },
      });
      return { refund, totals: await this.syncRefundTotals(tx, row.paymentId) };
    });
    await this.notifyFullRefund(outcome.totals);
    return outcome.refund;
  }

  /** Stripe proved the refund did not happen: the reservation is released. Only a PENDING row can fail. */
  private static async markRefundFailed(refundId: string, reason: string, stripeRefundId?: string) {
    return this.refundTx(async (tx) => {
      const row = await tx.refund.findUnique({ where: { id: refundId } });
      if (!row || row.status !== RefundStatus.PENDING) return row;
      const refund = await tx.refund.update({
        where: { id: refundId },
        data: { status: RefundStatus.FAILED, stripeRefundId: stripeRefundId ?? row.stripeRefundId, processingUntil: null, errorMessage: String(reason).slice(0, 500) },
      });
      await this.syncRefundTotals(tx, row.paymentId);
      return refund;
    });
  }

  /** Stripe accepted the refund but has not finished it: remember its id, keep the reservation, free the lease. */
  private static async markRefundPending(refundId: string, stripeRefundId: string) {
    await prisma.refund.updateMany({ where: { id: refundId, status: RefundStatus.PENDING }, data: { stripeRefundId, processingUntil: null, errorMessage: null } });
    return prisma.refund.findUnique({ where: { id: refundId } });
  }

  private static async notifyFullRefund(totals: { payment: any; becameFullyRefunded: boolean } | null) {
    if (totals?.becameFullyRefunded && totals.payment.orderId) {
      await this.notifyOrderService(totals.payment.orderId, 'REFUNDED').catch((err) =>
        logger.error(`Failed notifying order service about refund: ${err.message}`)
      );
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

    // FIX 07B-2A.2: the row and the payment's counters change in one transaction (serialised with every other refund writer)
    const { updatedRefund, totals } = await this.refundTx(async (tx) => {
      const current = await tx.refund.findUnique({ where: { id: refundId } });
      if (!current || current.status !== RefundStatus.PENDING) {
        throw new Error('Refund is not in PENDING status and cannot be confirmed');
      }
      const updated = await tx.refund.update({
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
      const synced = await this.syncRefundTotals(tx, payment.id, {
        manualRefundConfirmedBy: adminUserId,
        manualRefundConfirmedAt: confirmedAt,
        transferReference,
        manualRefundNotes: notes?.trim() || null,
      });
      return { updatedRefund: updated, totals: synced };
    });
    const totalRefunded = totals.refunded;
    await this.notifyFullRefund(totals);

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
        // a registration fee created before IMPLEMENT-01: the user-service only queues an application for ADMIN review
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

    if (Array.isArray(charge.refunds?.data)) {
      for (const stripeRefund of charge.refunds.data) {
        await this.applyStripeRefund(stripeRefund, payment, charge.currency);
      }
    } else {
      // Fallback (no refund list in the event): the oldest PENDING refund of this payment, as before
      const pendingRefund = await prisma.refund.findFirst({
        where: { paymentId: payment.id, status: RefundStatus.PENDING },
        orderBy: { createdAt: 'asc' },
      });
      if (pendingRefund) await this.markRefundSucceeded(pendingRefund.id);
    }
    // Re-derive the counters from the rows even when no row changed (as before FIX 07B-2A.2): counters that drifted from the rows
    // are repaired, a repeated webhook adds nothing (derived, not incremented). It runs in a refund transaction that writes the
    // payment, so it is serialised with concurrent reservations; the order hears REFUNDED only on the transition to fully refunded.
    const resynced = await this.refundTx((tx) => this.syncRefundTotals(tx, payment.id));
    await this.notifyFullRefund(resynced);
    const after = await prisma.payment.findUnique({ where: { id: payment.id } });
    logger.info(`charge.refunded processed for ${charge.payment_intent} (refunded: ${after?.refundedTotal}/${payment.amount}, pending: ${after?.pendingRefundTotal})`);
  }

  /** The local row of a Stripe refund: by Stripe's id, else by the row id / key this service put in the refund metadata. */
  private static async findLocalRefund(stripeRefund: any, paymentId?: string) {
    const byStripeId = await prisma.refund.findFirst({ where: { stripeRefundId: stripeRefund.id } });
    if (byStripeId) return byStripeId;
    const meta = stripeRefund.metadata || {};
    let row: any = null;
    if (isObjectId(meta.localRefundId)) row = await prisma.refund.findUnique({ where: { id: meta.localRefundId } });
    if (!row && typeof meta.idempotencyKey === 'string' && meta.idempotencyKey) row = await prisma.refund.findUnique({ where: { idempotencyKey: meta.idempotencyKey } });
    if (row && paymentId && row.paymentId !== paymentId) return null;   // metadata pointing at another payment's row is ignored
    return row;
  }

  /** One refund reported by a Stripe webhook: idempotent, the counters and order follow-up go through the refund transactions. */
  private static async applyStripeRefund(stripeRefund: any, payment: any, currency: string) {
    const local = await this.findLocalRefund(stripeRefund, payment.id);
    const verdict = verdictFromStripeRefund(stripeRefund);
    if (local) {
      if (verdict === 'SUCCEEDED') await this.markRefundSucceeded(local.id, stripeRefund.id);
      else if (verdict === 'FAILED') await this.markRefundFailed(local.id, stripeRefund.failure_reason || `Stripe refund ${stripeRefund.status}`, stripeRefund.id);
      else if (!local.stripeRefundId) await this.markRefundPending(local.id, stripeRefund.id);
      return;
    }
    if (verdict !== 'SUCCEEDED') return;
    // a refund made outside this service (e.g. in the Stripe dashboard): recorded once, under a key derived from Stripe's id
    const zeroDecimal = ['vnd', 'jpy', 'krw'].includes(String(currency || stripeRefund.currency || '').toLowerCase());
    try {
      const totals = await this.refundTx(async (tx) => {
        await tx.refund.create({
          data: {
            paymentId: payment.id,
            orderId: payment.orderId,
            orderNumber: payment.orderNumber,
            userId: payment.userId,
            amount: zeroDecimal ? stripeRefund.amount : stripeRefund.amount / 100,
            currency: currency || stripeRefund.currency,
            reason: stripeRefund.reason || 'Refund via Stripe',
            status: RefundStatus.SUCCEEDED,
            stripeRefundId: stripeRefund.id,
            idempotencyKey: `stripe_refund:${stripeRefund.id}`,
            completedAt: new Date(),
          },
        });
        return this.syncRefundTotals(tx, payment.id);
      });
      await this.notifyFullRefund(totals);
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;   // the same webhook delivered twice: already recorded
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
    const refund = await this.findLocalRefund(refundObject);
    if (!refund) return;
    const verdict = verdictFromStripeRefund(refundObject);
    if (verdict === 'SUCCEEDED') await this.markRefundSucceeded(refund.id, refundObject.id);
    else if (verdict === 'FAILED') await this.markRefundFailed(refund.id, refundObject.failure_reason || `Stripe refund ${refundObject.status}`, refundObject.id);
    else if (!refund.stripeRefundId) await this.markRefundPending(refund.id, refundObject.id);
    logger.info(`Refund updated: ${refundObject.id}, status: ${verdict}`);
  }

  private static async notifyOrderService(orderId: string, status: string, maxRetries = 3) {
    const orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:3004';
    // The order webhook accepts only the Order <-> Payment credential (FIX 07B-2A). Without a usable ORDER_PAYMENT_TOKEN nothing
    // is sent and this throws like an unreachable order service, so every caller keeps its existing path (outbox / retry).
    const token = readServiceToken('ORDER_PAYMENT_TOKEN');
    if (!token.ok) {
      logger.error(`Not notifying order service about ${status} for order ${orderId}: ${token.reason}`);
      throw new Error(`Failed to notify order service: ${token.reason}`);
    }

    let lastError: any = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await axios.post(
          `${orderServiceUrl}/api/orders/webhook/payment`,
          { orderId, status },
          { headers: { [SERVICE_TOKEN_HEADER]: token.value }, timeout: 5000 }
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

    // never the error object itself: an axios error carries the request headers, i.e. the token
    const lastStatus = lastError?.response?.status;
    logger.error(`Exhausted all ${maxRetries} retries notifying order service for order ${orderId}: ${lastStatus ? `HTTP ${lastStatus}` : lastError?.code || lastError?.message}`);
    throw new Error(`Failed to notify order service after ${maxRetries} attempts: ${lastError?.message}`);
  }

  private static async notifyUserService(userId: string, status: string) {
    // The role-upgrade route of the User Service accepts only the Payment -> User credential (FIX 07B-1). Without a usable
    // PAYMENT_USER_TOKEN nothing is sent: no fallback to INTERNAL_SERVICE_TOKEN, a default or an empty value.
    const token = readServiceToken('PAYMENT_USER_TOKEN');
    if (!token.ok) {
      logger.error(`Not notifying user service about ${status} for user ${userId}: ${token.reason}`);
      return;
    }
    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      await axios.post(
        `${userServiceUrl}/api/users/become-instructor/confirm`,
        { userId, status },
        { headers: { [SERVICE_TOKEN_HEADER]: token.value } }
      );
      logger.info(`Notified user service about ${status} for user ${userId}`);
    } catch (error: any) {
      // never the error object itself: an axios error carries the request headers, i.e. the token
      const httpStatus = error?.response?.status;
      logger.error(`Failed to notify user service about ${status} for user ${userId}: ${httpStatus ? `HTTP ${httpStatus}` : String(error?.code || error?.message || 'unknown error').split(token.value).join('[redacted]')}`);
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
