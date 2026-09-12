// ============================================================
// Progress Analyzer
// ============================================================
// Calculates progress from MILESTONE data (CourseProgress,
// LessonProgress), NOT from ActivityLog counts.
// Handles INSUFFICIENT_DATA explicitly.
// ============================================================

import type { RawLearnerData, ProgressAnalytics, ProgressDataPoint } from './types';

export class ProgressAnalyzer {
  static analyze(data: RawLearnerData): ProgressAnalytics {
    const { courseProgresses, lessonProgresses } = data;

    const totalLessons = courseProgresses.reduce((sum: number, cp: any) => sum + (cp.totalLessons || 0), 0);
    const completedLessons = courseProgresses.reduce((sum: number, cp: any) => sum + (cp.completedLessons || 0), 0);
    
    if (totalLessons === 0) {
      return {
        status: 'INSUFFICIENT_DATA',
        currentProgress: 0,
        dataPoints: [],
        trend: 'INSUFFICIENT_DATA',
        trendLabel: 'Chưa đủ dữ liệu',
        confidence: 0,
      };
    }

    const currentProgress = Math.round((completedLessons / totalLessons) * 100);
    const dataPoints = this.reconstructWeeklySnapshots(lessonProgresses, totalLessons, courseProgresses);

    if (dataPoints.length < 2) {
      return {
        status: 'INSUFFICIENT_DATA',
        currentProgress,
        dataPoints,
        trend: 'INSUFFICIENT_DATA',
        trendLabel: 'Chưa đủ dữ liệu',
        confidence: 0.3,
      };
    }

    const trend = this.computeTrend(dataPoints);
    const trendLabels: Record<string, string> = {
      INCREASING: 'Đang tăng',
      STABLE: 'Ổn định',
      SLOWING: 'Đang chậm lại',
      STAGNATING: 'Đình trệ',
      INSUFFICIENT_DATA: 'Chưa đủ dữ liệu',
    };

    const confidence = this.computeConfidence(dataPoints, totalLessons);

    return {
      status: 'READY',
      currentProgress,
      dataPoints,
      trend,
      trendLabel: trendLabels[trend],
      confidence,
    };
  }

  private static reconstructWeeklySnapshots(
    lessonProgresses: any[],
    totalLessons: number,
    courseProgresses: any[]
  ): ProgressDataPoint[] {
    if (totalLessons === 0) return [];

    // Get all completed lessons with dates
    const completedWithDates = lessonProgresses
      .filter((lp: any) => lp.completed && lp.completedAt)
      .map((lp: any) => ({
        completedAt: new Date(lp.completedAt),
        courseId: lp.courseId,
      }))
      .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());

    if (completedWithDates.length === 0) return [];

    const now = new Date();
    const points: ProgressDataPoint[] = [];

    // Course lookup for context
    const getCourseTitle = (courseId: string) => {
      const cp = courseProgresses.find((c: any) => c.courseId === courseId);
      return cp ? cp.courseTitle : 'Khóa học';
    };

    for (let w = 7; w >= 0; w--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - (w + 1) * 7);
      
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - w * 7);
      weekEnd.setHours(23, 59, 59, 999);

      const completedByDate = completedWithDates.filter(
        (l) => l.completedAt <= weekEnd
      ).length;

      const pct = Math.round((completedByDate / totalLessons) * 100);

      // Find if anything was completed exactly in this week for context
      const completedThisWeek = completedWithDates.filter(
        (l) => l.completedAt > weekStart && l.completedAt <= weekEnd
      );
      
      let context: string | undefined = undefined;
      if (completedThisWeek.length > 0) {
        const uniqueCourseIds = [...new Set(completedThisWeek.map(l => l.courseId))];
        const titles = uniqueCourseIds.map(id => getCourseTitle(id));
        context = `Đã học: ${titles.join(', ')}`;
      }

      points.push({
        date: weekEnd.toISOString().split('T')[0],
        value: pct,
        context,
      });
    }

    return points;
  }

  private static computeTrend(
    points: ProgressDataPoint[]
  ): 'INCREASING' | 'STABLE' | 'SLOWING' | 'STAGNATING' | 'INSUFFICIENT_DATA' {
    if (points.length < 3) return 'INSUFFICIENT_DATA';

    const recent = points.slice(-4);
    const n = recent.length;

    const xMean = (n - 1) / 2;
    const yMean = recent.reduce((s, p) => s + p.value, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (recent[i].value - yMean);
      denominator += (i - xMean) * (i - xMean);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;

    const allSame = recent.every((p) => p.value === recent[0].value);

    if (allSame && recent[0].value < 100) return 'STAGNATING';
    if (slope > 2) return 'INCREASING';
    if (slope > 0.5) return 'STABLE';
    if (slope > -1) return 'SLOWING';
    return 'STAGNATING';
  }

  private static computeConfidence(points: ProgressDataPoint[], totalLessons: number): number {
    if (totalLessons === 0) return 0;
    if (points.length < 3) return 0.3;
    if (points.length < 5) return 0.6;
    return 0.85;
  }
}
