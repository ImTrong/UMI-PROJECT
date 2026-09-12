import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { SkillLevel, SkillEntry, SkillEvidence } from '../types';
import {
  LearnerCompetencyProfile,
  LearningProgressSummary,
  QuizPerformanceSummary,
  SkillAssessment,
  StrengthWeaknessItem,
  CareerFitAnalysis,
  CareerFitLevel,
  SkillGapItem,
  SkillGapStatus,
  DataSourceUsed,
  InvalidationEvent,
  LEVEL_RULES,
  CAREER_FIT_WEIGHTS,
  CAREER_FIT_THRESHOLDS,
  DEFAULT_REQUIRED_LEVEL,
  ANALYSIS_CACHE_TTL_HOURS,
} from '../types/learner-analysis.types';
import { SkillProfileService } from './skill-profile.service';

const prisma = new PrismaClient();

// Current data version — increment when profile schema changes
const CURRENT_DATA_VERSION = 1;

/**
 * LearnerAnalysisService — Xây dựng Learner Competency Profile
 * 
 * Tổng hợp dữ liệu từ nhiều nguồn (CourseProgress, QuizAttempt, LearningPath,
 * ProjectEvaluation, UserSkillProfile, Certificate) thành cấu trúc phân tích
 * chuẩn hóa cho Dashboard và AI Service.
 * 
 * Nguyên tắc:
 * - UserSkillProfile (ProjectEvaluation) = nguồn chính năng lực
 * - Quiz/Course = dữ liệu bổ trợ, KHÔNG biến thành skill evidence
 * - Career Fit = weighted scoring (MET/NEEDS_IMPROVEMENT/MISSING)
 * - Cache = event-driven invalidation + TTL 6h fallback
 * - Overall Level = multi-evidence rules
 */
export class LearnerAnalysisService {

  // ==================== Public API ====================

  /**
   * Get or build the Learner Competency Profile
   * Uses cached version if valid, otherwise rebuilds
   */
  static async getProfile(userId: string): Promise<LearnerCompetencyProfile> {
    // 1. Check cache
    const cached = await this.getCachedProfile(userId);
    if (cached) {
      logger.debug(`[LearnerAnalysis] Cache hit for user ${userId}`);
      return cached;
    }

    // 2. Build fresh profile
    logger.info(`[LearnerAnalysis] Building profile for user ${userId}`);
    const profile = await this.buildProfile(userId);

    // 3. Save to cache
    await this.saveToCache(userId, profile);

    return profile;
  }

  /**
   * Get only Career Fit Analysis
   */
  static async getCareerFitAnalysis(userId: string): Promise<CareerFitAnalysis[]> {
    const profile = await this.getProfile(userId);
    return profile.careerFitAnalysis;
  }

  /**
   * Get extended skills summary (richer than SkillProfileService.getSkillSummary)
   */
  static async getExtendedSkillsSummary(userId: string): Promise<{
    acquiredSkills: SkillAssessment[];
    currentLevel: SkillLevel;
    levelConfidence: number;
    strengths: StrengthWeaknessItem[];
    weaknesses: StrengthWeaknessItem[];
    learningProgress: LearningProgressSummary;
  }> {
    const profile = await this.getProfile(userId);
    return {
      acquiredSkills: profile.acquiredSkills,
      currentLevel: profile.currentLevel,
      levelConfidence: profile.levelConfidence,
      strengths: profile.strengths,
      weaknesses: profile.weaknesses,
      learningProgress: profile.learningProgress,
    };
  }

  /**
   * Force refresh — invalidate cache and rebuild
   */
  static async refreshProfile(userId: string): Promise<LearnerCompetencyProfile> {
    await this.invalidateCache(userId, 'MANUAL_REFRESH');
    return this.getProfile(userId);
  }

