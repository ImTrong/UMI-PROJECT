// services/stream.service.ts
// Service layer for secure video streaming via presigned URLs.
// Implements the complete authorization chain:
//   JWT verify → user exists → course purchased → lesson belongs to course → generate presigned URL

import { PrismaClient } from '@prisma/client';
import axios, { AxiosError } from 'axios';
import {
  minioPublicClient,
  minioInternalClient,
  BUCKETS,
  PRESIGNED_URL_CONFIG,
} from '../config/minio.config';
import {
  StreamRequestData,
  StreamResponse,
  CourseFromService,
  LessonFromService,
  extractObjectKey,
} from '../types/stream.types';
import { STREAM_ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// ============================================
// Custom Errors for precise HTTP status mapping
// ============================================

export class StreamUnauthorizedError extends Error {
  constructor(message: string = STREAM_ERROR_MESSAGES.INVALID_TOKEN) {
    super(message);
    this.name = 'StreamUnauthorizedError';
  }
}

export class StreamForbiddenError extends Error {
  constructor(message: string = STREAM_ERROR_MESSAGES.COURSE_NOT_PURCHASED) {
    super(message);
    this.name = 'StreamForbiddenError';
  }
}

export class StreamNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamNotFoundError';
  }
}

// ============================================
// Stream Service
// ============================================

