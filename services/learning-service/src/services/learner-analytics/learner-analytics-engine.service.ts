// ============================================================
// Learner Analytics Engine — Orchestrator
// ============================================================
// Single entry point: getDashboardAnalytics(userId)
// 1. Fetches ALL data in parallel (batch queries, no N+1)
// 2. Runs all analyzers
// 3. Returns LearnerAnalyticsDashboardData
// ============================================================

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import logger from '../../utils/logger';
import type {
  RawLearnerData,
  LearnerAnalyticsDashboardData,
  OverviewAnalytics,
  AnalyticsDataQuality,
} from './types';

import { ProgressAnalyzer } from './progress-analyzer';
import { PerformanceAnalyzer } from './performance-analyzer';
import { EngagementAnalyzer } from './engagement-analyzer';
import { SkillAnalyzer } from './skill-analyzer';
import { TimelineAnalyzer } from './timeline-analyzer';
import { StageDetector } from './stage-detector';
import { KnowledgeGapAnalyzer } from './knowledge-gap-analyzer';
import { BottleneckDetector } from './bottleneck-detector';
import { RecoveryAnalyzer } from './recovery-analyzer';
import { LearningStateDetector } from './learning-state-detector';

import { RecommendationEngine } from './recommendation-engine';

const prisma = new PrismaClient();

export class LearnerAnalyticsEngine {
  private static readonly CACHE_TTL_MS = parseInt(
    process.env.LEARNER_ANALYTICS_CACHE_TTL_MS || `${5 * 60 * 1000}`,
    10
  );
  private static readonly cache = new Map<string, {
    expiresAt: number;
    data: LearnerAnalyticsDashboardData;
  }>();

