import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { HTTP_STATUS } from '../utils/constants';
import { disallowedFields, isPlainObject } from '../utils/profile-fields';

/**
 * Refuses (400, before anything is written) a body that is not a JSON object or that carries a field outside `allowed`.
 * The writer filters again with the same allowlist, so this is the explicit answer to the client, not the only guard.
 */
export const allowOnlyFields = (allowed: readonly string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!isPlainObject(req.body)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Request body must be a JSON object' });
    }
    const extra = disallowedFields(req.body, allowed);
    if (extra.length > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `Fields not allowed: ${extra.slice(0, 10).join(', ')}`,
        fields: extra.slice(0, 10),
      });
    }
    next();
  };

// PUT /api/users/me: profile fields only - no role, isActive, email, userId...
// `typeof` checks are explicit because express-validator applies a string validator to each ELEMENT of an array value.
const isString = (v: unknown) => typeof v === 'string';

export const validateUpdateMyProfile = [
  body('fullName')
    .optional()
    .custom(isString).withMessage('Full name must be a string')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  body('avatar')
    .optional()
    .custom(isString).withMessage('Avatar must be a string')
    .isLength({ max: 2048 })
    .withMessage('Avatar must be at most 2048 characters'),
  body('bio')
    .optional()
    .custom(isString).withMessage('Bio must be a string')
    .isLength({ max: 500 })
    .withMessage('Bio must be less than 500 characters'),
  body('phoneNumber')
    .optional()
    .custom(isString).withMessage('Phone number must be a string')
    .matches(/^[0-9+\-\s]+$/)
    .withMessage('Invalid phone number format'),
  body('address')
    .optional()
    .custom(isString).withMessage('Address must be a string')
    .isLength({ max: 255 })
    .withMessage('Address must be less than 255 characters'),
  body('dateOfBirth')
    .optional({ checkFalsy: true }) // Allows empty string to be treated as optional
    .custom(isString).withMessage('Date of birth must be a string')
    .isISO8601()
    .withMessage('Invalid date of birth format. Must be a valid date.'),
  body('preferences')
    .optional()
    .custom((value) => isPlainObject(value) && JSON.stringify(value).length <= 4096)
    .withMessage('Preferences must be an object of at most 4 KB'),
];

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
    .custom((v) => typeof v === 'string' && ['STUDENT', 'INSTRUCTOR', 'ADMIN'].includes(v))
    .withMessage('Invalid role'),
  body('isActive')
    .optional()
    .custom((v) => typeof v === 'boolean')
    .withMessage('isActive must be a boolean'),
  body('dateOfBirth')
    .optional({ checkFalsy: true }) // Allows empty string to be treated as optional
    .isISO8601()
    .withMessage('Invalid date of birth format. Must be a valid date.'),
];

// PUT /api/users/:userId (ADMIN): the self-service fields plus role and isActive, every one type-checked.
export const validateAdminUpdateUser = [
  ...validateUpdateMyProfile,
  body('role')
    .optional()
    .custom((v) => typeof v === 'string' && ['STUDENT', 'INSTRUCTOR', 'ADMIN'].includes(v))
    .withMessage('Invalid role'),
  body('isActive')
    .optional()
    .custom((v) => typeof v === 'boolean')
    .withMessage('isActive must be a boolean'),
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