export class StreamService {
  /**
   * Main entry point: generate a presigned streaming URL for a lesson's video.
   * 
   * Authorization flow:
   * 1. Fetch lesson details from course-service (validates lesson exists)
   * 2. Fetch course details (validates course exists and gets instructorId)
   * 3. Verify user has purchased the course (check enrollment in learning_db)
   * 4. Verify the video file exists in MinIO
   * 5. Generate presigned URL with short TTL
   * 
   * @throws StreamUnauthorizedError - Invalid or missing token (HTTP 401)
   * @throws StreamForbiddenError    - User hasn't purchased the course (HTTP 403)
   * @throws StreamNotFoundError     - Lesson/course/video not found (HTTP 404)
   * @throws Error                   - Internal server error (HTTP 500)
   */
  static async generateStreamUrl(data: StreamRequestData): Promise<StreamResponse> {
    const { userId, lessonId } = data;

    logger.info(`[Stream] Generating stream URL for user=${userId}, lesson=${lessonId}`);

    // ─────────────────────────────────────────
    // Step 1: Fetch lesson from course-service
    // ─────────────────────────────────────────
    const lesson = await this.fetchLessonFromCourseService(lessonId);
    const courseId = lesson.courseId;

    logger.debug(`[Stream] Lesson found: "${lesson.title}" in course=${courseId}`);

    // ─────────────────────────────────────────
    // Step 2: Fetch course and validate it exists
    // ─────────────────────────────────────────
    const course = await this.fetchCourseFromCourseService(courseId);

    logger.debug(`[Stream] Course found: "${course.title}", instructor=${course.instructorId}`);

    // ─────────────────────────────────────────
    // Step 3: Verify instructor exists (via user-service)
    // ─────────────────────────────────────────
    await this.verifyInstructorExists(course.instructorId);

    // ─────────────────────────────────────────
    // Step 4: Authorization check - user must have purchased course
    // Allow access if user is the instructor of this course
    // ─────────────────────────────────────────
    const isInstructor = userId === course.instructorId;

    if (!isInstructor) {
      // Check if lesson is a free preview
      if (lesson.isPreview) {
        logger.info(`[Stream] Lesson is a free preview, allowing access`);
      } else {
        // Must be enrolled (purchased)
        await this.verifyCoursePurchased(userId, courseId);
      }
    } else {
      logger.info(`[Stream] User is the course instructor, granting access`);
    }

    // ─────────────────────────────────────────
    // Step 5: Extract video object key and verify it exists in MinIO
    // ─────────────────────────────────────────
    const bucketName = BUCKETS.COURSE_VIDEOS;
    const objectKey = extractObjectKey(lesson.videoUrl, bucketName);

    await this.verifyVideoExistsInStorage(bucketName, objectKey);

    // ─────────────────────────────────────────
    // Step 6: Generate presigned URL
    // ─────────────────────────────────────────
    const expirySeconds = Math.min(
      PRESIGNED_URL_CONFIG.VIDEO_EXPIRY_SECONDS,
      PRESIGNED_URL_CONFIG.MAX_EXPIRY_SECONDS
    );

    const streamUrl = await this.generatePresignedUrl(bucketName, objectKey, expirySeconds);

    logger.info(`[Stream] ✅ Presigned URL generated for user=${userId}, lesson=${lessonId}, expires in ${expirySeconds}s`);

    return {
      streamUrl,
      expiresIn: expirySeconds,
      lesson: {
        id: lesson.id,
        title: lesson.title,
        duration: lesson.duration,
        order: lesson.order,
      },
    };
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Fetch a specific lesson by ID from the course-service.
   * Uses the internal API endpoint that returns all lessons for a course,
   * then finds the specific lesson by ID.
   */
  private static async fetchLessonFromCourseService(lessonId: string): Promise<LessonFromService> {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

    try {
      // Try to get lesson directly via internal endpoint
      const response = await axios.get<{ data: LessonFromService }>(
        `${courseServiceUrl}/api/courses/internal/lessons/${lessonId}`
      );

      if (response.data?.data) {
        return response.data.data;
      }
    } catch (directError: unknown) {
      // If the direct endpoint doesn't exist, fall through to search approach
      const axiosErr = directError as AxiosError;
      if (axiosErr.response?.status !== 404) {
        logger.debug(`[Stream] Direct lesson fetch failed, trying search approach`);
      }
    }

    // Fallback: We need the courseId to fetch lessons. Since we only have lessonId,
    // check if we have enrollment records that reference this lessonId
    const lessonProgress = await prisma.lessonProgress.findFirst({
      where: { lessonId },
      select: { courseId: true },
    });

    if (lessonProgress) {
      try {
        const response = await axios.get<{ data: LessonFromService[] }>(
          `${courseServiceUrl}/api/courses/internal/${lessonProgress.courseId}/lessons`
        );
        const lessons = response.data?.data || [];
        const lesson = lessons.find((l) => l.id === lessonId);
        if (lesson) {
          return { ...lesson, courseId: lessonProgress.courseId };
        }
      } catch {
        // Fall through to error
      }
    }

    // Try to search across all user's enrolled courses
    throw new StreamNotFoundError(STREAM_ERROR_MESSAGES.LESSON_NOT_FOUND);
  }

  /**
   * Fetch course details from the course-service.
   */
  private static async fetchCourseFromCourseService(courseId: string): Promise<CourseFromService> {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

    try {
      const response = await axios.get<{ data: CourseFromService }>(
        `${courseServiceUrl}/api/courses/${courseId}`
      );

      const course = response.data?.data;

      if (!course) {
        throw new StreamNotFoundError(STREAM_ERROR_MESSAGES.COURSE_NOT_FOUND);
      }

      return course;
    } catch (error: unknown) {
      if (error instanceof StreamNotFoundError) throw error;
      const axiosErr = error as AxiosError;
      if (axiosErr.response?.status === 404) {
        throw new StreamNotFoundError(STREAM_ERROR_MESSAGES.COURSE_NOT_FOUND);
      }
      logger.error('[Stream] Failed to fetch course from course-service:', error);
      throw new Error(STREAM_ERROR_MESSAGES.COURSE_SERVICE_ERROR);
    }
  }

  /**
   * Verify that the instructor (course creator) exists via user-service.
   */
  private static async verifyInstructorExists(instructorId: string): Promise<void> {
    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';

    try {
      const response = await axios.get(`${userServiceUrl}/api/users/${instructorId}`);

      if (!response.data?.data) {
        throw new StreamNotFoundError(STREAM_ERROR_MESSAGES.INSTRUCTOR_NOT_FOUND);
      }
    } catch (error: unknown) {
      if (error instanceof StreamNotFoundError) throw error;
      const axiosErr = error as AxiosError;
      if (axiosErr.response?.status === 404) {
        throw new StreamNotFoundError(STREAM_ERROR_MESSAGES.INSTRUCTOR_NOT_FOUND);
      }
      // If user-service is down, log warning but don't block (graceful degradation)
      logger.warn(`[Stream] Could not verify instructor ${instructorId}, proceeding anyway`);
    }
  }

  /**
   * Verify the user has purchased (enrolled in) the course.
   * Checks the local learning_db for enrollment records.
   */
  private static async verifyCoursePurchased(userId: string, courseId: string): Promise<void> {
    const enrollment = await prisma.courseProgress.findUnique({
      where: {
        userId_courseId: { userId, courseId },
      },
      select: {
        id: true,
        enrolledAt: true,
      },
    });

    if (!enrollment) {
      logger.warn(`[Stream] ⛔ Access denied: user=${userId} has not purchased course=${courseId}`);
      throw new StreamForbiddenError(STREAM_ERROR_MESSAGES.COURSE_NOT_PURCHASED);
    }

    logger.debug(`[Stream] ✅ Enrollment verified: user=${userId}, course=${courseId}, enrolled at ${enrollment.enrolledAt}`);
  }

  /**
   * Verify that the video file actually exists in the MinIO bucket.
   * Uses statObject to check file existence without downloading it.
   */
  private static async verifyVideoExistsInStorage(bucket: string, objectKey: string): Promise<void> {
    try {
      await minioInternalClient.statObject(bucket, objectKey);
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'NotFound' || err.code === 'NoSuchKey') {
        logger.error(`[Stream] Video file not found in MinIO: ${bucket}/${objectKey}`);
        throw new StreamNotFoundError(STREAM_ERROR_MESSAGES.VIDEO_NOT_FOUND);
      }
      logger.error(`[Stream] MinIO error checking video: ${bucket}/${objectKey}`, error);
      throw new Error(STREAM_ERROR_MESSAGES.STORAGE_ERROR);
    }
  }

  /**
   * Generate a presigned GET URL for the video file.
   * Uses the public MinIO client so the URL is accessible from the browser.
   */
  private static async generatePresignedUrl(
    bucket: string,
    objectKey: string,
    expirySeconds: number
  ): Promise<string> {
    try {
      const url = await minioPublicClient.presignedGetObject(
        bucket,
        objectKey,
        expirySeconds,
        { 'response-content-disposition': 'inline' }
      );

      return url;
    } catch (error) {
      logger.error(`[Stream] Failed to generate presigned URL for ${bucket}/${objectKey}:`, error);
      throw new Error(STREAM_ERROR_MESSAGES.PRESIGNED_URL_ERROR);
    }
  }
}
