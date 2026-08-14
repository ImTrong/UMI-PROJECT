import { PrismaClient } from '@prisma/client';
import { ChatService } from './chat.service';
import logger from '../utils/logger';

const prisma = new PrismaClient();
const MAX_QUESTIONS = 30;
const MAX_ROUNDS = 4;

/**
 * Career Advisor Orchestrator Service
 * 
 * State machine that coordinates Prompt 1 (Skill Assessment) and Prompt 2 (Career Path).
 * 
 * Flow:
 *   START → Prompt 1 (assess) → ASSESSMENT_REQUIRED? → collect answers → Prompt 1 (reassess)
 *   → PROFILE_COMPLETE → Prompt 2 (roadmap) → ROADMAP_READY
 */
export class CareerAdvisorService {

  /**
   * Start a new career advisor session
   * Creates a session, runs Prompt 1, and returns the initial state
   */
  static async startSession(userId: string, careerGoal: string, token: string) {
    // 1. Create session in DB
    const session = await prisma.skillAssessmentSession.create({
      data: {
        userId,
        careerGoal,
        status: 'PENDING',
        assessmentHistory: [],
        currentRound: 0,
      },
    });

    logger.info(`Created career advisor session ${session.id} for user ${userId}, goal: "${careerGoal}"`);

    // 2. Prepare initial assessment state
    const assessmentState = {
      round: 0,
      questionsAnswered: 0,
      maxQuestions: MAX_QUESTIONS,
      maxRounds: MAX_ROUNDS,
      status: 'NOT_STARTED',
    };

    // 3. Run Prompt 1 (initial assessment — no history yet)
    const assessmentResult = await ChatService.generateSkillAssessment(
      userId,
      careerGoal,
      [],
      assessmentState,
      token
    );

    // 4. Process result based on mode
    if (assessmentResult.mode === 'PROFILE_COMPLETE' || assessmentResult.mode === 'ASSESSMENT_MAX_REACHED' || assessmentResult.mode === 'ASSESSMENT_SKIPPED') {
      // Enough data or max reached — save profile and run Prompt 2 immediately
      return await this.completeProfileAndGenerateRoadmap(
        session.id,
        userId,
        careerGoal,
        assessmentResult,
        token
      );
    } else {
      // Need assessment — save questions and return them
      const updatedSession = await prisma.skillAssessmentSession.update({
        where: { id: session.id },
        data: {
          status: 'ASSESSMENT_REQUIRED',
          skillProfile: assessmentResult,
          currentRound: 1,
        },
      });

      return {
        status: 'ASSESSMENT_REQUIRED' as const,
        sessionId: updatedSession.id,
        assessment: {
          questions: assessmentResult.assessment?.questions || [],
          totalQuestions: assessmentResult.assessment?.totalQuestions || 0,
          reason: assessmentResult.assessment?.reason || '',
          skillsToAssess: assessmentResult.assessment?.skillsToAssess || [],
          round: 1,
          questionsAnswered: 0,
          maxQuestions: MAX_QUESTIONS,
        },
        skillProfile: assessmentResult.skillProfile,
        overallProfile: assessmentResult.overallProfile,
      };
    }
  }

  /**
   * Submit assessment answers and continue the flow
   * Processes answers, re-runs Prompt 1, and decides next step
   */
  static async submitAnswers(
    userId: string,
    sessionId: string,
    answers: Array<{ questionId: string; skill: string; answer: string; correctAnswer: string }>,
    token: string
  ) {
    // 1. Get existing session
    const session = await prisma.skillAssessmentSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }

    if (session.status === 'ROADMAP_READY' || session.status === 'PROFILE_COMPLETE' || session.status === 'ASSESSMENT_MAX_REACHED' || session.status === 'ASSESSMENT_SKIPPED') {
      throw new Error('SESSION_ALREADY_COMPLETE');
    }

    // 2. Build updated assessment history and calculate budget
    const previousHistory = (session.assessmentHistory || []) as any[];
    const currentProfile = session.skillProfile as any;
    
