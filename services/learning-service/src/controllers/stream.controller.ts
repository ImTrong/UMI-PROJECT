// controllers/stream.controller.ts
// Controller for the secure video streaming endpoint.
// Handles HTTP request/response, delegates business logic to StreamService.

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  StreamService,
  StreamUnauthorizedError,
  StreamForbiddenError,
  StreamNotFoundError,
} from '../services/stream.service';
import { HTTP_STATUS, STREAM_ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class StreamController {
  /**
   * GET /api/learning/lessons/:lessonId/stream
   * 
   * Generate a presigned URL for streaming a lesson's video.
   * 
   * Flow:
   * 1. authenticateToken middleware has already verified JWT and attached user
   * 2. Validate lessonId parameter
   * 3. Delegate to StreamService for authorization + URL generation
   * 4. Return presigned URL or appropriate error
   * 
   * Responses:
   * - 200: { streamUrl, expiresIn, lesson }
   * - 401: Invalid/missing token
   * - 403: User hasn't purchased the course
   * - 404: Lesson/course/video not found
   * - 500: Internal server error
   */
  static async getLessonStream(req: AuthRequest, res: Response): Promise<void> {
    try {
      // ── Step 1: Verify authenticated user ──
      if (!req.user || !req.user.userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: STREAM_ERROR_MESSAGES.INVALID_TOKEN,
        });
        return;
      }

      // ── Step 2: Validate lessonId parameter ──
      const { lessonId } = req.params;

      if (!lessonId || lessonId.trim() === '') {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: STREAM_ERROR_MESSAGES.INVALID_LESSON_ID,
        });
        return;
      }

      // Basic ObjectId format validation (24 hex chars for MongoDB)
      const objectIdRegex = /^[0-9a-fA-F]{24}$/;
      if (!objectIdRegex.test(lessonId)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: STREAM_ERROR_MESSAGES.INVALID_LESSON_ID,
        });
        return;
      }

      // ── Step 3: Generate presigned stream URL ──
      const result = await StreamService.generateStreamUrl({
        userId: req.user.userId,
        lessonId,
      });

      // ── Step 4: Return response ──
      // Set cache-control headers to prevent caching of presigned URLs
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
      });

      res.status(HTTP_STATUS.OK).json({
        streamUrl: result.streamUrl,
        expiresIn: result.expiresIn,
        lesson: result.lesson,
      });
    } catch (error: unknown) {
      // ── Error handling with precise HTTP status codes ──
      if (error instanceof StreamUnauthorizedError) {
        logger.warn(`[StreamController] Unauthorized: ${error.message}`);
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: error.message,
        });
        return;
      }

      if (error instanceof StreamForbiddenError) {
        logger.warn(`[StreamController] Forbidden: ${error.message}`);
        res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
        return;
      }

      if (error instanceof StreamNotFoundError) {
        logger.warn(`[StreamController] Not found: ${error.message}`);
        res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
        return;
      }

      // Generic internal error
      const err = error as Error;
      logger.error(`[StreamController] Internal error: ${err.message}`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: STREAM_ERROR_MESSAGES.INTERNAL_ERROR,
      });
    }
  }
}
