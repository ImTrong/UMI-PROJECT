// ============================================================
// Bottleneck Detector
// ============================================================
// Uses a composite score from revisit behavior, assessment
// difficulty, failed attempts, related skill mastery, and lack
// of improvement. A revisit alone is not treated as a problem.
// ============================================================

import type {
  BottleneckAnalytics,
  PotentialBottleneck,
  RawLearnerData,
  SkillMetricResult,
} from './types';

interface QuizSignal {
  attempts: number;
  failed: number;
  bestScore: number;
  latestScore: number;
  scores: number[];
  quizTitle?: string;
}

export class BottleneckDetector {
  static detect(
    data: RawLearnerData,
    skills: SkillMetricResult[]
  ): BottleneckAnalytics {
    const quizByLesson = this.groupQuizSignalsByLesson(data.quizAttempts);
    const candidates: PotentialBottleneck[] = [];

    for (const lessonProgress of data.lessonProgresses) {
      const lessonId = lessonProgress.lessonId;
      const quizSignal = quizByLesson.get(lessonId);
      const revisitCount = Math.max((lessonProgress.watchCount || 1) - 1, 0);
      const contentTitle = lessonProgress.lessonTitle || quizSignal?.quizTitle || lessonId;
      const relatedSkillMastery = this.findRelatedSkillMastery(contentTitle, skills);

      const revisitSignal = this.scoreRevisit(revisitCount);
      const assessmentSignal = this.scoreAssessment(quizSignal?.bestScore);
      const failureSignal = this.scoreFailures(quizSignal?.failed ?? 0);
      const skillSignal = this.scoreSkillMastery(relatedSkillMastery);
      const improvementSignal = this.scoreLackOfImprovement(quizSignal?.scores ?? [], revisitCount);

      const bottleneckScore = revisitSignal +
        assessmentSignal +
        failureSignal +
        skillSignal +
        improvementSignal;
      const signalCount = [
        revisitSignal,
        assessmentSignal,
        failureSignal,
        skillSignal,
        improvementSignal,
      ].filter((signal) => signal > 0).length;

      if (bottleneckScore < 25 || signalCount < 2) continue;

      const evidence: string[] = [];
      if (revisitCount > 0) evidence.push(`Đã xem lại bài học ${revisitCount} lần.`);
      if (quizSignal?.failed && quizSignal.failed > 0) evidence.push(`Có ${quizSignal.failed} lần làm bài kiểm tra chưa đạt.`);
      if (quizSignal?.bestScore !== undefined && quizSignal.bestScore < 75) evidence.push(`Điểm số tốt nhất là ${quizSignal.bestScore}%, dưới mức kỳ vọng.`);
      if (relatedSkillMastery !== undefined && relatedSkillMastery < 55) evidence.push(`Mức độ thành thạo của kỹ năng liên quan ở mức thấp (${relatedSkillMastery}%).`);
      if (improvementSignal > 0) evidence.push('Không có dấu hiệu tiến bộ rõ rệt qua các lần làm bài.');

      candidates.push({
        contentTitle,
        contentId: lessonId,
        revisitCount,
        failedAttempts: quizSignal?.failed ?? 0,
        assessmentScore: quizSignal?.bestScore,
        skillMastery: relatedSkillMastery,
        bottleneckScore: Math.min(bottleneckScore, 100),
        severity: this.severityFromScore(bottleneckScore),
        confidence: this.confidenceFromSignals(signalCount, quizSignal != null),
        evidence,
      });
    }

    const bottlenecks = candidates
      .sort((a, b) => b.bottleneckScore - a.bottleneckScore)
      .slice(0, 5);

    if (bottlenecks.length === 0) {
      return { status: 'INSUFFICIENT_DATA', bottlenecks: [], confidence: 0 };
    }

    const confidence = bottlenecks.length > 0
      ? Math.round(
          (bottlenecks.reduce((sum, item) => sum + item.confidence, 0) / bottlenecks.length) * 100
        ) / 100
      : 0;

    return { status: 'READY', bottlenecks, confidence };
  }

  private static groupQuizSignalsByLesson(quizAttempts: any[]): Map<string, QuizSignal> {
    const byLesson = new Map<string, QuizSignal>();

    for (const attempt of quizAttempts) {
      if (attempt.status !== 'SUBMITTED' || attempt.score == null) continue;

      const lessonId = this.getAttemptLessonId(attempt);
      if (!lessonId) continue;

      const score = this.normalizePercent(attempt.score);
      const passingScore = this.normalizePercent(attempt.quiz?.passingScore ?? 70);
      const existing = byLesson.get(lessonId) || {
        attempts: 0,
        failed: 0,
        bestScore: 0,
        latestScore: 0,
        scores: [] as number[],
        quizTitle: attempt.quiz?.title,
      };

      existing.attempts += 1;
      existing.failed += attempt.passed === true && score >= passingScore ? 0 : 1;
      existing.bestScore = Math.max(existing.bestScore, score);
      existing.latestScore = score;
      existing.scores.push(score);
      existing.quizTitle = existing.quizTitle || attempt.quiz?.title;

      byLesson.set(lessonId, existing);
    }

    return byLesson;
  }

  private static scoreRevisit(revisitCount: number): number {
    if (revisitCount <= 0) return 0;
    if (revisitCount === 1) return 8;
    if (revisitCount === 2) return 16;
    return 25;
  }

  private static scoreAssessment(score?: number): number {
    if (score == null) return 0;
    if (score < 50) return 25;
    if (score < 65) return 18;
    if (score < 75) return 8;
    return 0;
  }

  private static scoreFailures(failedAttempts: number): number {
    if (failedAttempts <= 0) return 0;
    if (failedAttempts >= 3) return 25;
    if (failedAttempts === 2) return 18;
    return 10;
  }

  private static scoreSkillMastery(mastery?: number): number {
    if (mastery == null) return 0;
    if (mastery < 40) return 15;
    if (mastery < 55) return 8;
    return 0;
  }

  private static scoreLackOfImprovement(scores: number[], revisitCount: number): number {
    if (revisitCount <= 0 || scores.length < 2) return 0;

    const improvement = scores[scores.length - 1] - scores[0];
    if (improvement < 3 && scores[scores.length - 1] < 65) return 10;
    if (improvement < 8 && scores[scores.length - 1] < 75) return 5;
    return 0;
  }

  private static severityFromScore(score: number): PotentialBottleneck['severity'] {
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  private static confidenceFromSignals(signalCount: number, hasQuizData: boolean): number {
    const base = signalCount >= 4 ? 0.85 : signalCount === 3 ? 0.7 : 0.55;
    return hasQuizData ? base : Math.max(base - 0.15, 0.35);
  }

  private static findRelatedSkillMastery(
    contentTitle: string,
    skills: SkillMetricResult[]
  ): number | undefined {
    const title = this.normalizeText(contentTitle);
    if (!title) return undefined;

    const matches = skills.filter((skill) => {
      const skillName = this.normalizeText(skill.name);
      return skillName && (title.includes(skillName) || skillName.includes(title));
    });

    const validMatches = matches.map(s => s.currentMastery).filter(m => m != null) as number[];
    if (validMatches.length === 0) return undefined;

    return Math.min(...validMatches);
  }

  private static getAttemptLessonId(attempt: any): string | undefined {
    return attempt.quiz?.lessonId || attempt.lessonId;
  }

  private static normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private static normalizePercent(value: number): number {
    return Math.min(Math.max(Math.round(value), 0), 100);
  }
}
