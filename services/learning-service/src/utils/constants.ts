export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const ERROR_MESSAGES = {
  USER_NOT_FOUND: 'User not found',
  COURSE_NOT_FOUND: 'Course not found',
  LESSON_NOT_FOUND: 'Lesson not found',
  PROGRESS_NOT_FOUND: 'Progress not found',
  CERTIFICATE_NOT_FOUND: 'Certificate not found',
  CERTIFICATE_ALREADY_EXISTS: 'Certificate already exists for this course',
  COURSE_NOT_COMPLETED: 'Course not completed yet',
  INVALID_ACTION: 'Invalid action',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  BADGE_NOT_FOUND: 'Badge not found',
} as const;

export const SUCCESS_MESSAGES = {
  LESSON_COMPLETED: 'Lesson marked as completed',
  COURSE_COMPLETED: 'Course completed successfully',
  CERTIFICATE_GENERATED: 'Certificate generated successfully',
  CERTIFICATE_VERIFIED: 'Certificate verified successfully',
  ACTIVITY_LOGGED: 'Activity logged successfully',
  BADGE_EARNED: 'Badge earned successfully',
} as const;
