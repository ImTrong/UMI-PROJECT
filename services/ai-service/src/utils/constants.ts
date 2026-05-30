export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  CONVERSATION_NOT_FOUND: 'Conversation not found',
  MESSAGE_REQUIRED: 'Message content is required',
  CONVERSATION_ID_REQUIRED: 'Conversation ID is required',
  TITLE_REQUIRED: 'Title is required',
  AI_SERVICE_ERROR: 'AI service encountered an error',
  GEMINI_API_ERROR: 'Failed to communicate with Gemini API',
  RATE_LIMIT_EXCEEDED: 'Too many requests, please try again later',
} as const;

export const SUCCESS_MESSAGES = {
  CONVERSATION_CREATED: 'Conversation created successfully',
  CONVERSATION_DELETED: 'Conversation deleted successfully',
  CONVERSATION_RENAMED: 'Conversation renamed successfully',
  MESSAGE_SENT: 'Message sent successfully',
  CONVERSATIONS_RETRIEVED: 'Conversations retrieved successfully',
  CONVERSATION_RETRIEVED: 'Conversation retrieved successfully',
} as const;
