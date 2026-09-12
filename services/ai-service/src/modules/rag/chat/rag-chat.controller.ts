import { Response } from 'express';
import { RAGChatService } from './rag-chat.service';
import { AuthRequest } from '../../../middleware/auth.middleware';
import logger from '../../../utils/logger';

const ragChatService = new RAGChatService();

/**
 * RAG Chat Controller — REST endpoint for RAG-powered chat.
 *
 * POST /api/ai/rag/chat — Send a message and get grounded answer with citations
 * POST /api/ai/rag/chat/new — Create conversation + send first message
 */
export class RAGChatController {
  /**
   * POST /api/ai/rag/chat
   *
   * Body:
   *   - conversationId (required): conversation ID
   *   - message (required): user's question
   *   - filter (optional): { courseId?, lessonId?, sourceType?, learningPathId?, skills? }
   */
  static async chat(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { conversationId, message, filter } = req.body;

      if (!conversationId || !message) {
        res.status(400).json({ error: 'conversationId and message are required' });
        return;
      }

      const result = await ragChatService.chat(
        userId,
        conversationId,
        message,
        filter,
        req.user?.email?.split('@')[0], // Use email prefix as learner name
      );

      res.json({
        success: true,
        data: {
          message: result.message,
          messageId: result.messageId,
          conversationId: result.conversationId,
          conversationTitle: result.conversationTitle,
          sources: result.sources,
          retrievalStats: result.retrievalStats,
        },
      });
    } catch (error: any) {
      logger.error('[RAGChat] Chat error:', error);

      if (error.message === 'CONVERSATION_NOT_FOUND') {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      res.status(500).json({
        error: 'Failed to process RAG chat',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  /**
   * POST /api/ai/rag/chat/new
   *
   * Body:
   *   - message (required): user's question
   *   - filter (optional): metadata filter
   */
  static async createAndChat(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { message, filter } = req.body;

      if (!message) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      const result = await ragChatService.createAndChat(
        userId,
        message,
        filter,
        req.user?.email?.split('@')[0],
      );

      res.json({
        success: true,
        data: {
          message: result.message,
          messageId: result.messageId,
          conversationId: result.conversationId,
          conversationTitle: result.conversationTitle,
          sources: result.sources,
          retrievalStats: result.retrievalStats,
        },
      });
    } catch (error: any) {
      logger.error('[RAGChat] CreateAndChat error:', error);
      res.status(500).json({
        error: 'Failed to create RAG chat',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
}
