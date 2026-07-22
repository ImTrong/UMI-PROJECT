import { PrismaClient } from '@prisma/client';
import { geminiService, ChatMessage } from './gemini.service';
import { LearningContextService } from './learning-context.service';
import {
  SYSTEM_PROMPT,
  LEARNING_SUMMARY_PROMPT,
  RECOMMENDATION_PROMPT,
  COACH_PROMPT,
  CAREER_PATH_PROMPT,
  EVALUATION_PIPELINE_PROMPT,
  FEEDBACK_REPORT_PROMPT,
} from '../utils/system-prompt';
import logger from '../utils/logger';

const prisma = new PrismaClient();

const MAX_CONTEXT_MESSAGES = parseInt(process.env.MAX_CONTEXT_MESSAGES || '20');

/**
 * Chat Service — Enhanced with Learning Context injection
 */
export class ChatService {
  /**
   * Create a new conversation
   */
  static async createConversation(userId: string, title?: string) {
    const conversation = await prisma.conversation.create({
      data: {
        userId,
        title: title || 'Cuộc trò chuyện mới',
      },
    });

    logger.info(`Created conversation ${conversation.id} for user ${userId}`);
    return conversation;
  }

  /**
   * Get all conversations for a user (sorted by latest first)
   */
  static async getConversations(userId: string) {
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
      },
    });

    return conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      messageCount: conv._count.messages,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));
  }

  /**
   * Get a single conversation with all messages
   */
  static async getConversationById(userId: string, conversationId: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      return null;
    }

    return conversation;
  }

  /**
   * Delete a conversation and all its messages
   */
  static async deleteConversation(userId: string, conversationId: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!conversation) {
      return null;
    }

    await prisma.conversation.delete({
      where: { id: conversationId },
    });

    logger.info(`Deleted conversation ${conversationId} for user ${userId}`);
    return { deleted: true };
  }

  /**
   * Rename a conversation
   */
  static async renameConversation(userId: string, conversationId: string, newTitle: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!conversation) {
      return null;
    }

    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: { title: newTitle },
    });

    logger.info(`Renamed conversation ${conversationId} to "${newTitle}"`);
    return updated;
  }

  /**
   * Build personalized system prompt with learning context
   */
  private static async buildPersonalizedPrompt(userId: string, token: string): Promise<string> {
    try {
      const context = await LearningContextService.getContext(userId, token);
      const contextString = LearningContextService.buildContextString(context);
      return SYSTEM_PROMPT.replace('{LEARNER_CONTEXT}', contextString);
    } catch (error) {
      logger.warn('Failed to get learning context, using generic prompt:', error);
      return SYSTEM_PROMPT.replace('{LEARNER_CONTEXT}', '(Không có dữ liệu học tập — trả lời ở mức chung)');
    }
  }

  /**
   * Send a message in a conversation and get AI response
   * Now with personalized learning context injection
   */
  static async sendMessage(userId: string, conversationId: string, userMessage: string, token: string) {
    // 1. Verify conversation ownership
    let conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!conversation) {
      throw new Error('CONVERSATION_NOT_FOUND');
    }

    // 2. Get conversation history for context
    const previousMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: MAX_CONTEXT_MESSAGES,
    });

    // 3. Build context for AI
    const chatHistory: ChatMessage[] = previousMessages.map((msg) => ({
      role: msg.role as 'USER' | 'ASSISTANT',
      content: msg.content,
    }));

    // 4. Save user message
    await prisma.message.create({
      data: {
        conversationId,
        role: 'USER',
        content: userMessage,
      },
    });

    // 5. Build personalized system prompt with learning data
    const personalizedPrompt = await this.buildPersonalizedPrompt(userId, token);

    // 6. Call Gemini AI with personalized prompt
    const aiResponse = await geminiService.generateResponse(
      personalizedPrompt,
      chatHistory,
      userMessage
    );

    // 7. Save AI response
    const aiMessage = await prisma.message.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content: aiResponse,
      },
    });

    // 8. Auto-generate title if this is the first message
    const isFirstMessage = previousMessages.length === 0;
    if (isFirstMessage) {
      try {
        const generatedTitle = await geminiService.generateTitle(userMessage, aiResponse);
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { title: generatedTitle },
        });
        conversation = { ...conversation, title: generatedTitle };
        logger.info(`Auto-generated title for conversation ${conversationId}: "${generatedTitle}"`);
      } catch (titleError) {
        logger.warn('Failed to auto-generate conversation title:', titleError);
      }
    }

    // 9. Touch conversation updatedAt
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return {
      message: aiResponse,
      messageId: aiMessage.id,
      conversationId,
      conversationTitle: conversation.title,
    };
  }

  /**
   * Create a new conversation AND send the first message in one call
   */
  static async createAndChat(userId: string, userMessage: string, token: string) {
    const conversation = await this.createConversation(userId);
    const result = await this.sendMessage(userId, conversation.id, userMessage, token);
    return result;
  }

  // ==================== Phase 2: AI Insight Endpoints ====================

  /**
   * Generate learning summary using AI
   */
  static async generateLearningSummary(userId: string, token: string): Promise<string> {
    const context = await LearningContextService.getContext(userId, token);
    const contextString = LearningContextService.buildContextString(context);
    const prompt = LEARNING_SUMMARY_PROMPT.replace('{LEARNER_CONTEXT}', contextString);

    const response = await geminiService.generateResponse(prompt, [], 'Tạo báo cáo học tập cho tôi');
    return response;
  }

  /**
   * Generate course recommendations using AI
   */
  static async generateRecommendations(userId: string, token: string): Promise<string> {
    const context = await LearningContextService.getContext(userId, token);
    const contextString = LearningContextService.buildContextString(context);
    const prompt = RECOMMENDATION_PROMPT.replace('{LEARNER_CONTEXT}', contextString);

    const response = await geminiService.generateResponse(prompt, [], 'Đề xuất khóa học cho tôi');
    return response;
  }

  /**
   * Generate coach advice using AI
   */
  static async generateCoachAdvice(userId: string, token: string): Promise<string> {
    const context = await LearningContextService.getContext(userId, token);
    const contextString = LearningContextService.buildContextString(context);
    const prompt = COACH_PROMPT.replace('{LEARNER_CONTEXT}', contextString);

    const response = await geminiService.generateResponse(prompt, [], 'Hãy đánh giá và động viên tôi');
    return response;
  }

  /**
   * Get raw learning insights (no AI call — fast endpoint for dashboard)
   */
  static async getLearningInsights(userId: string, token: string) {
    const context = await LearningContextService.getContext(userId, token);

    return {
      user: context.user,
      stats: context.learningStats,
      inProgressCourses: context.inProgressCourses,
      completedCourses: context.completedCourses,
      learningPaths: context.learningPaths,
      weeklyReport: context.weeklyReport,
      reminders: context.studyReminders,
    };
  }

  /**
   * Get AI-powered smart path recommendations
   */
  static async getRecommendedPaths(userId: string, token: string) {
    const context = await LearningContextService.getContext(userId, token);
    const contextString = LearningContextService.buildContextString(context);
    
    // Fetch all paths available on platform
    const availablePaths = await LearningContextService.fetchAvailablePaths({ Authorization: `Bearer ${token}` });
    
    if (!availablePaths || availablePaths.length === 0) {
      return [];
    }

    const availablePathsString = availablePaths.map((p: any) => 
      `- ID: ${p.id} | Tên lộ trình: "${p.title}" | Danh mục: ${p.category || 'N/A'} | Độ khó: ${p.difficulty} | Mục tiêu: ${p.careerGoal || 'N/A'} | Kỹ năng: [${(p.skills || []).join(', ')}]`
    ).join('\n');

    let prompt = require('../utils/system-prompt').RECOMMEND_PATHS_PROMPT;
    prompt = prompt.replace('{LEARNER_CONTEXT}', contextString);
    prompt = prompt.replace('{AVAILABLE_PATHS}', availablePathsString);

    try {
      const response = await geminiService.generateResponse(prompt, [], 'Hãy trả về danh sách lộ trình định dạng JSON như yêu cầu.');
      
      // Attempt to clean JSON in case Gemini added markdown blocks
      let jsonStr = response.trim();
      if (jsonStr.startsWith('\`\`\`json')) {
        jsonStr = jsonStr.substring(7);
        if (jsonStr.endsWith('\`\`\`')) {
          jsonStr = jsonStr.substring(0, jsonStr.length - 3);
        }
      } else if (jsonStr.startsWith('\`\`\`')) {
        jsonStr = jsonStr.substring(3);
        if (jsonStr.endsWith('\`\`\`')) {
          jsonStr = jsonStr.substring(0, jsonStr.length - 3);
        }
      }
      
      const recommendations = JSON.parse(jsonStr.trim());
      
      // Join with path data
      return recommendations.map((rec: any) => {
        const pathData = availablePaths.find((p: any) => p.id === rec.pathId);
        if (!pathData) return null;
        return {
          ...pathData,
          aiRecommendation: {
            reason: rec.reason,
            score: rec.score
          }
        };
      }).filter(Boolean);
    } catch (error) {
      logger.error('Failed to parse AI path recommendations:', error);
      return [];
    }
  }

  /**
   * Generate AI-powered career path recommendation
   * Analyzes learner's current state + career goal → structured roadmap
   */
  static async generateCareerPathRecommendation(userId: string, careerGoal: string, token: string) {
    // 1. Get extended context with quiz scores, certificates, and detailed paths
    const context = await LearningContextService.getExtendedContext(userId, token);
    const contextString = LearningContextService.buildContextString(context);

    // 2. Build certificates string
    const certificatesString = context.certificates.length > 0
      ? context.certificates.map((c) =>
          `- "${c.courseTitle}" (${c.type}) — Ngày cấp: ${c.issueDate}`
        ).join('\n')
      : '(Chưa có chứng nhận nào)';

    // 3. Build quiz scores string
    const quizScoresString = context.quizScores.length > 0
      ? context.quizScores.map((q) =>
          `- ${q.quizTitle} — Điểm: ${q.score}% — ${q.passed ? 'Đạt ✓' : 'Chưa đạt ✗'}`
        ).join('\n')
      : '(Chưa có kết quả quiz)';

    // 4. Build detailed paths string (enriched with certificate & finalProject)
    const detailedPathsString = context.detailedPaths.length > 0
      ? context.detailedPaths.map((p) => {
          const courses = p.courseDetails.map((c) =>
            `    + CourseID: ${c.courseId} | "${c.title}" (${c.level})`
          ).join('\n');
          const certInfo = p.certificateName ? `\n  Chứng chỉ khi hoàn thành: "${p.certificateName}"` : '';
          const projectInfo = p.finalProject
            ? `\n  Final Project: "${p.finalProject.title}" — ${p.finalProject.objectives} (Ngưỡng đạt: ${p.finalProject.passingScore}%)`
            : '';
          const shortDescInfo = p.shortDescription ? `\n  Tóm tắt: ${p.shortDescription}` : '';
          return `- PathID: ${p.id} | "${p.title}" | Danh mục: ${p.category} | Độ khó: ${p.difficulty} | Mục tiêu: ${p.careerGoal || 'N/A'} | Kỹ năng: [${p.skills.join(', ')}] | Thời lượng: ${p.totalDurationMinutes} phút${shortDescInfo}${certInfo}${projectInfo}\n  Các khóa học trong lộ trình (theo thứ tự học):\n${courses}`;
        }).join('\n')
      : '(Không có lộ trình nào)';

    // 5. Build available courses string
    const availableCoursesString = context.availableCourses.length > 0
      ? context.availableCourses.map((c) =>
          `- CourseID: ${c.id} | "${c.title}" | Danh mục: ${c.category} | Cấp độ: ${c.level}`
        ).join('\n')
      : '(Không có khóa học nào)';

    // 6. Build prompt
    let prompt = CAREER_PATH_PROMPT;
    prompt = prompt.replace('{CAREER_GOAL}', careerGoal);
    prompt = prompt.replace('{LEARNER_CONTEXT}', contextString);
    prompt = prompt.replace('{CERTIFICATES}', certificatesString);
    prompt = prompt.replace('{QUIZ_SCORES}', quizScoresString);
    prompt = prompt.replace('{AVAILABLE_PATHS}', detailedPathsString);
    prompt = prompt.replace('{AVAILABLE_COURSES}', availableCoursesString);

    // 7. Call Gemini
    const response = await geminiService.generateResponse(
      prompt,
      [],
      `Hãy phân tích mục tiêu "${careerGoal}" và trả về lộ trình JSON.`
    );

    // 8. Parse JSON response (with cleanup)
    let jsonStr = response.trim();
    // Remove markdown code block wrapping if present
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
      const result = JSON.parse(jsonStr);

      // Validate essential fields exist
      if (!result.careerGoal || !result.roadmap) {
        throw new Error('Invalid response structure from AI');
      }

      return result;
    } catch (parseError) {
      logger.error('Failed to parse career path JSON:', parseError);
      logger.error('Raw AI response:', response.substring(0, 500));

      // Return a graceful fallback
      return {
        careerGoal,
        matchedPath: null,
        roadmap: [],
        totalEstimatedHours: 0,
        pathCertificate: null,
        summary: 'Xin lỗi, AI không thể tạo lộ trình lúc này. Vui lòng thử lại.',
        alternativePaths: [],
        error: true,
      };
    }
  }

  /**
   * Evaluate a submission through the AI evaluation pipeline
   * Runs each stage sequentially, then generates a feedback report
   */
  static async evaluateSubmission(
    submissionContent: string,
    projectInfo: { title: string; description: string; instructions: string; objectives: string },
    evaluationPipeline: {
      stageNumber: number;
      title: string;
      objective: string;
      criteria: string;
      maxScore: number;
      weight: number;
      passCriteria: string;
    }[],
    passingScore: number = 80
  ) {
    logger.info(`Starting AI evaluation pipeline with ${evaluationPipeline.length} stages`);

    const projectInfoStr = [
      `Tên project: ${projectInfo.title}`,
      `Mô tả: ${projectInfo.description}`,
      projectInfo.instructions ? `Hướng dẫn: ${projectInfo.instructions}` : '',
      projectInfo.objectives ? `Mục tiêu đầu ra: ${projectInfo.objectives}` : '',
    ].filter(Boolean).join('\n');

    const stageResults: any[] = [];

    // Evaluate each stage sequentially
    for (const stage of evaluationPipeline) {
      logger.info(`Evaluating stage ${stage.stageNumber}: ${stage.title}`);

      const stageConfigStr = [
        `Stage ${stage.stageNumber}: ${stage.title}`,
        `Mục tiêu: ${stage.objective}`,
        `Tiêu chí đánh giá: ${stage.criteria}`,
        `Điểm tối đa: ${stage.maxScore}`,
        `Trọng số: ${stage.weight}`,
        `Điều kiện đạt: ${stage.passCriteria}`,
      ].join('\n');

      let prompt = EVALUATION_PIPELINE_PROMPT;
      prompt = prompt.replace('{PROJECT_INFO}', projectInfoStr);
      prompt = prompt.replace('{SUBMISSION_CONTENT}', submissionContent);
      prompt = prompt.replace('{STAGE_CONFIG}', stageConfigStr);

      try {
        const response = await geminiService.generateResponse(
          prompt,
          [],
          `Đánh giá stage ${stage.stageNumber}: ${stage.title}`
        );

        // Parse JSON response
        let jsonStr = response.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
        else if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
        jsonStr = jsonStr.trim();

        const stageResult = JSON.parse(jsonStr);

        // Calculate weighted score
        const weightedScore = (stageResult.score / stage.maxScore) * stage.weight * 100;
        stageResult.weightedScore = Math.round(weightedScore * 100) / 100;
        stageResult.maxScore = stage.maxScore;

        stageResults.push(stageResult);
        logger.info(`Stage ${stage.stageNumber} result: score=${stageResult.score}/${stage.maxScore}, passed=${stageResult.passed}`);
      } catch (stageError: any) {
        logger.error(`Failed to evaluate stage ${stage.stageNumber}:`, stageError);

        // Add a failed stage result
        stageResults.push({
          stageNumber: stage.stageNumber,
          title: stage.title,
          score: 0,
          maxScore: stage.maxScore,
          weightedScore: 0,
          passed: false,
          feedback: 'Không thể đánh giá stage này. Vui lòng thử lại.',
          details: ['❌ Lỗi hệ thống khi đánh giá'],
        });
      }
    }

    // Calculate total score (weighted sum)
    const totalScore = Math.round(stageResults.reduce((sum, r) => sum + (r.weightedScore || 0), 0) * 100) / 100;
    const passed = totalScore >= passingScore;

    // Generate comprehensive feedback report
    let feedbackReport = '';
    try {
      const stageResultsStr = stageResults.map(r =>
        `Stage ${r.stageNumber} (${r.title}): ${r.score}/${r.maxScore} — ${r.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}\n  ${r.feedback}`
      ).join('\n\n');

      let feedbackPrompt = FEEDBACK_REPORT_PROMPT;
      feedbackPrompt = feedbackPrompt.replace('{PROJECT_INFO}', projectInfoStr);
      feedbackPrompt = feedbackPrompt.replace('{STAGE_RESULTS}', stageResultsStr);
      feedbackPrompt = feedbackPrompt.replace('{TOTAL_SCORE}', String(totalScore));
      feedbackPrompt = feedbackPrompt.replace('{PASSING_SCORE}', String(passingScore));

      feedbackReport = await geminiService.generateResponse(
        feedbackPrompt,
        [],
        'Viết báo cáo phản hồi chi tiết cho học viên.'
      );
    } catch (feedbackError) {
      logger.error('Failed to generate feedback report:', feedbackError);
      feedbackReport = `Tổng điểm: ${totalScore}%. ${passed ? 'Chúc mừng bạn đã đạt!' : 'Bạn cần cải thiện để đạt yêu cầu.'}`;
    }

    const result = {
      stageResults,
      totalScore,
      passed,
      feedbackReport,
    };

    logger.info(`Evaluation complete: totalScore=${totalScore}%, passed=${passed}`);
    return result;
  }
}
