import { PrismaClient } from '@prisma/client';
import { geminiService } from './gemini.service';
import { LearningContextService } from './learning-context.service';
import {
  COMPETENCY_ANALYSIS_PROMPT,
  LEARNING_PLAN_PROMPT,
  ALTERNATIVE_CAREER_PROMPT,
} from '../utils/system-prompt';
import logger from '../utils/logger';

const prisma = new PrismaClient();

const CURRENT_DATA_VERSION = 1;

/**
 * CompetencyAnalysisService — GĐ2: AI phân tích năng lực và đề xuất
 * 
 * Nguyên tắc:
 * 1. AI KHÔNG ghi đè currentLevel — chỉ giải thích level do GĐ1 xác định
 * 2. AI chọn courseId/pathId từ danh sách thật, backend validate lại
 * 3. Kết quả AI được cache — không gọi Gemini mỗi lần Dashboard mở
 * 4. Alternative career dựa trên system-calculated fit scores, AI chỉ phân tích
 */
export class CompetencyAnalysisService {

  // ==================== Public API ====================

  /**
   * POST /api/ai/learner-analysis/generate
   * Generate (or refresh) full AI analysis: competency + learning plan + alternative careers
   */
  static async generateFullAnalysis(userId: string, token: string): Promise<any> {
    logger.info(`[CompetencyAnalysis] Generating full analysis for user ${userId}`);

    // 1. Fetch data from GĐ1 + context
    const [profile, context, availablePaths] = await Promise.all([
      LearningContextService.fetchLearnerAnalysis(userId),
      LearningContextService.getExtendedContext(userId, token),
      LearningContextService.fetchAvailablePaths({
        Authorization: `Bearer ${token}`,
        'x-internal-service': 'true',
      }),
    ]);

    if (!profile) {
      throw new Error('Learner analysis profile not found. Please complete some courses or projects first.');
    }

    // 2. Generate all 3 analyses in parallel
    const [competencyAnalysis, learningPlan, alternativeCareers] = await Promise.all([
      this.analyzeCompetency(profile, context),
      this.generateLearningPlan(profile, context, availablePaths || []),
      this.suggestAlternativeCareer(profile, availablePaths || []),
    ]);

    // 3. Validate AI output (courseIds, pathIds)
    const validatedLearningPlan = this.validateLearningPlan(learningPlan, context.availableCourses, availablePaths || []);

    // 4. Build result
    const result = {
      systemLevel: profile.currentLevel,
      levelConfidence: profile.levelConfidence,
      competencyAnalysis,
      learningPlan: validatedLearningPlan,
      alternativeCareers,
      profile: {
        acquiredSkills: profile.acquiredSkills,
        strengths: profile.strengths,
        weaknesses: profile.weaknesses,
        careerFitAnalysis: profile.careerFitAnalysis,
        learningProgress: profile.learningProgress,
        dataCompleteness: profile.dataCompleteness,
      },
      generatedAt: new Date().toISOString(),
    };

    // 5. Save to cache
    await this.saveToCache(userId, result, profile.analyzedAt);

    return result;
  }

  /**
   * GET /api/ai/learner-analysis
   * Get cached AI analysis result (no Gemini call)
   */
  static async getCachedAnalysis(userId: string): Promise<any | null> {
    try {
      const cached = await prisma.aIAnalysisCache.findUnique({
        where: { userId },
      });

      if (!cached) return null;
      if (cached.invalidatedAt) return null;
      if (cached.dataVersion !== CURRENT_DATA_VERSION) return null;

      return {
        systemLevel: null, // Will be enriched from live profile
        competencyAnalysis: cached.competencyAnalysis,
        learningPlan: cached.learningPlan,
        alternativeCareers: cached.alternativeCareers,
        generatedAt: cached.analyzedAt?.toISOString(),
        isCached: true,
      };
    } catch (err: any) {
      logger.warn(`[CompetencyAnalysis] Error reading cache: ${err.message}`);
      return null;
    }
  }

  /**
   * Invalidate AI analysis cache for a user
   */
  static async invalidateCache(userId: string): Promise<void> {
    try {
      await prisma.aIAnalysisCache.updateMany({
        where: { userId },
        data: { invalidatedAt: new Date() },
      });
      logger.info(`[CompetencyAnalysis] Cache invalidated for user ${userId}`);
    } catch (err: any) {
      logger.debug(`[CompetencyAnalysis] No cache to invalidate for user ${userId}`);
    }
  }

  // ==================== AI Analysis Methods ====================

