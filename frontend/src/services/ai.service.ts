import { aiApi } from './api';

// ==================== Types ====================

export interface Conversation {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface ChatResponse {
  message: string;
  messageId: string;
  conversationId: string;
  conversationTitle: string;
}

export interface LearningInsights {
  user: { name: string; email: string; role: string } | null;
  stats: {
    totalCoursesEnrolled: number;
    totalCoursesCompleted: number;
    totalLessonsCompleted: number;
    currentStreak: number;
    longestStreak: number;
    totalStudyTime: string;
  } | null;
  inProgressCourses: Array<{ courseId: string; title: string; progress: number }>;
  completedCourses: Array<{ courseId: string; title: string; completedAt: string }>;
  learningPaths: Array<{ pathId: string; title: string; progress: number; targetRole: string }>;
  weeklyReport: {
    totalMinutes: number;
    lessonsCompleted: number;
    coursesCompleted: number;
    comparedToLastWeek: string;
  } | null;
  reminders: Array<{ type: string; message: string; priority: string }>;
}

// ==================== AI Service ====================

export const aiService = {
  // ========== Chat ==========

  chat: async (message: string, conversationId?: string): Promise<ChatResponse> => {
    const response = await aiApi.post('/api/ai/chat', { message, conversationId });
    return response.data.data;
  },

  createConversation: async (title?: string): Promise<{ id: string; title: string }> => {
    const response = await aiApi.post('/api/ai/conversations', { title });
    return response.data.data;
  },

  getConversations: async (): Promise<Conversation[]> => {
    const response = await aiApi.get('/api/ai/conversations');
    return response.data.data;
  },

  getConversationById: async (id: string): Promise<ConversationDetail> => {
    const response = await aiApi.get(`/api/ai/conversations/${id}`);
    return response.data.data;
  },

  deleteConversation: async (id: string): Promise<void> => {
    await aiApi.delete(`/api/ai/conversations/${id}`);
  },

  renameConversation: async (id: string, title: string): Promise<void> => {
    await aiApi.patch(`/api/ai/conversations/${id}/rename`, { title });
  },

  // ========== Phase 2: AI Insights ==========

  /**
   * Get raw learning insights (fast, no Gemini call)
   */
  getInsights: async (): Promise<LearningInsights> => {
    const response = await aiApi.get('/api/ai/insights');
    return response.data.data;
  },

  /**
   * Get AI-generated learning summary (calls Gemini)
   */
  getLearningSummary: async (): Promise<string> => {
    const response = await aiApi.get('/api/ai/learning-summary');
    return response.data.data.summary;
  },

  /**
   * Get AI-generated course recommendations (calls Gemini)
   */
  getRecommendations: async (): Promise<string> => {
    const response = await aiApi.get('/api/ai/recommendations');
    return response.data.data.recommendations;
  },

  /**
   * Get AI Coach advice (calls Gemini)
   */
  getCoachAdvice: async (): Promise<string> => {
    const response = await aiApi.post('/api/ai/coach');
    return response.data.data.advice;
  },

  /**
   * Phase 3: Get AI-powered smart path recommendations
   */
  getRecommendedPaths: async (): Promise<any[]> => {
    const response = await aiApi.get('/api/ai/recommended-paths');
    return response.data.data;
  },
};
