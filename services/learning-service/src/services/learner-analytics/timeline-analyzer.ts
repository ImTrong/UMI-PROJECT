// ============================================================
// Timeline Analyzer
// ============================================================
// Aggregates milestones from real DB events:
// CourseProgress, LessonProgress, QuizAttempt, Certificates.
// NOT from raw ActivityLog counts.
// ============================================================

import type { RawLearnerData, TimelineAnalytics, TimelineMilestone, LearningStageType } from './types';

const STAGE_LABELS: Record<LearningStageType, string> = {
  GETTING_STARTED: 'Khởi đầu',
  FOUNDATION: 'Nền tảng',
  DEVELOPMENT: 'Phát triển',
  APPLICATION: 'Ứng dụng',
  FINAL_PROJECT: 'Đồ án',
  ASSESSMENT: 'Đánh giá',
  MASTERY: 'Thành thạo',
};

export class TimelineAnalyzer {
  static analyze(data: RawLearnerData, currentStage: LearningStageType): TimelineAnalytics {
    const milestones: TimelineMilestone[] = [];

    // 1. Course enrollments
    this.addCourseEnrollments(data, milestones);

    // 2. Significant lesson completions (group by course)
    this.addLessonMilestones(data, milestones, currentStage);

    // 3. Quiz results
    this.addQuizMilestones(data, milestones, currentStage);

    // 4. Project submissions
    this.addProjectMilestones(data, milestones);

    // 5. Certificates
    this.addCertificateMilestones(data, milestones);

    // Sort chronologically (newest first)
    milestones.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Limit to last 20 milestones for performance
    const limited = milestones.slice(0, 20);

    return {
      milestones: limited,
      totalMilestones: milestones.length,
    };
  }

  private static addCourseEnrollments(data: RawLearnerData, milestones: TimelineMilestone[]) {
    for (const cp of data.courseProgresses) {
      if (cp.enrolledAt) {
        milestones.push({
          id: `enroll-${cp.courseId}`,
          date: new Date(cp.enrolledAt).toISOString().split('T')[0],
          stage: 'GETTING_STARTED',
          stageLabel: STAGE_LABELS.GETTING_STARTED,
          title: `Đăng ký khóa học`,
          type: 'COURSE_STARTED',
          status: 'completed',
        });
      }

      // Course completion
      if (cp.completedAt && cp.progressPercentage >= 100) {
        milestones.push({
          id: `complete-${cp.courseId}`,
          date: new Date(cp.completedAt).toISOString().split('T')[0],
          stage: 'MASTERY',
          stageLabel: STAGE_LABELS.MASTERY,
          title: `Hoàn thành khóa học`,
          type: 'COURSE_STARTED',
          completion: 100,
          assessment: cp.averageQuizScore || undefined,
          status: 'completed',
          insight: cp.averageQuizScore
            ? `Điểm trung bình quiz: ${Math.round(cp.averageQuizScore)}%`
            : undefined,
          insightDirection: cp.averageQuizScore && cp.averageQuizScore >= 80 ? 'up' : 'stable',
        });
      }
    }
  }