  /**
   * 1. Analyze competency — AI EXPLAINS system level, does NOT override
   */
  private static async analyzeCompetency(profile: any, context: any): Promise<any> {
    try {
      // Build prompt with structured data
      let prompt = COMPETENCY_ANALYSIS_PROMPT;
      prompt = prompt.replace('{SYSTEM_LEVEL}', profile.currentLevel || 'NO_EVIDENCE');
      prompt = prompt.replace('{SYSTEM_LEVEL}', profile.currentLevel || 'NO_EVIDENCE'); // 2nd occurrence
      prompt = prompt.replace('{LEVEL_CONFIDENCE}', String(profile.levelConfidence || 0));
      prompt = prompt.replace('{LEVEL_REASONING}', profile.levelReasoning || 'N/A');
      prompt = prompt.replace('{DATA_COMPLETENESS}', String(profile.dataCompleteness || 0));

      // Build skills string
      const skillsStr = (profile.acquiredSkills || []).map((s: any) =>
        `- ${s.skill} (${s.category}): Level=${s.level}, Confidence=${s.confidence}, Score=${s.score}, Evidence=${s.evidenceCount}`
      ).join('\n') || '(Chưa có kỹ năng)';
      prompt = prompt.replace('{ACQUIRED_SKILLS}', skillsStr);

      // Build strengths/weaknesses
      const strengthsStr = (profile.strengths || []).map((s: any) =>
        `- ${s.area} (${s.category}): ${s.detail} [source: ${s.source}, confidence: ${s.confidence}]`
      ).join('\n') || '(Chưa xác định)';
      prompt = prompt.replace('{STRENGTHS}', strengthsStr);

      const weaknessesStr = (profile.weaknesses || []).map((w: any) =>
        `- ${w.area} (${w.category}): ${w.detail} [source: ${w.source}, confidence: ${w.confidence}]`
      ).join('\n') || '(Chưa xác định)';
      prompt = prompt.replace('{WEAKNESSES}', weaknessesStr);

      // Build learning progress summary
      const lp = profile.learningProgress || {};
      const progressStr = [
        `- Khóa học: ${lp.completedCourses || 0}/${lp.totalCourses || 0} hoàn thành (${lp.completionRate || 0}%)`,
        `- Quiz: Trung bình ${lp.quizPerformance?.averageQuizScore || 0}%, Pass rate ${lp.quizPerformance?.quizPassRate || 0}%`,
        `- Lộ trình: ${lp.activeLearningPaths || 0} đang theo, ${lp.completedPaths || 0} hoàn thành`,
        `- Đồ án: ${lp.evaluatedProjects || 0} đã đánh giá, điểm TB ${lp.averageProjectScore || 0}%`,
        `- Thời gian: ${lp.totalStudyHours || 0} giờ, streak ${lp.streakDays || 0} ngày`,
        `- Chứng nhận: ${lp.totalCertificates || 0} (khóa: ${lp.courseCertificates || 0}, path: ${lp.pathCertificates || 0})`,
      ].join('\n');
      prompt = prompt.replace('{LEARNING_PROGRESS}', progressStr);

      // Build career fit
      const careerFitStr = (profile.careerFitAnalysis || []).map((cf: any) =>
        `- "${cf.pathTitle}" (${cf.careerGoal}): Fit=${cf.fitScore}% (${cf.fitLevel}), Matched=${cf.matchedSkills?.length || 0}, Missing=${cf.missingSkills?.length || 0}, Improvable=${cf.improvableSkills?.length || 0}`
      ).join('\n') || '(Chưa đăng ký lộ trình)';
      prompt = prompt.replace('{CAREER_FIT}', careerFitStr);

      // Call Gemini
      const response = await geminiService.generateResponse(
        prompt, [], 'Phân tích năng lực học viên và trả về JSON.'
      );

      return this.parseJsonResponse(response, 'competency-analysis');
    } catch (err: any) {
      logger.error(`[CompetencyAnalysis] AI analysis failed: ${err.message}`);
      return {
        levelInterpretation: `Trình độ hiện tại: ${profile.currentLevel}`,
        reasoning: profile.levelReasoning || 'Không thể phân tích chi tiết do lỗi AI.',
        evidences: [],
        strengthsAnalysis: 'Không thể phân tích do lỗi AI.',
        weaknessesAnalysis: 'Không thể phân tích do lỗi AI.',
        developmentPotential: '',
        oneLiner: `Trình độ ${profile.currentLevel} — cần phân tích thêm.`,
        error: true,
      };
    }
  }

