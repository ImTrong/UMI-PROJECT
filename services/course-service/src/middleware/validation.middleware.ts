import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { HTTP_STATUS } from '../utils/constants';
import { disallowedFields, isPlainObject } from '../utils/course-fields';

/**
 * Refuses (400, before anything is read or written) a body that is not a JSON object or that carries a field outside
 * `allowed` (FIX-INS-02). The writers filter again with the same allowlist, so this is the explicit answer to the client.
 * The answer uses `error` (a string) like the other refusals of this service, so the frontend toast shows it.
 */
export const allowOnlyFields = (allowed: readonly string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body === undefined ? {} : req.body;
    if (!isPlainObject(payload)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Request body must be a JSON object' });
    }
    const extra = disallowedFields(payload, allowed);
    if (extra.length > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `Fields not allowed: ${extra.slice(0, 10).join(', ')}`,
        fields: extra.slice(0, 10),
      });
    }
    next();
  };

// express-validator applies a validator to each ELEMENT of an array value, so types are checked explicitly.
const isString = (v: unknown) => typeof v === 'string';
const isPrice = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '');
const isStringList = (v: unknown) =>
  Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'string' && x.length <= 500);

// Optional course fields shared by create and update (the required ones are checked in each list below).
const courseOptionalFields = [
  body('thumbnail')
    .optional({ values: 'null' })
    .custom(isString).withMessage('Thumbnail must be a string')
    .isLength({ max: 2048 }).withMessage('Thumbnail must be at most 2048 characters'),
  body('language')
    .optional()
    .custom(isString).withMessage('Language must be a string')
    .isLength({ max: 50 }).withMessage('Language must be at most 50 characters'),
  body('whatYouWillLearn')
    .optional({ values: 'null' })
    .custom(isString).withMessage('whatYouWillLearn must be a string')
    .isLength({ max: 5000 }).withMessage('whatYouWillLearn must be at most 5000 characters'),
  body('requirements')
    .optional()
    .custom(isStringList).withMessage('requirements must be a list of at most 50 strings'),
  body('targetAudience')
    .optional()
    .custom(isStringList).withMessage('targetAudience must be a list of at most 50 strings'),
  body('certificateConfig')
    .optional({ values: 'null' })
    .custom((v) => isPlainObject(v) && JSON.stringify(v).length <= 4096)
    .withMessage('certificateConfig must be an object of at most 4 KB'),
];

export const validateCreateCourse = [
  body('title')
    .custom(isString).withMessage('Title must be a string')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .custom(isString).withMessage('Description must be a string')
    .trim()
    .notEmpty()
    .withMessage('Description is required')
    .isLength({ min: 10, max: 5000 })
    .withMessage('Description must be between 10 and 5000 characters'),
  body('price')
    .custom(isPrice).withMessage('Price must be a positive number')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('level')
    .optional()
    .custom(isString).withMessage('Invalid level')
    .isIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
    .withMessage('Invalid level'),
  body('categoryId')
    .optional()
    .custom(isString).withMessage('Invalid category ID')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid category ID'),
  ...courseOptionalFields,
];

export const validateUpdateCourse = [
  body('title')
    .optional()
    .custom(isString).withMessage('Title must be a string')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .optional()
    .custom(isString).withMessage('Description must be a string')
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Description must be between 10 and 5000 characters'),
  body('price')
    .optional()
    .custom(isPrice).withMessage('Price must be a positive number')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('level')
    .optional()
    .custom(isString).withMessage('Invalid level')
    .isIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
    .withMessage('Invalid level'),
  // the edit page sends the stored value back: null / '' clear the category (as the service already did)
  body('categoryId')
    .optional({ values: 'falsy' })
    .custom(isString).withMessage('Invalid category ID')
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage('Invalid category ID'),
  ...courseOptionalFields,
];

export const validateCreateLesson = [
  body('title')
    .custom(isString).withMessage('Title must be a string')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('videoUrl')
    .custom(isString).withMessage('Video URL must be a string')
    .trim()
    .notEmpty()
    .withMessage('Video URL is required'),
  body('duration')
    .custom((v) => typeof v === 'number' || typeof v === 'string').withMessage('Duration must be a positive integer')
    .isInt({ min: 1 })
    .withMessage('Duration must be a positive integer'),
  body('order')
    .optional()
    .custom((v) => Number.isInteger(v)).withMessage('Order must be a non-negative integer')
    .isInt({ min: 0 })
    .withMessage('Order must be a non-negative integer'),
  body('description')
    .optional({ values: 'null' })
    .custom(isString).withMessage('Description must be a string')
    .isLength({ max: 5000 }).withMessage('Description must be at most 5000 characters'),
  body('isPreview')
    .optional()
    .custom((v) => typeof v === 'boolean').withMessage('isPreview must be a boolean'),
  body('resources')
    .optional()
    .custom((v) => Array.isArray(v) && JSON.stringify(v).length <= 16384)
    .withMessage('resources must be a list of at most 16 KB'),
];

// POST /:courseId/lessons/reorder: [{ id, order }] - every id is checked against the course in LessonService.reorderLessons.
export const validateReorderLessons = [
  body('lessonOrders')
    .custom((v) =>
      Array.isArray(v) && v.length > 0 && v.length <= 500 &&
      v.every((x) => isPlainObject(x) && Object.keys(x).every((k) => k === 'id' || k === 'order') &&
        typeof x.id === 'string' && /^[0-9a-fA-F]{24}$/.test(x.id) && Number.isInteger(x.order) && (x.order as number) >= 0))
    .withMessage('lessonOrders must be a list of { id, order }'),
];

// POST /api/courses/recommendations/batch (learning-service only): bounded lists of ids, known levels / sort keys, small limit.
const isObjectIdList = (max: number) => (v: unknown) =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && /^[0-9a-fA-F]{24}$/.test(x));
export const validateRecommendationBatch = [
  body('categoryIds').optional().custom(isObjectIdList(100)).withMessage('categoryIds must be a list of at most 100 ids'),
  body('excludeIds').optional().custom(isObjectIdList(500)).withMessage('excludeIds must be a list of at most 500 ids'),
  body('levels')
    .optional()
    .custom((v) => Array.isArray(v) && v.length <= 3 && v.every((x) => ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].includes(x)))
    .withMessage('levels must be a list of course levels'),
  body('sortBy').optional().custom((v) => v === 'rating' || v === 'enrolledCount' || v === 'newest').withMessage('Invalid sortBy'),
  body('limit').optional().custom((v) => Number.isInteger(v) && v >= 1 && v <= 100).withMessage('limit must be an integer between 1 and 100'),
];

// POST /:courseId/upload-url
export const validateUploadUrl = [
  body('fileName')
    .custom(isString).withMessage('File name and content type are required')
    .isLength({ min: 1, max: 255 }).withMessage('File name must be 1-255 characters'),
  body('contentType')
    .custom(isString).withMessage('File name and content type are required')
    .isLength({ min: 1, max: 255 }).withMessage('Content type must be 1-255 characters'),
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