  private static addLessonMilestones(
    data: RawLearnerData,
    milestones: TimelineMilestone[],
    currentStage: LearningStageType
  ) {
    // Group lessons by course and add completion milestones at 25%, 50%, 75% marks
    const byCourse = new Map<string, any[]>();
    for (const lp of data.lessonProgresses) {
      if (!lp.completed || !lp.completedAt) continue;
      const arr = byCourse.get(lp.courseId) || [];
      arr.push(lp);
      byCourse.set(lp.courseId, arr);
    }

    for (const [courseId, lessons] of byCourse) {
      const cp = data.courseProgresses.find((c: any) => c.courseId === courseId);
      const total = cp?.totalLessons || lessons.length;
      if (total === 0) continue;

      // Sort lessons by completion date
      const sorted = lessons.sort(
        (a: any, b: any) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
      );

      // Add milestone at specific thresholds
      const thresholds = [
        { pct: 25, label: '25% hoàn thành', stage: 'FOUNDATION' as LearningStageType },
        { pct: 50, label: '50% hoàn thành', stage: 'DEVELOPMENT' as LearningStageType },
        { pct: 75, label: '75% hoàn thành', stage: 'APPLICATION' as LearningStageType },
      ];

      for (const threshold of thresholds) {
        const idx = Math.floor((threshold.pct / 100) * total) - 1;
        if (idx >= 0 && idx < sorted.length) {
          milestones.push({
            id: `lesson-${courseId}-${threshold.pct}`,
            date: new Date(sorted[idx].completedAt).toISOString().split('T')[0],
            stage: threshold.stage,
            stageLabel: STAGE_LABELS[threshold.stage],
            title: threshold.label,
            type: 'LESSON_COMPLETED',
            completion: threshold.pct,
            status: 'completed',
          });
        }
      }
    }
  }

  private static addQuizMilestones(
    data: RawLearnerData,
    milestones: TimelineMilestone[],
    currentStage: LearningStageType
  ) {
    for (const qa of data.quizAttempts) {
      if (qa.status !== 'SUBMITTED' || !qa.submittedAt) continue;

      const passed = qa.passed === true;
      milestones.push({
        id: `quiz-${qa.id}`,
        date: new Date(qa.submittedAt).toISOString().split('T')[0],
        stage: currentStage,
        stageLabel: STAGE_LABELS[currentStage],
        title: `Quiz ${passed ? 'đạt' : 'chưa đạt'}`,
        type: passed ? 'QUIZ_PASSED' : 'QUIZ_FAILED',
        assessment: typeof qa.score === 'number' ? Math.round(qa.score) : undefined,
        status: passed ? 'completed' : 'failed',
        insight: typeof qa.score === 'number'
          ? `Điểm: ${Math.round(qa.score)}%`
          : undefined,
        insightDirection: passed ? 'up' : 'down',
      });
    }
  }

  private static addProjectMilestones(data: RawLearnerData, milestones: TimelineMilestone[]) {
    for (const ps of data.projectSubmissions) {
      if (!ps.createdAt) continue;

      const isEvaluated = ps.status === 'EVALUATED' || ps.status === 'GRADED';
      milestones.push({
        id: `project-${ps.id}`,
        date: new Date(ps.createdAt).toISOString().split('T')[0],
        stage: 'FINAL_PROJECT',
        stageLabel: STAGE_LABELS.FINAL_PROJECT,
        title: isEvaluated ? 'Đồ án đã đánh giá' : 'Đồ án đã nộp',
        type: isEvaluated ? 'PROJECT_EVALUATED' : 'PROJECT_SUBMITTED',
        assessment: ps.score != null ? Math.round(ps.score) : undefined,
        status: isEvaluated ? 'completed' : 'in_progress',
        insight: ps.score != null ? `Điểm đồ án: ${Math.round(ps.score)}` : undefined,
        insightDirection: ps.score && ps.score >= 70 ? 'up' : 'stable',
      });
    }
  }

  private static addCertificateMilestones(data: RawLearnerData, milestones: TimelineMilestone[]) {
    for (const cert of data.certificates) {
      if (!cert.issueDate) continue;

      milestones.push({
        id: `cert-${cert.id}`,
        date: new Date(cert.issueDate).toISOString().split('T')[0],
        stage: 'MASTERY',
        stageLabel: STAGE_LABELS.MASTERY,
        title: `Chứng chỉ được cấp`,
        type: 'CERTIFICATE_ISSUED',
        status: 'completed',
        insight: cert.averageScore
          ? `Điểm trung bình: ${Math.round(cert.averageScore)}%`
          : undefined,
        insightDirection: 'up',
      });
    }
  }
}
