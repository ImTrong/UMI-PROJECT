import { PrismaClient, MessageType } from '@prisma/client';
import logger from '../utils/logger';
import { notificationSocket } from '../sockets/notification.socket';

const prisma = new PrismaClient();

export interface SendMessageData {
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  messageType?: MessageType;
}

export class ChatService {
  /**
   * Get or create a conversation between participants
   */
  static async getOrCreateConversation(
    participantIds: string[],
    courseId?: string,
    courseTitle?: string
  ) {
    // Sort IDs so the same pair always matches
    const sorted = [...participantIds].sort();

    // Try to find existing conversation between same participants
    const existing = await prisma.conversation.findFirst({
      where: {
        participants: { equals: sorted },
        ...(courseId ? { courseId } : {}),
      },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (existing) {
      return existing;
    }

    // Create new conversation
    const conversation = await prisma.conversation.create({
      data: {
        participants: sorted,
        courseId: courseId || null,
        courseTitle: courseTitle || null,
      },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    logger.info(`New conversation created: ${conversation.id} between ${sorted.join(', ')}`);
    return conversation;
  }

  /**
   * Send a message in a conversation
   */
  static async sendMessage(data: SendMessageData) {
    const message = await prisma.chatMessage.create({
      data: {
        conversationId: data.conversationId,
        senderId: data.senderId,
        senderName: data.senderName,
        senderAvatar: data.senderAvatar || null,
        content: data.content,
        messageType: data.messageType || 'TEXT',
        readBy: [data.senderId], // Sender has read their own message
      },
    });

    // Update conversation's lastMessage and lastMessageAt
    await prisma.conversation.update({
      where: { id: data.conversationId },
      data: {
        lastMessage: data.content.length > 100
          ? data.content.substring(0, 100) + '...'
          : data.content,
        lastMessageAt: new Date(),
      },
    });

    // Broadcast via Socket.io to the conversation room
    if (notificationSocket) {
      notificationSocket.sendChatMessage(data.conversationId, message);

      // Notify other participants about unread messages
      const conversation = await prisma.conversation.findUnique({
        where: { id: data.conversationId },
      });

      if (conversation) {
        for (const participantId of conversation.participants) {
          if (participantId !== data.senderId) {
            // Count unread messages for this participant in this conversation
            const unreadCount = await prisma.chatMessage.count({
              where: {
                conversationId: data.conversationId,
                NOT: { readBy: { has: participantId } },
              },
            });
            notificationSocket.sendUnreadUpdate(participantId, {
              conversationId: data.conversationId,
              unreadCount,
            });
          }
        }
      }
    }

    return message;
  }

  /**
   * Get user's conversations with last message and unread count
   */
  static async getConversations(userId: string) {
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { has: userId },
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    // Add unread count for each conversation
    const withUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await prisma.chatMessage.count({
          where: {
            conversationId: conv.id,
            NOT: { readBy: { has: userId } },
          },
        });

        return {
          ...conv,
          unreadCount,
        };
      })
    );

    return withUnread;
  }

  /**
   * Get messages for a conversation (paginated, newest first)
   */
  static async getMessages(
    conversationId: string,
    userId: string,
    page: number = 1,
    limit: number = 50
  ) {
    // Verify user is a participant
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation || !conversation.participants.includes(userId)) {
      throw new Error('Conversation not found or access denied');
    }

    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { conversationId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.chatMessage.count({ where: { conversationId } }),
    ]);

    return {
      messages: messages.reverse(), // Return in chronological order
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Mark all messages in a conversation as read for a user
   */
  static async markAsRead(conversationId: string, userId: string) {
    // Verify user is a participant
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation || !conversation.participants.includes(userId)) {
      throw new Error('Conversation not found or access denied');
    }

    // Find unread messages and add userId to readBy
    const unreadMessages = await prisma.chatMessage.findMany({
      where: {
        conversationId,
        NOT: { readBy: { has: userId } },
      },
    });

    // Update each message to add userId to readBy array
    for (const msg of unreadMessages) {
      await prisma.chatMessage.update({
        where: { id: msg.id },
        data: {
          readBy: { push: userId },
        },
      });
    }

    return { markedCount: unreadMessages.length };
  }

  /**
   * Get total unread message count across all conversations for a user
   */
  static async getTotalUnreadCount(userId: string): Promise<number> {
    const conversations = await prisma.conversation.findMany({
      where: { participants: { has: userId } },
      select: { id: true },
    });

    let total = 0;
    for (const conv of conversations) {
      total += await prisma.chatMessage.count({
        where: {
          conversationId: conv.id,
          NOT: { readBy: { has: userId } },
        },
      });
    }

    return total;
  }
}