  /**
   * 2. Generate learning plan — AI selects from REAL courses/paths
   */
  private static async generateLearningPlan(profile: any, context: any, availablePaths: any[]): Promise<any> {
    try {
      let prompt = LEARNING_PLAN_PROMPT;
      prompt = prompt.replace('{SYSTEM_LEVEL}', profile.currentLevel || 'NO_EVIDENCE');

      // Skills
      const skillsStr = (profile.acquiredSkills || []).map((s: any) =>
        `- ${s.skill} (${s.category}): Level=${s.level}, Score=${s.score}`
      ).join('\n') || '(Chưa có)';
      prompt = prompt.replace('{ACQUIRED_SKILLS}', skillsStr);

      // Skill gaps from all career fit analyses
      const allGaps: string[] = [];
      for (const cf of (profile.careerFitAnalysis || [])) {
        for (const ms of (cf.missingSkills || [])) {
          allGaps.push(`- MISSING: ${ms.skill} (required: ${ms.requiredLevel}) — cho "${cf.pathTitle}"`);
        }
        for (const is of (cf.improvableSkills || [])) {
          allGaps.push(`- NEEDS_IMPROVEMENT: ${is.skill} (current: ${is.currentLevel}, required: ${is.requiredLevel}) — cho "${cf.pathTitle}"`);
        }
      }
      prompt = prompt.replace('{SKILL_GAPS}', allGaps.length > 0 ? allGaps.join('\n') : '(Không có skill gap)');

      // Career fit
      const careerFitStr = (profile.careerFitAnalysis || []).map((cf: any) =>
        `- "${cf.pathTitle}": Fit=${cf.fitScore}% (${cf.fitLevel})`
      ).join('\n') || '(N/A)';
      prompt = prompt.replace('{CAREER_FIT}', careerFitStr);

      // Learning progress
      const lp = profile.learningProgress || {};
      const progressStr = `Hoàn thành ${lp.completedCourses || 0}/${lp.totalCourses || 0} khóa, ${lp.totalStudyHours || 0}h học, streak ${lp.streakDays || 0} ngày`;
      prompt = prompt.replace('{LEARNING_PROGRESS}', progressStr);

      // Available courses (with real IDs)
      const coursesStr = (context.availableCourses || []).map((c: any) =>
        `- CourseID: ${c.id} | "${c.title}" | Danh mục: ${c.category} | Cấp độ: ${c.level}`
      ).join('\n') || '(Không có khóa học)';
      prompt = prompt.replace('{AVAILABLE_COURSES}', coursesStr);

      // Available paths (with real IDs)
      const pathsStr = (availablePaths || []).map((p: any) =>
        `- PathID: ${p.id} | "${p.title}" | Danh mục: ${p.category || 'N/A'} | Kỹ năng: [${(p.skills || []).join(', ')}] | Mục tiêu: ${p.careerGoal || 'N/A'}`
      ).join('\n') || '(Không có lộ trình)';
      prompt = prompt.replace('{AVAILABLE_PATHS}', pathsStr);

      const response = await geminiService.generateResponse(
        prompt, [], 'Đề xuất kế hoạch học tập cá nhân hóa và trả về JSON.'
      );

      return this.parseJsonResponse(response, 'learning-plan');
    } catch (err: any) {
      logger.error(`[CompetencyAnalysis] Learning plan generation failed: ${err.message}`);
      return {
        prioritySkills: [],
        recommendedCourses: [],
        recommendedPaths: [],
        nextActions: [],
        estimatedTimeline: 'Không thể ước tính do lỗi AI.',
        summary: 'Không thể tạo kế hoạch học tập do lỗi AI.',
        error: true,
      };
    }
  }