    // Get the questions from the current profile to pair with answers
    const currentQuestions = currentProfile?.assessment?.questions || [];
    
    const newRound = {
      round: session.currentRound,
      questions: currentQuestions,
      answers: answers,
    };

    const updatedHistory = [...previousHistory, newRound];
    
    // Calculate questions answered so far
    let questionsAnswered = updatedHistory.reduce((total, r) => total + (r.answers?.length || 0), 0);
    const nextRoundIndex = session.currentRound + 1;

    // 3. HARD LIMIT CHECK (Backend Source of Truth)
    if (questionsAnswered >= MAX_QUESTIONS || nextRoundIndex > MAX_ROUNDS) {
      logger.info(`Session ${sessionId} reached hard limits: answered=${questionsAnswered}/${MAX_QUESTIONS}, round=${nextRoundIndex}/${MAX_ROUNDS}`);
      
      // Force completion with current profile
      const maxReachedProfile = {
        ...currentProfile,
        mode: 'ASSESSMENT_MAX_REACHED',
        assessment: null,
      };
      
      await prisma.skillAssessmentSession.update({
        where: { id: sessionId },
        data: {
          assessmentHistory: updatedHistory,
          currentRound: nextRoundIndex,
          status: 'ASSESSMENT_MAX_REACHED'
        },
      });

      return await this.completeProfileAndGenerateRoadmap(
        sessionId,
        userId,
        session.careerGoal,
        maxReachedProfile,
        token
      );
    }

    // 4. Prepare state and re-run Prompt 1
    const assessmentState = {
      round: nextRoundIndex,
      questionsAnswered,
      maxQuestions: MAX_QUESTIONS,
      maxRounds: MAX_ROUNDS,
      status: 'IN_PROGRESS',
    };

    const assessmentResult = await ChatService.generateSkillAssessment(
      userId,
      session.careerGoal,
      updatedHistory,
      assessmentState,
      token
    );

