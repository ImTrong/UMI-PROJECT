import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export const DEFAULT_COURSE_REDEMPTION_POINTS = 500;

export class RewardPointService {
  /**
   * Get user's reward point balance. Creates record with 0 balance if not exists.
   */
  static async getUserPoints(userId: string) {
    let userPoints = await prisma.userRewardPoint.findUnique({
      where: { userId },
    });

    if (!userPoints) {
      userPoints = await prisma.userRewardPoint.create({
        data: {
          userId,
          balance: 0,
          totalEarned: 0,
          totalSpent: 0,
        },
      });
    }

    return userPoints;
  }

  /**
   * Award reward points for leaderboard ranking.
   * IDEMPOTENT: Uses unique idempotencyKey to prevent duplicate awards upon cron retries.
   */
  static async awardLeaderboardPoints(
    userId: string,
    points: number,
    leaderboardId: string,
    rank: number,
    month: number,
    year: number
  ) {
    if (points <= 0) return null;

    const monthStr = month.toString().padStart(2, '0');
    // Stable idempotency key: guaranteed 1 reward per user per month regardless of rank shifts or retries
    const idempotencyKey = `reward_lb_month_${month}_year_${year}_user_${userId}`;

    // 1. Check if transaction already exists
    const existingTx = await prisma.rewardPointTransaction.findUnique({
      where: { idempotencyKey },
    });

    if (existingTx) {
      logger.info(`🎖️ Reward points already awarded to user ${userId} for month ${month}/${year} (tx: ${existingTx.id}). Skipping.`);
      return existingTx;
    }

    // 2. Fetch or create user balance
    const userPoints = await this.getUserPoints(userId);
    const newBalance = userPoints.balance + points;

    // 3. Create transaction and update balance
    const tx = await prisma.rewardPointTransaction.create({
      data: {
        userId,
        amount: points,
        type: 'LEADERBOARD_REWARD',
        description: `Thưởng Top ${rank} Bảng xếp hạng tháng ${monthStr}/${year}`,
        balanceAfter: newBalance,
        sourceId: leaderboardId,
        idempotencyKey,
        metadata: {
          leaderboardId,
          rank,
          month,
          year,
          points,
        },
      },
    });

    await prisma.userRewardPoint.update({
      where: { userId },
      data: {
        balance: newBalance,
        totalEarned: userPoints.totalEarned + points,
      },
    });

    logger.info(`🎖️ Successfully awarded ${points} points to user ${userId}. New balance: ${newBalance}`);
    return tx;
  }