  /**
   * 3. Suggest alternative career — system finds candidates, AI explains
   * 
   * Trigger: NOT just fitScore < 40. System compares ALL path fits
   * and finds paths with significantly higher fit.
   */
  private static async suggestAlternativeCareer(profile: any, availablePaths: any[]): Promise<any> {
    try {
      const careerFits = profile.careerFitAnalysis || [];
      
      if (careerFits.length === 0) {
        return {
          shouldSuggest: false,
          currentCareerAssessment: null,
          alternativeCareers: [],
          encouragement: 'Hãy đăng ký lộ trình học tập để hệ thống có thể phân tích nghề nghiệp phù hợp.',
        };
      }

      // Current career = first enrolled path's career fit
      const currentFit = careerFits[0];

      // System calculates alternative candidates:
      // Find ALL paths on UMI, compute fit score for each using acquiredSkills
      const alternativeCandidates = this.findAlternativeCandidates(
        profile.acquiredSkills || [],
        availablePaths,
        careerFits,
        currentFit
      );

      // If no alternative is significantly better (> 15 points), skip AI call
      if (alternativeCandidates.length === 0) {
        return {
          shouldSuggest: false,
          currentCareerAssessment: {
            careerGoal: currentFit.careerGoal || currentFit.pathTitle,
            fitScore: currentFit.fitScore,
            isAchievable: currentFit.fitScore >= 40,
            assessment: currentFit.recommendation || '',
            whyStay: `Mục tiêu "${currentFit.pathTitle}" vẫn là hướng phù hợp nhất với kỹ năng hiện tại.`,
          },
          alternativeCareers: [],
          encouragement: 'Bạn đang đi đúng hướng! Hãy tiếp tục nỗ lực.',
        };
      }

      // Build prompt for AI to explain
      let prompt = ALTERNATIVE_CAREER_PROMPT;

      const currentFitStr = `- "${currentFit.pathTitle}" (${currentFit.careerGoal}): Fit=${currentFit.fitScore}% (${currentFit.fitLevel}), Matched=${currentFit.matchedSkills?.length || 0}, Missing=${currentFit.missingSkills?.length || 0}`;
      prompt = prompt.replace('{CURRENT_CAREER_FIT}', currentFitStr);

      const altFitsStr = alternativeCandidates.map((c: any) =>
        `- "${c.pathTitle}" (${c.careerGoal}): Fit=${c.fitScore}%, Skills match: [${(c.matchedSkills || []).join(', ')}], Missing: [${(c.missingSkills || []).join(', ')}]`
      ).join('\n');
      prompt = prompt.replace('{ALTERNATIVE_CAREER_FITS}', altFitsStr);

      const skillsStr = (profile.acquiredSkills || []).map((s: any) =>
        `- ${s.skill} (${s.category}): ${s.level}, Score=${s.score}`
      ).join('\n') || '(Chưa có)';
      prompt = prompt.replace('{ACQUIRED_SKILLS}', skillsStr);

      const strengthsStr = (profile.strengths || []).map((s: any) =>
        `- ${s.area}: ${s.detail}`
      ).join('\n') || '(Chưa xác định)';
      prompt = prompt.replace('{STRENGTHS}', strengthsStr);

      const response = await geminiService.generateResponse(
        prompt, [], 'Phân tích nghề nghiệp thay thế và trả về JSON.'
      );

      return this.parseJsonResponse(response, 'alternative-career');
    } catch (err: any) {
      logger.error(`[CompetencyAnalysis] Alternative career suggestion failed: ${err.message}`);
      return {
        shouldSuggest: false,
        currentCareerAssessment: null,
        alternativeCareers: [],
        encouragement: 'Hãy tiếp tục học tập — hệ thống sẽ phân tích thêm khi có đủ dữ liệu.',
        error: true,
      };
    }
  }

  // ==================== System-level Alternative Candidate Finder ====================

  /**
   * Find alternative career candidates based on system-calculated data
   * 
   * A candidate is "significantly better" if:
   * - fitScore is > 15 points higher than current career
   * - OR fitScore >= 70 while current is < 50
   * 
   * This is DETERMINISTIC — no AI involved
   */
  private static findAlternativeCandidates(
    acquiredSkills: any[],
    availablePaths: any[],
    enrolledCareerFits: any[],
    currentFit: any
  ): any[] {
    const enrolledPathIds = enrolledCareerFits.map((cf: any) => cf.pathId);
    const candidates: any[] = [];

    for (const path of availablePaths) {
      // Skip already enrolled paths
      if (enrolledPathIds.includes(path.id || path._id)) continue;
      if (!path.skills || path.skills.length === 0) continue;

      // Calculate fit for this path using acquired skills
      const pathSkills: string[] = path.skills || [];
      let matchedSkills: string[] = [];
      let missingSkills: string[] = [];

      for (const reqSkill of pathSkills) {
        const canonicalReq = reqSkill.toLowerCase().trim();
        const found = acquiredSkills.find((s: any) =>
          s.canonicalName === canonicalReq ||
          (s.skill || '').toLowerCase() === canonicalReq
        );

        if (found && found.level !== 'NO_EVIDENCE') {
          matchedSkills.push(reqSkill);
        } else {
          missingSkills.push(reqSkill);
        }
      }

      const fitScore = pathSkills.length > 0
        ? Math.round((matchedSkills.length / pathSkills.length) * 100)
        : 0;

      // Check if significantly better
      const isSignificantlyBetter =
        (fitScore > currentFit.fitScore + 15) ||
        (fitScore >= 70 && currentFit.fitScore < 50);

      if (isSignificantlyBetter) {
        candidates.push({
          pathId: path.id || path._id,
          pathTitle: path.title,
          careerGoal: path.careerGoal || path.title,
          fitScore,
          matchedSkills,
          missingSkills,
          category: path.category,
        });
      }
    }

    // Sort by fit score desc, limit to 3
    candidates.sort((a, b) => b.fitScore - a.fitScore);
    return candidates.slice(0, 3);
  }

