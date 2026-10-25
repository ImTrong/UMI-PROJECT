import { Request, Response } from 'express';
import { MockPaymentDisabledError } from '../utils/mock-payment';
import { PaymentConfirmationRejectedError } from '../utils/payment-confirmation';
import { AuthRequest } from '../middleware/auth.middleware';
import { PaymentService } from '../services/payment.service';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class PaymentController {
  static async createPaymentIntent(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { orderId, orderNumber, amount, currency, type, metadata } = req.body;

      const paymentIntent = await PaymentService.createPaymentIntent({
        orderId,
        orderNumber,
        userId: req.user.userId,
        amount,
        currency,
        type,
        metadata,
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.PAYMENT_INTENT_CREATED,
        data: paymentIntent,
      });
    } catch (error: any) {
      logger.error('Create payment intent error:', error);

      if (error.message === ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }
      if (error.message === ERROR_MESSAGES.UNSUPPORTED_PAYMENT_TYPE) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create payment intent',
      });
    }
  }

  // Internal endpoint for service-to-service calls (no user auth, userId from body)
  static async createPaymentIntentInternal(req: AuthRequest, res: Response) {
    try {
      const { orderId, orderNumber, userId, amount, currency, type, metadata } = req.body;

      if (!userId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'userId is required',
        });
      }

      const paymentIntent = await PaymentService.createPaymentIntent({
        orderId,
        orderNumber,
        userId,
        amount,
        currency,
        type,
        metadata,
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.PAYMENT_INTENT_CREATED,
        data: paymentIntent,
      });
    } catch (error: any) {
      logger.error('Internal create payment intent error:', error);

      if (error.message === ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }
      if (error.message === ERROR_MESSAGES.UNSUPPORTED_PAYMENT_TYPE) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create payment intent',
      });
    }
  }

  static async confirmPayment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { paymentIntentId, paymentMethodId } = req.body;

      // the caller is the authenticated user (req.user, set by authenticateToken) - a userId in the body is ignored (FIX 07B-1.1)
      const payment = await PaymentService.confirmPayment(
        { paymentIntentId, paymentMethodId },
        { kind: 'user', userId: req.user.userId }
      );

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.PAYMENT_CONFIRMED,
        data: payment,
      });
    } catch (error: any) {
      if (error instanceof MockPaymentDisabledError) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: error.message });
      }
      // not a Stripe payment, or its provider is unclear: refused before any write (FIX 07B-1.2)
      if (error instanceof PaymentConfirmationRejectedError) {
        return res.status(HTTP_STATUS.CONFLICT).json({ error: error.message, code: error.code });
      }
      // someone else's payment and a missing one get the same answer (as GET /api/payments/:paymentId)
      if (error.message === ERROR_MESSAGES.PAYMENT_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.PAYMENT_NOT_FOUND });
      }
      logger.error('Confirm payment error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: error.message || 'Failed to confirm payment',
      });
    }
  }

  static async confirmPaymentInternal(req: Request, res: Response) {
    try {
      const { paymentIntentId, paymentMethodId } = req.body;

      // ORDER_PAYMENT_TOKEN checked (FIX 07B-2A): the order-service, which checks the order owner before calling
      const payment = await PaymentService.confirmPayment({ paymentIntentId, paymentMethodId }, { kind: 'internal' });

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.PAYMENT_CONFIRMED,
        data: payment,
      });
    } catch (error: any) {
      if (error instanceof MockPaymentDisabledError) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: error.message });
      }
      // not a Stripe payment, or its provider is unclear: refused before any write (FIX 07B-1.2)
      if (error instanceof PaymentConfirmationRejectedError) {
        return res.status(HTTP_STATUS.CONFLICT).json({ error: error.message, code: error.code });
      }
      logger.error('Internal confirm payment error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: error.message || 'Failed to confirm payment internally',
      });
    }
  }

  static async getPaymentById(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { paymentId } = req.params;
      const isAdmin = req.user.role === 'ADMIN';
      const payment = await PaymentService.getPaymentById(paymentId, req.user.userId, isAdmin);

      res.status(HTTP_STATUS.OK).json({
        data: payment,
      });
    } catch (error: any) {
      logger.error('Get payment error:', error);

      if (error.message === ERROR_MESSAGES.PAYMENT_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get payment',
      });
    }
  }

  static async getPaymentByOrder(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { orderId } = req.params;
      const payment = await PaymentService.getPaymentByOrder(orderId, req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        data: payment,
      });
    } catch (error: any) {
      logger.error('Get payment by order error:', error);

      if (error.message === ERROR_MESSAGES.PAYMENT_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get payment for order',
      });
    }
  }

  static async getUserPayments(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await PaymentService.getUserPayments(req.user.userId, page, limit);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get user payments error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get payments',
      });
    }
  }

  static async getAllPayments(req: AuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as string;

      const result = await PaymentService.getAllPayments(page, limit, status);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get all payments error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get payments',
      });
    }
  }


  static async refundPayment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      // SCOPE-RESET-01: ADMIN only (also enforced by requireRole on the route) - never the payment owner
      if (req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      }

      const { paymentId } = req.params;
      const { amount, reason } = req.body;
      const isAdmin = req.user.role === 'ADMIN';

      const { refund, outcome } = await PaymentService.refundPayment(
        paymentId,
        req.user.userId,
        amount,
        reason,
        isAdmin
      );
      // same answer as before when the provider call did not end in a refund (FIX 07B-2A.2 keeps this route's contract)
      if (outcome === 'FAILED' || outcome === 'UNVERIFIED') {
        logger.error(`Refund ${refund?.id} for payment ${paymentId}: ${outcome}`);
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to refund payment' });
      }

      const isPending = refund.status === 'PENDING';
      res.status(HTTP_STATUS.OK).json({
        message: isPending
          ? 'Yêu cầu hoàn tiền đã được tạo thành công (Trạng thái: Đang chờ xử lý)'
          : SUCCESS_MESSAGES.PAYMENT_REFUNDED,
        data: refund,
      });
    } catch (error: any) {
      logger.error('Refund payment error:', error);

      if (error.message === ERROR_MESSAGES.PAYMENT_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.FORBIDDEN) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to refund payment',
      });
    }
  }

  static async cancelPayment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { paymentId } = req.params;
      const isAdmin = req.user.role === 'ADMIN';

      const payment = await PaymentService.cancelPayment(paymentId, req.user.userId, isAdmin);

      res.status(HTTP_STATUS.OK).json({
        message: 'Payment cancelled successfully',
        data: payment,
      });
    } catch (error: any) {
      logger.error('Cancel payment error:', error);

      if (error.message === ERROR_MESSAGES.PAYMENT_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to cancel payment',
      });
    }
  }

  static async getPaymentStats(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      const { userId, fromDate, toDate } = req.query;
      const stats = await PaymentService.getPaymentStats(
        userId as string,
        fromDate ? new Date(fromDate as string) : undefined,
        toDate ? new Date(toDate as string) : undefined
      );

      res.status(HTTP_STATUS.OK).json({
        data: stats,
      });
    } catch (error: any) {
      logger.error('Get payment stats error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get payment statistics',
      });
    }
  }

  static async getReconciliationReport(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const filters: any = {};
      if (req.query.provider) filters.provider = req.query.provider;
      if (req.query.fromDate) filters.fromDate = new Date(req.query.fromDate as string);
      if (req.query.toDate) filters.toDate = new Date(req.query.toDate as string);

      const report = await PaymentService.getReconciliationReport(page, limit, filters);
      res.status(HTTP_STATUS.OK).json({
        data: report,
      });
    } catch (error: any) {
      logger.error('Get reconciliation report error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get reconciliation report',
      });
    }
  }

  static async confirmManualRefund(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      const { refundId } = req.params;
      const { transferReference, actualAmount, notes } = req.body;

      if (!transferReference || typeof transferReference !== 'string' || !transferReference.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Mã tham chiếu chuyển khoản ngân hàng (transferReference) là bắt buộc',
        });
      }

      const result = await PaymentService.confirmManualRefund({
        refundId,
        adminUserId: req.user.userId,
        transferReference: transferReference.trim(),
        actualAmount: actualAmount ? Number(actualAmount) : undefined,
        notes: typeof notes === 'string' ? notes.trim() : undefined,
      });

      res.status(HTTP_STATUS.OK).json({
        message: 'Xác nhận hoàn tiền thủ công thành công',
        data: result,
      });
    } catch (error: any) {
      logger.error('Confirm manual refund error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: error.message || 'Failed to confirm refund',
      });
    }
  }

  static async createSetupIntent(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const result = await PaymentService.createSetupIntent(req.user.userId, req.user.email);

      res.status(HTTP_STATUS.OK).json({
        data: result,
      });
    } catch (error: any) {
      logger.error('Create setup intent error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create setup intent',
      });
    }
  }

  static async savePaymentMethod(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { paymentMethodId } = req.body;

      const result = await PaymentService.savePaymentMethod(req.user.userId, paymentMethodId);

      res.status(HTTP_STATUS.OK).json({
        message: 'Payment method saved successfully',
        data: result,
      });
    } catch (error: any) {
      logger.error('Save payment method error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to save payment method',
      });
    }
  }

  static async getPaymentMethods(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const result = await PaymentService.getPaymentMethods(req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        data: result,
      });
    } catch (error: any) {
      logger.error('Get payment methods error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get payment methods',
      });
    }
  }

  static async completeMockPayment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { orderId } = req.body;
      if (!orderId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'orderId is required',
        });
      }

      const result = await PaymentService.completeMockPayment(orderId, req.user.userId);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      if (error instanceof MockPaymentDisabledError) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Route not found' });
      }
      logger.error('Complete mock payment error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: error.message || 'Failed to complete mock payment',
      });
    }
  }

  static async healthCheck(req: AuthRequest, res: Response) {
    const health = await PaymentService.healthCheck();
    const statusCode = health.database === 'connected'
      ? HTTP_STATUS.OK
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;

    res.status(statusCode).json(health);
  }
}
