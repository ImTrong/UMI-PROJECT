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
  USER_ALREADY_EXISTS: 'User profile already exists',
  EMAIL_ALREADY_EXISTS: 'Email already exists',
  INVALID_USER_ID: 'Invalid user ID',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  EDUCATION_NOT_FOUND: 'Education record not found',
  WORK_EXPERIENCE_NOT_FOUND: 'Work experience not found',
  INVALID_DATA: 'Invalid data provided',
} as const;

export const SUCCESS_MESSAGES = {
  USER_CREATED: 'User profile created successfully',
  USER_UPDATED: 'User profile updated successfully',
  USER_DELETED: 'User profile deleted successfully',
  EDUCATION_ADDED: 'Education background added successfully',
  EDUCATION_UPDATED: 'Education background updated successfully',
  EDUCATION_DELETED: 'Education background deleted successfully',
  WORK_ADDED: 'Work experience added successfully',
  WORK_UPDATED: 'Work experience updated successfully',
  WORK_DELETED: 'Work experience deleted successfully',
} as const;

export const USER_ROLES = {
  STUDENT: 'STUDENT',
  INSTRUCTOR: 'INSTRUCTOR',
  ADMIN: 'ADMIN',
} as const;
