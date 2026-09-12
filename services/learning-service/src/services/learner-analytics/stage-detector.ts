// ============================================================
// Stage Detector
// ============================================================
// Determines learning stage from MILESTONE data, NOT from
// progress percentage alone.
// Uses enrollment status, lesson completion, quiz status,
// project status, and certificate status as evidence.
// ============================================================

import type { RawLearnerData, StageAnalytics, LearningStageType } from './types';

const STAGE_LABELS: Record<LearningStageType, string> = {
  GETTING_STARTED: 'Khởi đầu',
  FOUNDATION: 'Nền tảng',
  DEVELOPMENT: 'Phát triển',
  APPLICATION: 'Ứng dụng',
  FINAL_PROJECT: 'Đồ án cuối khóa',
  ASSESSMENT: 'Đánh giá',
  MASTERY: 'Thành thạo',
};

export class StageDetector {
  /**
   * Detect current learning stage from milestones, NOT from progress %.
   * Priority: MASTERY > ASSESSMENT > FINAL_PROJECT > APPLICATION > DEVELOPMENT > FOUNDATION > GETTING_STARTED
   */
  static detect(data: RawLearnerData): StageAnalytics {
    const evidence: string[] = [];

    // Check milestones from highest to lowest stage
    const hasCertificate = data.certificates.length > 0;
    const hasEvaluatedProject = data.projectSubmissions.some(
      (ps: any) => ps.status === 'EVALUATED' || ps.status === 'GRADED'
    );
    const hasSubmittedProject = data.projectSubmissions.some(
      (ps: any) => ps.status === 'SUBMITTED' || ps.status === 'PENDING_REVIEW'
    );
    const hasPassedQuiz = data.quizAttempts.some(
      (qa: any) => qa.passed === true && qa.status === 'SUBMITTED'
    );
    const completedCourses = data.courseProgresses.filter(
      (cp: any) => cp.progressPercentage >= 100 && cp.completedAt
    );
    const hasCompletedCourse = completedCourses.length > 0;

    // Count completed lessons
    const totalCompletedLessons = data.lessonProgresses.filter(
      (lp: any) => lp.completed
    ).length;
    const totalLessons = data.courseProgresses.reduce(
      (s: number, cp: any) => s + (cp.totalLessons || 0),
      0
    );
    const overallPct = totalLessons > 0
      ? (totalCompletedLessons / totalLessons) * 100
      : 0;

    const hasEnrollment = data.courseProgresses.length > 0 || data.pathEnrollments.length > 0;

    // ── Stage detection with evidence ──
    if (hasCertificate && hasCompletedCourse) {
      evidence.push('Đã nhận chứng chỉ');
      evidence.push(`${completedCourses.length} khóa học hoàn thành`);
      return {
        currentStage: 'MASTERY',
        stageLabel: STAGE_LABELS.MASTERY,
        evidence,
        confidence: 0.95,
      };
    }

    if (hasEvaluatedProject) {
      evidence.push('Đồ án đã được đánh giá');
      return {
        currentStage: 'ASSESSMENT',
        stageLabel: STAGE_LABELS.ASSESSMENT,
        evidence,
        confidence: 0.9,
      };
    }

    if (hasSubmittedProject) {
      evidence.push('Đồ án đã nộp, đang chờ đánh giá');
      return {
        currentStage: 'FINAL_PROJECT',
        stageLabel: STAGE_LABELS.FINAL_PROJECT,
        evidence,
        confidence: 0.9,
      };
    }

    // APPLICATION: has passed quizzes AND completed >50% content
    if (hasPassedQuiz && overallPct > 50) {
      evidence.push('Đã đạt quiz');
      evidence.push(`Tiến độ: ${Math.round(overallPct)}%`);
      return {
        currentStage: 'APPLICATION',
        stageLabel: STAGE_LABELS.APPLICATION,
        evidence,
        confidence: 0.8,
      };
    }

    // DEVELOPMENT: completed >25% content
    if (overallPct > 25) {
      evidence.push(`Tiến độ: ${Math.round(overallPct)}%`);
      evidence.push(`${totalCompletedLessons} bài học hoàn thành`);
      return {
        currentStage: 'DEVELOPMENT',
        stageLabel: STAGE_LABELS.DEVELOPMENT,
        evidence,
        confidence: 0.75,
      };
    }

    // FOUNDATION: has some completed lessons
    if (totalCompletedLessons > 0) {
      evidence.push(`${totalCompletedLessons} bài học đầu tiên hoàn thành`);
      return {
        currentStage: 'FOUNDATION',
        stageLabel: STAGE_LABELS.FOUNDATION,
        evidence,
        confidence: 0.7,
      };
    }

    // GETTING_STARTED: just enrolled
    if (hasEnrollment) {
      evidence.push('Đã đăng ký khóa học/lộ trình');
      return {
        currentStage: 'GETTING_STARTED',
        stageLabel: STAGE_LABELS.GETTING_STARTED,
        evidence,
        confidence: 0.9,
      };
    }

    // No data at all
    evidence.push('Chưa có hoạt động học tập');
    return {
      currentStage: 'GETTING_STARTED',
      stageLabel: STAGE_LABELS.GETTING_STARTED,
      evidence,
      confidence: 0.5,
    };
  }
}