  /**
   * Main entry point — fetches all data, runs all analyzers,
   * returns the complete dashboard data.
   */
  static async getDashboardAnalytics(userId: string, token?: string): Promise<LearnerAnalyticsDashboardData> {
    const startTime = Date.now();

    try {
      // ── Step 1: Fetch ALL data in parallel (no N+1) ──
      const rawData = await this.fetchAllData(userId);

      // ── Step 2: Compute data quality ──
      const dataQuality = this.assessDataQuality(rawData);

      // ── Step 3: Run Foundation analyzers ──
      const progress = ProgressAnalyzer.analyze(rawData);
      const performance = PerformanceAnalyzer.analyze(rawData);
      const engagement = EngagementAnalyzer.analyze(rawData);
      const skills = SkillAnalyzer.analyze(rawData);
      const stage = StageDetector.detect(rawData);

      // ── Step 4: Run Derived/Behavioral analyzers ──
      const timeline = TimelineAnalyzer.analyze(rawData, stage.currentStage);
      const knowledgeGap = KnowledgeGapAnalyzer.analyze(
        rawData,
        skills.skills,
        skills.completionVsMastery?.completion ?? 0
      );
      const bottlenecks = BottleneckDetector.detect(rawData, skills.skills);
      const recovery = RecoveryAnalyzer.analyze(rawData);

      // ── Step 5: Learning State (depends on foundation results) ──
      const learningState = LearningStateDetector.detect(
        rawData,
        progress,
        performance,
        engagement
      );

      // ── Learning Effectiveness (Replaces Health Score) ──
      const assessmentScores = dataQuality.available.includes('performance') && rawData.quizAttempts.length > 0
        ? rawData.quizAttempts.filter(qa => qa.score != null).map(qa => qa.score)
        : [];
      const assessmentAverage = assessmentScores.length > 0
        ? Math.round(assessmentScores.reduce((a, b) => a + b, 0) / assessmentScores.length)
        : null;

      const projectScores = rawData.projectEvaluations.map(pe => pe.totalScore).filter(s => s != null);
      const projectAverage = projectScores.length > 0
        ? Math.round(projectScores.reduce((a, b) => a + b, 0) / projectScores.length)
        : null;

      const effectivenessStatus = (progress.status === 'READY' && progress.currentProgress > 0 && assessmentAverage !== null)
        ? 'READY'
        : 'INSUFFICIENT_DATA';

      let insight = 'Chưa đủ dữ liệu để đánh giá hiệu quả học tập.';
      if (effectivenessStatus === 'READY') {
        if (progress.currentProgress >= 80 && assessmentAverage !== null && assessmentAverage >= 80) {
          insight = 'Bạn hoàn thành tốt nội dung và đạt kết quả đánh giá cao.';
        } else if (progress.currentProgress >= 80 && assessmentAverage !== null && assessmentAverage < 60) {
          insight = 'Bạn đã xem hết nội dung nhưng kết quả đánh giá cho thấy cần củng cố kiến thức.';
        } else if (progress.currentProgress < 50 && assessmentAverage !== null && assessmentAverage >= 80) {
          insight = 'Bạn nắm bắt tốt kiến thức nhưng cần hoàn thành thêm nội dung lộ trình.';
        } else {
          insight = 'Đang trong quá trình tiếp thu kiến thức. Hãy duy trì việc học và làm bài tập.';
        }
      }

      const effectiveness = {
        status: effectivenessStatus as 'READY' | 'INSUFFICIENT_DATA',
        completionRate: progress.status === 'READY' ? progress.currentProgress : null,
        assessmentAverage,
        projectAverage,
        skillEvidenceAvailable: skills.status === 'READY' && skills.skills.some(s => s.evidences && s.evidences.length > 0),
        insight,
        confidence: effectivenessStatus === 'READY' ? 0.8 : 0,
      };

      // ── Step 6: Recommendations (depends on all analysis results) ──
      const recommendations = RecommendationEngine.generate(
        knowledgeGap,
        bottlenecks,
        engagement,
        learningState,
        skills
      );

      // ── Step 7: Build Overview from computed data ──
      const overview = this.buildOverview(progress, skills, effectiveness, stage, learningState);

      // ── Step 8: AI Summary (call existing AI service, graceful failure) ──
      let aiSummary: { summary: string; generatedAt: string; basedOn: string[] } | null = null;
      try {
        aiSummary = await this.generateAISummary({
          progress, performance, engagement, skills, stage,
          learningState, knowledgeGap, bottlenecks, recovery, effectiveness,
        }, token);
      } catch (aiError) {
        logger.warn(`[LearnerAnalytics] AI Summary failed for ${userId}, continuing without it:`, aiError);
      }

      const elapsed = Date.now() - startTime;
      logger.info(`[LearnerAnalytics] Dashboard computed for ${userId} in ${elapsed}ms`);

      return {
        overview,
        timeline,
        progressTrend: progress,
        performanceTrend: performance,
        engagement,
        skills,
        knowledgeGaps: knowledgeGap,
        bottlenecks,
        recovery,
        learningState,
        effectiveness,
        recommendations,
        aiSummary,
        dataQuality,
      };
    } catch (error) {
      logger.error(`[LearnerAnalytics] Error computing dashboard for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch ALL raw data in parallel using Promise.all.
   * Each query is independent — no N+1.
   */
  private static async fetchAllData(userId: string): Promise<RawLearnerData> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [
      userProgress,
      courseProgresses,
      lessonProgresses,
      activityLogs,
      quizAttempts,
      skillProfile,
      projectSubmissions,
      projectEvaluations,
      pathEnrollments,
      certificates,
    ] = await Promise.all([
      // 1. User progress
      prisma.userProgress.findUnique({ where: { userId } }),

      // 2. All course progresses
      prisma.courseProgress.findMany({
        where: { userId },
        orderBy: { enrolledAt: 'desc' },
      }),

      // 3. All lesson progresses
      prisma.lessonProgress.findMany({
        where: { userId },
      }),

      // 4. Activity logs (last 90 days for trends)
      prisma.activityLog.findMany({
        where: {
          userId,
          createdAt: { gte: ninetyDaysAgo },
        },
        orderBy: { createdAt: 'asc' },
      }),

      // 5. Quiz attempts
      prisma.quizAttempt.findMany({
        where: { userId },
        orderBy: { submittedAt: 'asc' },
      }),

      // 6. Skill profile
      prisma.userSkillProfile.findUnique({ where: { userId } }),

      // 7. Project submissions
      prisma.finalProjectSubmission.findMany({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
      }),

      // 8. Project evaluations
      prisma.projectEvaluation.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),

      // 9. Path enrollments
      prisma.userPathEnrollment.findMany({
        where: { userId },
      }),

      // 10. Certificates
      prisma.certificate.findMany({
        where: { userId },
        orderBy: { issueDate: 'desc' },
      }),
    ]);

    return {
      userId,
      userProgress,
      courseProgresses,
      lessonProgresses,
      activityLogs,
      quizAttempts,
      skillProfile,
      projectSubmissions,
      projectEvaluations,
      pathEnrollments,
      certificates,
    };
  }

  /**
   * Assess what analytics are available based on data richness.
   * "0% skill growth" and "no data for skill growth" are completely different.
   */
  private static assessDataQuality(data: RawLearnerData): AnalyticsDataQuality {
    const available: string[] = [];
    const unavailable: string[] = [];
    let totalDataPoints = 0;

    // Progress
    if (data.courseProgresses.length > 0) {
      available.push('progress');
      totalDataPoints += data.courseProgresses.length;
    } else {
      unavailable.push('progress');
    }

    // Activity
    if (data.activityLogs.length > 0) {
      available.push('activity');
      totalDataPoints += data.activityLogs.length;
    } else {
      unavailable.push('activity');
    }

    // Performance (quiz scores)
    const submittedQuizzes = data.quizAttempts.filter((qa: any) => qa.status === 'SUBMITTED');
    if (submittedQuizzes.length >= 2) {
      available.push('performance');
      totalDataPoints += submittedQuizzes.length;
    } else {
      unavailable.push('performance');
    }

    // Skills
    if (data.skillProfile && Array.isArray(data.skillProfile.skills) && data.skillProfile.skills.length > 0) {
      available.push('skills');
      available.push('skillGrowth');
      totalDataPoints += data.skillProfile.skills.length;
    } else {
      unavailable.push('skills');
      unavailable.push('skillGrowth');
    }

    // Recovery (needs 4+ quiz attempts)
    if (submittedQuizzes.length >= 4) {
      available.push('recovery');
    } else {
      unavailable.push('recovery');
    }

    // Bottleneck (needs lesson progresses)
    if (data.lessonProgresses.length > 0) {
      available.push('bottleneck');
    } else {
      unavailable.push('bottleneck');
    }

    // Determine overall status
    let status: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT';
    if (available.length >= 5) status = 'SUFFICIENT';
    else if (available.length >= 2) status = 'PARTIAL';
    else status = 'INSUFFICIENT';

    // Oldest data
    const dates: Date[] = [];
    if (data.activityLogs.length > 0) {
      dates.push(new Date(data.activityLogs[0].createdAt));
    }
    if (data.courseProgresses.length > 0) {
      for (const cp of data.courseProgresses) {
        if (cp.enrolledAt) dates.push(new Date(cp.enrolledAt));
      }
    }
    const oldestDataDate = dates.length > 0
      ? new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString().split('T')[0]
      : undefined;

    return { status, available, unavailable, totalDataPoints, oldestDataDate };
  }

  /**
   * Build Overview from all computed analytics.
   */
  private static buildOverview(
    progress: any,
    skills: any,
    effectiveness: any,
    stage: any,
    state: any
  ): OverviewAnalytics {
    return {
      progress: {
        value: progress.status === 'READY' ? progress.currentProgress : '---',
        label: 'Tiến độ',
        status: progress.status === 'READY' ? (progress.currentProgress >= 70 ? 'positive' : progress.currentProgress >= 40 ? 'neutral' : 'warning') : 'insufficient_data',
        description: progress.status === 'READY' ? 'Tổng tiến độ hoàn thành nội dung' : 'Chưa có đủ dữ liệu tiến độ',
      },
      mastery: {
        value: skills.status === 'READY' ? skills.overallMastery : '---',
        label: 'Thành thạo',
        trend: skills.status === 'READY' && skills.completionVsMastery.gap > 0 ? -skills.completionVsMastery.gap : undefined,
        trendDirection: skills.status === 'READY' && skills.completionVsMastery.gap > 10 ? 'down' : 'stable',
        status: skills.status === 'READY' ? (skills.overallMastery >= 70 ? 'positive' : skills.overallMastery >= 40 ? 'neutral' : 'warning') : 'insufficient_data',
        description: skills.status === 'READY' ? 'Mức thành thạo kỹ năng tổng thể' : 'Chưa đủ bằng chứng để đánh giá kỹ năng',
      },
      effectiveness: {
        value: effectiveness.status === 'READY' ? (effectiveness.assessmentAverage ?? '---') : '---',
        label: 'Hiệu suất (Assessment)',
        status: effectiveness.status === 'READY' ? (effectiveness.assessmentAverage >= 70 ? 'positive' : 'warning') : 'insufficient_data',
        description: effectiveness.status === 'READY' ? effectiveness.insight : 'Chưa đủ dữ liệu đánh giá hiệu quả',
      },
      stage: {
        value: stage.stageLabel,
        label: 'Giai đoạn',
        status: 'neutral',
        description: `Đang ở giai đoạn ${stage.stageLabel}`,
      },
      status: {
        value: state.state === 'INSUFFICIENT_DATA' ? 'Chưa rõ' : state.state === 'PROGRESSING' ? 'Tiến bộ' : state.state === 'STABLE' ? 'Ổn định' : state.state === 'PAUSED' ? 'Tạm dừng' : state.state === 'RECOVERING' ? 'Phục hồi' : state.state === 'REGRESSING' ? 'Đang giảm' : 'Rủi ro',
        label: 'Trạng thái học tập',
        status: state.state === 'INSUFFICIENT_DATA' ? 'insufficient_data' : state.state === 'PROGRESSING' || state.state === 'RECOVERING' ? 'positive' : state.state === 'STABLE' || state.state === 'PAUSED' ? 'neutral' : 'warning',
        description: state.description,
      },
    };
  }

  /**
   * Generate AI Learning Summary using the existing AI service.
   * Builds a verified analytics context and sends it to Gemini via the AI service.
   * Returns null if insufficient data or AI service unavailable.
   */
  private static async generateAISummary(analyticsContext: {
    progress: any;
    performance: any;
    engagement: any;
    skills: any;
    stage: any;
    learningState: any;
    knowledgeGap: any;
    bottlenecks: any;
    recovery: any;
    effectiveness: any;
  }, token?: string): Promise<{ summary: string; generatedAt: string; basedOn: string[] } | null> {
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://ai-service:3007';

    // Build verified context — ONLY real data, no fabrication
    const basedOn: string[] = [];
    const contextParts: string[] = [];

    if (analyticsContext.progress?.status === 'READY') {
      contextParts.push(`Tiến độ hiện tại: ${analyticsContext.progress.currentProgress}%`);
      contextParts.push(`Xu hướng tiến độ: ${analyticsContext.progress.trendLabel}`);
      basedOn.push('Tiến độ học tập');
    }
    if (analyticsContext.performance?.status === 'READY') {
      contextParts.push(`Điểm đánh giá hiện tại: ${analyticsContext.performance.currentScore}%`);
      contextParts.push(`Xu hướng hiệu suất: ${analyticsContext.performance.trendLabel}`);
      basedOn.push('Kết quả đánh giá');
    }
    if (analyticsContext.stage) {
      contextParts.push(`Giai đoạn học tập: ${analyticsContext.stage.stageLabel}`);
      basedOn.push('Giai đoạn học tập');
    }
    if (analyticsContext.skills?.status === 'READY') {
      const skillsWithEvidence = analyticsContext.skills.skills.filter((s: any) => s.hasEvidence && s.currentMastery != null);
      if (skillsWithEvidence.length > 0) {
        const skillSummary = skillsWithEvidence.map((s: any) => `${s.name}: ${s.currentMastery}%`).join(', ');
        contextParts.push(`Kỹ năng (đã đánh giá): ${skillSummary}`);
        basedOn.push('Phân tích kỹ năng');
      }
      if (analyticsContext.skills.strengths?.length > 0) {
        contextParts.push(`Điểm mạnh: ${analyticsContext.skills.strengths.map((s: any) => s.name).join(', ')}`);
      }
      if (analyticsContext.skills.improvementAreas?.length > 0) {
        const areasWithEvidence = analyticsContext.skills.improvementAreas.filter((s: any) => s.hasEvidence);
        if (areasWithEvidence.length > 0) {
          contextParts.push(`Cần củng cố: ${areasWithEvidence.map((s: any) => `${s.name} (${s.currentMastery}%)`).join(', ')}`);
        }
      }
    }
    if (analyticsContext.learningState?.state && analyticsContext.learningState.state !== 'INSUFFICIENT_DATA') {
      contextParts.push(`Trạng thái học tập: ${analyticsContext.learningState.description}`);
      basedOn.push('Trạng thái học tập');
    }
    if (analyticsContext.engagement?.status === 'READY') {
      contextParts.push(`Nhịp độ: ${analyticsContext.engagement.momentum.description}`);
      basedOn.push('Hoạt động học tập');
    }
    if (analyticsContext.bottlenecks?.status === 'READY' && analyticsContext.bottlenecks.bottlenecks.length > 0) {
      contextParts.push(`Điểm nghẽ: ${analyticsContext.bottlenecks.bottlenecks.map((b: any) => b.contentTitle).join(', ')}`);
      basedOn.push('Phân tích điểm nghẽ');
    }

    // Need at least some data to generate meaningful summary
    if (contextParts.length < 2) {
      return null;
    }

    const userMessage = `[YÊU CẦU ĐẶC BIỆT] Hãy tổng kết tình hình học tập của học viên dựa trên dữ liệu phân tích bên dưới.

Quy tắc:
- CHỈ sử dụng dữ liệu được cung cấp, KHÔNG bịa số liệu
- KHÔNG đưa ra nhận định phán xét tiêu cực
- Viết bằng tiếng Việt tự nhiên, thân thiện, ngắn gọn (3-5 câu)
- Trả lời: Bạn đang học như thế nào? Điểm mạnh? Cần chú ý gì? Làm gì tiếp?
- KHÔNG dùng markdown, KHÔNG dùng bullet points, chỉ văn bản thuần

Dữ liệu phân tích:
${contextParts.join('\n')}`;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = token;

      const response = await axios.post(
        `${aiServiceUrl}/api/ai/chat`,
        {
          message: userMessage,
          conversationId: null,
        },
        {
          timeout: 30000,
          headers,
        }
      );

      const aiText = response.data?.data?.response || response.data?.data?.message || response.data?.message || '';
      if (!aiText || typeof aiText !== 'string' || aiText.length < 20) {
        return null;
      }

      return {
        summary: aiText.trim(),
        generatedAt: new Date().toISOString(),
        basedOn,
      };
    } catch (error: any) {
      logger.warn(`[LearnerAnalytics] AI Summary HTTP call failed: ${error.message}`);
      return null;
    }
  }
}
