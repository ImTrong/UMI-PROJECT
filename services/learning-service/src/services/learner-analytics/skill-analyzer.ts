// ============================================================
// Skill Analyzer
// ============================================================
// Parses UserSkillProfile JSON to extract mastery, growth,
// strengths, improvement areas, and expected mastery when present.
// ============================================================

import type { RawLearnerData, SkillAnalyticsResult, SkillMetricResult } from './types';

export class SkillAnalyzer {
  static analyze(data: RawLearnerData): SkillAnalyticsResult {
    const { skillProfile, courseProgresses } = data;

    if (!skillProfile) {
      return this.emptyResult(courseProgresses);
    }

    const rawSkills: any[] = Array.isArray(skillProfile.skills) ? skillProfile.skills : [];
    const rawStrengths: string[] = Array.isArray(skillProfile.strengths) ? skillProfile.strengths : [];
    const rawWeaknesses: string[] = Array.isArray(skillProfile.weaknesses) ? skillProfile.weaknesses : [];

    if (rawSkills.length === 0) {
      return this.emptyResult(courseProgresses);
    }

    const skills: SkillMetricResult[] = rawSkills.map((skillEntry: any) => {
      const hasRealEvidence = Array.isArray(skillEntry.evidences) && skillEntry.evidences.length > 0;
      const currentMastery = hasRealEvidence ? this.computeCurrentMastery(skillEntry) : null;
      const previousMastery = hasRealEvidence ? this.computePreviousMastery(skillEntry) : null;
      const growth = (previousMastery != null && currentMastery != null)
        ? Math.round(currentMastery - previousMastery)
        : null;
      const expectedMastery = this.extractExpectedMastery(skillEntry);

      return {
        name: skillEntry.displayName || skillEntry.canonicalName || skillEntry.name || 'Unknown',
        category: skillEntry.category || undefined,
        currentMastery: currentMastery ?? null,
        previousMastery: previousMastery ?? undefined,
        growth: growth ?? null,
        trend: !hasRealEvidence ? 'insufficient_data' : previousMastery == null ? 'insufficient_data' : (growth ?? 0) > 2 ? 'up' : (growth ?? 0) < -2 ? 'down' : 'stable',
        expectedMastery,
        masteryGap: (expectedMastery != null && currentMastery != null) ? Math.max(expectedMastery - currentMastery, 0) : null,
        evidences: skillEntry.evidences,
        hasEvidence: hasRealEvidence,
      };
    });

    skills.sort((a, b) => (b.currentMastery ?? 0) - (a.currentMastery ?? 0));

    const strengths = skills.filter(
      (skill) =>
        rawStrengths.some((strength) => this.includesNormalized(strength, skill.name)) ||
        (skill.currentMastery ?? 0) >= 75 ||
        (skill.growth ?? 0) >= 10
    ).slice(0, 5);

    // Only skills WITH real evidence can be improvement areas — no-evidence skills show INSUFFICIENT_DATA
    const skillsWithEvidence = skills.filter((s) => s.hasEvidence && s.currentMastery != null);

    const improvementAreas = skillsWithEvidence.filter(
      (skill) =>
        rawWeaknesses.some((weakness) => this.includesNormalized(weakness, skill.name)) ||
        (skill.currentMastery as number) < 50 ||
        (skill.growth != null && skill.growth <= -5) ||
        (skill.masteryGap != null && skill.masteryGap >= 15)
    ).slice(0, 5);

    // overallMastery excludes skills without evidence — no-data ≠ 0%
    const overallMastery = skillsWithEvidence.length > 0
      ? Math.round(skillsWithEvidence.reduce((sum, skill) => sum + (skill.currentMastery as number), 0) / skillsWithEvidence.length)
      : null;

    const totalProgress = this.computeOverallCompletion(courseProgresses);
    const completionVsMastery = {
      completion: totalProgress,
      mastery: overallMastery,
      gap: overallMastery != null ? Math.max(totalProgress - overallMastery, 0) : 0,
    };

    const evidenceCount = rawSkills.reduce(
      (sum, skillEntry) => sum + (Array.isArray(skillEntry.evidences) ? skillEntry.evidences.length : 0),
      0
    );
    const confidence = skills.length >= 5 && evidenceCount >= 5
      ? 0.85
      : skills.length >= 2 && evidenceCount >= 2
        ? 0.65
        : skills.length > 0
          ? 0.4
          : 0;

    return {
      status: 'READY',
      skills,
      strengths,
      improvementAreas,
      overallMastery,
      completionVsMastery,
      confidence,
    };
  }

