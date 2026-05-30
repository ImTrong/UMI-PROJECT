import { PrismaClient } from '@prisma/client';
import { geminiService, ChatMessage } from './gemini.service';
import { LearningContextService } from './learning-context.service';
import {
  SYSTEM_PROMPT,
  LEARNING_SUMMARY_PROMPT,
  RECOMMENDATION_PROMPT,
  COACH_PROMPT,
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
      `- ID: ${p.id} | Tên lộ trình: "${p.title}" | Độ khó: ${p.difficulty} | Mục tiêu: ${p.careerGoal || 'N/A'}`
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
}
