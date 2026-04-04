import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { CartService } from '../services/cart.service';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class CartController {
  static async getCart(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const cart = await CartService.getCart(req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        data: cart,
      });
    } catch (error: any) {
      logger.error('Get cart error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get cart',
      });
    }
  }

  static async addToCart(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.body;
      const cart = await CartService.addToCart(req.user.userId, courseId);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.CART_ADDED,
        data: cart,
      });
    } catch (error: any) {
      logger.error('Add to cart error:', error);

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.COURSE_ALREADY_IN_CART) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to add to cart',
      });
    }
  }

  static async removeFromCart(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { courseId } = req.params;
      const cart = await CartService.removeFromCart(req.user.userId, courseId);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.CART_REMOVED,
        data: cart,
      });
    } catch (error: any) {
      logger.error('Remove from cart error:', error);

      if (error.message === ERROR_MESSAGES.CART_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.COURSE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to remove from cart',
      });
    }
  }

  static async clearCart(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const cart = await CartService.clearCart(req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.CART_CLEARED,
        data: cart,
      });
    } catch (error: any) {
      logger.error('Clear cart error:', error);

      if (error.message === ERROR_MESSAGES.CART_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to clear cart',
      });
    }
  }

  static async getCartTotal(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const total = await CartService.getCartTotal(req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        data: total,
      });
    } catch (error: any) {
      logger.error('Get cart total error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get cart total',
      });
    }
  }
}
