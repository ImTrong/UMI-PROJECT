import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { LeaderboardService } from '../services/leaderboard.service';
import { AchievementService } from '../services/achievement.service';
import { RewardPointService, COURSE_REDEMPTION_POINTS } from '../services/reward-point.service';
import { CourseAccessError } from '../services/course-access.service';
import { UserEligibilityError } from '../services/user-eligibility.service';
import { getCurrentVietnamMonthYear } from '../config/scoring-policy';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import axios from 'axios';

/**
 * Learner eligibility (role / active account) is verified by the User Service. When that cannot be done the
 * ranking is NOT guessed: answer 503 so the client retries, instead of showing an unverified list.
 */
const respondIfEligibilityUnavailable = (error: unknown, res: Response): boolean => {
  if (!(error instanceof UserEligibilityError)) return false;
  res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
    error: 'Bảng xếp hạng tạm thời chưa khả dụng vì chưa xác minh được tư cách tham gia. Vui lòng thử lại sau.',
  });
  return true;
};

export class LeaderboardController {
  /**
   * GET /api/learning/leaderboard/current
   * Returns computed leaderboard for the current month.
   */
  static async getCurrentLeaderboard(req: AuthRequest, res: Response) {
    try {
      const leaderboard = await LeaderboardService.getCurrentLeaderboard();

      // Fetch user profiles for display
      const enriched = await enrichEntriesWithUserInfo(leaderboard.entries);

      res.status(HTTP_STATUS.OK).json({
        data: {
          ...leaderboard,
          entries: enriched,
        },
      });
    } catch (error) {
      logger.error('Get current leaderboard error:', error);
      if (respondIfEligibilityUnavailable(error, res)) return;
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get leaderboard' });
    }
  }

  /**
   * GET /api/learning/leaderboard/history?month=08&year=2026
   * Returns finalized leaderboard for a past month.
   */
  static async getHistoryLeaderboard(req: AuthRequest, res: Response) {
    try {
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);

      if (!month || !year || month < 1 || month > 12 || year < 2020) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid month or year' });
      }

      const leaderboard = await LeaderboardService.getLeaderboard(month, year);
      const enriched = await enrichEntriesWithUserInfo(leaderboard.entries);