  // ==================== Validation ====================

  /**
   * Validate AI-recommended courseIds and pathIds against actual data
   * Remove any IDs that don't exist in the system
   */
  private static validateLearningPlan(plan: any, availableCourses: any[], availablePaths: any[]): any {
    if (!plan || plan.error) return plan;

    const validCourseIds = new Set((availableCourses || []).map((c: any) => c.id));
    const validPathIds = new Set((availablePaths || []).map((p: any) => p.id || p._id));

    // Validate recommended courses
    if (plan.recommendedCourses) {
      plan.recommendedCourses = plan.recommendedCourses.filter((c: any) => {
        if (!c.courseId || !validCourseIds.has(c.courseId)) {
          logger.warn(`[CompetencyAnalysis] AI hallucinated courseId: ${c.courseId}, removed`);
          return false;
        }
        return true;
      });
    }

    // Validate recommended paths
    if (plan.recommendedPaths) {
      plan.recommendedPaths = plan.recommendedPaths.filter((p: any) => {
        if (!p.pathId || !validPathIds.has(p.pathId)) {
          logger.warn(`[CompetencyAnalysis] AI hallucinated pathId: ${p.pathId}, removed`);
          return false;
        }
        return true;
      });
    }

    // Validate nextActions resource IDs
    if (plan.nextActions) {
      plan.nextActions = plan.nextActions.map((a: any) => {
        if (a.resourceId && !validCourseIds.has(a.resourceId) && !validPathIds.has(a.resourceId)) {
          logger.warn(`[CompetencyAnalysis] AI hallucinated resourceId in nextAction: ${a.resourceId}, cleared`);
          return { ...a, resourceId: null, resourceTitle: null };
        }
        return a;
      });
    }

    return plan;
  }

  // ==================== Cache ====================

  private static async saveToCache(userId: string, result: any, profileAnalyzedAt: string): Promise<void> {
    try {
      await prisma.aIAnalysisCache.upsert({
        where: { userId },
        update: {
          competencyAnalysis: result.competencyAnalysis ? JSON.parse(JSON.stringify(result.competencyAnalysis)) : undefined,
          learningPlan: result.learningPlan ? JSON.parse(JSON.stringify(result.learningPlan)) : undefined,
          alternativeCareers: result.alternativeCareers ? JSON.parse(JSON.stringify(result.alternativeCareers)) : undefined,
          dataVersion: CURRENT_DATA_VERSION,
          analyzedAt: new Date(),
          invalidatedAt: null,
          profileAnalyzedAt: profileAnalyzedAt ? new Date(profileAnalyzedAt) : null,
        },
        create: {
          userId,
          competencyAnalysis: result.competencyAnalysis ? JSON.parse(JSON.stringify(result.competencyAnalysis)) : undefined,
          learningPlan: result.learningPlan ? JSON.parse(JSON.stringify(result.learningPlan)) : undefined,
          alternativeCareers: result.alternativeCareers ? JSON.parse(JSON.stringify(result.alternativeCareers)) : undefined,
          dataVersion: CURRENT_DATA_VERSION,
          analyzedAt: new Date(),
          profileAnalyzedAt: profileAnalyzedAt ? new Date(profileAnalyzedAt) : null,
        },
      });
      logger.info(`[CompetencyAnalysis] Cached AI analysis for user ${userId}`);
    } catch (err: any) {
      logger.error(`[CompetencyAnalysis] Failed to cache: ${err.message}`);
    }
  }

  // ==================== JSON Parser ====================

  /**
   * Parse AI JSON response with cleanup
   */
  private static parseJsonResponse(response: string, context: string): any {
    let jsonStr = response.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.substring(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.substring(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    }
    jsonStr = jsonStr.trim();

    try {
      return JSON.parse(jsonStr);
    } catch (err: any) {
      logger.error(`[CompetencyAnalysis] Failed to parse ${context} JSON: ${err.message}`);
      logger.error(`[CompetencyAnalysis] Raw response (first 500 chars): ${response.substring(0, 500)}`);
      throw new Error(`Failed to parse AI response for ${context}`);
    }
  }
}
