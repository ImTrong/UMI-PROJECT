// services/hls-queue.service.ts
// In-memory queue for video processing jobs with persistence via MongoDB.
// Processes jobs sequentially to avoid overloading FFmpeg on a single node.
// For production multi-node scaling, replace with Redis/Bull/BullMQ.

import { PrismaClient } from '@prisma/client';
import { HLSProcessorService } from './hls-processor.service';
import {
  VideoProcessJobData,
  VideoProcessingStatus,
} from '../types/hls.types';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// ============================================
// Queue Item Type
// ============================================

interface QueueItem {
  jobId: string;
  data: VideoProcessJobData;
  retries: number;
}

// ============================================
// HLS Queue Service
// ============================================

export class HLSQueueService {
  /** In-memory job queue */
  private static queue: QueueItem[] = [];
  /** Whether the queue processor is currently running */
  private static isProcessing = false;
  /** Maximum retry attempts for failed jobs */
  private static readonly MAX_RETRIES = 2;

  /**
   * Add a video processing job to the queue.
   * Creates a database record and enqueues for processing.
   *
   * @returns The job ID for status polling
   */
  static async enqueue(data: VideoProcessJobData): Promise<string> {
    // Create job record in database
    const job = await prisma.videoProcessingJob.create({
      data: {
        lessonId: data.lessonId,
        courseId: data.courseId,
        inputFilePath: data.inputFilePath,
        originalFileName: data.originalFileName,
        uploadedBy: data.uploadedBy,
        status: VideoProcessingStatus.PENDING,
      },
    });

    logger.info(`[HLSQueue] Job created: ${job.id} for lesson=${data.lessonId}`);

    // Add to in-memory queue
    this.queue.push({
      jobId: job.id,
      data,
      retries: 0,
    });

    // Start processing if not already running
    this.processNext();

    return job.id;
  }

  /**
   * Get the current status of a processing job.
   */
  static async getJobStatus(jobId: string) {
    const job = await prisma.videoProcessingJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return null;
    }

    return {
      jobId: job.id,
      status: job.status,
      hlsPath: job.hlsPath,
      segmentCount: job.segmentCount,
      durationSeconds: job.durationSeconds,
      error: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  /**
   * Process the next item in the queue.
   * Runs sequentially — one job at a time to avoid resource contention.
   */
  private static async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift()!;

    try {
      // Update status to PROCESSING
      await prisma.videoProcessingJob.update({
        where: { id: item.jobId },
        data: { status: VideoProcessingStatus.PROCESSING },
      });

      logger.info(`[HLSQueue] Processing job: ${item.jobId}`);

      // Run the actual FFmpeg + MinIO upload
      const result = await HLSProcessorService.processVideo(item.data);

      // Update job as COMPLETED with results
      await prisma.videoProcessingJob.update({
        where: { id: item.jobId },
        data: {
          status: VideoProcessingStatus.COMPLETED,
          hlsPath: result.hlsPath,
          segmentCount: result.segmentCount,
          durationSeconds: result.durationSeconds,
          totalSizeBytes: result.totalSizeBytes,
        },
      });

      // Update the lesson's videoUrl in course-service to point to HLS
      await this.updateLessonHLSPath(
        item.data.courseId,
        item.data.lessonId,
        result.hlsPath,
        result.durationSeconds
      );

      logger.info(`[HLSQueue] ✅ Job completed: ${item.jobId}`);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`[HLSQueue] ❌ Job failed: ${item.jobId}`, err);

      // Retry logic
      if (item.retries < this.MAX_RETRIES) {
        item.retries++;
        logger.info(`[HLSQueue] Retrying job ${item.jobId} (attempt ${item.retries + 1}/${this.MAX_RETRIES + 1})`);
        this.queue.push(item);

        await prisma.videoProcessingJob.update({
          where: { id: item.jobId },
          data: {
            status: VideoProcessingStatus.PENDING,
            errorMessage: `Retry ${item.retries}: ${err.message}`,
          },
        });
      } else {
        // Max retries exceeded — mark as FAILED
        await prisma.videoProcessingJob.update({
          where: { id: item.jobId },
          data: {
            status: VideoProcessingStatus.FAILED,
            errorMessage: err.message,
          },
        });
      }
    } finally {
      this.isProcessing = false;
      // Process next job in queue
      if (this.queue.length > 0) {
        // Use setImmediate to avoid blocking the event loop
        setImmediate(() => this.processNext());
      }
    }
  }

  /**
   * Notify course-service to update the lesson's videoUrl with the HLS path.
   * This is an internal service-to-service call.
   */
  private static async updateLessonHLSPath(
    courseId: string,
    lessonId: string,
    hlsPath: string,
    durationSeconds: number
  ): Promise<void> {
    try {
      const axios = (await import('axios')).default;
      const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

      // Use internal API to update lesson
      await axios.put(
        `${courseServiceUrl}/api/courses/internal/${courseId}/lessons/${lessonId}`,
        {
          videoUrl: hlsPath,
          duration: durationSeconds,
        }
      );

      logger.info(`[HLSQueue] Updated lesson videoUrl: ${hlsPath}`);
    } catch (error) {
      // Log but don't fail the job — HLS files are already in MinIO
      logger.warn(`[HLSQueue] Could not update lesson videoUrl in course-service:`, error);
    }
  }

  /**
   * Resume any pending/processing jobs from the database on service restart.
   * Call this once during service initialization.
   */
  static async resumePendingJobs(): Promise<void> {
    try {
      const pendingJobs = await prisma.videoProcessingJob.findMany({
        where: {
          status: {
            in: [VideoProcessingStatus.PENDING, VideoProcessingStatus.PROCESSING],
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (pendingJobs.length === 0) {
        logger.info('[HLSQueue] No pending jobs to resume');
        return;
      }

      logger.info(`[HLSQueue] Resuming ${pendingJobs.length} pending jobs`);

      for (const job of pendingJobs) {
        // Only re-enqueue if input file still exists
        const inputExists = await import('fs').then((fs) =>
          fs.existsSync(job.inputFilePath)
        );

        if (inputExists) {
          this.queue.push({
            jobId: job.id,
            data: {
              inputFilePath: job.inputFilePath,
              courseId: job.courseId,
              lessonId: job.lessonId,
              originalFileName: job.originalFileName,
              uploadedBy: job.uploadedBy,
            },
            retries: 0,
          });
        } else {
          // Input file was lost (e.g., container restart) — mark as failed
          await prisma.videoProcessingJob.update({
            where: { id: job.id },
            data: {
              status: VideoProcessingStatus.FAILED,
              errorMessage: 'Input file not found after service restart. Please re-upload.',
            },
          });
          logger.warn(`[HLSQueue] Job ${job.id} failed: input file missing after restart`);
        }
      }

      // Start processing
      this.processNext();
    } catch (error) {
      logger.error('[HLSQueue] Failed to resume pending jobs:', error);
    }
  }
}
