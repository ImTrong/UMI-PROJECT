import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { HTTP_STATUS } from '../utils/constants';

export const validateLessonComplete = [
  param('courseId')
    .notEmpty()
    .withMessage('Course ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid course ID format'),
  param('lessonId')
    .notEmpty()
    .withMessage('Lesson ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid lesson ID format'),
  body('timeSpent')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Time spent must be a positive integer'),
];

export const validateUserId = [
  param('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid user ID format'),
];

export const validateCourseId = [
  param('courseId')
    .notEmpty()
    .withMessage('Course ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid course ID format'),
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
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({ errors: errors.array() });
    return;
  }
  next();
};
