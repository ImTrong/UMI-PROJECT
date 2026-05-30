import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ChatService } from '../services/chat.service';
import { HTTP_STATUS } from '../utils/constants';
import logger from '../utils/logger';

export class ChatController {
  /**
   * GET /api/users/me/conversations
   * Get all conversations for the current user
   */
  static async getConversations(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const conversations = await ChatService.getConversations(req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: 'Conversations retrieved successfully',
        data: conversations,
      });
    } catch (error: any) {
      logger.error('Get conversations error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to retrieve conversations',
      });
    }
  }

  /**
   * POST /api/users/me/conversations
   * Create or get a conversation with another user
   * Body: { participantId: string, courseId?: string, courseTitle?: string }
   */
  static async createConversation(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const { participantId, courseId, courseTitle } = req.body;

      if (!participantId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'participantId is required',
        });
      }

      if (participantId === req.user.userId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Cannot create a conversation with yourself',
        });
      }

      const conversation = await ChatService.getOrCreateConversation(
        [req.user.userId, participantId],
        courseId,
        courseTitle
      );

      res.status(HTTP_STATUS.OK).json({
        message: 'Conversation retrieved/created successfully',
        data: conversation,
      });
    } catch (error: any) {
      logger.error('Create conversation error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create conversation',
      });
    }
  }

  /**
   * GET /api/users/me/conversations/:conversationId/messages
   * Get messages for a conversation (paginated)
   */
  static async getMessages(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const { conversationId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const result = await ChatService.getMessages(
        conversationId,
        req.user.userId,
        page,
        limit
      );

      res.status(HTTP_STATUS.OK).json({
        message: 'Messages retrieved successfully',
        ...result,
      });
    } catch (error: any) {
      logger.error('Get messages error:', error);
      const status = error.message?.includes('not found') || error.message?.includes('access denied')
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;
      res.status(status).json({
        error: error.message || 'Failed to retrieve messages',
      });
    }
  }

  /**
   * POST /api/users/me/conversations/:conversationId/messages
   * Send a message in a conversation
   * Body: { content: string, messageType?: 'TEXT' | 'IMAGE' | 'FILE' }
   */
  static async sendMessage(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const { conversationId } = req.params;
      const { content, messageType, senderName, senderAvatar } = req.body;

      if (!content || !content.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Message content is required',
        });
      }

      const message = await ChatService.sendMessage({
        conversationId,
        senderId: req.user.userId,
        senderName: senderName || req.user.email,
        senderAvatar,
        content: content.trim(),
        messageType: messageType || 'TEXT',
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: 'Message sent successfully',
        data: message,
      });
    } catch (error: any) {
      logger.error('Send message error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to send message',
      });
    }
  }

  /**
   * PUT /api/users/me/conversations/:conversationId/read
   * Mark all messages in a conversation as read
   */
  static async markAsRead(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const { conversationId } = req.params;
      const result = await ChatService.markAsRead(conversationId, req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: 'Messages marked as read',
        ...result,
      });
    } catch (error: any) {
      logger.error('Mark as read error:', error);
      const status = error.message?.includes('not found')
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;
      res.status(status).json({
        error: error.message || 'Failed to mark messages as read',
      });
    }
  }

  /**
   * GET /api/users/me/chat/unread-count
   * Get total unread message count
   */
  static async getUnreadCount(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const count = await ChatService.getTotalUnreadCount(req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        data: { unreadCount: count },
      });
    } catch (error: any) {
      logger.error('Get unread count error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get unread count',
      });
    }
  }
}
