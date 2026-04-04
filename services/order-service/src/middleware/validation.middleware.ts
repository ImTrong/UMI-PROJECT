import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { HTTP_STATUS } from '../utils/constants';

export const validateAddToCart = [
  body('courseId')
    .notEmpty()
    .withMessage('Course ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid course ID format'),
];

export const validateCreateOrder = [
  body('items')
    .isArray()
    .withMessage('Items must be an array')
    .notEmpty()
    .withMessage('Order must have at least one item'),
  body('items.*.courseId')
    .notEmpty()
    .withMessage('Course ID is required'),
  body('items.*.price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('notes')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Notes must be less than 500 characters'),
];

export const validateUpdateOrderStatus = [
  param('orderId')
    .notEmpty()
    .withMessage('Order ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid order ID format'),
  body('status')
    .isIn(['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED'])
    .withMessage('Invalid order status'),
  body('reason')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Reason must be less than 500 characters'),
];

export const validateCancelOrder = [
  param('orderId')
    .notEmpty()
    .withMessage('Order ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid order ID format'),
  body('reason')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Reason must be less than 500 characters'),
];

export const validateOrderId = [
  param('orderId')
    .notEmpty()
    .withMessage('Order ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid order ID format'),
];

export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
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
