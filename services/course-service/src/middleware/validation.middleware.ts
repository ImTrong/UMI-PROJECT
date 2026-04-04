import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { HTTP_STATUS } from '../utils/constants';

export const validateCreateCourse = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Description is required')
    .isLength({ min: 10, max: 5000 })
    .withMessage('Description must be between 10 and 5000 characters'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('level')
    .optional()
    .isIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
    .withMessage('Invalid level'),
  body('categoryId')
    .optional()
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid category ID'),
];

export const validateUpdateCourse = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Description must be between 10 and 5000 characters'),
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('level')
    .optional()
    .isIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
    .withMessage('Invalid level'),
];

export const validateCreateLesson = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('videoUrl')
    .trim()
    .notEmpty()
    .withMessage('Video URL is required')
    .isURL()
    .withMessage('Invalid video URL'),
  body('duration')
    .isInt({ min: 1 })
    .withMessage('Duration must be a positive integer'),
  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Order must be a non-negative integer'),
];

export const validateCreateReview = [
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Comment must be less than 1000 characters'),
];

export const validateCreateCategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Category name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Category name must be between 2 and 50 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
];

export const validateCourseId = [
  param('courseId')
    .notEmpty()
    .withMessage('Course ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid course ID format'),
];

export const validateLessonId = [
  param('lessonId')
    .notEmpty()
    .withMessage('Lesson ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid lesson ID format'),
];

export const validateReviewId = [
  param('reviewId')
    .notEmpty()
    .withMessage('Review ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid review ID format'),
];

export const validateCategoryId = [
  param('categoryId')
    .notEmpty()
    .withMessage('Category ID is required')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid category ID format'),
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
