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

// ==================== Video Streaming Constants ====================

export const STREAM_ERROR_MESSAGES = {
  INVALID_TOKEN: 'Authentication required. Please login to access this content.',
  COURSE_NOT_PURCHASED: 'You must purchase this course to access the video content.',
  LESSON_NOT_FOUND: 'Lesson not found.',
  COURSE_NOT_FOUND: 'Course not found.',
  INSTRUCTOR_NOT_FOUND: 'Course instructor not found.',
  VIDEO_NOT_FOUND: 'Video file not found in storage.',
  INVALID_LESSON_ID: 'Invalid lesson ID format.',
  COURSE_SERVICE_ERROR: 'Failed to communicate with course service.',
  STORAGE_ERROR: 'Failed to access video storage.',
  PRESIGNED_URL_ERROR: 'Failed to generate video streaming URL.',
  PRESIGNED_URL_EXPIRED: 'Stream token has expired. Please refresh the video player.',
  INTERNAL_ERROR: 'An unexpected error occurred while processing your request.',
} as const;

export const STREAM_SUCCESS_MESSAGES = {
  STREAM_URL_GENERATED: 'Stream URL generated successfully.',
} as const;

// ==================== HLS Processing Constants ====================

export const HLS_ERROR_MESSAGES = {
  NO_VIDEO_FILE: 'No video file uploaded.',
  INVALID_VIDEO_FORMAT: 'Invalid video format. Supported: mp4, mov, avi, mkv, webm.',
  INVALID_COURSE_ID: 'Invalid course ID format.',
  INVALID_JOB_ID: 'Invalid job ID format.',
  JOB_NOT_FOUND: 'Video processing job not found.',
  HLS_NOT_READY: 'HLS video is not ready yet. The video may not have been processed.',
  PROCESSING_FAILED: 'Video processing failed. Please try re-uploading the video.',
  UPLOAD_SUCCESS: 'Video uploaded successfully. Processing started.',
  FFMPEG_NOT_FOUND: 'FFmpeg is not installed or not accessible.',
} as const;