  /**
   * Invalidate cache for a user — called on data-changing events
   */
  static async invalidateCache(userId: string, event: InvalidationEvent): Promise<void> {
    try {
      await prisma.learnerAnalysis.updateMany({
        where: { userId },
        data: { invalidatedAt: new Date() },
      });
      logger.info(`[LearnerAnalysis] Cache invalidated for user ${userId}, event: ${event}`);
    } catch (err: any) {
      // Not found is OK — means no cache to invalidate
      logger.debug(`[LearnerAnalysis] No cache to invalidate for user ${userId}: ${err.message}`);
    }
  }

  // ==================== Profile Builder ====================

  /**
   * Build a fresh LearnerCompetencyProfile from all data sources
   */
  static async buildProfile(userId: string): Promise<LearnerCompetencyProfile> {
    const dataSources: DataSourceUsed[] = [];

    // Fetch all data in parallel
    const [
      learningProgress,
      skillData,
      evaluationData,
      pathData,
    ] = await Promise.all([
      this.aggregateLearningProgress(userId, dataSources),
      this.aggregateSkills(userId, dataSources),
      this.aggregateEvaluationData(userId, dataSources),
      this.aggregatePathData(userId, dataSources),
    ]);

    // Analyze strengths & weaknesses
    const { strengths, weaknesses } = this.analyzeStrengthsWeaknesses(
      skillData.skills,
      evaluationData,
      learningProgress
    );

    // Analyze career fit
    const careerFitAnalysis = this.analyzeCareerFit(
      pathData,
      skillData.skills,
      learningProgress
    );

    // Determine overall level
    const { level, confidence, reasoning } = this.determineOverallLevel(
      skillData.skills,
      evaluationData,
      learningProgress
    );

    // Calculate data completeness
    const dataCompleteness = this.calculateDataCompleteness(dataSources);

    const profile: LearnerCompetencyProfile = {
      userId,
      currentLevel: level,
      levelConfidence: confidence,
      levelReasoning: reasoning,
      learningProgress,
      acquiredSkills: skillData.skills,
      strengths,
      weaknesses,
      careerFitAnalysis,
      analyzedAt: new Date().toISOString(),
      dataCompleteness,
      dataSources,
    };

    return profile;
  }

  // ==================== Sub-Aggregators ====================

  /**
   * Aggregate learning progress from CourseProgress, UserProgress, Quiz, Certificates
   */
  static async aggregateLearningProgress(
    userId: string,
    dataSources: DataSourceUsed[]
  ): Promise<LearningProgressSummary> {
    // Fetch data in parallel
    const [
      userProgress,
      courseProgresses,
      quizAttempts,
      certificates,
      projectSubmissions,
      projectEvaluations,
    ] = await Promise.all([
      prisma.userProgress.findUnique({ where: { userId } }),
      prisma.courseProgress.findMany({ where: { userId } }),
      prisma.quizAttempt.findMany({ where: { userId, status: 'SUBMITTED' } }),
      prisma.certificate.findMany({ where: { userId } }),
      prisma.finalProjectSubmission.findMany({ where: { userId } }),
      prisma.projectEvaluation.findMany({ where: { userId } }),
    ]);

    // Track data sources
    dataSources.push(
      { source: 'UserProgress', recordCount: userProgress ? 1 : 0, hasData: !!userProgress },
      { source: 'CourseProgress', recordCount: courseProgresses.length, hasData: courseProgresses.length > 0 },
      { source: 'QuizAttempt', recordCount: quizAttempts.length, hasData: quizAttempts.length > 0 },
      { source: 'Certificate', recordCount: certificates.length, hasData: certificates.length > 0 },
      { source: 'FinalProjectSubmission', recordCount: projectSubmissions.length, hasData: projectSubmissions.length > 0 },
      { source: 'ProjectEvaluation', recordCount: projectEvaluations.length, hasData: projectEvaluations.length > 0 },
    );

    // Course stats
    const completedCourses = courseProgresses.filter(c => c.progressPercentage >= 100).length;
    const inProgressCourses = courseProgresses.filter(c => c.progressPercentage > 0 && c.progressPercentage < 100).length;
    const totalCourses = courseProgresses.length;
    const averageCourseProgress = totalCourses > 0
      ? Math.round(courseProgresses.reduce((sum, c) => sum + c.progressPercentage, 0) / totalCourses)
      : 0;
    const completionRate = totalCourses > 0
      ? Math.round((completedCourses / totalCourses) * 100)
      : 0;

    // Quiz performance (supporting data only)
    const coursesWithQuiz = courseProgresses.filter(c => c.averageQuizScore !== null && c.averageQuizScore !== undefined);
    const quizScores = coursesWithQuiz.map(c => c.averageQuizScore!);
    const averageQuizScore = quizScores.length > 0
      ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length)
      : 0;
    const passedQuizAttempts = quizAttempts.filter(q => q.passed);
    const quizPassRate = quizAttempts.length > 0
      ? Math.round((passedQuizAttempts.length / quizAttempts.length) * 100)
      : 0;

