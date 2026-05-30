import { userApi } from './api';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  messageType: 'TEXT' | 'IMAGE' | 'FILE' | 'SYSTEM';
  readBy: string[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  courseId?: string;
  courseTitle?: string;
  participants: string[];
  lastMessage?: string;
  lastMessageAt: string;
  createdAt: string;
  messages: ChatMessage[];
  unreadCount: number;
}

export interface MessagesResponse {
  messages: ChatMessage[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const chatService = {
  async getConversations(): Promise<Conversation[]> {
    const response = await userApi.get('/api/users/me/conversations');
    return response.data.data;
  },

  async createConversation(
    participantId: string,
    courseId?: string,
    courseTitle?: string
  ): Promise<Conversation> {
    const response = await userApi.post('/api/users/me/conversations', {
      participantId,
      courseId,
      courseTitle,
    });
    return response.data.data;
  },

  async getMessages(conversationId: string, page: number = 1, limit: number = 50): Promise<MessagesResponse> {
    const response = await userApi.get(
      `/api/users/me/conversations/${conversationId}/messages?page=${page}&limit=${limit}`
    );
    return response.data;
  },

  async sendMessage(
    conversationId: string,
    content: string,
    senderName: string,
    senderAvatar?: string,
    messageType: string = 'TEXT'
  ): Promise<ChatMessage> {
    const response = await userApi.post(
      `/api/users/me/conversations/${conversationId}/messages`,
      { content, senderName, senderAvatar, messageType }
    );
    return response.data.data;
  },

  async markAsRead(conversationId: string): Promise<{ markedCount: number }> {
    const response = await userApi.put(`/api/users/me/conversations/${conversationId}/read`);
    return response.data;
  },

  async getUnreadCount(): Promise<number> {
    const response = await userApi.get('/api/users/me/chat/unread-count');
    return response.data.data.unreadCount;
  },
};
