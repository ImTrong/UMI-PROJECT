// ============================================================
// Knowledge Gap Analyzer
// ============================================================
// Compares expected mastery with actual mastery. Expected values
// come from explicit skill requirements when available; otherwise
// a conservative fallback is clearly marked as estimated.
// ============================================================

import type {
  KnowledgeGapAnalytics,
  KnowledgeGapItem,
  RawLearnerData,
  SkillMetricResult,
} from './types';

interface SkillRequirement {
  name: string;
  key: string;
  expected: number | null;
  hasExpectedData: boolean;
  evidence: string[];
}

export class KnowledgeGapAnalyzer {
  static analyze(
    data: RawLearnerData,
    skills: SkillMetricResult[],
    overallCompletion: number
  ): KnowledgeGapAnalytics {
    const assessedSkills = new Map(skills.map((skill) => [this.normalize(skill.name), skill]));
    const requirements = this.collectRequirements(data, skills);
    const gapsBySkill = new Map<string, KnowledgeGapItem>();

    for (const requirement of requirements) {
      const assessed = assessedSkills.get(requirement.key);
      const current = assessed?.currentMastery ?? 0;
      this.addGapIfNeeded(gapsBySkill, requirement, current);
    }

    for (const skill of skills) {
      if (skill.expectedMastery == null || skill.currentMastery == null) continue;

      this.addGapIfNeeded(
        gapsBySkill,
        {
          name: skill.name,
          key: this.normalize(skill.name),
          expected: skill.expectedMastery,
          hasExpectedData: true,
          evidence: ['Expected mastery is stored on the skill profile.'],
        },
        skill.currentMastery
      );
    }

    // No fallback baseline — if there are no explicit requirements, return INSUFFICIENT_DATA
    // DO NOT invent expected mastery when the Learning Path does not define it.

    const gaps = [...gapsBySkill.values()]
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 5);

    if (gaps.length === 0) {
      return { status: 'INSUFFICIENT_DATA', gaps: [], confidence: 0 };
    }

    const realDataCount = gaps.filter((gap) => gap.hasExpectedData).length;
    const confidence = realDataCount > 0
      ? Math.min(0.65 + realDataCount / gaps.length * 0.25, 0.9)
      : 0.5;

    return {
      status: 'READY',
      gaps,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  private static collectRequirements(
    data: RawLearnerData,
    skills: SkillMetricResult[]
  ): SkillRequirement[] {
    const requirements = new Map<string, SkillRequirement>();

    for (const enrollment of data.pathEnrollments) {
      const path = enrollment.learningPath;
      const pathSkills: any[] = Array.isArray(path?.skills) ? path.skills : [];

      for (const rawSkill of pathSkills) {
        const parsed = this.parseRequirement(rawSkill, path?.title);
        if (!parsed) continue;

        const existing = requirements.get(parsed.key);
        if (!existing || parsed.hasExpectedData || (parsed.expected != null && existing.expected != null && parsed.expected > existing.expected)) {
          requirements.set(parsed.key, parsed);
        } else {
          existing.evidence.push(...parsed.evidence);
        }
      }
    }

    for (const skill of skills) {
      if (skill.expectedMastery == null) continue;

      const key = this.normalize(skill.name);
      requirements.set(key, {
        name: skill.name,
        key,
        expected: skill.expectedMastery,
        hasExpectedData: true,
        evidence: ['Expected mastery is stored on the skill profile.'],
      });
    }

    return [...requirements.values()];
  }

  private static parseRequirement(rawSkill: any, pathTitle?: string): SkillRequirement | null {
    const name = typeof rawSkill === 'string'
      ? rawSkill
      : rawSkill?.skill || rawSkill?.name || rawSkill?.displayName || rawSkill?.canonicalName;

    if (!name || typeof name !== 'string') return null;

    const expected = typeof rawSkill === 'object'
      ? this.firstNumericPercent(
          rawSkill.expectedMastery,
          rawSkill.requiredMastery,
          rawSkill.targetMastery,
          rawSkill.expectedScore
        ) ?? this.expectedFromLevel(rawSkill.requiredLevel || rawSkill.level)
      : null;

    const hasExpectedData = expected != null;

    return {
      name,
      key: this.normalize(name),
      expected: expected ?? null,
      hasExpectedData,
      evidence: [
        hasExpectedData
          ? `Requirement from ${pathTitle || 'learning path'} expects ${expected}%.`
          : `Kỹ năng thuộc lộ trình ${pathTitle || 'hiện tại'} nhưng chưa có mức kỳ vọng cụ thể.`,
      ],
    };
  }

  private static addGapIfNeeded(
    gapsBySkill: Map<string, KnowledgeGapItem>,
    requirement: SkillRequirement,
    current: number
  ): void {
    // Cannot calculate gap without explicit expected mastery
    if (requirement.expected == null) return;
    const gapMagnitude = requirement.expected - current;
    if (gapMagnitude <= 10) return;

    const item: KnowledgeGapItem = {
      skill: requirement.name,
      expected: requirement.expected,
      current,
      gap: -Math.abs(Math.round(gapMagnitude)),
      priority: this.priorityFromGap(gapMagnitude, requirement.hasExpectedData),
      hasExpectedData: requirement.hasExpectedData,
      evidence: [...new Set(requirement.evidence)],
    };

    const existing = gapsBySkill.get(requirement.key);
    if (!existing || item.gap < existing.gap || item.hasExpectedData) {
      gapsBySkill.set(requirement.key, item);
    }
  }

  private static priorityFromGap(
    gapMagnitude: number,
    hasExpectedData: boolean
  ): KnowledgeGapItem['priority'] {
    if (gapMagnitude >= 30 || (hasExpectedData && gapMagnitude >= 25)) return 'HIGH';
    if (gapMagnitude >= 18) return 'MEDIUM';
    return 'LOW';
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
        return Math.min(Math.max(Math.round(value), 0), 100);
      }
    }
    return null;
  }

  private static normalize(value: string): string {
    return value.trim().toLowerCase();
  }
}
