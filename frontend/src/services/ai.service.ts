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

// ==================== Career Path Types ====================

export interface CareerPathCourse {
  order: number;
  courseId: string;
  courseTitle: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED';
  currentProgress?: number;
  skills: string[];
  estimatedHours: number;
  certificate: string;
  prerequisiteNote?: string | null;
}

export interface CareerPathRecommendation {
  careerGoal: string;
  goalAnalysis?: {
    goalType: 'CAREER_POSITION' | 'SKILL_DEVELOPMENT' | 'CAREER_TRANSITION' | 'CERTIFICATION' | 'COMBINED';
    targetRole: string | null;
    keyTechnologies: string[];
    targetLevel: 'junior' | 'mid' | 'senior' | 'lead' | null;
    requiredCompetencies: string[];
  };
  gapAnalysis?: {
    met: string[];
    needReinforcement: string[];
    missing: string[];
    unverified: string[];
    unavailableOnPlatform: string[];
  };
  platformCoverage?: {
    coverageLevel: 'FULL_COVERAGE' | 'PARTIAL_COVERAGE' | 'NOT_SUPPORTED';
    coveredSkills: string[];
    uncoveredSkills: string[];
    coverageSummary: string;
    externalRequirements: string[];
    limitations: string[];
  };
  certifications?: {
    umiCertificates: string[];
    externalCertifications: string[];
  };
  matchedPath: {
    pathId: string | null;
    title: string | null;
    description: string | null;
    matchLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    matchReason: string;
  } | null;
  roadmap: CareerPathCourse[];
  totalEstimatedHours: number;
  estimatedWeeks?: string;
  pathCertificate: string | null;
  summary: string;
  alternativePaths: Array<{
    pathId: string;
    title: string;
    matchLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    reason: string;
  }>;
  error?: boolean;
}

// ==================== Career Advisor Pipeline Types ====================

export interface AssessmentQuestion {
  id: string;
  skill: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  question: string;
  options: string[];
  correctAnswer: string;
}

export interface AssessmentAnswer {
  questionId: string;
  skill: string;
  answer: string;
  correctAnswer: string;
}

export interface SkillProfileEntry {
  skill: string;
  level: 'NO_EVIDENCE' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  confidence: number;
  status: 'MET' | 'NEEDS_REINFORCEMENT' | 'MISSING' | 'UNVERIFIED';
  evidences: string[];
}

export interface CareerAdvisorAssessmentRequired {
  status: 'ASSESSMENT_REQUIRED' | 'ASSESSMENT_CONTINUE';
  sessionId: string;
  assessment: {
    questions: AssessmentQuestion[];
    totalQuestions: number;
    reason: string;
    skillsToAssess: string[];
    round: number;
    questionsAnswered: number;
    maxQuestions: number;
  };
  skillProfile: SkillProfileEntry[];
  overallProfile: {
    profileCompleteness: number;
    summary: string;
  };
}

export interface CareerAdvisorRoadmapReady {
  status: 'ROADMAP_READY';
  sessionId: string;
  skillProfile: any;
  roadmap: CareerPathRecommendation;
}

export interface CareerAdvisorProfileComplete {
  status: 'PROFILE_COMPLETE';
  sessionId: string;
  skillProfile: any;
  roadmap: null;
  error?: string;
}

export type CareerAdvisorResponse =
  | CareerAdvisorAssessmentRequired
  | CareerAdvisorRoadmapReady
  | CareerAdvisorProfileComplete;

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

  // ========== Phase 3: AI Career Path Recommendation ==========

  /**
   * Get AI-powered personalized career path recommendation
   * Sends learner's career goal and gets a structured roadmap
   */
  getCareerPathRecommendation: async (goal: string): Promise<CareerPathRecommendation> => {
    const response = await aiApi.post('/api/ai/career-path', { goal });
    return response.data.data;
  },

  // ========== Career Advisor Pipeline (Prompt 1 + Prompt 2) ==========

  /**
   * Start a career advisor session
   * Runs Prompt 1 (Skill Assessment) → may return assessment questions or roadmap directly
   */
  startCareerAdvisor: async (goal: string): Promise<CareerAdvisorResponse> => {
    const response = await aiApi.post('/api/ai/career-advisor', { goal });
    return response.data.data;
  },

  /**
   * Submit assessment answers for an existing session
   * Continues Prompt 1 → may return more questions or complete with roadmap
   */
  submitAssessmentAnswers: async (sessionId: string, answers: AssessmentAnswer[]): Promise<CareerAdvisorResponse> => {
    const response = await aiApi.post(`/api/ai/career-advisor/${sessionId}/submit`, { answers });
    return response.data.data;
  },

  /**
   * Skip assessment and get foundation-first roadmap
   */
  skipAssessment: async (sessionId: string): Promise<CareerAdvisorResponse> => {
    const response = await aiApi.post(`/api/ai/career-advisor/${sessionId}/skip`);
    return response.data.data;
  },
};