  private static computeCurrentMastery(skillEntry: any): number {
    const evidences: any[] = Array.isArray(skillEntry.evidences) ? skillEntry.evidences : [];
    const evidenceScore = this.weightedEvidenceScore(evidences);
    if (evidenceScore != null) return evidenceScore;

    const directScore = this.firstNumericPercent(
      skillEntry.currentMastery,
      skillEntry.mastery,
      skillEntry.score,
      skillEntry.scorePercentage
    );
    if (directScore != null) return directScore;

    return this.levelToMastery(skillEntry.level, skillEntry.confidence);
  }

  private static computePreviousMastery(skillEntry: any): number | null {
    const evidences: any[] = Array.isArray(skillEntry.evidences) ? skillEntry.evidences : [];
    if (evidences.length < 2) return null;

    const sorted = [...evidences].sort(
      (a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime()
    );

    return this.weightedEvidenceScore(sorted.slice(0, -1));
  }

  private static extractExpectedMastery(skillEntry: any): number | null {
    const direct = this.firstNumericPercent(
      skillEntry.expectedMastery,
      skillEntry.targetMastery,
      skillEntry.requiredMastery,
      skillEntry.expectedScore,
      skillEntry.requiredScore
    );
    if (direct != null) return direct;

    const nested = skillEntry.requirement || skillEntry.requirements || skillEntry.target || skillEntry.expected;
    if (nested && typeof nested === 'object') {
      const nestedValue = this.firstNumericPercent(
        nested.expectedMastery,
        nested.targetMastery,
        nested.requiredMastery,
        nested.expectedScore,
        nested.requiredScore
      );
      if (nestedValue != null) return nestedValue;

      const requiredLevel = nested.requiredLevel || nested.level;
      const levelExpected = this.expectedFromLevel(requiredLevel);
      if (levelExpected != null) return levelExpected;
    }

    return this.expectedFromLevel(skillEntry.requiredLevel);
  }

  private static computeOverallCompletion(courseProgresses: any[]): number {
    if (courseProgresses.length === 0) return 0;

    const totalLessons = courseProgresses.reduce(
      (sum: number, course) => sum + (course.totalLessons || 0),
      0
    );
    const completedLessons = courseProgresses.reduce(
      (sum: number, course) => sum + (course.completedLessons || 0),
      0
    );

    if (totalLessons > 0) {
      return Math.round((completedLessons / totalLessons) * 100);
    }

    return Math.round(
      courseProgresses.reduce((sum: number, course) => sum + (course.progressPercentage || 0), 0) /
        courseProgresses.length
    );
  }

  private static weightedEvidenceScore(evidences: any[]): number | null {
    const usable = evidences
      .map((evidence) => ({
        score: this.firstNumericPercent(
          evidence.scorePercentage,
          evidence.score,
          evidence.percentage
        ),
        weight: typeof evidence.weight === 'number' && evidence.weight > 0 ? evidence.weight : 1,
      }))
      .filter((evidence): evidence is { score: number; weight: number } => evidence.score != null);

    if (usable.length === 0) return null;

    const totalWeight = usable.reduce((sum, evidence) => sum + evidence.weight, 0);
    const weighted = usable.reduce(
      (sum, evidence) => sum + evidence.score * evidence.weight,
      0
    ) / totalWeight;

    return this.normalizePercent(weighted);
  }

  private static levelToMastery(level: string, confidence?: number): number {
    const baseMap: Record<string, number> = {
      NO_EVIDENCE: 0,
      BEGINNER: 25,
      INTERMEDIATE: 50,
      ADVANCED: 75,
      EXPERT: 90,
    };
    const base = baseMap[level] || 0;
    const conf = typeof confidence === 'number' ? confidence : 0.5;
    return this.normalizePercent(base + (conf * 10));
  }

  private static expectedFromLevel(level: any): number | null {
    const map: Record<string, number> = {
      BEGINNER: 40,
      INTERMEDIATE: 65,
      ADVANCED: 80,
      EXPERT: 90,
    };
    return typeof level === 'string' ? map[level.toUpperCase()] ?? null : null;
  }

  private static firstNumericPercent(...values: any[]): number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return this.normalizePercent(value);
      }
    }
    return null;
  }

  private static normalizePercent(value: number): number {
    return Math.min(Math.max(Math.round(value), 0), 100);
  }

  private static includesNormalized(source: string, needle: string): boolean {
    return source.toLowerCase().includes(needle.toLowerCase());
  }

  private static emptyResult(courseProgresses: any[]): SkillAnalyticsResult {
    return {
      status: 'INSUFFICIENT_DATA',
      skills: [],
      strengths: [],
      improvementAreas: [],
      overallMastery: null,
      completionVsMastery: null,
      confidence: 0,
    };
  }
}
