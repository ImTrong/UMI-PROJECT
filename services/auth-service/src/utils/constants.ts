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
  EMAIL_EXISTS: 'Email already registered',
  INVALID_CREDENTIALS: 'Invalid email or password',
  USER_NOT_FOUND: 'User not found',
  TOKEN_EXPIRED: 'Token has expired',
  TOKEN_INVALID: 'Invalid token',
  TOKEN_MISSING: 'Authentication token missing',
  ACCOUNT_DISABLED: 'Account has been disabled',
  EMAIL_NOT_VERIFIED: 'Email not verified',
  RATE_LIMIT_EXCEEDED: 'Too many requests, please try again later',
} as const;

export const SUCCESS_MESSAGES = {
  REGISTER_SUCCESS: 'User registered successfully',
  LOGIN_SUCCESS: 'Login successful',
  LOGOUT_SUCCESS: 'Logout successful',
  TOKEN_REFRESHED: 'Token refreshed successfully',
  TOKEN_VERIFIED: 'Token verified successfully',
} as const;
