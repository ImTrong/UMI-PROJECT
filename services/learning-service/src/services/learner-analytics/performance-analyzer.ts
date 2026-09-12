// ============================================================
// Performance Analyzer
// ============================================================
// Tracks individual quiz/assessment scores over time.
// Detects IMPROVING/STABLE/DECLINING/RECOVERING trends.
// Handles INSUFFICIENT_DATA explicit state.
// ============================================================

import type { RawLearnerData, PerformanceAnalytics, PerformanceDataPoint } from './types';

export class PerformanceAnalyzer {
  static analyze(data: RawLearnerData): PerformanceAnalytics {
    const { quizAttempts, projectEvaluations, courseProgresses } = data;

    // Collect all scored assessments with context
    const scoredEvents: { date: Date; value: number; context: string; passed?: boolean }[] = [];

    // Course lookup for context
    const getCourseTitle = (courseId: string) => {
      const cp = courseProgresses.find((c: any) => c.courseId === courseId);
      return cp ? cp.courseTitle : 'Khóa học';
    };

    // Quiz attempts
    for (const qa of quizAttempts) {
      if (qa.status === 'SUBMITTED' && qa.score != null && qa.submittedAt) {
        scoredEvents.push({
          date: new Date(qa.submittedAt),
          value: qa.score,
          context: `Quiz: ${getCourseTitle(qa.courseId)}`,
          passed: qa.passed,
        });
      }
    }

    // Project evaluations
    for (const pe of projectEvaluations) {
      if (pe.totalScore != null && pe.createdAt) {
        scoredEvents.push({
          date: new Date(pe.createdAt),
          value: pe.totalScore,
          context: `Project Evaluation`,
          passed: pe.totalScore >= 70, // Assuming 70 is passing for projects
        });
      }
    }

    // Sort chronologically
    scoredEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

    if (scoredEvents.length === 0) {
      return {
        status: 'INSUFFICIENT_DATA',
        currentScore: 0,
        dataPoints: [],
        trend: 'INSUFFICIENT_DATA',
        trendLabel: 'Chưa đủ dữ liệu',
        confidence: 0,
      };
    }

    // Build data points with previous value and change
    const dataPoints: PerformanceDataPoint[] = [];
    let previousValue: number | undefined = undefined;

    for (const event of scoredEvents) {
      const change = previousValue !== undefined ? Math.round(event.value - previousValue) : undefined;
      dataPoints.push({
        date: event.date.toISOString().split('T')[0],
        value: Math.round(event.value),
        context: event.context,
        previousValue: previousValue !== undefined ? Math.round(previousValue) : undefined,
        change,
        passed: event.passed,
      });
      previousValue = event.value;
    }

    const currentScore = Math.round(scoredEvents.reduce((s, e) => s + e.value, 0) / scoredEvents.length);

    if (scoredEvents.length < 2) {
      return {
        status: 'INSUFFICIENT_DATA',
        currentScore,
        dataPoints,
        trend: 'INSUFFICIENT_DATA',
        trendLabel: 'Chưa đủ dữ liệu',
        confidence: 0.3,
      };
    }

    const trend = this.detectTrend(dataPoints);
    const trendLabels: Record<string, string> = {
      IMPROVING: 'Đang cải thiện',
      STABLE: 'Ổn định',
      DECLINING: 'Đang giảm',
      RECOVERING: 'Đang phục hồi',
      INSUFFICIENT_DATA: 'Chưa đủ dữ liệu',
    };

    const confidence = this.computeConfidence(scoredEvents.length);

    return {
      status: 'READY',
      currentScore,
      dataPoints,
      trend,
      trendLabel: trendLabels[trend],
      confidence,
    };
  }

  private static detectTrend(
    points: PerformanceDataPoint[]
  ): 'IMPROVING' | 'STABLE' | 'DECLINING' | 'RECOVERING' | 'INSUFFICIENT_DATA' {
    if (points.length < 2) return 'INSUFFICIENT_DATA';

    const values = points.map((p) => p.value);
    const n = values.length;

    // Check for RECOVERING: dip then recovery
    if (n >= 3) {
      const minIdx = values.indexOf(Math.min(...values));
      if (minIdx > 0 && minIdx < n - 1 && values[n - 1] > values[minIdx] + 5) {
        return 'RECOVERING';
      }
    }

    // Linear regression slope
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (values[i] - yMean);
      den += (i - xMean) * (i - xMean);
    }
    const slope = den !== 0 ? num / den : 0;

    if (slope > 2) return 'IMPROVING';
    if (slope < -2) return 'DECLINING';
    return 'STABLE';
  }

  private static computeConfidence(totalAssessments: number): number {
    if (totalAssessments < 2) return 0;
    if (totalAssessments < 4) return 0.5;
    if (totalAssessments < 8) return 0.8;
    return 0.9;
  }
}
