// services/hls-stream.service.ts
// Service for streaming HLS content via presigned URLs.
// Handles the authorization chain and generates signed URLs for .m3u8 playlists.

import { PrismaClient } from '@prisma/client';
import axios, { AxiosError } from 'axios';
import {
  minioPublicClient,
  minioInternalClient,
  BUCKETS,
  PRESIGNED_URL_CONFIG,
} from '../config/minio.config';
import {
  HLSStreamResponse,
  VideoProcessingStatus,
} from '../types/hls.types';
import {
  CourseFromService,
  LessonFromService,
} from '../types/stream.types';
import {
  StreamForbiddenError,
  StreamNotFoundError,
} from './stream.service';
import { STREAM_ERROR_MESSAGES } from '../utils/constants';
import { HLS_ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// ============================================
// HLS Stream Service
// ============================================

export class HLSStreamService {
  /**
   * Generate a presigned URL for the HLS master.m3u8 playlist.
   *
   * Authorization chain (same as stream.service.ts):
   * 1. User already authenticated via middleware
   * 2. Fetch lesson → get courseId
   * 3. Verify course exists
   * 4. Check if user purchased course (or is instructor / preview lesson)
   * 5. Check if HLS processing is complete
   * 6. Generate presigned URL for master.m3u8
   * 7. Also generate presigned URLs for all .ts segments
   *    (needed because HLS player fetches segments referenced in .m3u8)
   */
  static async generateHLSStreamUrl(
    userId: string,
    lessonId: string,
    ip: string,
    userAgent: string
  ): Promise<HLSStreamResponse> {
    logger.info(`[HLS-Stream] Generating HLS URL for user=${userId}, lesson=${lessonId}`);

    // ── Step 1: Fetch lesson from course-service ──
    const lesson = await this.fetchLesson(lessonId);
    const courseId = lesson.courseId;

    // ── Step 2: Fetch course ──
    const course = await this.fetchCourse(courseId);

    // ── Step 3: Authorization ──
    const isInstructor = userId === course.instructorId;
    if (!isInstructor && !lesson.isPreview) {
      await this.verifyPurchased(userId, courseId);
    }

    // ── Step 4: Check HLS readiness ──
    const hlsPrefix = `${courseId}/${lessonId}`;
    const playlistKey = `${hlsPrefix}/master.m3u8`;
    const hlsReady = await this.checkHLSExists(playlistKey);

    if (!hlsReady) {
      const job = await prisma.videoProcessingJob.findFirst({
        where: { lessonId, courseId },
        orderBy: { createdAt: 'desc' },
      });

      if (job && job.status === VideoProcessingStatus.PROCESSING) {
        return {
          streamUrl: '',
          expiresIn: 0,
          lesson: {
            id: lesson.id,
            title: lesson.title,
            duration: lesson.duration,
            order: lesson.order,
          },
          hls: { ready: false, segmentCount: 0 },
        };
      }

      if (job && job.status === VideoProcessingStatus.FAILED) {
        throw new StreamNotFoundError(HLS_ERROR_MESSAGES.PROCESSING_FAILED);
      }
      throw new StreamNotFoundError(HLS_ERROR_MESSAGES.HLS_NOT_READY);
    }

    // ── Step 5: Generate Stream Token ──
    const { StreamTokenService } = require('./stream-token.service');
    const streamToken = StreamTokenService.generateToken({
      userId,
      lessonId,
      courseId,
      ip,
      userAgent,
    });

    const streamUrl = `/api/learning/lessons/${lessonId}/hls/playlist?courseId=${courseId}&streamToken=${streamToken}`;
    const segmentCount = await this.countSegments(hlsPrefix);
    const expiresIn = 3 * 3600; // 3 hours in seconds

    logger.info(`[HLS-Stream] ✅ HLS Proxy URL generated for lesson=${lessonId}, segments=${segmentCount}`);

    return {
      streamUrl,
      expiresIn,
      lesson: {
        id: lesson.id,
        title: lesson.title,
        duration: lesson.duration,
        order: lesson.order,
      },
      hls: {
        ready: true,
        segmentCount,
      },
    };
  }

  /**
   * Generate presigned URLs for all .ts segments referenced in a playlist.
   * This is needed because the .m3u8 references relative .ts paths,
   * but those paths need to be presigned to access from private bucket.
   *
   * Alternative approach: rewrite the .m3u8 content to use presigned URLs.
   * This method generates a modified playlist with signed segment URLs.
   */
  static async generateSignedPlaylist(
    userId: string,
    lessonId: string,
    token: string
  ): Promise<{ playlist: string; contentType: string }> {
    logger.info(`[HLS-Stream] Generating signed playlist for lesson=${lessonId}`);

    // Authorization (same chain)
    const lesson = await this.fetchLesson(lessonId);
    const courseId = lesson.courseId;
    const course = await this.fetchCourse(courseId);

    const isInstructor = userId === course.instructorId;
    if (!isInstructor && !lesson.isPreview) {
      await this.verifyPurchased(userId, courseId);
    }

    const hlsPrefix = `${courseId}/${lessonId}`;
    const playlistKey = `${hlsPrefix}/master.m3u8`;
    const bucket = BUCKETS.COURSE_VIDEOS;

    // Read the original .m3u8 content from MinIO
    const originalPlaylist = await this.readFileFromMinIO(bucket, playlistKey);

    // Rewrite each .ts reference to the backend proxy stream URL
    const lines = originalPlaylist.split('\n');
    const rewrittenLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#EXT-X-KEY')) {
        // Rewrite the key URI to point to our proxy
        const keyUrl = `/api/learning/lessons/${lessonId}/hls/key?courseId=${courseId}&token=${token}`;
        const rewrittenKeyLine = line.replace(/URI="[^"]+"/, `URI="${keyUrl}"`);
        rewrittenLines.push(rewrittenKeyLine);
      } else if (trimmed.endsWith('.ts')) {
        // This is a segment reference — point it to our API proxy
        const signedUrl = `/api/learning/lessons/${lessonId}/hls/segment/${trimmed}?courseId=${courseId}&token=${token}`;
        rewrittenLines.push(signedUrl);
      } else {
        rewrittenLines.push(line);
      }
    }

    return {
      playlist: rewrittenLines.join('\n'),
      contentType: 'application/vnd.apple.mpegurl',
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  private static async fetchLesson(lessonId: string): Promise<LessonFromService> {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

    try {
      const response = await axios.get<{ data: LessonFromService }>(
        `${courseServiceUrl}/api/courses/internal/lessons/${lessonId}`
      );
      if (response.data?.data) return response.data.data;
    } catch {
      // Fall through
    }

    // Fallback: search via lesson progress
    const lessonProgress = await prisma.lessonProgress.findFirst({
      where: { lessonId },
      select: { courseId: true },
    });

    if (lessonProgress) {
      try {
        const response = await axios.get<{ data: LessonFromService[] }>(
          `${courseServiceUrl}/api/courses/internal/${lessonProgress.courseId}/lessons`
        );
        const lesson = response.data?.data?.find((l) => l.id === lessonId);
        if (lesson) return { ...lesson, courseId: lessonProgress.courseId };
      } catch {
        // Fall through
      }
    }

    throw new StreamNotFoundError(STREAM_ERROR_MESSAGES.LESSON_NOT_FOUND);
  }

  private static async fetchCourse(courseId: string): Promise<CourseFromService> {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

    try {
      const response = await axios.get<{ data: CourseFromService }>(
        `${courseServiceUrl}/api/courses/${courseId}`
      );
      if (response.data?.data) return response.data.data;
    } catch (error: unknown) {
      const axiosErr = error as AxiosError;
      if (axiosErr.response?.status === 404) {
        throw new StreamNotFoundError(STREAM_ERROR_MESSAGES.COURSE_NOT_FOUND);
      }
    }

    throw new StreamNotFoundError(STREAM_ERROR_MESSAGES.COURSE_NOT_FOUND);
  }

  private static async verifyPurchased(userId: string, courseId: string): Promise<void> {
    const enrollment = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { id: true },
    });

    if (!enrollment) {
      throw new StreamForbiddenError(STREAM_ERROR_MESSAGES.COURSE_NOT_PURCHASED);
    }
  }

  private static async checkHLSExists(playlistKey: string): Promise<boolean> {
    try {
      await minioInternalClient.statObject(BUCKETS.COURSE_VIDEOS, playlistKey);
      return true;
    } catch {
      return false;
    }
  }

  private static async countSegments(prefix: string): Promise<number> {
    let count = 0;
    const stream = minioInternalClient.listObjects(BUCKETS.COURSE_VIDEOS, prefix + '/', true);

    return new Promise((resolve) => {
      stream.on('data', (obj) => {
        if (obj.name?.endsWith('.ts')) count++;
      });
      stream.on('error', () => resolve(0));
      stream.on('end', () => resolve(count));
    });
  }

  private static async generatePresignedUrl(
    bucket: string,
    key: string,
    expirySeconds: number
  ): Promise<string> {
    try {
      return await minioPublicClient.presignedGetObject(bucket, key, expirySeconds);
    } catch (error) {
      logger.error(`[HLS-Stream] Failed to generate presigned URL for ${key}:`, error);
      throw new Error(STREAM_ERROR_MESSAGES.PRESIGNED_URL_ERROR);
    }
  }

  private static async readFileFromMinIO(bucket: string, key: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      minioInternalClient.getObject(bucket, key, (err, stream) => {
        if (err) return reject(err);
        stream.on('data', (chunk) => (data += chunk.toString()));
        stream.on('end', () => resolve(data));
        stream.on('error', reject);
      });
    });
  }
}