  /**
   * Get transaction history for a user
   */
  static async getTransactionHistory(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.rewardPointTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.rewardPointTransaction.count({ where: { userId } }),
    ]);

    const userPoints = await this.getUserPoints(userId);

    return {
      balance: userPoints.balance,
      totalEarned: userPoints.totalEarned,
      totalSpent: userPoints.totalSpent,
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Redeem points to enroll in a course.
   * Atomic point deduction with automatic refund if enrollment fails.
   */
  static async redeemCourseWithPoints(
    userId: string,
    courseId: string,
    pointsRequired: number = DEFAULT_COURSE_REDEMPTION_POINTS,
    clientRequestId?: string
  ) {
    // 1. Mandatory clientRequestId validation (no fallback window)
    if (!clientRequestId || typeof clientRequestId !== 'string' || !clientRequestId.trim()) {
      throw new Error('Mã yêu cầu (clientRequestId) là bắt buộc cho thao tác đổi điểm.');
    }
    const idempotencyKey = clientRequestId.trim();

    // 2. Check if user already enrolled
    const existingProgress = await prisma.courseProgress.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (existingProgress) {
      throw new Error('Bạn đã đăng ký hoặc sở hữu khóa học này.');
    }

    if (pointsRequired <= 0) {
      throw new Error('Số điểm đổi phải lớn hơn 0');
    }

    // Ensure wallet exists
    await this.getUserPoints(userId);

    const existingTx = await prisma.rewardPointTransaction.findUnique({
      where: { idempotencyKey },
    });

    if (existingTx) {
      // 1. Detect payload conflict: same key with different courseId or pointsRequired
      const txMeta = (existingTx.metadata as any) || {};
      if (existingTx.sourceId !== courseId || txMeta.pointsRequired !== pointsRequired) {
        throw new Error(
          `Xung đột khóa idempotency: Mã yêu cầu "${idempotencyKey}" đã được sử dụng cho một giao dịch khác.`
        );
      }

      // 2. Check if this previous redemption transaction had been refunded
      const refundTx = await prisma.rewardPointTransaction.findUnique({
        where: { idempotencyKey: `refund_${idempotencyKey}` },
      });

      const currentWallet = await this.getUserPoints(userId);

      if (refundTx) {
        // Previous attempt with this key failed and was refunded.
        // Client retrying the SAME failed key receives clear notice and NO double debit.
        return {
          success: false,
          transaction: existingTx,
          refundTransaction: refundTx,
          remainingBalance: currentWallet.balance,
          isIdempotentReplay: true,
          status: 'ALREADY_REFUNDED',
          message: 'Yêu cầu đổi điểm này trước đó đã thất bại và số điểm đã được hoàn lại ví. Vui lòng tạo yêu cầu mới nếu muốn thử lại.',
        };
      }

      // Previous attempt succeeded and was not refunded!
      logger.info(
        `🎁 Idempotent replay: Course redemption for user ${userId}, course ${courseId} already completed (tx: ${existingTx.id}).`
      );
      return {
        success: true,
        transaction: existingTx,
        remainingBalance: currentWallet.balance,
        isIdempotentReplay: true,
        status: 'ALREADY_COMPLETED',
        message: 'Khóa học đã được đổi thành công trong yêu cầu trước đó.',
      };
    }

    // 3. ATOMIC POINT DEDUCTION: condition balance >= pointsRequired directly in DB update
    // Prevents double-spend race condition when multiple requests run simultaneously
    const deductResult = await prisma.userRewardPoint.updateMany({
      where: {
        userId,
        balance: { gte: pointsRequired },
      },
      data: {
        balance: { decrement: pointsRequired },
        totalSpent: { increment: pointsRequired },
      },
    });

    if (deductResult.count === 0) {
      const currentWallet = await this.getUserPoints(userId);
      throw new Error(`Số dư điểm thưởng không đủ. Cần ${pointsRequired} điểm (Số dư hiện tại: ${currentWallet.balance} điểm).`);
    }

    const currentWallet = await this.getUserPoints(userId);
    const newBalance = currentWallet.balance;

    // 4. Record transaction in ledger with PENDING_ENROLLMENT status
    // Safely handles race condition where two simultaneous requests use the exact same key
    let tx;
    try {
      tx = await prisma.rewardPointTransaction.create({
        data: {
          userId,
          amount: -pointsRequired,
          type: 'COURSE_REDEMPTION',
          description: `Đổi điểm lấy khóa học (ID: ${courseId})`,
          balanceAfter: newBalance,
          sourceId: courseId,
          idempotencyKey,
          metadata: { courseId, pointsRequired, redemptionStatus: 'PENDING_ENROLLMENT' },
        },
      });
    } catch (createErr: any) {
      // Concurrency collision on unique idempotencyKey: another parallel thread won the insert
      if (
        createErr.code === 'P2002' ||
        createErr.message?.includes('Unique constraint') ||
        createErr.message?.includes('E11000') ||
        createErr.message?.includes('idempotencyKey')
      ) {
        // Rollback deduction for this losing parallel request
        await prisma.userRewardPoint.update({
          where: { userId },
          data: {
            balance: { increment: pointsRequired },
            totalSpent: { decrement: pointsRequired },
          },
        });
        const concurrentTx = await prisma.rewardPointTransaction.findUnique({
          where: { idempotencyKey },
        });
        if (concurrentTx) {
          // Detect payload conflict on concurrent race condition
          const txMeta = (concurrentTx.metadata as any) || {};
          if (concurrentTx.sourceId !== courseId || txMeta.pointsRequired !== pointsRequired) {
            throw new Error(
              `Xung đột khóa idempotency: Mã yêu cầu "${idempotencyKey}" đã được sử dụng cho một giao dịch khác.`
            );
          }

          // If payloads match, wait briefly if thread A is still in-flight
          let finalTx = concurrentTx;
          let refundTx = await prisma.rewardPointTransaction.findUnique({
            where: { idempotencyKey: `refund_${idempotencyKey}` },
          });

          for (let i = 0; i < 5 && !refundTx && (finalTx.metadata as any)?.redemptionStatus === 'PENDING_ENROLLMENT'; i++) {
            await new Promise((r) => setTimeout(r, 100));
            const refreshed = await prisma.rewardPointTransaction.findUnique({ where: { idempotencyKey } });
            if (refreshed) finalTx = refreshed;
            refundTx = await prisma.rewardPointTransaction.findUnique({
              where: { idempotencyKey: `refund_${idempotencyKey}` },
            });
          }

          const wallet = await this.getUserPoints(userId);
          if (refundTx) {
            return {
              success: false,
              transaction: finalTx,
              refundTransaction: refundTx,
              remainingBalance: wallet.balance,
              isIdempotentReplay: true,
              status: 'ALREADY_REFUNDED',
              message: 'Yêu cầu đổi điểm này trước đó đã thất bại và số điểm đã được hoàn lại ví. Vui lòng tạo yêu cầu mới nếu muốn thử lại.',
            };
          }
          return {
            success: true,
            transaction: finalTx,
            remainingBalance: wallet.balance,
            isIdempotentReplay: true,
            status: 'ALREADY_COMPLETED',
            message: 'Khóa học đã được đổi thành công trong yêu cầu trước đó.',
          };
        }
      }
      throw createErr;
    }

    // 4. Enroll student in course via ProgressService
    try {
      const { ProgressService } = require('./progress.service');
      const enrollment = await ProgressService.enrollInCourse(userId, courseId, true);

      // Update tx status to COMPLETED
      await prisma.rewardPointTransaction.update({
        where: { id: tx.id },
        data: {
          metadata: {
            courseId,
            pointsRequired,
            redemptionStatus: 'COMPLETED',
            enrolledAt: new Date().toISOString(),
          },
        },
      });

      // Send notification
      try {
        const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
        await axios.post(`${userServiceUrl}/api/users/internal/notifications`, {
          userId,
          title: '🎁 Đổi khóa học thành công!',
          message: `Bạn đã dùng ${pointsRequired} điểm thưởng để đổi thành công khóa học. Hãy bắt đầu học ngay!`,
          type: 'SUCCESS',
          link: `/learn/${courseId}`,
        });
      } catch (notifErr) {
        logger.warn('Failed to send redemption notification:', notifErr);
      }

      return {
        success: true,
        transaction: tx,
        remainingBalance: newBalance,
        enrollment,
      };
    } catch (enrollErr: any) {
      logger.error(`Enrollment failed during course redemption for user ${userId}, course ${courseId}:`, enrollErr);

      // Automatic atomic refund - strictly idempotent
      const refundIdempotencyKey = `refund_${idempotencyKey}`;
      const existingRefund = await prisma.rewardPointTransaction.findUnique({
        where: { idempotencyKey: refundIdempotencyKey },
      });

      if (!existingRefund) {
        await prisma.userRewardPoint.update({
          where: { userId },
          data: {
            balance: { increment: pointsRequired },
            totalSpent: { decrement: pointsRequired },
          },
        });

        const refundedWallet = await this.getUserPoints(userId);
        const refundBalance = refundedWallet.balance;

        await prisma.rewardPointTransaction.create({
          data: {
            userId,
            amount: pointsRequired,
            type: 'COURSE_REDEMPTION_REFUND',
            description: `Hoàn điểm đổi khóa học do lỗi ghi danh (Khóa: ${courseId})`,
            balanceAfter: refundBalance,
            sourceId: courseId,
            idempotencyKey: refundIdempotencyKey,
            metadata: { courseId, originalTxId: tx.id, error: enrollErr.message },
          },
        });

        // Update original transaction status to FAILED
        await prisma.rewardPointTransaction.update({
          where: { id: tx.id },
          data: {
            metadata: {
              courseId,
              pointsRequired,
              redemptionStatus: 'FAILED',
              refundIdempotencyKey,
              error: enrollErr.message,
            },
          },
        });
      }

      throw new Error(`Đổi điểm thất bại khi ghi danh khóa học: ${enrollErr.message}. Điểm đã được hoàn lại ví của bạn.`);
    }
  }

  /**
   * Admin point adjustment with audit logging
   */
  static async adminAdjustPoints(
    adminId: string,
    adminEmail: string,
    targetUserId: string,
    amount: number,
    reason: string
  ) {
    if (amount === 0) throw new Error('Số điểm điều chỉnh không thể bằng 0');

    const userPoints = await this.getUserPoints(targetUserId);
    const newBalance = userPoints.balance + amount;
    if (newBalance < 0) {
      throw new Error(`Số dư sau điều chỉnh không thể âm (Hiện tại: ${userPoints.balance}, Điều chỉnh: ${amount})`);
    }

    const idempotencyKey = `admin_adj_${adminId}_${targetUserId}_${Date.now()}`;

    const tx = await prisma.rewardPointTransaction.create({
      data: {
        userId: targetUserId,
        amount,
        type: 'ADMIN_ADJUSTMENT',
        description: `Quản trị viên điều chỉnh: ${reason}`,
        balanceAfter: newBalance,
        sourceId: adminId,
        idempotencyKey,
        metadata: { adminId, adminEmail, reason },
      },
    });

    await prisma.userRewardPoint.update({
      where: { userId: targetUserId },
      data: {
        balance: newBalance,
        totalEarned: amount > 0 ? userPoints.totalEarned + amount : userPoints.totalEarned,
        totalSpent: amount < 0 ? userPoints.totalSpent + Math.abs(amount) : userPoints.totalSpent,
      },
    });

    // Record audit log
    await prisma.leaderboardAuditLog.create({
      data: {
        adminId,
        adminEmail,
        action: 'ADJUST_POINTS',
        targetUserId,
        reason,
        details: { amount, newBalance, txId: tx.id },
      },
    });

    return { tx, newBalance };
  }
}
