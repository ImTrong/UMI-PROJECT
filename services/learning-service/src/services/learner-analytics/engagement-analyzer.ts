// ============================================================
// Engagement Analyzer
// ============================================================
// Uses WEIGHTED activity scoring, not raw counts.
// Momentum handles previous=0 as NEW_ACTIVITY.
// ============================================================

import type { RawLearnerData, EngagementAnalytics, MomentumLevel, ACTIVITY_WEIGHTS } from './types';
import { ACTIVITY_WEIGHTS as WEIGHTS } from './types';

export class EngagementAnalyzer {
  static analyze(data: RawLearnerData): EngagementAnalytics {
    const { activityLogs, userProgress } = data;
    const now = new Date();

    if (!activityLogs || activityLogs.length === 0) {
      return {
        status: 'INSUFFICIENT_DATA',
        dailyActivity: [],
        activeDays: 0,
        totalSessions: 0,
        currentStreak: 0,
        longestStreak: 0,
        averageSessionsPerWeek: 0,
        activeDayRatio: 0,
        momentum: {
          level: 'INSUFFICIENT_DATA',
          changePercent: null,
          description: 'Chưa có hoạt động học tập nào',
          confidence: 0,
        },
      };
    }

    // ── Daily activity (last 14 days for chart, last 30 for stats) ──
    const dailyActivity = this.computeDailyActivity(activityLogs, 14);

    // ── Active days (last 30 days) ──
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentLogs = activityLogs.filter(
      (a: any) => new Date(a.createdAt) >= thirtyDaysAgo
    );
    const uniqueDays = new Set(
      recentLogs.map((a: any) => new Date(a.createdAt).toISOString().split('T')[0])
    );
    const activeDays = uniqueDays.size;

    // ── Total sessions (distinct days with activity in last 30 days) ──
    const totalSessions = activeDays; // simplified: 1 session per active day

    // ── Streaks ──
    const currentStreak = userProgress?.streakDays || 0;
    const longestStreak = this.computeLongestStreak(activityLogs);

    // ── Average sessions per week ──
    const averageSessionsPerWeek = Math.round((activeDays / 4) * 10) / 10; // 30 days ≈ 4 weeks

    // ── Active day ratio ──
    const activeDayRatio = Math.round((activeDays / 30) * 100) / 100;

    // ── Momentum (weighted, with NEW_ACTIVITY handling) ──
    const momentum = this.computeMomentum(activityLogs);

    return {
      status: 'READY',
      dailyActivity,
      activeDays,
      totalSessions,
      currentStreak,
      longestStreak,
      averageSessionsPerWeek,
      activeDayRatio,
      momentum,
    };
  }

  /**
   * Compute daily activity breakdown for chart display.
   * Sessions: a session starts after a 30-min inactivity gap.
   */
  private static computeDailyActivity(
    logs: any[],
    days: number
  ): EngagementAnalytics['dailyActivity'] {
    const now = new Date();
    const result: EngagementAnalytics['dailyActivity'] = [];

    for (let d = days - 1; d >= 0; d--) {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];

      const dayLogs = logs.filter((a: any) => {
        const logDate = new Date(a.createdAt).toISOString().split('T')[0];
        return logDate === dateStr;
      });

      // Count sessions using 30-min inactivity gap rule
      const SESSION_GAP_MS = 30 * 60 * 1000;
      let sessions = 0;
      if (dayLogs.length > 0) {
        sessions = 1;
        const sorted = [...dayLogs].sort((a: any, b: any) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        for (let i = 1; i < sorted.length; i++) {
          const gap = new Date(sorted[i].createdAt).getTime() - new Date(sorted[i - 1].createdAt).getTime();
          if (gap > SESSION_GAP_MS) sessions++;
        }
      }

      const lessonsCompleted = dayLogs.filter(
        (a: any) => a.action === 'LESSON_COMPLETE'
      ).length;
      const quizSubmissions = dayLogs.filter(
        (a: any) => a.action === 'QUIZ_ATTEMPT' || a.action === 'QUIZ_PASS'
      ).length;
      const minutesActive = Math.round(
        dayLogs.reduce((s: number, a: any) => s + (a.durationSeconds || 0), 0) / 60
      );

      result.push({ date: dateStr, sessions, lessonsCompleted, quizSubmissions, minutesActive });
    }

    return result;
  }

  /**
   * Compute momentum using WEIGHTED activity scores.
   * Handles previous=0 as NEW_ACTIVITY instead of huge percentage.
   */
  private static computeMomentum(logs: any[]): EngagementAnalytics['momentum'] {
    const now = new Date();

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Weighted score for current 7 days
    const currentLogs = logs.filter(
      (a: any) => new Date(a.createdAt) >= sevenDaysAgo
    );
    const currentScore = this.computeWeightedScore(currentLogs);

    // Weighted score for previous 7 days
    const previousLogs = logs.filter(
      (a: any) => {
        const d = new Date(a.createdAt);
        return d >= fourteenDaysAgo && d < sevenDaysAgo;
      }
    );
    const previousScore = this.computeWeightedScore(previousLogs);

    // Handle edge cases
    if (previousScore === 0 && currentScore === 0) {
      return {
        level: 'INACTIVE',
        changePercent: 0,
        description: 'Không có hoạt động học tập gần đây',
        confidence: 0.9,
      };
    }

    if (previousScore === 0 && currentScore > 0) {
      return {
        level: 'NEW_ACTIVITY',
        changePercent: 0, // Don't show misleading +500%
        description: 'Mới bắt đầu hoạt động trở lại',
        confidence: 0.5, // Low confidence — no baseline
      };
    }

    const changePercent = Math.round(((currentScore - previousScore) / previousScore) * 100);

    let level: MomentumLevel;
    let description: string;

    if (changePercent > 30) {
      level = 'STRONG';
      description = 'Hoạt động học tập đang tăng mạnh';
    } else if (changePercent > 0) {
      level = 'HEALTHY';
      description = 'Nhịp độ học tập ổn định và tích cực';
    } else if (changePercent > -20) {
      level = 'SLOWING';
      description = 'Hoạt động học tập đang chậm lại một chút';
    } else if (changePercent > -50) {
      level = 'LOW';
      description = 'Hoạt động học tập giảm đáng kể';
    } else {
      level = 'INACTIVE';
      description = 'Rất ít hoạt động học tập gần đây';
    }

    // Evidence-based description
    const currentSessionCount = currentLogs.length;
    const confidence = previousScore > 10 ? 0.85 : 0.6;

    return {
      level,
      changePercent,
      description: `${currentSessionCount} hoạt động học tập trong 7 ngày gần đây. ${description}`,
      confidence,
    };
  }

  /**
   * Compute weighted activity score (not raw count).
   */
  private static computeWeightedScore(logs: any[]): number {
    return logs.reduce((score: number, log: any) => {
      const weight = WEIGHTS[log.action] || 1;
      return score + weight;
    }, 0);
  }

  /**
   * Compute longest streak from activity log dates.
   */
  private static computeLongestStreak(logs: any[]): number {
    if (logs.length === 0) return 0;

    const dates = [
      ...new Set(logs.map((a: any) => new Date(a.createdAt).toISOString().split('T')[0])),
    ].sort();

    let longest = 1;
    let current = 1;

    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = Math.round(
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 1) {
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 1;
      }
    }

    return longest;
  }
}
