// ============================================================
// Learning State Detector
// ============================================================
// Uses PRIORITY ordering for state detection.
// AT_RISK is checked first, STABLE last.
// Every state includes confidence + evidence.
// ============================================================

import type {
  RawLearnerData,
  LearningStateAnalytics,
  LearningStateType,
  LearningStateEvidence,
  ProgressAnalytics,
  PerformanceAnalytics,
  EngagementAnalytics,
} from './types';

export class LearningStateDetector {
  /**
   * Detect learning state with priority ordering:
   * AT_RISK > REGRESSING > RECOVERING > STAGNATING > PROGRESSING > STABLE
   *
   * Each state is checked in order — the first match wins.
   */
  static detect(
    data: RawLearnerData,
    progress: ProgressAnalytics,
    performance: PerformanceAnalytics,
    engagement: EngagementAnalytics
  ): LearningStateAnalytics {
    const now = new Date();
    const evidence: LearningStateEvidence[] = [];

    // ── Compute signals ──
    const lastActivity = data.userProgress?.lastActivityDate
      ? new Date(data.userProgress.lastActivityDate)
      : null;
    const daysSinceActivity = lastActivity
      ? Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    const progressChange = this.computeRecentChange(progress.dataPoints);
    const isPerformanceDeclining = performance.trend === 'DECLINING';
    const isPerformanceRecovering = performance.trend === 'RECOVERING';
    const momentumLevel = engagement.momentum.level;
    const momentumChange = engagement.momentum.changePercent;

    // Build evidence
    evidence.push({
      metric: 'Tiến độ',
      value: progressChange > 0 ? `+${progressChange}%` : `${progressChange}%`,
      direction: progressChange > 2 ? 'up' : progressChange < -2 ? 'down' : 'stable',
    });

    evidence.push({
      metric: 'Kết quả',
      value: performance.trendLabel,
      direction: performance.trend === 'IMPROVING' || performance.trend === 'RECOVERING' ? 'up'
        : performance.trend === 'DECLINING' ? 'down'
          : 'stable',
    });

    evidence.push({
      metric: 'Hoạt động',
      value: (momentumChange ?? 0) !== 0 ? `${(momentumChange ?? 0) > 0 ? '+' : ''}${momentumChange ?? 0}%` : 'Ổn định',
      direction: (momentumChange ?? 0) > 5 ? 'up' : (momentumChange ?? 0) < -10 ? 'down' : 'stable',
    });

    if (daysSinceActivity < 999) {
      evidence.push({
        metric: 'Lần hoạt động cuối',
        value: daysSinceActivity === 0 ? 'Hôm nay' : `${daysSinceActivity} ngày trước`,
        direction: daysSinceActivity <= 1 ? 'up' : daysSinceActivity >= 7 ? 'down' : 'stable',
      });
    }

    // ── Priority-ordered detection ──

    if (progress.status === 'INSUFFICIENT_DATA' && performance.status === 'INSUFFICIENT_DATA' && engagement.status === 'INSUFFICIENT_DATA') {
      return {
        state: 'INSUFFICIENT_DATA',
        description: 'Chưa đủ dữ liệu hoạt động để đánh giá trạng thái học tập.',
        evidence: [],
        confidence: 0,
        lastUpdated: now.toISOString(),
      };
    }

    // 1. INSUFFICIENT_DATA (fallback if no activity at all)
    if (daysSinceActivity >= 999) {
      return {
        state: 'INSUFFICIENT_DATA',
        description: 'Bạn chưa có hoạt động học tập nào được ghi nhận.',
        evidence: [],
        confidence: 0,
        lastUpdated: now.toISOString(),
      };
    }

    // 2. AT_RISK: inactive >7 days AND performance actually declining
    if (daysSinceActivity >= 7 && isPerformanceDeclining) {
      return {
        state: 'AT_RISK',
        description: `Không hoạt động ${daysSinceActivity} ngày và kết quả thực tế đang giảm. Cần quay lại học tập sớm.`,
        evidence,
        confidence: daysSinceActivity >= 14 ? 0.95 : 0.8,
        lastUpdated: now.toISOString(),
      };
    }

    // 3. PAUSED: inactive > 14 days but no proof of performance decline (or no performance data)
    if (daysSinceActivity >= 14) {
      return {
        state: 'PAUSED',
        description: `Đang tạm dừng học. Đã ${daysSinceActivity} ngày không có hoạt động mới.`,
        evidence,
        confidence: 0.9,
        lastUpdated: now.toISOString(),
      };
    }

    // 4. REGRESSING: performance declining continuously
    if (isPerformanceDeclining && momentumChange !== null && momentumChange < -10) {
      return {
        state: 'REGRESSING',
        description: 'Kết quả đang giảm và hoạt động giảm. Cần xem xét lại phương pháp học.',
        evidence,
        confidence: 0.8,
        lastUpdated: now.toISOString(),
      };
    }

    // 5. RECOVERING: performance was declining but now improving
    if (isPerformanceRecovering) {
      return {
        state: 'RECOVERING',
        description: 'Kết quả từng giảm nhưng đang phục hồi. Tiếp tục duy trì nhịp độ học tập.',
        evidence,
        confidence: 0.75,
        lastUpdated: now.toISOString(),
      };
    }

    // 6. STAGNATING: no progress change AND activity declining (only if sufficient progress data)
    if (progress.status === 'READY' && Math.abs(progressChange) <= 2 && momentumChange !== null && momentumChange < -15) {
      return {
        state: 'STAGNATING',
        description: 'Tiến độ không thay đổi và hoạt động giảm. Thử thay đổi nội dung hoặc phương pháp học.',
        evidence,
        confidence: 0.7,
        lastUpdated: now.toISOString(),
      };
    }

    // 7. PROGRESSING: progress increasing AND activity stable/increasing
    if (progress.status === 'READY' && progressChange > 2 && momentumChange !== null && momentumChange >= -10) {
      return {
        state: 'PROGRESSING',
        description: 'Tiến độ đang tăng và hoạt động ổn định. Đang đi đúng hướng!',
        evidence,
        confidence: 0.85,
        lastUpdated: now.toISOString(),
      };
    }

    // 8. STABLE: default — active but not significant changes
    return {
      state: 'STABLE',
      description: 'Hoạt động học tập ổn định. Chưa có sự thay đổi rõ rệt nào về kết quả.',
      evidence,
      confidence: 0.6,
      lastUpdated: now.toISOString(),
    };
  }

  /**
   * Compute recent progress change (last 2 weeks vs previous 2 weeks).
   */
  private static computeRecentChange(dataPoints: { date: string; value: number }[]): number {
    if (dataPoints.length < 2) return 0;

    const recent = dataPoints.slice(-2);
    const previous = dataPoints.slice(-4, -2);

    const recentAvg = recent.reduce((s, p) => s + p.value, 0) / recent.length;
    const previousAvg = previous.length > 0
      ? previous.reduce((s, p) => s + p.value, 0) / previous.length
      : recentAvg;

    return Math.round(recentAvg - previousAvg);
  }
}