    const quizPerformance: QuizPerformanceSummary = {
      totalQuizAttempts: quizAttempts.length,
      averageQuizScore,
      quizPassRate,
      coursesWithQuizData: coursesWithQuiz.length,
    };

    // Learning paths
    const pathEnrollments = await prisma.userPathEnrollment.findMany({ where: { userId } });
    const activePaths = pathEnrollments.filter(p => p.status === 'IN_PROGRESS').length;
    const completedPaths = pathEnrollments.filter(p => p.status === 'COMPLETED').length;

    // Certificates
    const courseCerts = certificates.filter(c => c.type === 'COURSE_COMPLETION').length;
    const pathCerts = certificates.filter(c => c.type === 'PATH_CERTIFICATE').length;

    // Project evaluations
    const evaluatedProjects = projectEvaluations.length;
    const avgProjectScore = evaluatedProjects > 0
      ? Math.round(projectEvaluations.reduce((sum, e) => sum + (e.totalScore as number || 0), 0) / evaluatedProjects)
      : 0;

    // Study time
    const totalStudyHours = userProgress
      ? Math.round((userProgress.totalStudyTime / 3600) * 10) / 10
      : 0;

    return {
      totalCourses,
      completedCourses,
      inProgressCourses,
      averageCourseProgress,
      completionRate,
      quizPerformance,
      activeLearningPaths: activePaths,
      completedPaths,
      totalStudyHours,
      streakDays: userProgress?.streakDays || 0,
      totalCertificates: certificates.length,
      courseCertificates: courseCerts,
      pathCertificates: pathCerts,
      totalProjectSubmissions: projectSubmissions.length,
      evaluatedProjects,
      averageProjectScore: avgProjectScore,
    };
  }

  /**
   * Aggregate skills — PRIMARY source: UserSkillProfile (from ProjectEvaluation)
   * Quiz/Course are NOT converted to skill evidence
   */
  static async aggregateSkills(
    userId: string,
    dataSources: DataSourceUsed[]
  ): Promise<{ skills: SkillAssessment[] }> {
    const profile = await SkillProfileService.getProfile(userId);
    const skills: SkillEntry[] = (profile?.skills as any[]) || [];

    dataSources.push({
      source: 'UserSkillProfile',
      recordCount: skills.length,
      hasData: skills.length > 0,
    });

    const assessments: SkillAssessment[] = skills
      .filter(s => s.level !== 'NO_EVIDENCE')
      .map(s => ({
        skill: s.displayName,
        canonicalName: s.canonicalName,
        category: s.category,
        level: s.level,
        confidence: s.confidence,
        score: SkillProfileService.getWeightedScore(s.evidences),
        evidenceCount: s.evidences.length,
        sources: [...new Set(s.evidences.map(e => e.source))] as any[],
      }));

    // Sort by confidence desc, then score desc
    assessments.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.score - a.score;
    });

    return { skills: assessments };
  }

  /**
   * Aggregate evaluation data for strength/weakness analysis
   */
  static async aggregateEvaluationData(
    userId: string,
    dataSources: DataSourceUsed[]
  ): Promise<{
    evaluations: any[];
    overallStrengths: string[];
    overallWeaknesses: string[];
  }> {
    const evaluations = await prisma.projectEvaluation.findMany({
      where: { userId },
      orderBy: { evaluatedAt: 'desc' },
    });

    dataSources.push({
      source: 'ProjectEvaluation',
      recordCount: evaluations.length,
      hasData: evaluations.length > 0,
    });

    // Collect all strengths/weaknesses from evaluations
    const allStrengths: string[] = [];
    const allWeaknesses: string[] = [];
    for (const ev of evaluations) {
      allStrengths.push(...(ev.overallStrengths || []));
      allWeaknesses.push(...(ev.overallWeaknesses || []));
    }

    return {
      evaluations,
      overallStrengths: [...new Set(allStrengths)],
      overallWeaknesses: [...new Set(allWeaknesses)],
    };
  }

  /**
   * Aggregate learning path data for career fit analysis
   */
  static async aggregatePathData(
    userId: string,
    dataSources: DataSourceUsed[]
  ): Promise<Array<{
    pathId: string;
    title: string;
    careerGoal: string;
    skills: string[];
    enrolled: boolean;
    status: string;
    courseIds: string[];
  }>> {
    // Get enrolled paths
    const enrollments = await prisma.userPathEnrollment.findMany({
      where: { userId },
      include: { learningPath: true },
    });

    dataSources.push({
      source: 'UserPathEnrollment',
      recordCount: enrollments.length,
      hasData: enrollments.length > 0,
    });

    return enrollments.map(e => ({
      pathId: e.learningPath.id,
      title: e.learningPath.title,
      careerGoal: e.learningPath.careerGoal || '',
      skills: e.learningPath.skills || [],
      enrolled: true,
      status: e.status,
      courseIds: e.learningPath.courseIds || [],
    }));
  }

  // ==================== Analyzers ====================

  /**
   * Analyze strengths and weaknesses from multiple sources
   */
  static analyzeStrengthsWeaknesses(
    skills: SkillAssessment[],
    evaluationData: {
      evaluations: any[];
      overallStrengths: string[];
      overallWeaknesses: string[];
    },
    learningProgress: LearningProgressSummary
  ): { strengths: StrengthWeaknessItem[]; weaknesses: StrengthWeaknessItem[] } {
    const strengths: StrengthWeaknessItem[] = [];
    const weaknesses: StrengthWeaknessItem[] = [];

    // 1. From skill profile — ADVANCED skills = strengths, BEGINNER skills = weaknesses
    for (const skill of skills) {
      if (skill.level === 'ADVANCED') {
        strengths.push({
          area: skill.skill,
          category: skill.category,
          detail: `Đạt trình độ Advanced với ${skill.evidenceCount} evidence, confidence ${Math.round(skill.confidence * 100)}%`,
          source: 'SKILL_PROFILE',
          confidence: skill.confidence,
        });
      } else if (skill.level === 'BEGINNER' && skill.evidenceCount > 0) {
        weaknesses.push({
          area: skill.skill,
          category: skill.category,
          detail: `Chỉ đạt trình độ Beginner — cần cải thiện thêm`,
          source: 'SKILL_PROFILE',
          confidence: skill.confidence,
        });
      }
    }

    // 2. From project evaluation results
    for (const strength of evaluationData.overallStrengths) {
      // Avoid duplicates with skill-based strengths
      if (!strengths.some(s => s.area.toLowerCase() === strength.toLowerCase())) {
        strengths.push({
          area: strength,
          category: 'Project',
          detail: `Được ghi nhận là điểm mạnh qua đánh giá đồ án`,
          source: 'PROJECT_EVALUATION',
          confidence: 0.8,
        });
      }
    }

    for (const weakness of evaluationData.overallWeaknesses) {
      if (!weaknesses.some(w => w.area.toLowerCase() === weakness.toLowerCase())) {
        weaknesses.push({
          area: weakness,
          category: 'Project',
          detail: `Được ghi nhận là điểm cần cải thiện qua đánh giá đồ án`,
          source: 'PROJECT_EVALUATION',
          confidence: 0.8,
        });
      }
    }

    // 3. From learning progress (supporting patterns)
    if (learningProgress.completionRate >= 80 && learningProgress.totalCourses >= 3) {
      strengths.push({
        area: 'Tính kiên trì',
        category: 'Learning',
        detail: `Tỷ lệ hoàn thành khóa học ${learningProgress.completionRate}% trên ${learningProgress.totalCourses} khóa`,
        source: 'LEARNING_PROGRESS',
        confidence: 0.7,
      });
    }

    if (learningProgress.quizPerformance.averageQuizScore >= 85 && learningProgress.quizPerformance.coursesWithQuizData >= 2) {
      strengths.push({
        area: 'Nắm vững lý thuyết',
        category: 'Learning',
        detail: `Điểm quiz trung bình ${learningProgress.quizPerformance.averageQuizScore}% trên ${learningProgress.quizPerformance.coursesWithQuizData} khóa`,
        source: 'QUIZ_PERFORMANCE',
        confidence: 0.6,
      });
    }

    if (learningProgress.quizPerformance.quizPassRate < 50 && learningProgress.quizPerformance.totalQuizAttempts >= 3) {
      weaknesses.push({
        area: 'Kiến thức lý thuyết',
        category: 'Learning',
        detail: `Tỷ lệ pass quiz chỉ ${learningProgress.quizPerformance.quizPassRate}% — cần ôn lại kiến thức nền tảng`,
        source: 'QUIZ_PERFORMANCE',
        confidence: 0.6,
      });
    }

    // Sort by confidence desc and limit to 10 each
    strengths.sort((a, b) => b.confidence - a.confidence);
    weaknesses.sort((a, b) => b.confidence - a.confidence);

    return {
      strengths: strengths.slice(0, 10),
      weaknesses: weaknesses.slice(0, 10),
    };
  }

  /**
   * Analyze career fit for all enrolled learning paths
   * 
   * Career Fit Score = weighted scoring:
   *   MET → 1.0 (full contribution)
   *   NEEDS_IMPROVEMENT → 0.5 (partial contribution)
   *   MISSING → 0 (no contribution)
   */
  static analyzeCareerFit(
    pathData: Array<{
      pathId: string;
      title: string;
      careerGoal: string;
      skills: string[];
      enrolled: boolean;
      status: string;
    }>,
    acquiredSkills: SkillAssessment[],
    learningProgress: LearningProgressSummary
  ): CareerFitAnalysis[] {
    if (pathData.length === 0) return [];

    const analyses: CareerFitAnalysis[] = [];

    for (const path of pathData) {
      if (path.skills.length === 0) continue;

      const matchedSkills: SkillGapItem[] = [];
      const improvableSkills: SkillGapItem[] = [];
      const missingSkills: SkillGapItem[] = [];

      for (const requiredSkill of path.skills) {
        const canonicalRequired = requiredSkill.toLowerCase().trim();
        const current = acquiredSkills.find(
          s => s.canonicalName === canonicalRequired ||
               s.skill.toLowerCase() === canonicalRequired
        );

        // requiredLevel is optional → fallback to INTERMEDIATE
        const requiredLevel: SkillLevel = DEFAULT_REQUIRED_LEVEL;

        const currentLevel: SkillLevel = current?.level || 'NO_EVIDENCE';
        const currentScore = current?.score || 0;

        const levelOrder: Record<SkillLevel, number> = {
          'NO_EVIDENCE': 0,
          'BEGINNER': 1,
          'INTERMEDIATE': 2,
          'ADVANCED': 3,
        };

        let gap: SkillGapStatus;
        if (levelOrder[currentLevel] >= levelOrder[requiredLevel]) {
          gap = 'MET';
        } else if (currentLevel === 'NO_EVIDENCE') {
          gap = 'MISSING';
        } else {
          gap = 'NEEDS_IMPROVEMENT';
        }

        const item: SkillGapItem = {
          skill: requiredSkill,
          currentLevel,
          requiredLevel,
          gap,
          currentScore,
        };

        switch (gap) {
          case 'MET': matchedSkills.push(item); break;
          case 'NEEDS_IMPROVEMENT': improvableSkills.push(item); break;
          case 'MISSING': missingSkills.push(item); break;
        }
      }

      // Calculate weighted fit score
      const totalRequired = path.skills.length;
      let weightedSum = 0;
      for (const s of matchedSkills) {
        weightedSum += CAREER_FIT_WEIGHTS.MET;
      }
      for (const s of improvableSkills) {
        weightedSum += CAREER_FIT_WEIGHTS.NEEDS_IMPROVEMENT;
      }
      // MISSING contributes 0

      const fitScore = totalRequired > 0
        ? Math.round((weightedSum / totalRequired) * 100)
        : 0;

      // Determine fit level
      let fitLevel: CareerFitLevel = 'EARLY_STAGE';
      if (fitScore >= CAREER_FIT_THRESHOLDS.EXCELLENT) fitLevel = 'EXCELLENT';
      else if (fitScore >= CAREER_FIT_THRESHOLDS.GOOD) fitLevel = 'GOOD';
      else if (fitScore >= CAREER_FIT_THRESHOLDS.DEVELOPING) fitLevel = 'DEVELOPING';

      // Generate deterministic recommendation
      const recommendation = this.generateCareerRecommendation(
        fitLevel,
        missingSkills,
        improvableSkills,
        path.title
      );

      analyses.push({
        careerGoal: path.careerGoal || path.title,
        pathId: path.pathId,
        pathTitle: path.title,
        fitScore,
        fitLevel,
        totalRequiredSkills: totalRequired,
        matchedSkills,
        improvableSkills,
        missingSkills,
        recommendation,
      });
    }

    // Sort by fitScore desc
    analyses.sort((a, b) => b.fitScore - a.fitScore);

    return analyses;
  }

  /**
   * Determine overall level using multi-evidence rules
   * 
   * NOT a simple weighted average. Uses conditions:
   * 
   * ADVANCED:
   *   - >= 5 skills có evidence
   *   - >= 2 project evaluations passed
   *   - >= 50% skills ở ADVANCED
   * 
   * INTERMEDIATE:
   *   - >= 3 skills có evidence
   *   - >= 1 project evaluation
   *   - >= 50% skills ở INTERMEDIATE+
   * 
   * BEGINNER:
   *   - Mọi trường hợp khác có evidence
   * 
   * NO_EVIDENCE:
   *   - Không có dữ liệu skill nào
   */
  static determineOverallLevel(
    skills: SkillAssessment[],
    evaluationData: {
      evaluations: any[];
      overallStrengths: string[];
      overallWeaknesses: string[];
    },
    learningProgress: LearningProgressSummary
  ): { level: SkillLevel; confidence: number; reasoning: string } {
    const skillsWithEvidence = skills.filter(s => s.level !== 'NO_EVIDENCE');
    const skillCount = skillsWithEvidence.length;
    const projectEvaluationCount = evaluationData.evaluations.length;
    const passedEvaluations = evaluationData.evaluations.filter(
      (e: any) => e.passed === true
    ).length;

    // No evidence at all
    if (skillCount === 0 && projectEvaluationCount === 0) {
      return {
        level: 'NO_EVIDENCE',
        confidence: 0,
        reasoning: 'Chưa có dữ liệu đánh giá năng lực. Hãy hoàn thành đồ án cuối kỳ để hệ thống phân tích.',
      };
    }

    // Count skills by level
    const advancedCount = skillsWithEvidence.filter(s => s.level === 'ADVANCED').length;
    const intermediateCount = skillsWithEvidence.filter(s => s.level === 'INTERMEDIATE').length;
    const intermediateOrAbove = advancedCount + intermediateCount;

    // Check ADVANCED rules
    const advancedRules = LEVEL_RULES.ADVANCED;
    if (
      skillCount >= advancedRules.minimumSkillsWithEvidence &&
      passedEvaluations >= advancedRules.minimumProjectEvaluations &&
      skillCount > 0 &&
      (advancedCount / skillCount) >= advancedRules.dominantLevelThreshold
    ) {
      const confidence = Math.min(
        0.5 + (advancedCount / skillCount) * 0.3 + Math.min(passedEvaluations / 5, 0.2),
        1.0
      );
      return {
        level: 'ADVANCED',
        confidence: Math.round(confidence * 100) / 100,
        reasoning: `Đạt trình độ Advanced: ${advancedCount}/${skillCount} kỹ năng ở mức Advanced, ${passedEvaluations} đồ án đã đạt.`,
      };
    }

    // Check INTERMEDIATE rules
    const intermediateRules = LEVEL_RULES.INTERMEDIATE;
    if (
      skillCount >= intermediateRules.minimumSkillsWithEvidence &&
      passedEvaluations >= intermediateRules.minimumProjectEvaluations &&
      skillCount > 0 &&
      (intermediateOrAbove / skillCount) >= intermediateRules.dominantLevelThreshold
    ) {
      const confidence = Math.min(
        0.4 + (intermediateOrAbove / skillCount) * 0.3 + Math.min(passedEvaluations / 3, 0.2),
        1.0
      );
      return {
        level: 'INTERMEDIATE',
        confidence: Math.round(confidence * 100) / 100,
        reasoning: `Đạt trình độ Intermediate: ${intermediateOrAbove}/${skillCount} kỹ năng ở mức Intermediate trở lên, ${passedEvaluations} đồ án đã đạt.`,
      };
    }

    // BEGINNER — has some evidence but not enough for higher levels
    if (skillCount > 0 || projectEvaluationCount > 0) {
      const confidence = Math.min(
        0.3 + Math.min(skillCount / 5, 0.3) + Math.min(projectEvaluationCount / 3, 0.2),
        0.8 // Max 0.8 for BEGINNER
      );
      return {
        level: 'BEGINNER',
        confidence: Math.round(confidence * 100) / 100,
        reasoning: `Trình độ Beginner: ${skillCount} kỹ năng có evidence, ${projectEvaluationCount} đồ án đã đánh giá. Cần thêm dữ liệu để xác định chính xác hơn.`,
      };
    }

    return {
      level: 'NO_EVIDENCE',
      confidence: 0,
      reasoning: 'Chưa có đủ dữ liệu đánh giá.',
    };
  }

  // ==================== Career Recommendation (Deterministic) ====================

  /**
   * Generate deterministic recommendation text based on fit analysis
   * NO AI — pure rule-based
   */
  static generateCareerRecommendation(
    fitLevel: CareerFitLevel,
    missingSkills: SkillGapItem[],
    improvableSkills: SkillGapItem[],
    pathTitle: string
  ): string {
    switch (fitLevel) {
      case 'EXCELLENT':
        return `Bạn đã đạt phần lớn yêu cầu kỹ năng cho lộ trình "${pathTitle}". Hãy tiếp tục hoàn thiện và nâng cao các kỹ năng chuyên sâu.`;

      case 'GOOD': {
        const improve = improvableSkills.map(s => s.skill).join(', ');
        return `Bạn đang trên đường hoàn thành lộ trình "${pathTitle}". Cần nâng cao: ${improve || 'một số kỹ năng'}.`;
      }

      case 'DEVELOPING': {
        const missing = missingSkills.map(s => s.skill).slice(0, 3).join(', ');
        const improve = improvableSkills.map(s => s.skill).slice(0, 3).join(', ');
        const parts: string[] = [];
        if (missing) parts.push(`Thiếu: ${missing}`);
        if (improve) parts.push(`Cần cải thiện: ${improve}`);
        return `Lộ trình "${pathTitle}" còn cần nhiều nỗ lực. ${parts.join('. ')}.`;
      }

      case 'EARLY_STAGE': {
        const total = missingSkills.length + improvableSkills.length;
        return `Bạn mới bắt đầu lộ trình "${pathTitle}". Còn ${total} kỹ năng cần phát triển. Hãy hoàn thành các khóa học cơ bản trước.`;
      }
    }
  }

  // ==================== Cache Management ====================

  /**
   * Get cached profile if still valid
   * Invalid if: invalidatedAt is set, expired, or wrong data version
   */
  static async getCachedProfile(userId: string): Promise<LearnerCompetencyProfile | null> {
    try {
      const cached = await prisma.learnerAnalysis.findUnique({
        where: { userId },
      });

      if (!cached) return null;

      // Check invalidation (event-driven)
      if (cached.invalidatedAt) {
        logger.debug(`[LearnerAnalysis] Cache invalidated by event for user ${userId}`);
        return null;
      }

      // Check TTL expiry (safety fallback)
      if (new Date() > cached.expiresAt) {
        logger.debug(`[LearnerAnalysis] Cache expired (TTL) for user ${userId}`);
        return null;
      }

      // Check data version
      if (cached.dataVersion !== CURRENT_DATA_VERSION) {
        logger.debug(`[LearnerAnalysis] Cache data version mismatch for user ${userId}`);
        return null;
      }

      return cached.profile as unknown as LearnerCompetencyProfile;
    } catch (err: any) {
      logger.warn(`[LearnerAnalysis] Error reading cache for user ${userId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Save profile to cache
   */
  static async saveToCache(userId: string, profile: LearnerCompetencyProfile): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + ANALYSIS_CACHE_TTL_HOURS);

      await prisma.learnerAnalysis.upsert({
        where: { userId },
        update: {
          profile: JSON.parse(JSON.stringify(profile)),
          dataVersion: CURRENT_DATA_VERSION,
          analyzedAt: new Date(),
          expiresAt,
          invalidatedAt: null, // Clear invalidation on fresh build
        },
        create: {
          userId,
          profile: JSON.parse(JSON.stringify(profile)),
          dataVersion: CURRENT_DATA_VERSION,
          analyzedAt: new Date(),
          expiresAt,
        },
      });

      logger.info(`[LearnerAnalysis] Cached profile for user ${userId}, expires at ${expiresAt.toISOString()}`);
    } catch (err: any) {
      logger.error(`[LearnerAnalysis] Failed to cache profile for user ${userId}: ${err.message}`);
      // Non-critical — profile still returned even if caching fails
    }
  }

  // ==================== Helpers ====================

  /**
   * Calculate data completeness (0-100)
   * Based on how many data sources have actual data
   */
  static calculateDataCompleteness(dataSources: DataSourceUsed[]): number {
    if (dataSources.length === 0) return 0;

    // Weight by importance
    const weights: Record<string, number> = {
      UserSkillProfile: 3,       // Most important
      ProjectEvaluation: 3,      // Most important
      CourseProgress: 2,
      QuizAttempt: 1,
      Certificate: 1,
      UserProgress: 1,
      UserPathEnrollment: 1,
      FinalProjectSubmission: 1,
    };

    let totalWeight = 0;
    let achievedWeight = 0;

    for (const ds of dataSources) {
      const w = weights[ds.source] || 1;
      totalWeight += w;
      if (ds.hasData) achievedWeight += w;
    }

    return totalWeight > 0 ? Math.round((achievedWeight / totalWeight) * 100) : 0;
  }
}
