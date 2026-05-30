// types/stream.types.ts
// TypeScript types for the video streaming / presigned URL feature.

// ============================================
// Request Types
// ============================================

/** Parameters for the lesson stream endpoint */
export interface StreamLessonParams {
  lessonId: string;
}

/** Validated data passed from controller to service */
export interface StreamRequestData {
  userId: string;
  lessonId: string;
}

// ============================================
// Response Types
// ============================================

/** Successful stream response with presigned URL */
export interface StreamResponse {
  streamUrl: string;
  expiresIn: number;
  lesson: {
    id: string;
    title: string;
    duration: number;
    order: number;
  };
}

/** Error response format */
export interface StreamErrorResponse {
  error: string;
  code?: string;
}

// ============================================
// Service Internal Types
// ============================================

/** Course data returned from course-service */
export interface CourseFromService {
  id: string;
  title: string;
  description: string;
  instructorId: string;
  price: number;
  level: string;
  published: boolean;
}

/** Lesson data returned from course-service */
export interface LessonFromService {
  id: string;
  title: string;
  description?: string;
  videoUrl: string;
  duration: number;
  order: number;
  isPreview: boolean;
  courseId: string;
}

/** Enrollment check result from learning-service DB */
export interface EnrollmentCheckResult {
  isEnrolled: boolean;
  courseId: string;
  enrolledAt?: Date;
}

/** Presigned URL generation result */
export interface PresignedUrlResult {
  url: string;
  expiresInSeconds: number;
}

// ============================================
// Video File Key Utilities
// ============================================

/**
 * Extracts the MinIO object key from a full video URL.
 * 
 * The videoUrl stored in the Lesson model can be in various formats:
 * - Full URL:     http://minio:9000/course-videos/abc123.mp4
 * - Public URL:   http://localhost:9000/course-videos/abc123.mp4
 * - Bucket path:  course-videos/abc123.mp4
 * - Object key:   abc123.mp4
 * - Relative:     videos/section-1/lecture-1.mp4
 * 
 * This function normalizes all formats to just the object key.
 */
export function extractObjectKey(videoUrl: string, bucketName: string): string {
  if (!videoUrl) {
    throw new Error('Video URL is empty');
  }

  let objectKey = videoUrl;

  // If it's a full URL, extract the path after the bucket name
  try {
    const url = new URL(videoUrl);
    // Path will be like /course-videos/abc123.mp4
    objectKey = url.pathname;
  } catch {
    // Not a valid URL, treat as relative path
  }

  // Remove leading slash
  if (objectKey.startsWith('/')) {
    objectKey = objectKey.substring(1);
  }

  // Remove bucket name prefix if present
  if (objectKey.startsWith(`${bucketName}/`)) {
    objectKey = objectKey.substring(bucketName.length + 1);
  }

  if (!objectKey) {
    throw new Error('Could not extract object key from video URL');
  }

  return objectKey;
}
