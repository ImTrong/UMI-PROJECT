import { Response } from 'express';
import { RAGChatService, RAGChatResult } from './rag-chat.service';
import { AuthRequest } from '../../../middleware/auth.middleware';
import { resolveReadScope } from '../access/rag-access.service';
import { requesterFrom, sendRAGError } from '../http';

export const ragChatService = new RAGChatService();

const MAX_MESSAGE_LENGTH = 4000;

function readMessage(body: any): string | null {
  const message = body?.message;
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_MESSAGE_LENGTH ? trimmed : null;
}

function toResponse(result: RAGChatResult) {
  return {
    success: true,
    data: {
      message: result.message,
      messageId: result.messageId,
      conversationId: result.conversationId,
      conversationTitle: result.conversationTitle,
      grounded: result.grounded,
      sources: result.sources,
      retrievalStats: result.retrievalStats,
    },
  };
}

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
   *   - courseId (required, or filter.courseId): the course whose documents are searched — access is verified
   *   - lessonId (optional, or filter.lessonId): a lesson of that course
   */
  static async chat(req: AuthRequest, res: Response): Promise<void> {
    try {
      const requester = requesterFrom(req);
      if (!requester) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { conversationId } = req.body || {};
      const message = readMessage(req.body);

      if (!conversationId || typeof conversationId !== 'string' || !message) {
        res.status(400).json({ error: 'conversationId and message are required' });
        return;
      }

      const scope = await resolveReadScope(requester, req.body);

      const result = await ragChatService.chat(
        requester.userId,
        conversationId,
        message,
        scope,
        req.user?.email?.split('@')[0], // Use email prefix as learner name
      );

      res.json(toResponse(result));
    } catch (error: any) {
      if (error?.message === 'CONVERSATION_NOT_FOUND') {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      sendRAGError(res, error, 'RAGChat', 'RAG_CHAT_FAILED');
    }
  }

  /**
   * POST /api/ai/rag/chat/new
   *
   * Body:
   *   - message (required): user's question
   *   - courseId (required, or filter.courseId) / lessonId (optional): see chat()
   */
  static async createAndChat(req: AuthRequest, res: Response): Promise<void> {
    try {
      const requester = requesterFrom(req);
      if (!requester) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const message = readMessage(req.body);

      if (!message) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      const scope = await resolveReadScope(requester, req.body);

      const result = await ragChatService.createAndChat(
        requester.userId,
        message,
        scope,
        req.user?.email?.split('@')[0],
      );

      res.json(toResponse(result));
    } catch (error: any) {
      sendRAGError(res, error, 'RAGChat', 'RAG_CHAT_FAILED');
    }
  }
}