      res.status(HTTP_STATUS.OK).json({
        data: {
          ...leaderboard,
          entries: enriched,
        },
      });
    } catch (error) {
      logger.error('Get history leaderboard error:', error);
      if (respondIfEligibilityUnavailable(error, res)) return;
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get leaderboard history' });
    }
  }

  /**
   * GET /api/learning/leaderboard/me
   * Returns current user's rank in the current month.
   */
  static async getMyRank(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const rank = await LeaderboardService.getUserRank(req.user.userId);

      res.status(HTTP_STATUS.OK).json({ data: rank });
    } catch (error) {
      logger.error('Get user rank error:', error);
      if (respondIfEligibilityUnavailable(error, res)) return;
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get rank' });
    }
  }

  /**
   * GET /api/learning/leaderboard/me/breakdown?month=&year=
   * Returns detailed score breakdown for the current user's completed courses.
   */
  static async getMyBreakdown(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const { month: curMonth, year: curYear } = getCurrentVietnamMonthYear();
      const month = req.query.month ? parseInt(req.query.month as string, 10) : curMonth;
      const year = req.query.year ? parseInt(req.query.year as string, 10) : curYear;

      const breakdown = await AchievementService.getStudentMonthlyBreakdown(req.user.userId, month, year);

      res.status(HTTP_STATUS.OK).json({ data: breakdown });
    } catch (error) {
      logger.error('Get user breakdown error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get score breakdown' });
    }
  }

  /**
   * GET /api/learning/leaderboard/months
   * Returns available finalized months for history navigation.
   */
  static async getAvailableMonths(req: AuthRequest, res: Response) {
    try {
      const months = await LeaderboardService.getAvailableMonths();
      res.status(HTTP_STATUS.OK).json({ data: months });
    } catch (error) {
      logger.error('Get available months error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get available months' });
    }
  }

  /**
   * GET /api/learning/reward-points/me
   * Returns current user's reward points balance.
   */
  static async getMyRewardPoints(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const points = await RewardPointService.getUserPoints(req.user.userId);
      // courseRedemptionPoints is informational (display); the redeem API never reads a price from the client
      res.status(HTTP_STATUS.OK).json({ data: { ...points, courseRedemptionPoints: COURSE_REDEMPTION_POINTS } });
    } catch (error) {
      logger.error('Get reward points error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get reward points' });
    }
  }

  /**
   * GET /api/learning/reward-points/transactions
   * Returns paginated transaction history for current user.
   */
  static async getRewardTransactions(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await RewardPointService.getTransactionHistory(req.user.userId, page, limit);
      res.status(HTTP_STATUS.OK).json({ data: result });
    } catch (error) {
      logger.error('Get transactions error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get transactions' });
    }
  }

  /**
   * POST /api/learning/reward-points/redeem
   * Redeem reward points for course enrollment.
   */
  static async redeemCourse(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      // Only courseId and the idempotency key are read from the body. Any price-like field
      // (pointsRequired, amount, balance, ...) sent by a client is ignored.
      const { courseId } = req.body;
      if (!courseId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Course ID is required' });
      }
      if (typeof courseId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(courseId)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid course ID format' });
      }

      const clientRequestId =
        (req.headers['x-idempotency-key'] as string) ||
        (req.headers['idempotency-key'] as string) ||
        req.body.clientRequestId ||
        req.body.requestId ||
        req.body.idempotencyKey;

      if (!clientRequestId || typeof clientRequestId !== 'string' || !clientRequestId.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Mã yêu cầu (clientRequestId hoặc header X-Idempotency-Key) là bắt buộc cho thao tác đổi điểm.',
        });
      }

      const result = await RewardPointService.redeemCourseWithPoints(
        req.user.userId,
        courseId,
        clientRequestId.trim()
      );

      if (result.status === 'ALREADY_REFUNDED') {
        return res.status(409).json({
          error: result.message,
          data: result,
        });
      }

      res.status(HTTP_STATUS.OK).json({
        message: result.message || 'Đổi khóa học thành công!',
        data: result,
      });
    } catch (error: any) {
      logger.error('Redeem course error:', error);
      if (error instanceof CourseAccessError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      const isConflict = error.message?.includes('Xung đột khóa idempotency');
      res.status(isConflict ? 409 : HTTP_STATUS.BAD_REQUEST).json({
        error: error.message || 'Failed to redeem course',
      });
    }
  }
}

/**
 * Enrich leaderboard entries with user profile info (fullName, avatar)
 * Uses the batch user API from user-service for efficiency.
 */
export async function enrichEntriesWithUserInfo(entries: any[]) {
  if (entries.length === 0) return entries;

  const userIds = entries.map(e => e.userId);

  try {
    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
    const response = await axios.post(`${userServiceUrl}/api/users/batch`, { ids: userIds }, { timeout: 4000 });
    const users: any[] = response.data.data || [];

    const userMap = new Map<string, { fullName: string; avatar?: string }>();
    for (const user of users) {
      userMap.set(user.userId || user.id, {
        fullName: user.fullName,
        avatar: user.avatar,
      });
    }

    return entries.map(entry => ({
      ...entry,
      fullName: userMap.get(entry.userId)?.fullName ?? 'Học viên ẩn',
      avatar: userMap.get(entry.userId)?.avatar ?? null,
    }));
  } catch (err) {
    logger.warn('Failed to enrich leaderboard entries with user info:', err);
    // Return entries with fallback name
    return entries.map(entry => ({
      ...entry,
      fullName: 'Học viên ẩn',
      avatar: null,
    }));
  }
}