    // 5. Process result
    if (assessmentResult.mode === 'PROFILE_COMPLETE' || assessmentResult.mode === 'ASSESSMENT_MAX_REACHED') {
      // Profile complete or max reached by AI — save and run Prompt 2
      await prisma.skillAssessmentSession.update({
        where: { id: sessionId },
        data: {
          assessmentHistory: updatedHistory,
          currentRound: nextRoundIndex,
          status: assessmentResult.mode,
        },
      });

      return await this.completeProfileAndGenerateRoadmap(
        sessionId,
        userId,
        session.careerGoal,
        assessmentResult,
        token
      );
    } else {
      // Need more assessment
      const updatedSession = await prisma.skillAssessmentSession.update({
        where: { id: sessionId },
        data: {
          status: 'ASSESSMENT_CONTINUE',
          skillProfile: assessmentResult,
          assessmentHistory: updatedHistory,
          currentRound: nextRoundIndex,
        },
      });

      return {
        status: 'ASSESSMENT_CONTINUE' as const,
        sessionId: updatedSession.id,
        assessment: {
          questions: assessmentResult.assessment?.questions || [],
          totalQuestions: assessmentResult.assessment?.totalQuestions || 0,
          reason: assessmentResult.assessment?.reason || '',
          skillsToAssess: assessmentResult.assessment?.skillsToAssess || [],
          round: updatedSession.currentRound,
          questionsAnswered,
          maxQuestions: MAX_QUESTIONS,
        },
        skillProfile: assessmentResult.skillProfile,
        overallProfile: assessmentResult.overallProfile,
      };
    }
  }

  /**
   * Skip the assessment and build a foundation-first roadmap
   */
  static async skipAssessment(userId: string, sessionId: string, token: string) {
    // 1. Get existing session
    const session = await prisma.skillAssessmentSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }

    if (session.status === 'ROADMAP_READY' || session.status === 'PROFILE_COMPLETE') {
      throw new Error('SESSION_ALREADY_COMPLETE');
    }

    // 2. Build skipped profile
    const currentProfile = session.skillProfile as any;
    
    // We keep goalAnalysis and requiredSkills, but reset skillProfile to NO_EVIDENCE
    const skippedProfile = {
      mode: 'ASSESSMENT_SKIPPED',
      assessment_status: 'SKIPPED',
      starting_level: 'BEGINNER',
      confidence: 'LOW',
      goalAnalysis: currentProfile?.goalAnalysis || null,
      requiredSkills: currentProfile?.requiredSkills || [],
      skillProfile: (currentProfile?.requiredSkills || []).map((reqSkill: any) => ({
        skill: reqSkill.skill,
        level: 'NO_EVIDENCE',
        confidence: 0,
        status: 'UNVERIFIED',
        evidences: ['Không có bằng chứng do học viên bỏ qua đánh giá'],
      })),
      assessment: null,
      overallProfile: {
        profileCompleteness: 0,
        summary: 'Chưa có đủ dữ liệu để xác định chính xác trình độ do học viên bỏ qua bài đánh giá. Lộ trình sẽ được bắt đầu từ các kiến thức nền tảng.',
      }
    };

    // Update status before running prompt 2
    await prisma.skillAssessmentSession.update({
      where: { id: sessionId },
      data: { status: 'ASSESSMENT_SKIPPED' }
    });

    // 3. Save profile and run Prompt 2
    return await this.completeProfileAndGenerateRoadmap(
      sessionId,
      userId,
      session.careerGoal,
      skippedProfile,
      token
    );
  }

  /**
   * Get session status and data
   */
  static async getSession(userId: string, sessionId: string) {
    const session = await prisma.skillAssessmentSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return null;
    }

    return {
      sessionId: session.id,
      status: session.status,
      careerGoal: session.careerGoal,
      currentRound: session.currentRound,
      skillProfile: session.skillProfile,
      roadmapResult: session.roadmapResult,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Internal: Complete profile and generate roadmap via Prompt 2
   * Called when Prompt 1 returns PROFILE_COMPLETE
   */
  private static async completeProfileAndGenerateRoadmap(
    sessionId: string,
    userId: string,
    careerGoal: string,
    assessmentResult: any,
    token: string
  ) {
    // 1. Save completed profile (if not already skipped/max reached)
    // Actually we just update the skillProfile
    const session = await prisma.skillAssessmentSession.findFirst({where: {id: sessionId}});
    
    await prisma.skillAssessmentSession.update({
      where: { id: sessionId },
      data: {
        status: session?.status === 'ASSESSMENT_SKIPPED' || session?.status === 'ASSESSMENT_MAX_REACHED' ? session.status : 'PROFILE_COMPLETE',
        skillProfile: assessmentResult,
      },
    });

    logger.info(`Profile complete for session ${sessionId}. Running Prompt 2...`);

    // 2. Run Prompt 2 — Career Path Recommendation
    try {
      const roadmap = await ChatService.generateCareerPathRecommendation(
        userId,
        careerGoal,
        token,
        assessmentResult  // Pass Prompt 1 output as skillProfile to Prompt 2
      );

      // 3. Save roadmap result and update status
      const finalSession = await prisma.skillAssessmentSession.update({
        where: { id: sessionId },
        data: {
          status: 'ROADMAP_READY',
          roadmapResult: roadmap,
        },
      });

      return {
        status: 'ROADMAP_READY' as const,
        sessionId: finalSession.id,
        skillProfile: assessmentResult,
        roadmap: roadmap,
      };
    } catch (error) {
      logger.error(`Prompt 2 failed for session ${sessionId}:`, error);

      // Profile is still saved — roadmap generation can be retried
      return {
        status: 'PROFILE_COMPLETE' as const,
        sessionId: sessionId,
        skillProfile: assessmentResult,
        roadmap: null,
        error: 'Không thể tạo lộ trình lúc này. Vui lòng thử lại.',
      };
    }
  }
}
