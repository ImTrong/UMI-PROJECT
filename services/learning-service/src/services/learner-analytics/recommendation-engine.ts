// ============================================================
// Recommendation Engine
// ============================================================
// Generates recommendations based on analyzed data:
// gaps, bottlenecks, momentum, learning state.
// Each recommendation has confidence + reason.
// ============================================================

import type {
  RecommendedAction,
  KnowledgeGapAnalytics,
  BottleneckAnalytics,
  EngagementAnalytics,
  LearningStateAnalytics,
  SkillAnalyticsResult,
} from './types';

export class RecommendationEngine {
  static generate(
    gaps: KnowledgeGapAnalytics,
    bottlenecks: BottleneckAnalytics,
    engagement: EngagementAnalytics,
    state: LearningStateAnalytics,
    skills: SkillAnalyticsResult
  ): RecommendedAction[] {
    const recs: RecommendedAction[] = [];

    // 1. AT_RISK or REGRESSING → urgent action
    if (state.state === 'AT_RISK' || state.state === 'REGRESSING') {
      recs.push({
        type: 'MOMENTUM',
        priority: 'HIGH',
        target: 'Quay lại học tập',
        problem: 'Kết quả học tập thực tế đang giảm sút',
        evidence: state.evidence.map(e => `${e.metric}: ${e.value}`),
        reason: state.description,
        action: 'Bắt đầu với một bài học ngắn hoặc ôn tập để lấy lại nhịp độ',
        actionUrl: '/my-learning',
        actionLabel: 'Học ngay',
        confidence: state.confidence,
      });
    }

    // 2. High-priority knowledge gaps
    if (gaps.status === 'READY') {
      for (const gap of gaps.gaps.filter((g) => g.priority === 'HIGH')) {
        recs.push({
          type: 'SKILL_GAP',
          priority: 'HIGH',
          target: `Củng cố ${gap.skill}`,
          problem: `Mức độ thành thạo thấp hơn yêu cầu (${gap.current}% / ${gap.expected}%)`,
          evidence: gap.evidence,
          reason: `Kỹ năng này cần thiết cho lộ trình học tập hiện tại.`,
          action: `Xem lại các bài giảng và bài tập liên quan đến ${gap.skill}`,
          confidence: gaps.confidence,
        });
      }
    }

    // 3. High-severity bottlenecks
    if (bottlenecks.status === 'READY') {
      for (const bn of bottlenecks.bottlenecks.filter((b) => b.severity === 'HIGH')) {
        recs.push({
          type: 'BOTTLENECK',
          priority: 'HIGH',
          target: `Xem lại ${bn.contentTitle}`,
          problem: `Bạn đang gặp khó khăn với nội dung này`,
          evidence: [
            `${bn.revisitCount} lần xem lại`,
            bn.failedAttempts > 0 ? `${bn.failedAttempts} lần chưa đạt` : '',
            bn.assessmentScore ? `Điểm đánh giá: ${bn.assessmentScore}` : '',
          ].filter(Boolean),
          reason: `Đây có thể là điểm nghẽn ngăn cản bạn tiếp thu các nội dung tiếp theo.`,
          action: 'Ôn tập chậm lại hoặc thảo luận với giảng viên',
          confidence: bn.confidence,
        });
      }
    }

    // 4. Low momentum → encourage activity (ONLY if not AT_RISK)
    if (
      engagement.status === 'READY' &&
      (engagement.momentum.level === 'LOW' || engagement.momentum.level === 'INACTIVE') &&
      state.state !== 'AT_RISK' &&
      state.state !== 'PAUSED'
    ) {
      recs.push({
        type: 'MOMENTUM',
        priority: 'MEDIUM',
        target: 'Duy trì thói quen học tập',
        problem: 'Nhịp độ học tập đang giảm',
        evidence: [`Mức độ hoạt động: ${engagement.momentum.level}`],
        reason: engagement.momentum.description,
        action: 'Dành 15-30 phút mỗi ngày để tạo thói quen tốt',
        actionUrl: '/my-learning',
        actionLabel: 'Bắt đầu học',
        confidence: engagement.momentum.confidence,
      });
    }

    // 5. Improvement areas from skills (EVIDENCE-BASED ONLY)
    if (skills.status === 'READY') {
      for (const area of skills.improvementAreas.slice(0, 2)) {
        if (!recs.some((r) => r.target.includes(area.name))) {
          const hasEvidence = area.hasEvidence && area.currentMastery != null;
          if (hasEvidence) {
            recs.push({
              type: 'PRACTICE',
              priority: 'MEDIUM',
              target: `Củng cố ${area.name}`,
              problem: `Kỹ năng này đang ở mức ${area.currentMastery}%`,
              evidence: area.evidences ? area.evidences.map(e => e.detail) : [`Điểm hiện tại: ${area.currentMastery}%`],
              reason: `Đây là kỹ năng cần củng cố dựa trên kết quả đánh giá thực tế.`,
              action: `Làm thêm bài tập thực hành liên quan đến ${area.name}`,
              confidence: skills.confidence,
            });
          } else {
            recs.push({
              type: 'PRACTICE',
              priority: 'LOW',
              target: `Đánh giá ${area.name}`,
              problem: `Chưa có đủ dữ liệu để đánh giá ${area.name}`,
              evidence: ['Chưa có kết quả quiz, assessment hoặc project liên quan'],
              reason: `Hệ thống cần thêm dữ liệu để đánh giá chính xác kỹ năng này.`,
              action: `Hoàn thành nội dung/assessment liên quan để hệ thống có thể đánh giá kỹ năng`,
              confidence: 0.3,
            });
          }
        }
      }

      // 6. Completion vs Mastery gap
      if (skills.completionVsMastery && skills.completionVsMastery.gap > 15) {
        recs.push({
          type: 'REVIEW',
          priority: 'MEDIUM',
          target: 'Đánh giá lại kiến thức',
          problem: `Hoàn thành bài học (${skills.completionVsMastery.completion}%) nhưng mức độ thành thạo thực tế thấp (${skills.completionVsMastery.mastery}%)`,
          evidence: [`Độ chênh lệch: ${Math.round(skills.completionVsMastery.gap)}%`],
          reason: `Có thể bạn đang lướt qua nội dung quá nhanh mà chưa thực hành đủ.`,
          action: 'Xem lại các bài học quan trọng và tự làm lại bài tập',
          actionUrl: '/my-learning',
          actionLabel: 'Ôn tập',
          confidence: skills.confidence,
        });
      }
    }

    // 7. PROGRESSING → continue
    if (state.state === 'PROGRESSING' && recs.length === 0) {
      recs.push({
        type: 'CONTINUE',
        priority: 'LOW',
        target: 'Tiếp tục lộ trình',
        problem: 'Không có vấn đề cần xử lý',
        evidence: ['Đang đi đúng hướng', 'Tiến độ đang tăng'],
        reason: 'Bạn đang tiến bộ rất tốt, hãy duy trì nhịp độ học tập!',
        action: 'Hoàn thành bài học tiếp theo',
        actionUrl: '/my-learning',
        actionLabel: 'Tiếp tục học',
        confidence: 0.9,
      });
    }

    // Sort by priority
    const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    recs.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

    return recs.slice(0, 4);
  }
}
