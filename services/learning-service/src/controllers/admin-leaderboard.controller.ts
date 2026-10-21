import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { LeaderboardService } from '../services/leaderboard.service';
import { AchievementService } from '../services/achievement.service';
import { RewardPointService } from '../services/reward-point.service';
import { enrichEntriesWithUserInfo } from './leaderboard.controller';
import { getCurrentVietnamMonthYear } from '../config/scoring-policy';
import { HTTP_STATUS } from '../utils/constants';
import logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
      const { month, year, force = false, reason = 'Chốt thủ công bởi Quản trị viên' } = req.body;
      const adminId = (req.user?.userId && req.user.userId.length === 24) ? req.user.userId : '000000000000000000000001';
      const adminEmail = (req.user as any)?.email || 'admin@elearning.local';

      if (!month || !year || month < 1 || month > 12) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid month or year' });
      }

      logger.info(`🏆 Admin ${adminEmail} (${adminId}) requested manual finalization of ${month}/${year}`);

      const result = await LeaderboardService.finalizeMonth(
        parseInt(month, 10),
        parseInt(year, 10),
        `ADMIN:${adminEmail}`,
        Boolean(force)
      );

      // Record audit log
      await prisma.leaderboardAuditLog.create({
        data: {
          adminId,
          adminEmail,
          action: 'MANUAL_FINALIZE',
          month: parseInt(month, 10),
          year: parseInt(year, 10),
          reason,
          details: { ...result, force },
        },
      });

      res.status(HTTP_STATUS.OK).json({
        message: `Chốt sổ tháng ${month}/${year} thành công!`,
        data: result,
      });
    } catch (error: any) {
      logger.error('Admin manual finalize error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to finalize month' });
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
