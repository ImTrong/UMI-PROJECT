import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { OrderService } from '../services/order.service';
import { PaymentClient } from '../services/payment.client';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class OrderController {
  static async createOrder(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const result = await OrderService.createOrder({
        userId: req.user.userId,
        items: req.body.items,
        notes: req.body.notes,
        paymentMethodId: req.body.paymentMethodId,
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.ORDER_CREATED,
        data: result,
      });
    } catch (error: any) {
      logger.error('Create order error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_ALREADY_PURCHASED) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create order',
      });
    }
  }

  static async createOrderWithPayment(req: AuthRequest, res: Response) {
    // This is essentially same as createOrder now that createOrder supports paymentMethodId
    return this.createOrder(req, res);
  }

  static async processPayment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { orderId } = req.params;
      const { paymentMethodId } = req.body;

      const result = await OrderService.processPayment(orderId, paymentMethodId);

      res.status(HTTP_STATUS.OK).json({
        message: result.success ? 'Payment processed successfully' : 'Payment failed',
        data: result,
      });
    } catch (error: any) {
      logger.error('Process payment error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to process payment',
      });
    }
  }

  static async getPaymentStatus(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { orderId } = req.params;
      const order = await OrderService.getOrderById(orderId, req.user.userId);

      if (!order.paymentId) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: 'No payment found for this order',
        });
      }

      const payment = await PaymentClient.getPaymentStatus(order.paymentId);

      res.status(HTTP_STATUS.OK).json({
        data: payment,
      });
    } catch (error: any) {
      logger.error('Get payment status error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get payment status',
      });
    }
  }

  static async getOrderById(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { orderId } = req.params;
      const isAdmin = req.user.role === 'ADMIN';
      const order = await OrderService.getOrderById(orderId, req.user.userId, isAdmin);

      res.status(HTTP_STATUS.OK).json({
        data: order,
      });
    } catch (error: any) {
      logger.error('Get order error:', error);

      if (error.message === ERROR_MESSAGES.ORDER_NOT_FOUND) {
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
        error: 'Failed to get order',
      });
    }
  }

  static async getOrderByNumber(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { orderNumber } = req.params;
      const isAdmin = req.user.role === 'ADMIN';
      const order = await OrderService.getOrderByNumber(orderNumber, req.user.userId, isAdmin);

      res.status(HTTP_STATUS.OK).json({
        data: order,
      });
    } catch (error: any) {
      logger.error('Get order by number error:', error);

      if (error.message === ERROR_MESSAGES.ORDER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get order',
      });
    }
  }

  static async getUserOrders(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as any;

      const result = await OrderService.getUserOrders(req.user.userId, page, limit, status);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get user orders error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get orders',
      });
    }
  }

  static async getAllOrders(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const filters = {
        status: req.query.status as any,
        paymentStatus: req.query.paymentStatus as any,
        userId: req.query.userId as string,
        fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
        toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
      };

      const result = await OrderService.getAllOrders(page, limit, filters);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get all orders error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get orders',
      });
    }
  }

  static async updateOrderStatus(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { orderId } = req.params;
      const { status, reason } = req.body;
      const isAdmin = req.user.role === 'ADMIN';

      const order = await OrderService.updateOrderStatus(
        orderId,
        status,
        req.user.userId,
        isAdmin,
        reason
      );

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.ORDER_UPDATED,
        data: order,
      });
    } catch (error: any) {
      logger.error('Update order status error:', error);

      if (error.message === ERROR_MESSAGES.ORDER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.INVALID_ORDER_STATUS) {
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
        error: 'Failed to update order status',
      });
    }
  }

  static async cancelOrder(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { orderId } = req.params;
      const { reason } = req.body;

      const order = await OrderService.cancelOrder(orderId, req.user.userId, reason);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.ORDER_CANCELLED,
        data: order,
      });
    } catch (error: any) {
      logger.error('Cancel order error:', error);

      if (error.message === ERROR_MESSAGES.ORDER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.ORDER_ALREADY_PROCESSED) {
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
        error: 'Failed to cancel order',
      });
    }
  }

  static async getOrderStats(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      const stats = await OrderService.getOrderStats();

      res.status(HTTP_STATUS.OK).json({
        data: stats,
      });
    } catch (error: any) {
      logger.error('Get order stats error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get order statistics',
      });
    }
  }

  // ==================== Analytics ====================
  static async getAnalytics(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const result = await OrderService.getOrderAnalytics();

      res.status(HTTP_STATUS.OK).json({
        message: 'Order analytics retrieved successfully',
        data: result,
      });
    } catch (error: any) {
      logger.error('Get order analytics error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to retrieve analytics',
      });
    }
  }

  // ==================== Payment Webhook ====================

  static async handlePaymentWebhook(req: Request, res: Response) {
    try {
      const { orderId, status } = req.body;

      if (!orderId || !status) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'orderId and status are required',
        });
      }

      const order = await OrderService.handlePaymentWebhook(orderId, status);

      res.status(HTTP_STATUS.OK).json({
        message: `Order updated to ${status}`,
        data: { id: order.id, status: order.status, paymentStatus: order.paymentStatus },
      });
    } catch (error: any) {
      logger.error('Payment webhook handler error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to process payment webhook',
      });
    }
  }

  static async healthCheck(req: AuthRequest, res: Response) {
    const health = await OrderService.healthCheck();
    const statusCode = health.database === 'connected'
      ? HTTP_STATUS.OK
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;

    res.status(statusCode).json(health);
  }
}
