import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import {
  SkillEntry,
  SkillEvidence,
  SkillUpdate,
  SkillLevel,
  SkillSummary,
  SkillGapResult,
} from '../types';

const prisma = new PrismaClient();

/**
 * SkillProfileService — Quản lý Skill Profile của học viên
 * 
 * Nguyên tắc:
 * - Criterion score = evidence, KHÔNG convert trực tiếp sang level
 * - Lưu TOÀN BỘ evidence lịch sử
 * - Tính level từ weighted aggregate của all evidences
 * - Canonical skill names để tránh trùng lặp
 */
export class SkillProfileService {

  // ==================== CRUD ====================

  /**
   * Get or create skill profile for user
   */
  static async getOrCreateProfile(userId: string) {
    let profile = await prisma.userSkillProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      profile = await prisma.userSkillProfile.create({
        data: {
          userId,
          skills: [],
          strengths: [],
          weaknesses: [],
          overallLevel: 'NO_EVIDENCE',
          profileCompleteness: 0,
        },
      });
      logger.info(`[SkillProfile] Created new profile for user: ${userId}`);
    }

    return profile;
  }

  /**
   * Get profile (no create)
   */
  static async getProfile(userId: string) {
    return prisma.userSkillProfile.findUnique({ where: { userId } });
  }

  // ==================== Update from Project Evaluation ====================

  /**
   * Add evidences from a project evaluation and recalculate levels
   */
  static async updateFromEvaluation(
    userId: string,
    skillUpdates: SkillUpdate[],
    evaluationStrengths: string[],
    evaluationWeaknesses: string[]
  ): Promise<void> {
    const invalidateCache = async () => {
      try {
        const { LearnerAnalysisService } = require('./learner-analysis.service');
        await LearnerAnalysisService.invalidateCache(userId, 'SKILL_PROFILE_UPDATED');
      } catch (err) {
        logger.debug(`[SkillProfile] Failed to invalidate learner analysis cache: ${err}`);
      }
    };

    if (skillUpdates.length === 0) {
      logger.info(`[SkillProfile] No skill updates for user: ${userId}`);
      await invalidateCache();
      return;
    }

    const profile = await this.getOrCreateProfile(userId);
    const currentSkills: SkillEntry[] = (profile.skills as any[]) || [];

    // 1. Add new evidences to skills
    const updatedSkills = this.mergeEvidences(currentSkills, skillUpdates);

    // 2. Recalculate levels for all skills with new evidences
    const recalculated = updatedSkills.map(skill => ({
      ...skill,
      level: this.calculateLevel(skill.evidences),
      confidence: this.calculateConfidence(skill.evidences),
    }));

    // 3. Merge strengths/weaknesses (keep unique, max 10 each)
    const allStrengths = [...new Set([...profile.strengths, ...evaluationStrengths])].slice(0, 10);
    const allWeaknesses = [...new Set([...profile.weaknesses, ...evaluationWeaknesses])].slice(0, 10);

    // 4. Calculate overall level and completeness
    const overallLevel = this.calculateOverallLevel(recalculated);
    const profileCompleteness = this.calculateCompleteness(recalculated);

    // 5. Save
    await prisma.userSkillProfile.update({
      where: { userId },
      data: {
        skills: JSON.parse(JSON.stringify(recalculated)),
        strengths: allStrengths,
        weaknesses: allWeaknesses,
        overallLevel,
        profileCompleteness,
      },
    });

    logger.info(`[SkillProfile] Updated profile for user ${userId}: ${recalculated.length} skills, overall=${overallLevel}`);

    // 6. Invalidate LearnerAnalysis cache — skill profile is primary data source
    await invalidateCache();
  }

  // ==================== Evidence Merge ====================

  /**
   * Merge new skill updates into existing skills
   * - If skill exists: append evidence
   * - If new skill: create entry
   */
  static mergeEvidences(
    currentSkills: SkillEntry[],
    updates: SkillUpdate[]
  ): SkillEntry[] {
    // Build a map by canonicalName
    const skillMap = new Map<string, SkillEntry>();
    for (const skill of currentSkills) {
      skillMap.set(skill.canonicalName, { ...skill });
    }

    const now = new Date().toISOString();

    for (const update of updates) {
      const existing = skillMap.get(update.canonicalName);

      if (existing) {
        // Append evidence to existing skill
        existing.evidences.push(update.evidence);
        existing.lastUpdated = now;
      } else {
        // Create new skill entry
        skillMap.set(update.canonicalName, {
          canonicalName: update.canonicalName,
          displayName: update.displayName,
          category: update.category,
          level: 'NO_EVIDENCE', // Will be recalculated
          confidence: 0,
          evidences: [update.evidence],
          lastUpdated: now,
        });
      }
    }

    return Array.from(skillMap.values());
  }

  // ==================== Level Calculation (Weighted Aggregate) ====================

  /**
   * Calculate skill level from ALL evidences using weighted average
   * 
   * NOT: "score >= X → level Y"
   * IS: weighted average of all evidence scores → level thresholds
   * 
   * Evidence weights by source:
   *   PROJECT_EVALUATION = 1.0 (highest — actual code)
   *   QUIZ = 0.5 (Phase 3B)
   *   COURSE_COMPLETION = 0.3 (Phase 3B)
   *   CAREER_ASSESSMENT = 0.4 (Phase 3B)
   */
  static calculateLevel(evidences: SkillEvidence[]): SkillLevel {
    if (evidences.length === 0) return 'NO_EVIDENCE';

    const weightedScore = this.getWeightedScore(evidences);

    // Thresholds cho weighted average (không phải từ 1 criterion)
    if (weightedScore >= 75) return 'ADVANCED';
    if (weightedScore >= 50) return 'INTERMEDIATE';
    return 'BEGINNER';
  }

  /**
   * Calculate weighted average score from all evidences
   */
  static getWeightedScore(evidences: SkillEvidence[]): number {
    if (evidences.length === 0) return 0;

    let totalWeight = 0;
    let weightedSum = 0;

    for (const ev of evidences) {
      const w = ev.weight || 1.0;
      weightedSum += ev.scorePercentage * w;
      totalWeight += w;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Calculate confidence based on evidence quantity and quality
   * More evidences + higher weight evidences → higher confidence
   */
  static calculateConfidence(evidences: SkillEvidence[]): number {
    if (evidences.length === 0) return 0;

    // Base confidence from number of evidences (diminishing returns)
    const countFactor = Math.min(evidences.length / 5, 1.0); // Max at 5 evidences

    // Quality factor from average weight
    const avgWeight = evidences.reduce((sum, e) => sum + (e.weight || 1.0), 0) / evidences.length;
    const qualityFactor = Math.min(avgWeight, 1.0);

    // Consistency factor — how consistent are the scores?
    const scores = evidences.map(e => e.scorePercentage);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    const consistencyFactor = Math.max(0.5, 1 - (stdDev / 50)); // Lower if high variance

    // Combined confidence
    const confidence = 0.4 * countFactor + 0.3 * qualityFactor + 0.3 * consistencyFactor;
    return Math.round(confidence * 100) / 100; // 2 decimal places
  }

  // ==================== Overall Calculations ====================

  /**
   * Calculate overall level from all skills
   */
  static calculateOverallLevel(skills: SkillEntry[]): string {
    if (skills.length === 0) return 'NO_EVIDENCE';

    const levelValues: Record<SkillLevel, number> = {
      'NO_EVIDENCE': 0,
      'BEGINNER': 1,
      'INTERMEDIATE': 2,
      'ADVANCED': 3,
    };

    const validSkills = skills.filter(s => s.level !== 'NO_EVIDENCE');
    if (validSkills.length === 0) return 'NO_EVIDENCE';

    const avgLevel = validSkills.reduce((sum, s) => sum + levelValues[s.level], 0) / validSkills.length;

    if (avgLevel >= 2.5) return 'ADVANCED';
    if (avgLevel >= 1.5) return 'INTERMEDIATE';
    return 'BEGINNER';
  }

  /**
   * Calculate profile completeness (0-100)
   * Based on % of skills with evidence (not NO_EVIDENCE)
   */
  static calculateCompleteness(skills: SkillEntry[]): number {
    if (skills.length === 0) return 0;

    const withEvidence = skills.filter(s => s.level !== 'NO_EVIDENCE').length;
    return Math.round((withEvidence / skills.length) * 100);
  }

  // ==================== Dashboard & Analysis ====================

  /**
   * Get skill summary for dashboard
   */
  static async getSkillSummary(userId: string): Promise<SkillSummary | null> {
    const profile = await this.getProfile(userId);
    if (!profile) return null;

    const skills: SkillEntry[] = (profile.skills as any[]) || [];

    // Count by level
    const skillsByLevel: Record<string, number> = {
      NO_EVIDENCE: 0,
      BEGINNER: 0,
      INTERMEDIATE: 0,
      ADVANCED: 0,
    };
    skills.forEach(s => { skillsByLevel[s.level] = (skillsByLevel[s.level] || 0) + 1; });

    // Top skills (ADVANCED/INTERMEDIATE, sorted by confidence)
    const topSkills = skills
      .filter(s => s.level === 'ADVANCED' || s.level === 'INTERMEDIATE')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .map(s => ({ skill: s.displayName, level: s.level, confidence: s.confidence }));

    // Weak skills (BEGINNER or NO_EVIDENCE with some evidence)
    const weakSkills = skills
      .filter(s => s.level === 'BEGINNER' && s.evidences.length > 0)
      .sort((a, b) => a.confidence - b.confidence)
      .slice(0, 5)
      .map(s => ({ skill: s.displayName, level: s.level, confidence: s.confidence }));

    return {
      totalSkills: skills.length,
      skillsByLevel,
      topSkills,
      weakSkills,
      strengths: profile.strengths,
      weaknesses: profile.weaknesses,
      overallLevel: profile.overallLevel || 'NO_EVIDENCE',
      profileCompleteness: profile.profileCompleteness,
    };
  }

  /**
   * Skill gap analysis — compare current skills vs target
   */
  static async getSkillGapAnalysis(
    userId: string,
    targetSkills: { skill: string; requiredLevel: SkillLevel }[]
  ): Promise<SkillGapResult[]> {
    const profile = await this.getProfile(userId);
    const skills: SkillEntry[] = (profile?.skills as any[]) || [];

    const levelOrder: Record<SkillLevel, number> = {
      'NO_EVIDENCE': 0,
      'BEGINNER': 1,
      'INTERMEDIATE': 2,
      'ADVANCED': 3,
    };

    return targetSkills.map(target => {
      const canonicalTarget = target.skill.toLowerCase().trim();
      const current = skills.find(s => s.canonicalName === canonicalTarget);
      const currentLevel: SkillLevel = current?.level || 'NO_EVIDENCE';

      let gap: 'MET' | 'NEEDS_IMPROVEMENT' | 'MISSING';
      if (levelOrder[currentLevel] >= levelOrder[target.requiredLevel]) {
        gap = 'MET';
      } else if (currentLevel === 'NO_EVIDENCE') {
        gap = 'MISSING';
      } else {
        gap = 'NEEDS_IMPROVEMENT';
      }

      return {
        skill: target.skill,
        currentLevel,
        requiredLevel: target.requiredLevel,
        gap,
        confidence: current?.confidence || 0,
      };
    });
  }
}
