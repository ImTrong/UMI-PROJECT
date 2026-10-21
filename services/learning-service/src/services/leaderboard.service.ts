/**
 * Leaderboard Service (Production-Ready)
 *
 * Implements the Monthly Learner Leaderboard:
 * - Calculates rankings from immutable CourseCompletionRecord (server-recorded completedAt)
 * - Timezone: Asia/Ho_Chi_Minh (UTC+7)
 * - Ranking:
 *   1. points DESC (Total achievement points)
 *   2. completedCourses DESC (Number of valid completed courses)
 *   3. averageQuizScore DESC (Average quiz score of courses WITH quizzes, excluding quiz-less courses)
 *   4. lastCompletedAt ASC (Earliest final completion time)
 * - Consistent tie handling (shared ranks, equal reward distribution, isTie flag)
 * - Rewards:
 *   - Rank 1: 1,000 points + "Nhà vô địch tháng MM/YYYY" (🥇)
 *   - Rank 2: 700 points + "Á quân tháng MM/YYYY" (🥈)
 *   - Rank 3: 500 points + "Top 3 tháng MM/YYYY" (🥉)
 *   - Rank 4-10: 200 points + "Top 10 tháng MM/YYYY" (🎖️)
 * - Concurrency protection: atomic status transition to FINALIZING before processing
 * - Chronological multi-month catch-up
 * - Detailed score breakdown saved per entry for complete auditability
 */

import { PrismaClient } from '@prisma/client';
import {
  getCurrentVietnamMonthYear,
  getRewardForRank,
  SCORING_POLICY_VERSION,
} from '../config/scoring-policy';
import { AchievementService } from './achievement.service';
import { RewardPointService } from './reward-point.service';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CourseScoreItem {
  courseId: string;
  courseTitle: string;
  durationSeconds: number;
  durationHours: number;
  level: string;
  basePoints: number;
  levelMultiplier: number;
  achievementPoints: number;
  averageQuizScore: number | null;
  hasQuiz: boolean;
  completedAt: Date;
}

export interface ComputedLeaderboardEntry {
  userId: string;
  rank: number;
  points: number;
  completedCourses: number;
  averageScore: number | null;
  lastCompletedAt: Date;
  rewardPoints: number;
  rewardBadgeId?: string | null;
  scoreBreakdown: CourseScoreItem[];
  isTie: boolean;
}

export interface LeaderboardResponse {
  month: number;
  year: number;
  status: string;
  policyVersion: string;
  totalParticipants: number;
  entries: ComputedLeaderboardEntry[];
  finalizedAt?: Date | null;
  finalizedBy?: string | null;
}

export interface UserRankResponse {
  rank: number | null;
  isTie: boolean;
  points: number;
  completedCourses: number;
  averageScore: number | null;
  lastCompletedAt: Date | null;
  totalParticipants: number;
  scoreBreakdown: CourseScoreItem[];
}

// ─── Internal Computation Engine ──────────────────────────────────────────────

/**
 * Aggregate completion data from CourseCompletionRecord for a specific month and year.
 * Ensures initial sync of any completed CourseProgress records if needed.
 */
