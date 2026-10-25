import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  LeaderboardService,
  LeaderboardRewardIncompleteError,
  LeaderboardStateError,
} from '../services/leaderboard.service';
import { LockLostError, LockStoreError } from '../services/leaderboard-lock.service';
import { AchievementService } from '../services/achievement.service';
import { RewardPointService } from '../services/reward-point.service';
import { UserEligibilityError } from '../services/user-eligibility.service';
import { enrichEntriesWithUserInfo } from './leaderboard.controller';
import { getCurrentVietnamMonthYear, getVietnamPeriodState } from '../config/scoring-policy';
import { HTTP_STATUS } from '../utils/constants';
import logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** A whole number given as a number or as a string of digits; anything else (9.5, "9abc", "", null) is null. */
const wholeNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\d{1,4}$/.test(v.trim())) return Number(v.trim());
  return null;
};

export class AdminLeaderboardController {
  /**
   * GET /api/learning/admin/leaderboard/overview
   * Returns dashboard overview for admin: active month stats, unfinalized past months, total points awarded.
   */
  static async getOverview(req: AuthRequest, res: Response) {
    try {
      const { month: curMonth, year: curYear } = getCurrentVietnamMonthYear();

      // Current active month preview
      const current = await LeaderboardService.getCurrentLeaderboard();
      const enrichedCurrent = await enrichEntriesWithUserInfo(current.entries.slice(0, 10));

      // Recent finalized leaderboards
      const finalized = await prisma.monthlyLeaderboard.findMany({
        where: { status: 'FINALIZED' },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 12,
        include: {
          _count: { select: { entries: true } },
        },
      });

      // Total statistics
      const [totalRecords, totalPointsLedger] = await Promise.all([
        prisma.courseCompletionRecord.count({ where: { status: 'VALID' } }),
        prisma.userRewardPoint.aggregate({
          _sum: { balance: true, totalEarned: true },
        }),
      ]);

      res.status(HTTP_STATUS.OK).json({
        data: {
          currentPeriod: {
            month: curMonth,
            year: curYear,
            status: 'ACTIVE',
            participantsCount: current.entries.length,
            topEntries: enrichedCurrent,
          },
          finalizedPeriods: finalized.map(f => ({
            id: f.id,
            month: f.month,
            year: f.year,
            status: f.status,
            finalizedAt: f.finalizedAt,
            finalizedBy: f.finalizedBy,
            participantsCount: f._count.entries,
            totalPointsAwarded: f.totalPointsAwarded,
          })),
          stats: {
            totalValidCompletions: totalRecords,
            totalRewardPointsBalance: totalPointsLedger._sum.balance || 0,
            totalRewardPointsAwarded: totalPointsLedger._sum.totalEarned || 0,
          },
        },
      });
    } catch (error) {
      logger.error('Admin get overview error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get leaderboard overview' });
    }
  }

  /**
   * POST /api/learning/admin/leaderboard/finalize
   * Manual finalization of a month with admin audit logging.
   */
  static async manualFinalize(req: AuthRequest, res: Response) {
    try {
      const { month, year, force, reason = 'Chốt thủ công bởi Quản trị viên' } = req.body;
      // `force` is accepted ONLY so that existing clients keep working. Since FIX 06B2 it has NO effect at all: it
      // cannot take over a period that a live process is working on (only an expired lease can be taken over, by the
      // same plain acquire everybody uses), cannot reopen a FINALIZED period, cannot rebuild a frozen snapshot and
      // cannot re-issue rewards.
      if (force !== undefined && typeof force !== 'boolean') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'force must be a boolean' });
      }
      const adminId = (req.user?.userId && req.user.userId.length === 24) ? req.user.userId : '000000000000000000000001';
      const adminEmail = (req.user as any)?.email || 'admin@elearning.local';

      // Whole numbers only (a number or a string of digits): "9abc" or 9.5 are refused, not read as 9
      const monthNum = wholeNumber(month);
      const yearNum = wholeNumber(year);
      if (monthNum === null || yearNum === null || monthNum < 1 || monthNum > 12 || yearNum < 2020 || yearNum > 2100) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid month or year' });
      }

      // Only a period that has ENDED in Asia/Ho_Chi_Minh may be finalized from the API (FIX DEMO RANKING 02C.2): the running or a
      // future month is refused before anything is read or written. Automatic finalization (startup catch-up, cron, reconcile)
      // calls the service directly with past months only and is not affected.
      const period = getVietnamPeriodState(monthNum, yearNum);
      if (period.state !== 'ENDED') {
        const message =
          period.state === 'CURRENT'
            ? `Tháng ${monthNum}/${yearNum} đang diễn ra; chỉ có thể chốt kỳ đã kết thúc (theo giờ Việt Nam).`
            : `Tháng ${monthNum}/${yearNum} chưa bắt đầu; chỉ có thể chốt kỳ đã kết thúc (theo giờ Việt Nam).`;
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: message,
          message,
          code: 'LEADERBOARD_PERIOD_NOT_ENDED',
          details: {
            month: monthNum,
            year: yearNum,
            state: period.state,
            currentMonth: period.current.month,
            currentYear: period.current.year,
            timeZone: 'Asia/Ho_Chi_Minh',
          },
        });
      }

      logger.info(`🏆 Admin ${adminEmail} (${adminId}) requested manual finalization of ${month}/${year}${force === true ? ' (force has no effect)' : ''}`);

      const result = await LeaderboardService.finalizeMonth(monthNum, yearNum, `ADMIN:${adminEmail}`);

      if (result.status === 'BUSY') {
        // Another live process owns the period. Nothing was touched; the same request can be repeated later.
        const message = `Tháng ${month}/${year} đang được xử lý bởi một tiến trình khác. Vui lòng thử lại sau.`;
        return res.status(HTTP_STATUS.CONFLICT).json({ error: message, message, code: 'LEADERBOARD_BUSY', data: result });
      }

      // Record audit log
      await prisma.leaderboardAuditLog.create({
        data: {
          adminId,
          adminEmail,
          action: 'MANUAL_FINALIZE',
          month: monthNum,
          year: yearNum,
          reason,
          details: { ...result, forceIgnored: force === true },
        },
      });

      const message =
        result.status === 'ALREADY_FINALIZED'
          ? `Tháng ${month}/${year} đã được chốt trước đó. Dữ liệu lịch sử được giữ nguyên, không chốt lại.`
          : `Chốt sổ tháng ${month}/${year} thành công!`;
      res.status(HTTP_STATUS.OK).json({ message, data: result });
    } catch (error: any) {
      logger.error('Admin manual finalize error:', error);
      if (error instanceof LeaderboardRewardIncompleteError) {
        // Not an internal error: the period is intact in REWARDING and the same request can be repeated safely
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
          message: error.message,
          details: {
            failures: error.failures,
            verifiedPoints: error.verifiedPoints,
            expectedPoints: error.expectedPoints,
          },
        });
      }
      if (error instanceof UserEligibilityError) {
        // Nothing was written: the period stays as it was and the same request can be repeated later
        return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ error: error.message, message: error.message });
      }
      if (error instanceof LeaderboardStateError) {
        return res.status(HTTP_STATUS.CONFLICT).json({ error: error.message, message: error.message, status: error.status });
      }
      if (error instanceof LockLostError) {
        // This request lost ownership of the period part-way (lease lapsed / taken over). It stopped and wrote nothing
        // more; the current owner continues from the stored state, so the request can simply be repeated later.
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: 'Quyền xử lý kỳ bảng xếp hạng đã chuyển sang tiến trình khác; yêu cầu này đã dừng. Vui lòng kiểm tra trạng thái và thử lại sau.',
          message: error.message,
          code: 'LEADERBOARD_LOCK_LOST',
          reason: error.reason,
        });
      }
      if (error instanceof LockStoreError) {
        // The lock could not be checked at all: nothing was written
        return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ error: 'Không thể kiểm tra khóa xử lý bảng xếp hạng. Vui lòng thử lại sau.', message: error.message, code: 'LEADERBOARD_LOCK_UNAVAILABLE' });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to finalize month' });
    }
  }

  /**
   * POST /api/learning/admin/leaderboard/retry-notifications
   * Re-sends reward notifications that FAILED for a period. This is deliberately not a finalize:
   * it never recomputes rankings, never touches points, badges or totals - it only re-sends messages
   * whose delivery failure was recorded on the snapshot entry.
   */
  static async retryNotifications(req: AuthRequest, res: Response) {
    try {
      const month = Number(req.body?.month);
      const year = Number(req.body?.year);
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020 || year > 2100) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid month or year' });
      }
      const adminId = (req.user?.userId && req.user.userId.length === 24) ? req.user.userId : '000000000000000000000001';
      const adminEmail = (req.user as any)?.email || 'admin@elearning.local';

      const stillPending = await LeaderboardService.retryFailedNotifications(month, year);

      await prisma.leaderboardAuditLog.create({
        data: {
          adminId,
          adminEmail,
          action: 'RETRY_NOTIFICATIONS',
          month,
          year,
          reason: req.body?.reason || 'Gửi lại thông báo thưởng bị lỗi',
          details: { stillPending },
        },
      });

      res.status(HTTP_STATUS.OK).json({
        message: stillPending === 0 ? 'Đã gửi lại các thông báo bị lỗi.' : `Còn ${stillPending} thông báo chưa gửi được.`,
        data: { month, year, stillPending },
      });
    } catch (error: any) {
      logger.error('Admin retry notifications error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to retry notifications' });
    }
  }

  /**
   * POST /api/learning/admin/leaderboard/sync-completions
   * Backfill / Sync legacy CourseProgress records into CourseCompletionRecord.
   */
  static async syncCompletions(req: AuthRequest, res: Response) {
    try {
      const adminId = (req.user?.userId && req.user.userId.length === 24) ? req.user.userId : '000000000000000000000001';
      const adminEmail = (req.user as any)?.email || 'admin@elearning.local';

      const result = await AchievementService.syncExistingCompletions();

      await prisma.leaderboardAuditLog.create({
        data: {
          adminId,
          adminEmail,
          action: 'SYNC_COMPLETIONS',
          reason: 'Đồng bộ dữ liệu thành tích lịch sử',
          details: result,
        },
      });

      res.status(HTTP_STATUS.OK).json({
        message: 'Đồng bộ dữ liệu hoàn tất!',
        data: result,
      });
    } catch (error: any) {
      logger.error('Admin sync completions error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to sync completions' });
    }
  }

  /**
   * GET /api/learning/admin/leaderboard/student-detail/:userId?month=&year=
   * Inspect a student's completion records and calculation details.
   */
  static async getStudentAudit(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      const { month: curMonth, year: curYear } = getCurrentVietnamMonthYear();
      const month = req.query.month ? parseInt(req.query.month as string, 10) : curMonth;
      const year = req.query.year ? parseInt(req.query.year as string, 10) : curYear;

      const [breakdown, userPoints, allRecords] = await Promise.all([
        AchievementService.getStudentMonthlyBreakdown(userId, month, year),
        RewardPointService.getUserPoints(userId),
        prisma.courseCompletionRecord.findMany({
          where: { userId },
          orderBy: { completedAt: 'desc' },
        }),
      ]);

      res.status(HTTP_STATUS.OK).json({
        data: {
          periodBreakdown: breakdown,
          rewardPoints: userPoints,
          allCompletions: allRecords,
        },
      });
    } catch (error) {
      logger.error('Admin get student audit error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get student audit data' });
    }
  }

  /**
   * POST /api/learning/admin/leaderboard/flag-record
   * Flag a suspicious completion record (SUSPECT or EXCLUDED).
   */
  static async flagRecord(req: AuthRequest, res: Response) {
    try {
      const { recordId, status, reason } = req.body;
      const adminId = (req.user?.userId && req.user.userId.length === 24) ? req.user.userId : '000000000000000000000001';
      const adminEmail = (req.user as any)?.email || 'admin@elearning.local';

      if (!recordId || !['SUSPECT', 'EXCLUDED', 'VALID'].includes(status)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid record ID or status (must be SUSPECT, EXCLUDED, or VALID)' });
      }

      if (!reason) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Lý do thay đổi trạng thái là bắt buộc để kiểm toán.' });
      }

      const updated = await prisma.courseCompletionRecord.update({
        where: { id: recordId },
        data: { status },
      });

      await prisma.leaderboardAuditLog.create({
        data: {
          adminId,
          adminEmail,
          action: status === 'VALID' ? 'RESTORE_STUDENT' : 'FLAG_STUDENT',
          targetUserId: updated.userId,
          reason,
          details: { recordId, newStatus: status, courseId: updated.courseId },
        },
      });

      res.status(HTTP_STATUS.OK).json({
        message: `Đã cập nhật trạng thái bản ghi thành ${status}`,
        data: updated,
      });
    } catch (error: any) {
      logger.error('Admin flag record error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to update record status' });
    }
  }

  /**
   * POST /api/learning/admin/leaderboard/adjust-points
   * Manually adjust student points with audit log.
   */
  static async adjustPoints(req: AuthRequest, res: Response) {
    try {
      const { targetUserId, amount, reason } = req.body;
      const adminId = (req.user?.userId && req.user.userId.length === 24) ? req.user.userId : '000000000000000000000001';
      const adminEmail = (req.user as any)?.email || 'admin@elearning.local';

      if (!targetUserId || !amount || !reason) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Target user ID, amount, and reason are required' });
      }

      const result = await RewardPointService.adminAdjustPoints(
        adminId,
        adminEmail,
        targetUserId,
        parseInt(amount, 10),
        reason
      );

      res.status(HTTP_STATUS.OK).json({
        message: 'Điều chỉnh điểm thành công!',
        data: result,
      });
    } catch (error: any) {
      logger.error('Admin adjust points error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message || 'Failed to adjust points' });
    }
  }

  /**
   * GET /api/learning/admin/leaderboard/audit-logs
   * Retrieve administrative audit logs.
   */
  static async getAuditLogs(req: AuthRequest, res: Response) {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
      const skip = (page - 1) * limit;

      const [logs, total] = await Promise.all([
        prisma.leaderboardAuditLog.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.leaderboardAuditLog.count(),
      ]);

      res.status(HTTP_STATUS.OK).json({
        data: {
          logs,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      logger.error('Admin get audit logs error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get audit logs' });
    }
  }

  /**
   * GET /api/learning/admin/leaderboard/reward-transactions
   * Retrieve all reward point transactions for audit.
   */
  static async getRewardTransactions(req: AuthRequest, res: Response) {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
      const type = req.query.type as string | undefined;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (type) where.type = type;

      const [transactions, total] = await Promise.all([
        prisma.rewardPointTransaction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.rewardPointTransaction.count({ where }),
      ]);

      // Enrich with user full name if possible
      const enriched = await enrichEntriesWithUserInfo(transactions);

      res.status(HTTP_STATUS.OK).json({
        data: {
          transactions: enriched,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      logger.error('Admin get reward transactions error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get reward transactions' });
    }
  }
}
