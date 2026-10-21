import { PrismaClient } from '@prisma/client';
import { CourseClientService } from './course-client.service';
import {
  calculateCourseAchievementPoints,
  getCurrentVietnamMonthYear,
  SCORING_POLICY_VERSION,
} from '../config/scoring-policy';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export class AchievementService {
  /**
   * Record a valid course completion and grant achievement points.
   * IDEMPOTENT: If an achievement record already exists for userId + courseId,
   * returns the existing record without modifying points.
   * This guarantees that subsequent retakes do NOT duplicate or alter points.
   */
  static async recordCourseCompletion(
    userId: string,
    courseId: string,
    completedAt: Date,
    courseTitleFallback: string = 'Khóa học',
    averageQuizScore?: number | null
  ) {
    // 1. Check if record already exists
    const existing = await prisma.courseCompletionRecord.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (existing) {
      logger.info(`🏆 Achievement already recorded for user ${userId} on course ${courseId}. Retake preservation active.`);
      return existing;
    }

    // 2. Fetch course metadata from course-service
    const courseMeta = await CourseClientService.getCourseMetadata(courseId);
    const isApproved = courseMeta.approvalStatus === 'APPROVED';

    // 3. Calculate achievement points
    const calc = calculateCourseAchievementPoints(
      courseMeta.totalDurationSeconds,
      courseMeta.level,
      isApproved
    );

    // If duration is missing or invalid (<= 0), flag record as SUSPECT to prevent fake points
    const isDurationValid = courseMeta.totalDurationSeconds > 0;
    const recordStatus = isDurationValid ? 'VALID' : 'SUSPECT';

    if (!isDurationValid) {
      logger.warn(
        `⚠️ Course ${courseId} has invalid or 0 duration. Flagged as SUSPECT (0 points) for admin audit. No fake points generated.`
      );
    }

    // 4. Determine calendar month/year in Vietnam timezone (Asia/Ho_Chi_Minh)
    const { month, year } = getCurrentVietnamMonthYear(completedAt);
    const hasQuiz = averageQuizScore !== undefined && averageQuizScore !== null && Number.isFinite(averageQuizScore);

    // 5. Create immutable achievement record
    const record = await prisma.courseCompletionRecord.create({
      data: {
        userId,
        courseId,
        courseTitle: courseMeta.title || courseTitleFallback,
        completedAt,
        passed: true,
        totalDurationSeconds: courseMeta.totalDurationSeconds,
        level: courseMeta.level,
        baseDurationPoints: isDurationValid ? calc.basePoints : 0,
        levelMultiplier: calc.levelMultiplier,
        achievementPoints: isDurationValid ? calc.achievementPoints : 0,
        averageQuizScore: hasQuiz ? averageQuizScore : null,
        hasQuiz,
        policyVersion: SCORING_POLICY_VERSION,
        pointsBreakdown: calc as any,
        status: recordStatus,
        month,
        year,
      },
    });

    logger.info(
      `🏆 Achievement recorded: user ${userId}, course ${courseId}, points: ${isDurationValid ? calc.achievementPoints : 0} (duration: ${calc.durationHours}h, level: ${calc.level} x${calc.levelMultiplier}), status: ${recordStatus}, period: ${month}/${year}`
    );

    return record;
  }

  /**
   * Backfill / Sync existing completed CourseProgress records into CourseCompletionRecord.
   * Comprehensive, safe, non-destructive audit and sync.
   * Never mutates or overwrites finalized snapshots.
   */
  static async syncExistingCompletions(): Promise<{
    processed: number;
    totalExamined: number;
    eligibleCount: number;
    created: number;
    skipped: number;
    needsReview: number;
    insufficientData: number;
    details: {
      createdList: Array<{ userId: string; courseId: string; points: number; month: number; year: number }>;
      skippedList: Array<{ userId: string; courseId: string; reason: string }>;
      needsReviewList: Array<{ userId: string; courseId: string; progressPercentage: number; passed: boolean | null; completedAt: Date | null; reason: string }>;
      insufficientDataList: Array<{ userId: string; courseId: string; reason: string }>;
    };
  }> {
    logger.info('🏆 Starting comprehensive sync of existing completed courses to CourseCompletionRecord...');

    const allProgress = await prisma.courseProgress.findMany();

    let eligibleCount = 0;
    let created = 0;
    let skipped = 0;
    let needsReview = 0;
    let insufficientData = 0;

    const createdList: Array<{ userId: string; courseId: string; points: number; month: number; year: number }> = [];
    const skippedList: Array<{ userId: string; courseId: string; reason: string }> = [];
    const needsReviewList: Array<{ userId: string; courseId: string; progressPercentage: number; passed: boolean | null; completedAt: Date | null; reason: string }> = [];
    const insufficientDataList: Array<{ userId: string; courseId: string; reason: string }> = [];

    for (const cp of allProgress) {
      // Check for discrepancies needing review
      const is100Percent = cp.progressPercentage >= 100;
      const hasCompletedAt = cp.completedAt !== null;
      const isPassed = cp.passed === true;

      // DISCREPANCY CHECKS (needsReview)
      if (is100Percent && (!isPassed || !hasCompletedAt)) {
        needsReview++;
        needsReviewList.push({
          userId: cp.userId,
          courseId: cp.courseId,
          progressPercentage: cp.progressPercentage,
          passed: cp.passed,
          completedAt: cp.completedAt,
          reason: 'Tiến trình 100% nhưng chưa đạt (passed !== true) hoặc thiếu completedAt.',
        });
        continue;
      }

      if (hasCompletedAt && !isPassed) {
        needsReview++;
        needsReviewList.push({
          userId: cp.userId,
          courseId: cp.courseId,
          progressPercentage: cp.progressPercentage,
          passed: cp.passed,
          completedAt: cp.completedAt,
          reason: 'Có completedAt nhưng passed !== true.',
        });
        continue;
      }

      if (isPassed && !hasCompletedAt) {
        needsReview++;
        needsReviewList.push({
          userId: cp.userId,
          courseId: cp.courseId,
          progressPercentage: cp.progressPercentage,
          passed: cp.passed,
          completedAt: cp.completedAt,
          reason: 'passed === true nhưng completedAt bị null.',
        });
        continue;
      }

      // If not fully eligible (in progress, <100%, no completedAt)
      if (!hasCompletedAt || !isPassed) {
        continue; // Normal active learning enrollment
      }

      // FULLY ELIGIBLE
      eligibleCount++;

      // Check uniqueness: already recorded?
      const existing = await prisma.courseCompletionRecord.findUnique({
        where: { userId_courseId: { userId: cp.userId, courseId: cp.courseId } },
      });

      if (existing) {
        skipped++;
        skippedList.push({
          userId: cp.userId,
          courseId: cp.courseId,
          reason: `Đã tồn tại bản ghi thành tích (ID: ${existing.id}, Điểm: ${existing.achievementPoints}, Trạng thái: ${existing.status})`,
        });
        continue;
      }

      // Check course metadata for valid duration
      try {
        const courseMeta = await CourseClientService.getCourseMetadata(cp.courseId);
        if (!courseMeta || courseMeta.totalDurationSeconds <= 0) {
          insufficientData++;
          insufficientDataList.push({
            userId: cp.userId,
            courseId: cp.courseId,
            reason: `Thời lượng khóa học không hợp lệ hoặc bằng 0 (${courseMeta?.totalDurationSeconds ?? 'N/A'}s)`,
          });
        }

        const newRec = await this.recordCourseCompletion(
          cp.userId,
          cp.courseId,
          cp.completedAt!,
          cp.courseTitle,
          cp.averageQuizScore
        );

        created++;
        createdList.push({
          userId: cp.userId,
          courseId: cp.courseId,
          points: newRec.achievementPoints,
          month: newRec.month,
          year: newRec.year,
        });
      } catch (err: any) {
        logger.error(`Failed to sync completion for user ${cp.userId}, course ${cp.courseId}:`, err);
        insufficientData++;
        insufficientDataList.push({
          userId: cp.userId,
          courseId: cp.courseId,
          reason: `Lỗi khi xử lý đồng bộ: ${err.message}`,
        });
      }
    }

    logger.info(
      `🏆 Sync completed: Examined ${allProgress.length}, Eligible ${eligibleCount}, Created ${created}, Skipped ${skipped}, NeedsReview ${needsReview}, InsufficientData ${insufficientData}`
    );

    return {
      processed: eligibleCount,
      totalExamined: allProgress.length,
      eligibleCount,
      created,
      skipped,
      needsReview,
      insufficientData,
      details: {
        createdList,
        skippedList,
        needsReviewList,
        insufficientDataList,
      },
    };
  }

  /**
   * Get student's completion records for a specific month and year.
   */
  static async getStudentMonthlyBreakdown(userId: string, month: number, year: number) {
    const records = await prisma.courseCompletionRecord.findMany({
      where: {
        userId,
        month,
        year,
        status: 'VALID',
      },
      orderBy: { completedAt: 'desc' },
    });

    const totalPoints = records.reduce((sum, r) => sum + r.achievementPoints, 0);
    const roundedTotalPoints = Math.round(totalPoints * 100) / 100;

    return {
      userId,
      month,
      year,
      completedCoursesCount: records.length,
      totalAchievementPoints: roundedTotalPoints,
      records: records.map(r => ({
        id: r.id,
        courseId: r.courseId,
        courseTitle: r.courseTitle,
        completedAt: r.completedAt,
        totalDurationSeconds: r.totalDurationSeconds,
        durationHours: Math.round((r.totalDurationSeconds / 3600) * 10) / 10,
        level: r.level,
        baseDurationPoints: r.baseDurationPoints,
        levelMultiplier: r.levelMultiplier,
        achievementPoints: r.achievementPoints,
        averageQuizScore: r.averageQuizScore,
        hasQuiz: r.hasQuiz,
        pointsBreakdown: r.pointsBreakdown,
      })),
    };
  }

  /**
   * Align all unfinalized CourseCompletionRecords in an active month to Policy v1.1.
   * Strictly preserves all historic records of finalized months.
   * Safe, transparent, with LeaderboardAuditLog.
   */
  static async alignActiveMonthScoringPolicy(
    month: number,
    year: number,
    adminId: string = '000000000000000000000001',
    adminEmail: string = 'system-policy-migration@elearning.local'
  ) {
    // 1. Verify month is NOT finalized
    const leaderboard = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month, year } },
    });

    if (leaderboard?.status === 'FINALIZED') {
      throw new Error(`Kỳ tháng ${month}/${year} đã chốt kết quả (FINALIZED). Tuyệt đối không sửa điểm lịch sử.`);
    }

    // 2. Find records in this active month with older policyVersion
    const recordsToUpdate = await prisma.courseCompletionRecord.findMany({
      where: {
        month,
        year,
        policyVersion: { not: SCORING_POLICY_VERSION },
      },
    });

    let updatedCount = 0;
    const updateDetails: Array<{ id: string; userId: string; courseId: string; oldPoints: number; newPoints: number }> = [];

    for (const rec of recordsToUpdate) {
      // Only recalculate VALID records with duration > 0
      if (rec.status === 'VALID' && rec.totalDurationSeconds > 0) {
        const calc = calculateCourseAchievementPoints(
          rec.totalDurationSeconds,
          rec.level,
          true
        );

        await prisma.courseCompletionRecord.update({
          where: { id: rec.id },
          data: {
            baseDurationPoints: calc.basePoints,
            levelMultiplier: calc.levelMultiplier,
            achievementPoints: calc.achievementPoints,
            policyVersion: SCORING_POLICY_VERSION,
            pointsBreakdown: calc as any,
          },
        });

        updateDetails.push({
          id: rec.id,
          userId: rec.userId,
          courseId: rec.courseId,
          oldPoints: rec.achievementPoints,
          newPoints: calc.achievementPoints,
        });
        updatedCount++;
      } else {
        // Just bump policyVersion if already 0 points
        await prisma.courseCompletionRecord.update({
          where: { id: rec.id },
          data: { policyVersion: SCORING_POLICY_VERSION },
        });
        updatedCount++;
      }
    }

    // 3. Write Audit Log
    if (updatedCount > 0) {
      await prisma.leaderboardAuditLog.create({
        data: {
          adminId,
          adminEmail,
          action: 'POLICY_RECALCULATION',
          reason: `Chuẩn hóa ${updatedCount} bản ghi thành tích kỳ chưa chốt (${month}/${year}) sang Policy v${SCORING_POLICY_VERSION}`,
          details: { updatedCount, updateDetails },
        },
      });
    }

    logger.info(`🏆 Aligned ${updatedCount} records in active month ${month}/${year} to Policy v${SCORING_POLICY_VERSION}.`);
    return { updatedCount, updateDetails };
  }
}
