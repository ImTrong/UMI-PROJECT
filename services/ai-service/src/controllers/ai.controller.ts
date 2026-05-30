import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ChatService } from '../services/chat.service';
import { HTTP_STATUS, ERROR_MESSAGES, SUCCESS_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

/**
 * Extract JWT token from request headers
 */
function extractToken(req: AuthRequest): string {
  const authHeader = req.headers.authorization;
  return authHeader?.split(' ')[1] || '';
}

/**
 * AI Controller — REST API handlers for chat and AI insights
 */
export class AIController {
  /**
   * Health check endpoint
   */
  static healthCheck(_req: AuthRequest, res: Response) {
    res.status(HTTP_STATUS.OK).json({
      status: 'ok',
      service: 'ai-service',
      version: '2.0',
      features: ['chat', 'learning-summary', 'recommendations', 'coach', 'insights'],
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * POST /api/ai/chat
   * Send a message and get AI response (with personalized context)
   */
  static async chat(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const { conversationId, message } = req.body;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MESSAGES.MESSAGE_REQUIRED });
      }

      const token = extractToken(req);
      let result;

      if (conversationId) {
        result = await ChatService.sendMessage(userId, conversationId, message.trim(), token);
      } else {
        result = await ChatService.createAndChat(userId, message.trim(), token);
      }

      return res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.MESSAGE_SENT,
        data: result,
      });
    } catch (error: any) {
      if (error.message === 'CONVERSATION_NOT_FOUND') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.CONVERSATION_NOT_FOUND });
      }

      logger.error('Chat error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: ERROR_MESSAGES.AI_SERVICE_ERROR,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * POST /api/ai/conversations
   */
  static async createConversation(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const { title } = req.body;
      const conversation = await ChatService.createConversation(userId, title);

      return res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.CONVERSATION_CREATED,
        data: conversation,
      });
    } catch (error: any) {
      logger.error('Create conversation error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message });
    }
  }

  /**
   * GET /api/ai/conversations
   */
  static async getConversations(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const conversations = await ChatService.getConversations(userId);

      return res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.CONVERSATIONS_RETRIEVED,
        data: conversations,
      });
    } catch (error: any) {
      logger.error('Get conversations error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message });
    }
  }

  /**
   * GET /api/ai/conversations/:id
   */
  static async getConversationById(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const { id } = req.params;
      const conversation = await ChatService.getConversationById(userId, id);

      if (!conversation) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.CONVERSATION_NOT_FOUND });
      }

      return res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.CONVERSATION_RETRIEVED,
        data: conversation,
      });
    } catch (error: any) {
      logger.error('Get conversation error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message });
    }
  }

  /**
   * DELETE /api/ai/conversations/:id
   */
  static async deleteConversation(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const { id } = req.params;
      const result = await ChatService.deleteConversation(userId, id);

      if (!result) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.CONVERSATION_NOT_FOUND });
      }

      return res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.CONVERSATION_DELETED,
      });
    } catch (error: any) {
      logger.error('Delete conversation error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message });
    }
  }

  /**
   * PATCH /api/ai/conversations/:id/rename
   */
  static async renameConversation(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const { id } = req.params;
      const { title } = req.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MESSAGES.TITLE_REQUIRED });
      }

      const result = await ChatService.renameConversation(userId, id, title.trim());

      if (!result) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MESSAGES.CONVERSATION_NOT_FOUND });
      }

      return res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.CONVERSATION_RENAMED,
        data: result,
      });
    } catch (error: any) {
      logger.error('Rename conversation error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message });
    }
  }

  // ==================== Phase 2: AI Insights Endpoints ====================

  /**
   * GET /api/ai/learning-summary
   * AI-generated learning summary (calls Gemini)
   */
  static async learningSummary(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const token = extractToken(req);
      const summary = await ChatService.generateLearningSummary(userId, token);

      return res.status(HTTP_STATUS.OK).json({
        message: 'Learning summary generated successfully',
        data: { summary },
      });
    } catch (error: any) {
      logger.error('Learning summary error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to generate learning summary',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * GET /api/ai/recommendations
   * AI-generated course recommendations (calls Gemini)
   */
  static async recommendations(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const token = extractToken(req);
      const recommendations = await ChatService.generateRecommendations(userId, token);

      return res.status(HTTP_STATUS.OK).json({
        message: 'Recommendations generated successfully',
        data: { recommendations },
      });
    } catch (error: any) {
      logger.error('Recommendations error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to generate recommendations',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * GET /api/ai/insights
   * Raw learning insights data (NO Gemini call — fast dashboard endpoint)
   */
  static async insights(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const token = extractToken(req);
      const data = await ChatService.getLearningInsights(userId, token);

      return res.status(HTTP_STATUS.OK).json({
        message: 'Learning insights retrieved successfully',
        data,
      });
    } catch (error: any) {
      logger.error('Insights error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to retrieve insights',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * POST /api/ai/coach
   * AI Learning Coach advice (calls Gemini)
   */
  static async coach(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const token = extractToken(req);
      const advice = await ChatService.generateCoachAdvice(userId, token);

      return res.status(HTTP_STATUS.OK).json({
        message: 'Coach advice generated successfully',
        data: { advice },
      });
    } catch (error: any) {
      logger.error('Coach error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to generate coach advice',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
  /**
   * GET /api/ai/recommended-paths
   * AI-generated learning path recommendations
   */
  static async recommendedPaths(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }

      const token = extractToken(req);
      const paths = await ChatService.getRecommendedPaths(userId, token);

      return res.status(HTTP_STATUS.OK).json({
        message: 'Recommended paths generated successfully',
        data: paths,
      });
    } catch (error: any) {
      logger.error('Recommended paths error:', error);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to generate recommended paths',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
}
