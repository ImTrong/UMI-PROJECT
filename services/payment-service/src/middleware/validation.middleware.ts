import { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { HTTP_STATUS } from '../utils/constants';

export const validateCreatePaymentIntent = [
  body('orderId')
    .optional()
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid order ID format'),
  body('orderNumber')
    .optional()
    .isString(),
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  body('currency')
    .optional()
    .isString()
    .isLength({ min: 3, max: 3 })
    .withMessage('Currency must be 3 characters'),
];

export const validateConfirmPayment = [
  body('paymentIntentId')
    .notEmpty()
    .withMessage('Payment intent ID is required'),
  body('paymentMethodId')
    .notEmpty()
    .withMessage('Payment method ID is required'),
];

export const validateRefundPayment = [
  param('paymentId')
    .notEmpty()
    .withMessage('Payment ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid payment ID format'),
  body('amount')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  body('reason')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Reason must be less than 500 characters'),
];

export const validatePaymentId = [
  param('paymentId')
    .notEmpty()
    .withMessage('Payment ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid payment ID format'),
];

export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      errors: errors.array(),
    });
  }
  next();
};
