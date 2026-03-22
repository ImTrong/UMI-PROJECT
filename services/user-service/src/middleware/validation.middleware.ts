import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { HTTP_STATUS } from '../utils/constants';

export const validateCreateUser = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email format'),
  body('fullName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  body('role')
    .optional()
    .isIn(['STUDENT', 'INSTRUCTOR', 'ADMIN'])
    .withMessage('Invalid role'),
];

export const validateUpdateUser = [
  body('fullName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  body('bio')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Bio must be less than 500 characters'),
  body('phoneNumber')
    .optional()
    .matches(/^[0-9+\-\s]+$/)
    .withMessage('Invalid phone number format'),
  body('role')
    .optional()
    .isIn(['STUDENT', 'INSTRUCTOR', 'ADMIN'])
    .withMessage('Invalid role'),
];

export const validateEducation = [
  body('institution')
    .trim()
    .notEmpty()
    .withMessage('Institution is required'),
  body('degree')
    .trim()
    .notEmpty()
    .withMessage('Degree is required'),
  body('fieldOfStudy')
    .trim()
    .notEmpty()
    .withMessage('Field of study is required'),
  body('startDate')
    .isISO8601()
    .withMessage('Invalid start date'),
  body('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date'),
];

export const validateWorkExperience = [
  body('company')
    .trim()
    .notEmpty()
    .withMessage('Company is required'),
  body('position')
    .trim()
    .notEmpty()
    .withMessage('Position is required'),
  body('startDate')
    .isISO8601()
    .withMessage('Invalid start date'),
  body('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date'),
  body('current')
    .optional()
    .isBoolean()
    .withMessage('Current must be boolean'),
];

export const validateUserId = [
  param('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid user ID format'),
];

export const validateId = [
  param('id')
    .notEmpty()
    .withMessage('ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid ID format'),
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