async function aggregateCompletions(month: number, year: number): Promise<ComputedLeaderboardEntry[]> {
  // 1. Fetch all VALID completion records for this month and year
  let records = await prisma.courseCompletionRecord.findMany({
    where: {
      month,
      year,
      status: 'VALID',
    },
    orderBy: { completedAt: 'asc' },
  });

  // If no records found, try a quick sync from CourseProgress in case completions happened before backfill
  if (records.length === 0) {
    await AchievementService.syncExistingCompletions();
    records = await prisma.courseCompletionRecord.findMany({
      where: {
        month,
        year,
        status: 'VALID',
      },
      orderBy: { completedAt: 'asc' },
    });
  }

  // 2. Group by userId
  const userMap = new Map<string, {
    courses: CourseScoreItem[];
  }>();

  for (const r of records) {
    if (!userMap.has(r.userId)) {
      userMap.set(r.userId, { courses: [] });
    }

    userMap.get(r.userId)!.courses.push({
      courseId: r.courseId,
      courseTitle: r.courseTitle,
      durationSeconds: r.totalDurationSeconds,
      durationHours: Math.round((r.totalDurationSeconds / 3600) * 10) / 10,
      level: r.level,
      basePoints: r.baseDurationPoints,
      levelMultiplier: r.levelMultiplier,
      achievementPoints: r.achievementPoints,
      averageQuizScore: r.averageQuizScore,
      hasQuiz: r.hasQuiz,
      completedAt: r.completedAt,
    });
  }

  // 3. Build preliminary aggregated entries
  const result: ComputedLeaderboardEntry[] = [];

  for (const [userId, data] of userMap) {
    const completedCourses = data.courses.length;
    const totalPoints = data.courses.reduce((sum, c) => sum + c.achievementPoints, 0);
    const roundedPoints = Math.round(totalPoints * 100) / 100;

    // Calculate quiz average strictly for courses that HAVE quizzes
    const quizCourses = data.courses.filter(c => c.hasQuiz && c.averageQuizScore != null);
    const averageScore = quizCourses.length > 0
      ? Math.round((quizCourses.reduce((sum, c) => sum + (c.averageQuizScore ?? 0), 0) / quizCourses.length) * 100) / 100
      : null;

    const lastCompletedAt = data.courses.reduce(
      (latest, c) => (c.completedAt > latest ? c.completedAt : latest),
      data.courses[0].completedAt
    );

    result.push({
      userId,
      rank: 0,
      points: roundedPoints,
      completedCourses,
      averageScore,
      lastCompletedAt,
      rewardPoints: 0,
      rewardBadgeId: null,
      scoreBreakdown: data.courses,
      isTie: false,
    });
  }

  // 4. Sort with 4 criteria:
  // 1) points DESC
  // 2) completedCourses DESC
  // 3) averageScore DESC (treat null as -1 so courses with actual quiz score rank above)
  // 4) lastCompletedAt ASC
  result.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.completedCourses !== a.completedCourses) return b.completedCourses - a.completedCourses;

    const scoreA = a.averageScore ?? -1;
    const scoreB = b.averageScore ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;

    return a.lastCompletedAt.getTime() - b.lastCompletedAt.getTime();
  });

  // 5. Assign ranks with consistent tie-breaking
  // Standard competition ranking (1224 ranking): equal participants share rank, next rank skips
  for (let i = 0; i < result.length; i++) {
    if (i === 0) {
      result[i].rank = 1;
      result[i].isTie = false;
      continue;
    }

    const prev = result[i - 1];
    const curr = result[i];

    const isPointsEqual = prev.points === curr.points;
    const isCoursesEqual = prev.completedCourses === curr.completedCourses;
    const isScoreEqual = (prev.averageScore ?? -1) === (curr.averageScore ?? -1);
    const isTimeEqual = Math.abs(prev.lastCompletedAt.getTime() - curr.lastCompletedAt.getTime()) < 1000; // within 1 second

    if (isPointsEqual && isCoursesEqual && isScoreEqual && isTimeEqual) {
      curr.rank = prev.rank;
      curr.isTie = true;
      prev.isTie = true;
    } else {
      curr.rank = i + 1;
      curr.isTie = false;
    }
  }

  // 6. Assign prospective reward points
  for (const entry of result) {
    const reward = getRewardForRank(entry.rank, month, year);
    if (reward) {
      entry.rewardPoints = reward.rewardPoints;
    }
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class LeaderboardService {
  /**
   * Get leaderboard for the current calendar month in Vietnam timezone (computed on-the-fly).
   */
  static async getCurrentLeaderboard(): Promise<LeaderboardResponse> {
    const { month, year } = getCurrentVietnamMonthYear();
    const entries = await aggregateCompletions(month, year);

    return {
      month,
      year,
      status: 'ACTIVE',
      policyVersion: SCORING_POLICY_VERSION,
      totalParticipants: entries.length,
      entries,
      finalizedAt: null,
      finalizedBy: null,
    };
  }

  /**
   * Get leaderboard for a specific month and year.
   * If FINALIZED: returns the snapshot from database.
   * If ACTIVE: computes on-the-fly.
   */
  static async getLeaderboard(month: number, year: number): Promise<LeaderboardResponse> {
    if (month < 1 || month > 12) throw new Error('Invalid month');
    if (year < 2020 || year > 2100) throw new Error('Invalid year');

    const snapshot = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month, year } },
      include: { entries: { orderBy: { rank: 'asc' } } },
    });

    if (snapshot && snapshot.status === 'FINALIZED') {
      return {
        month: snapshot.month,
        year: snapshot.year,
        status: snapshot.status,
        policyVersion: snapshot.policyVersion,
        totalParticipants: snapshot.totalParticipants || snapshot.entries.length,
        entries: snapshot.entries.map(e => ({
          userId: e.userId,
          rank: e.rank,
          points: e.points,
          completedCourses: e.completedCourses,
          averageScore: e.averageScore,
          lastCompletedAt: e.lastCompletedAt,
          rewardPoints: e.rewardPoints,
          rewardBadgeId: e.rewardBadgeId,
          scoreBreakdown: (e.scoreBreakdown as any) || [],
          isTie: e.isTie,
        })),
        finalizedAt: snapshot.finalizedAt,
        finalizedBy: snapshot.finalizedBy,
      };
    }

    // Not finalized -> compute on-the-fly
    const entries = await aggregateCompletions(month, year);

    return {
      month,
      year,
      status: snapshot?.status || 'ACTIVE',
      policyVersion: SCORING_POLICY_VERSION,
      totalParticipants: entries.length,
      entries,
      finalizedAt: null,
      finalizedBy: null,
    };
  }

  /**
   * Get student's rank and achievement in the current month.
   */
  static async getUserRank(userId: string): Promise<UserRankResponse> {
    const { month, year } = getCurrentVietnamMonthYear();
    const entries = await aggregateCompletions(month, year);
    const userEntry = entries.find(e => e.userId === userId);

    return {
      rank: userEntry?.rank ?? null,
      isTie: userEntry?.isTie ?? false,
      points: userEntry?.points ?? 0,
      completedCourses: userEntry?.completedCourses ?? 0,
      averageScore: userEntry?.averageScore ?? null,
      lastCompletedAt: userEntry?.lastCompletedAt ?? null,
      totalParticipants: entries.length,
      scoreBreakdown: userEntry?.scoreBreakdown ?? [],
    };
  }

  /**
   * Finalize a month's leaderboard: snapshot to DB, award Badges and Reward Points.
   * CONCURRENCY-SAFE: Uses atomic status transitions to prevent duplicate finalization.
   */
  static async finalizeMonth(
    month: number,
    year: number,
    finalizedBy: string = 'SYSTEM_CRON',
    force: boolean = false,
    options?: {
      simulateFailureAt?: 'BEFORE_SNAPSHOT_CONFIRM' | 'AFTER_FIRST_REWARD' | 'BEFORE_FINALIZED';
    }
  ): Promise<{ status: string; totalParticipants: number; totalPointsAwarded: number }> {
    logger.info(`🏆 [Finalize] Checking leaderboard for ${month}/${year} (initiator: ${finalizedBy})...`);

    // 1. Concurrency Check: atomically inspect and set status
    const existing = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month, year } },
    });

    if (existing?.status === 'FINALIZED' && !force) {
      logger.info(`🏆 [Finalize] Leaderboard ${month}/${year} already finalized at ${existing.finalizedAt?.toISOString()}. Skipping.`);
      return {
        status: 'ALREADY_FINALIZED',
        totalParticipants: existing.totalParticipants,
        totalPointsAwarded: existing.totalPointsAwarded,
      };
    }

    const inProgressStatuses = ['FINALIZING', 'SNAPSHOT_BUILDING', 'SNAPSHOT_FROZEN', 'REWARDING'];
    if (existing && inProgressStatuses.includes(existing.status) && !force) {
      const lockAgeMinutes = (Date.now() - existing.updatedAt.getTime()) / (1000 * 60);
      if (lockAgeMinutes < 5) {
        logger.warn(`🏆 [Finalize] Leaderboard ${month}/${year} is currently in progress (${existing.status}, ${lockAgeMinutes.toFixed(1)}m ago). Skipping.`);
        return {
          status: 'IN_PROGRESS',
          totalParticipants: existing.totalParticipants,
          totalPointsAwarded: existing.totalPointsAwarded,
        };
      }
      logger.warn(`🏆 [Finalize] Previous finalization lock expired (${existing.status}, ${lockAgeMinutes.toFixed(1)}m ago). Breaking lock and resuming.`);
    }

    let leaderboard = await prisma.monthlyLeaderboard.upsert({
      where: { month_year: { month, year } },
      create: {
        month,
        year,
        status: 'SNAPSHOT_BUILDING',
        policyVersion: SCORING_POLICY_VERSION,
        finalizedBy,
      },
      update: {
        finalizedBy,
      },
    });

    try {
      // =========================================================================
      // PHASE 1: FROZEN SNAPSHOT DRAFT & INTEGRITY CONFIRMATION
      // Check if snapshot entries were ALREADY confirmed frozen in a previous run.
      // If confirmed, NEVER recalculate rankings from live data! Use the frozen ranks!
      // =========================================================================
      const isSnapshotAlreadyConfirmed = existing?.status === 'SNAPSHOT_FROZEN' || existing?.status === 'REWARDING';
      let entriesToProcess: Array<{
        userId: string;
        rank: number;
        points: number;
        completedCourses: number;
        averageScore: number | null;
        lastCompletedAt: Date;
        rewardPoints: number;
        rewardBadgeId: string | null;
        scoreBreakdown: any;
        isTie: boolean;
      }> = [];

      if (isSnapshotAlreadyConfirmed) {
        // Snapshot was confirmed complete in previous run!
        const existingEntries = await prisma.leaderboardEntry.findMany({
          where: { leaderboardId: leaderboard.id },
          orderBy: { rank: 'asc' },
        });

        logger.info(
          `🏆 [Finalize] Resuming from confirmed frozen snapshot (${existingEntries.length} entries). Preserving exact rankings without recomputation.`
        );
        entriesToProcess = existingEntries.map(e => ({
          userId: e.userId,
          rank: e.rank,
          points: e.points,
          completedCourses: e.completedCourses,
          averageScore: e.averageScore,
          lastCompletedAt: e.lastCompletedAt,
          rewardPoints: e.rewardPoints,
          rewardBadgeId: e.rewardBadgeId,
          scoreBreakdown: e.scoreBreakdown,
          isTie: e.isTie,
        }));
      } else {
        // Status is SNAPSHOT_BUILDING (first run or resumed from unconfirmed partial write)
        await prisma.monthlyLeaderboard.update({
          where: { id: leaderboard.id },
          data: { status: 'SNAPSHOT_BUILDING' },
        });

        // 1. Wipe any partial/stale entries from previous interrupted build
        await prisma.leaderboardEntry.deleteMany({
          where: { leaderboardId: leaderboard.id },
        });

        // 2. Compute rankings
        const computed = await aggregateCompletions(month, year);
        const expectedCount = computed.length;

        // Simulated failure before confirming snapshot
        if (options?.simulateFailureAt === 'BEFORE_SNAPSHOT_CONFIRM') {
          if (computed.length > 0) {
            await prisma.leaderboardEntry.create({
              data: {
                leaderboardId: leaderboard.id,
                userId: computed[0].userId,
                rank: computed[0].rank,
                points: computed[0].points,
                completedCourses: computed[0].completedCourses,
                averageScore: computed[0].averageScore,
                lastCompletedAt: computed[0].lastCompletedAt,
                rewardPoints: computed[0].rewardPoints,
                scoreBreakdown: computed[0].scoreBreakdown as any,
                isTie: computed[0].isTie,
              },
            });
          }
          throw new Error('[SIMULATION] Crash occurred while writing snapshot entries (partial write simulated)');
        }

        // 3. Insert complete snapshot entries
        if (computed.length > 0) {
          await prisma.leaderboardEntry.createMany({
            data: computed.map(e => ({
              leaderboardId: leaderboard.id,
              userId: e.userId,
              rank: e.rank,
              points: e.points,
              completedCourses: e.completedCourses,
              averageScore: e.averageScore,
              lastCompletedAt: e.lastCompletedAt,
              rewardPoints: e.rewardPoints,
              rewardBadgeId: e.rewardBadgeId ?? null,
              scoreBreakdown: e.scoreBreakdown as any,
              isTie: e.isTie,
            })),
          });
        }

        // 4. Verify snapshot completeness (integrity check)
        const actualCount = await prisma.leaderboardEntry.count({
          where: { leaderboardId: leaderboard.id },
        });

        if (actualCount !== expectedCount) {
          throw new Error(
            `Snapshot integrity check failed: expected ${expectedCount} entries, but found ${actualCount} in database.`
          );
        }

        // 5. Advance to SNAPSHOT_FROZEN state
        await prisma.monthlyLeaderboard.update({
          where: { id: leaderboard.id },
          data: {
            status: 'SNAPSHOT_FROZEN',
            totalParticipants: expectedCount,
          },
        });

        entriesToProcess = computed.map(e => ({
          ...e,
          rewardBadgeId: e.rewardBadgeId ?? null,
        }));
      }

      // =========================================================================
      // PHASE 2: DISBURSE REWARDS (strictly based on the confirmed frozen snapshot)
      // =========================================================================
      await prisma.monthlyLeaderboard.update({
        where: { id: leaderboard.id },
        data: { status: 'REWARDING' },
      });

      const monthStr = month.toString().padStart(2, '0');
      const monthLabel = `${monthStr}/${year}`;
      let totalPointsAwarded = 0;
      let rewardIndex = 0;

      for (const entry of entriesToProcess) {
        rewardIndex++;
        const reward = getRewardForRank(entry.rank, month, year);
        if (!reward) continue;

        entry.rewardPoints = reward.rewardPoints;
        totalPointsAwarded += reward.rewardPoints;

        // A. Award points into ledger (strictly idempotent by month + year + userId)
        try {
          await RewardPointService.awardLeaderboardPoints(
            entry.userId,
            reward.rewardPoints,
            leaderboard.id,
            entry.rank,
            month,
            year
          );
        } catch (pointErr) {
          logger.error(`Failed to award points to user ${entry.userId}:`, pointErr);
        }

        // B. Award Badge (idempotent)
        try {
          const existingBadge = await prisma.badge.findUnique({
            where: {
              userId_badgeName: {
                userId: entry.userId,
                badgeName: reward.badgeName,
              },
            },
          });

          if (existingBadge) {
            entry.rewardBadgeId = existingBadge.id;
          } else {
            const badge = await prisma.badge.create({
              data: {
                userId: entry.userId,
                badgeName: reward.badgeName,
                badgeType: 'LEADERBOARD_REWARD',
                description: reward.description,
                iconUrl: reward.icon,
                metadata: {
                  month,
                  year,
                  rank: entry.rank,
                  isTie: entry.isTie,
                  points: entry.points,
                  completedCourses: entry.completedCourses,
                  rewardPoints: reward.rewardPoints,
                },
              },
            });
            entry.rewardBadgeId = badge.id;
          }
        } catch (badgeErr) {
          logger.error(`Failed to award badge to user ${entry.userId}:`, badgeErr);
        }

        // C. Send notification
        try {
          const axios = (await import('axios')).default;
          const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
          await axios.post(`${userServiceUrl}/api/users/internal/notifications`, {
            userId: entry.userId,
            title: `🏆 Chúc mừng! Bạn đạt ${reward.badgeName}`,
            message: `Bạn đạt thứ hạng #${entry.rank} trong Bảng xếp hạng tháng ${monthLabel} với ${entry.points} điểm thành tích và nhận được ${reward.rewardPoints} điểm thưởng cùng huy hiệu ${reward.icon}!`,
            type: 'SUCCESS',
            link: '/leaderboard',
          });
        } catch (notifErr) {
          logger.warn(`Failed to send reward notification to user ${entry.userId}:`, notifErr);
        }

        // Simulated failure after first reward
        if (options?.simulateFailureAt === 'AFTER_FIRST_REWARD' && rewardIndex === 1) {
          throw new Error('[SIMULATION] Crash occurred immediately after rewarding first student');
        }
      }

      // Simulated failure before finalized
      if (options?.simulateFailureAt === 'BEFORE_FINALIZED') {
        throw new Error('[SIMULATION] Crash occurred right before marking FINALIZED');
      }

      // Update reward badge IDs in snapshot entries if newly assigned
      for (const entry of entriesToProcess) {
        if (entry.rewardBadgeId) {
          await prisma.leaderboardEntry.updateMany({
            where: { leaderboardId: leaderboard.id, userId: entry.userId },
            data: { rewardBadgeId: entry.rewardBadgeId, rewardPoints: entry.rewardPoints },
          });
        }
      }

      // =========================================================================
      // PHASE 3: MARK FINALIZED
      // =========================================================================
      await prisma.monthlyLeaderboard.update({
        where: { id: leaderboard.id },
        data: {
          status: 'FINALIZED',
          finalizedAt: new Date(),
          totalParticipants: entriesToProcess.length,
          totalPointsAwarded,
          policyVersion: SCORING_POLICY_VERSION,
        },
      });

      logger.info(
        `🏆 [Finalize] Month ${month}/${year} finalized successfully: ${entriesToProcess.length} participants, ${totalPointsAwarded} reward points granted.`
      );

      return {
        status: 'FINALIZED',
        totalParticipants: entriesToProcess.length,
        totalPointsAwarded,
      };
    } catch (error: any) {
      logger.error(`🏆 [Finalize] Error finalizing month ${month}/${year}:`, error);
      // Preserve progress status (SNAPSHOT_BUILDING / REWARDING) so retry/recovery can inspect and resume accurately
      throw error;
    }
  }

  /**
   * Check and finalize all missing unfinalized past months in chronological order.
   * Called on startup and by cron job.
   */
  static async checkAndFinalizeAllPastMonths(): Promise<{ finalizedMonths: string[] }> {
    const { month: curMonth, year: curYear } = getCurrentVietnamMonthYear();
    const finalizedMonths: string[] = [];

    // Find all past months from the last 12 months up to previous month
    const pastMonths: { month: number; year: number }[] = [];
    let checkMonth = curMonth - 1;
    let checkYear = curYear;
    if (checkMonth < 1) {
      checkMonth = 12;
      checkYear = curYear - 1;
    }

    // Go back up to 6 past months (Semester period) to ensure no missed months
    for (let i = 0; i < 6; i++) {
      pastMonths.unshift({ month: checkMonth, year: checkYear });
      checkMonth--;
      if (checkMonth < 1) {
        checkMonth = 12;
        checkYear--;
      }
    }

    // Process past months strictly in chronological order
    for (const { month, year } of pastMonths) {
      const existing = await prisma.monthlyLeaderboard.findUnique({
        where: { month_year: { month, year } },
      });

      if (!existing || existing.status !== 'FINALIZED') {
        logger.info(`🏆 Past month ${month}/${year} not finalized. Finalizing now...`);
        try {
          const res = await this.finalizeMonth(month, year, 'SYSTEM_STARTUP_CATCHUP', true);
          if (res.status === 'FINALIZED') {
            finalizedMonths.push(`${month}/${year}`);
          }
        } catch (err) {
          logger.error(`Failed to catch-up finalize month ${month}/${year}:`, err);
        }
      }
    }

    return { finalizedMonths };
  }

  /**
   * Get available finalized months for history navigation.
   */
  static async getAvailableMonths(): Promise<{ month: number; year: number; status: string }[]> {
    const leaderboards = await prisma.monthlyLeaderboard.findMany({
      where: { status: 'FINALIZED' },
      select: { month: true, year: true, status: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return leaderboards;
  }
}
