// ============================================================
// Recovery Analyzer
// ============================================================
// Detects observed improvement after revisits and recovery after
// a performance dip. Wording remains observational, not causal.
// ============================================================

import type {
  RawLearnerData,
  RecoveryAnalytics,
  RecoveryDetection,
  RevisitItem,
} from './types';

interface AssessmentScore {
  date: Date;
  score: number;
  title?: string;
}

export class RecoveryAnalyzer {
  static analyze(data: RawLearnerData): RecoveryAnalytics {
    const revisits = this.analyzeRevisits(data);
    const recovery = this.detectRecovery(data);

    if (revisits.length === 0 && !recovery.detected && (recovery.scoreHistory ?? []).length < 2) {
      return {
        status: 'INSUFFICIENT_DATA',
        revisits: [],
        recovery: { detected: false, scoreHistory: [], confidence: 0 },
      };
    }

    return {
      status: 'READY',
      revisits,
      recovery,
    };
  }

  private static analyzeRevisits(data: RawLearnerData): RevisitItem[] {
    const items: RevisitItem[] = [];
    const revisitedLessons = data.lessonProgresses.filter(
      (lessonProgress: any) => (lessonProgress.watchCount || 1) > 1
    );

    for (const lessonProgress of revisitedLessons) {
      const attempts = data.quizAttempts
        .filter((attempt: any) =>
          attempt.status === 'SUBMITTED' &&
          attempt.score != null &&
          this.getAttemptLessonId(attempt) === lessonProgress.lessonId
        )
        .sort((a: any, b: any) =>
          new Date(a.submittedAt || a.startedAt || 0).getTime() -
          new Date(b.submittedAt || b.startedAt || 0).getTime()
        );

      if (attempts.length < 2) continue;

      const beforeScore = this.normalizePercent(attempts[0].score);
      const afterScore = this.normalizePercent(attempts[attempts.length - 1].score);
      const observedImprovement = afterScore - beforeScore;

      items.push({
        contentTitle: lessonProgress.lessonTitle || attempts[0].quiz?.title || lessonProgress.lessonId,
        revisitCount: Math.max((lessonProgress.watchCount || 1) - 1, 0),
        beforeScore,
        afterScore,
        observedImprovement,
      });
    }

    return items
      .sort((a, b) => Math.abs(b.observedImprovement) - Math.abs(a.observedImprovement))
      .slice(0, 5);
  }

  private static detectRecovery(data: RawLearnerData): RecoveryDetection {
    const assessments = this.collectAssessments(data);
    const scores = assessments.map((assessment) => assessment.score);

    if (scores.length < 4) {
      return { detected: false, scoreHistory: scores, confidence: 0 };
    }

    const latestScore = scores[scores.length - 1];
    const previousScores = scores.slice(0, -1);
    const minScore = Math.min(...previousScores);
    const minIndex = scores.indexOf(minScore);

    if (minIndex <= 0 || minIndex >= scores.length - 1) {
      return { detected: false, scoreHistory: scores, confidence: 0.3 };
    }

    const beforePeak = Math.max(...scores.slice(0, minIndex));
    const dipDepth = beforePeak - minScore;
    const recoveryAmount = latestScore - minScore;
    const recentMomentum = latestScore - scores[scores.length - 2];
    const declineStepsBeforeDip = this.countDeclineSteps(scores.slice(0, minIndex + 1));

    const detected =
      declineStepsBeforeDip >= 1 &&
      dipDepth >= 12 &&
      recoveryAmount >= 10 &&
      recoveryAmount >= dipDepth * 0.4 &&
      recentMomentum >= 0;

    if (!detected) {
      return { detected: false, scoreHistory: scores, confidence: 0.35 };
    }

    const confidence = Math.min(
      0.55 +
        Math.min(recoveryAmount / Math.max(dipDepth, 1), 1) * 0.25 +
        Math.min(scores.length / 10, 1) * 0.15,
      0.95
    );
    
    const evidence: string[] = [
      `Kết quả ban đầu đạt ${beforePeak}%.`,
      `Có sự sụt giảm ${Math.round(dipDepth)}% xuống còn ${minScore}%.`,
      `Sau đó, kết quả đã phục hồi lên ${latestScore}% (tăng ${Math.round(recoveryAmount)}%).`
    ];

    return {
      detected: true,
      description: `Kết quả giảm từ ${beforePeak}% xuống ${minScore}% rồi phục hồi lên ${latestScore}% (+${recoveryAmount}%).`,
      scoreHistory: scores,
      confidence: Math.round(confidence * 100) / 100,
      evidence,
    };
  }

  private static collectAssessments(data: RawLearnerData): AssessmentScore[] {
    const assessments: AssessmentScore[] = [];

    for (const attempt of data.quizAttempts) {
      if (attempt.status !== 'SUBMITTED' || attempt.score == null || !attempt.submittedAt) continue;
      assessments.push({
        date: new Date(attempt.submittedAt),
        score: this.normalizePercent(attempt.score),
        title: attempt.quiz?.title,
      });
    }

    for (const evaluation of data.projectEvaluations) {
      const rawScore = evaluation.totalScore ?? evaluation.score;
      const rawDate = evaluation.evaluatedAt ?? evaluation.createdAt;
      if (rawScore == null || !rawDate) continue;

      assessments.push({
        date: new Date(rawDate),
        score: this.normalizePercent(rawScore),
      });
    }

    return assessments.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private static countDeclineSteps(scores: number[]): number {
    let count = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] < scores[i - 1] - 2) count += 1;
    }
    return count;
  }

  private static getAttemptLessonId(attempt: any): string | undefined {
    return attempt.quiz?.lessonId || attempt.lessonId;
  }

  private static normalizePercent(value: number): number {
    return Math.min(Math.max(Math.round(value), 0), 100);
  }
}
