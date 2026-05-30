// controllers/hls.controller.ts
// Controller for HLS video upload, processing, and streaming endpoints.

import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { HLSQueueService } from '../services/hls-queue.service';
import { HLSStreamService } from '../services/hls-stream.service';
import {
  StreamForbiddenError,
  StreamNotFoundError,
} from '../services/stream.service';
import { HTTP_STATUS, STREAM_ERROR_MESSAGES, HLS_ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

// MongoDB ObjectId validation regex
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export class HLSController {
  /**
   * POST /api/learning/lessons/:lessonId/upload-video
   *
   * Upload a video file for HLS processing.
   * Requires instructor or admin role.
   *
   * Body: multipart/form-data with 'video' field
   * Query: ?courseId=xxx (required)
   */
  static async uploadVideo(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: STREAM_ERROR_MESSAGES.INVALID_TOKEN,
        });
        return;
      }

      const { lessonId } = req.params;
      const courseId = req.query.courseId as string || req.body.courseId;

      // Validate params
      if (!lessonId || !OBJECT_ID_REGEX.test(lessonId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: STREAM_ERROR_MESSAGES.INVALID_LESSON_ID,
        });
        return;
      }

      if (!courseId || !OBJECT_ID_REGEX.test(courseId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: HLS_ERROR_MESSAGES.INVALID_COURSE_ID,
        });
        return;
      }

      // Check file uploaded
      const file = req.file;
      if (!file) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: HLS_ERROR_MESSAGES.NO_VIDEO_FILE,
        });
        return;
      }

      // Validate file type
      const allowedMimeTypes = [
        'video/mp4',
        'video/quicktime',
        'video/x-msvideo',
        'video/x-matroska',
        'video/webm',
      ];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: HLS_ERROR_MESSAGES.INVALID_VIDEO_FORMAT,
        });
        return;
      }

      // Enqueue for processing
      const jobId = await HLSQueueService.enqueue({
        inputFilePath: file.path,
        courseId,
        lessonId,
        originalFileName: file.originalname,
        uploadedBy: req.user.userId,
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: HLS_ERROR_MESSAGES.UPLOAD_SUCCESS,
        jobId,
        status: 'PENDING',
      });
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`[HLSController] Upload error: ${err.message}`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: STREAM_ERROR_MESSAGES.INTERNAL_ERROR,
      });
    }
  }

  /**
   * GET /api/learning/video-jobs/:jobId/status
   *
   * Get the status of a video processing job.
   */
  static async getJobStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: STREAM_ERROR_MESSAGES.INVALID_TOKEN,
        });
        return;
      }

      const { jobId } = req.params;
      if (!jobId || !OBJECT_ID_REGEX.test(jobId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: HLS_ERROR_MESSAGES.INVALID_JOB_ID,
        });
        return;
      }

      const status = await HLSQueueService.getJobStatus(jobId);
      if (!status) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          error: HLS_ERROR_MESSAGES.JOB_NOT_FOUND,
        });
        return;
      }

      res.status(HTTP_STATUS.OK).json(status);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`[HLSController] Job status error: ${err.message}`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: STREAM_ERROR_MESSAGES.INTERNAL_ERROR,
      });
    }
  }

  /**
   * GET /api/learning/lessons/:lessonId/hls
   *
   * Get a presigned URL for the HLS master.m3u8 playlist.
   * Same authorization chain as /stream endpoint.
   */
  static async getHLSStream(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: STREAM_ERROR_MESSAGES.INVALID_TOKEN,
        });
        return;
      }

      const { lessonId } = req.params;
      if (!lessonId || !OBJECT_ID_REGEX.test(lessonId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: STREAM_ERROR_MESSAGES.INVALID_LESSON_ID,
        });
        return;
      }

      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      const result = await HLSStreamService.generateHLSStreamUrl(
        req.user.userId,
        lessonId,
        ip,
        userAgent
      );

      // No-cache headers for presigned URLs
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
      });

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: unknown) {
      if (error instanceof StreamForbiddenError) {
        res.status(HTTP_STATUS.FORBIDDEN).json({ error: error.message });
        return;
      }
      if (error instanceof StreamNotFoundError) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
        return;
      }

      const err = error as Error;
      logger.error(`[HLSController] HLS stream error: ${err.message}`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: STREAM_ERROR_MESSAGES.INTERNAL_ERROR,
      });
    }
  }

  /**
   * GET /api/learning/lessons/:lessonId/hls/playlist
   *
   * Return a rewritten .m3u8 playlist where each .ts reference
   * is replaced with a presigned URL. This is what the HLS player
   * actually fetches to know where to get each segment.
   */
  static async getSignedPlaylist(req: Request, res: Response): Promise<void> {
    try {
      const { lessonId } = req.params;
      const token = req.query.streamToken as string || req.query.token as string;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      if (!lessonId || !OBJECT_ID_REGEX.test(lessonId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: STREAM_ERROR_MESSAGES.INVALID_LESSON_ID });
        return;
      }

      if (!token) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Stream token missing' });
        return;
      }

      // Verify stream token
      const { StreamTokenService } = require('../services/stream-token.service');
      const decoded = StreamTokenService.verifyToken(token, lessonId, ip, userAgent);

      const { playlist, contentType } = await HLSStreamService.generateSignedPlaylist(
        decoded.userId,
        lessonId,
        token
      );

      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
      });

      res.status(HTTP_STATUS.OK).send(playlist);
    } catch (error: unknown) {
      if (error instanceof StreamForbiddenError) {
        res.status(HTTP_STATUS.FORBIDDEN).json({ error: error.message });
        return;
      }
      if (error instanceof StreamNotFoundError) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
        return;
      }

      const err = error as Error;
      logger.error(`[HLSController] Signed playlist error: ${err.message}`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: STREAM_ERROR_MESSAGES.INTERNAL_ERROR,
      });
    }
  }

  /**
   * GET /api/learning/lessons/:lessonId/hls/segment/:segmentFile
   *
   * Proxy the .ts segment file stream from MinIO to the client.
   * Ensures that MinIO URL is never exposed.
   */
  static async getSegmentStream(req: Request, res: Response): Promise<void> {
    try {
      const { lessonId, segmentFile } = req.params;
      const courseId = req.query.courseId as string;
      const token = req.query.streamToken as string || req.query.token as string;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      if (!lessonId || !segmentFile || !courseId || !token) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Missing parameters or token' });
        return;
      }

      // Verify stream token
      const { StreamTokenService } = require('../services/stream-token.service');
      StreamTokenService.verifyToken(token, lessonId, ip, userAgent);

      const { minioInternalClient, BUCKETS } = require('../config/minio.config');
      const segmentKey = `${courseId}/${lessonId}/${segmentFile}`;

      const stream = await minioInternalClient.getObject(BUCKETS.COURSE_VIDEOS, segmentKey);
      
      res.set({
        'Content-Type': 'video/MP2T',
        'Cache-Control': 'public, max-age=3600', // Segments can be cached
        'Access-Control-Allow-Origin': '*',
      });

      stream.pipe(res);

      stream.on('error', (err: any) => {
        logger.error(`[HLSController] Segment stream error: ${err.message}`);
        if (!res.headersSent) {
          res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Stream failed' });
        }
      });
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`[HLSController] Segment stream error: ${err.message}`);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: STREAM_ERROR_MESSAGES.INTERNAL_ERROR });
    }
  }
  /**
   * GET /api/learning/lessons/:lessonId/hls/key
   *
   * Proxy the AES-128 encryption key from MinIO to the client.
   */
  static async getKeyStream(req: Request, res: Response): Promise<void> {
    try {
      const { lessonId } = req.params;
      const courseId = req.query.courseId as string;
      const token = req.query.streamToken as string || req.query.token as string;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      if (!lessonId || !courseId || !token) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Missing parameters or token' });
        return;
      }

      // Verify stream token
      const { StreamTokenService } = require('../services/stream-token.service');
      StreamTokenService.verifyToken(token, lessonId, ip, userAgent);

      const { minioInternalClient, BUCKETS } = require('../config/minio.config');
      const keyFile = `${courseId}/${lessonId}/encryption.key`;

      const stream = await minioInternalClient.getObject(BUCKETS.COURSE_VIDEOS, keyFile);
      
      res.set({
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
      });

      stream.pipe(res);

      stream.on('error', (err: any) => {
        logger.error(`[HLSController] Key stream error: ${err.message}`);
        if (!res.headersSent) {
          res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to retrieve key' });
        }
      });
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`[HLSController] Key stream error: ${err.message}`);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: STREAM_ERROR_MESSAGES.INTERNAL_ERROR });
    }
  }
}
