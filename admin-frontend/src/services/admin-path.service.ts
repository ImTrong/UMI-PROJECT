import { learningApi } from './api';

export interface CertificateConfig {
  title?: string;
  subtitle?: string;
  description?: string;
  signerName?: string;
  signerTitle?: string;
  organizationName?: string;
  validityYears?: number;
  skills?: string[];
}

export interface AdminLearningPath {
  id: string;
  title: string;
  description: string;
  slug: string;
  category?: string;
  difficulty: string;
  imageUrl?: string;
  shortDescription?: string;
  bannerUrl?: string;
  careerGoal?: string;
  skills: string[];
  prerequisiteRules?: any;
  completionRule: string;
  recommended: boolean;
  status: string;
  totalDurationMinutes: number;
  enrollmentCount: number;
  courseIds: string[];
  certificateConfig?: CertificateConfig;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPathFilters {
  search?: string;
  category?: string;
  difficulty?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export const adminPathService = {
  getPaths: async (filters: AdminPathFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.category) params.append('category', filters.category);
    if (filters.difficulty) params.append('difficulty', filters.difficulty);
    if (filters.status) params.append('status', filters.status);
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());

    const response = await learningApi.get(`/api/learning/admin/paths?${params.toString()}`);
    return response.data;
  },

  getPathById: async (id: string): Promise<AdminLearningPath> => {
    const response = await learningApi.get(`/api/learning/admin/paths/${id}`);
    return response.data.data;
  },

  createPath: async (data: Partial<AdminLearningPath>) => {
    const response = await learningApi.post('/api/learning/admin/paths', data);
    return response.data.data;
  },

  updatePath: async (id: string, data: Partial<AdminLearningPath>) => {
    const response = await learningApi.put(`/api/learning/admin/paths/${id}`, data);
    return response.data.data;
  },

  updateStatus: async (id: string, status: string) => {
    const response = await learningApi.put(`/api/learning/admin/paths/${id}/status`, { status });
    return response.data.data;
  },

  deletePath: async (id: string) => {
    const response = await learningApi.delete(`/api/learning/admin/paths/${id}`);
    return response.data;
  },

  duplicatePath: async (id: string) => {
    const response = await learningApi.post(`/api/learning/admin/paths/${id}/duplicate`);
    return response.data.data;
  },

  // ==================== Final Project Admin Methods ====================

  getFinalProject: async (pathId: string): Promise<AdminFinalProject | null> => {
    try {
      const response = await learningApi.get(`/api/learning/final-project/${pathId}`);
      return response.data.data;
    } catch (err: any) {
      if (err.response?.status === 404) return null;
      throw err;
    }
  },

  createFinalProject: async (pathId: string, data: Partial<AdminFinalProject>): Promise<AdminFinalProject> => {
    const response = await learningApi.post(`/api/learning/final-project/${pathId}`, {
      ...data,
      learningPathId: pathId,
    });
    return response.data.data;
  },

  updateFinalProject: async (projectId: string, data: Partial<AdminFinalProject>): Promise<AdminFinalProject> => {
    const response = await learningApi.put(`/api/learning/final-project/${projectId}`, data);
    return response.data.data;
  },
};

export interface AdminFinalProject {
  id: string;
  learningPathId: string;
  title: string;
  description: string;
  instructions?: string;
  objectives?: string;
  references?: { title: string; url: string }[];
  maxScore: number;
  passingScore: number;
  allowedFileTypes: string[];
  maxFileSizeMB: number;
  maxAttempts: number;
  deadline?: string;
  submissionTypes?: SubmissionTypeConfig[];
  evaluationPipeline?: EvaluationStageConfig[];
  createdBy: string;
  createdAt: string;
}

export type SubmissionFieldType =
  | 'FILE'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'GITHUB_LINK'
  | 'DEMO_LINK'
  | 'FIGMA_LINK'
  | 'TEXT'
  | 'CUSTOM';

export interface SubmissionTypeConfig {
  type: SubmissionFieldType;
  label: string;
  description?: string;
  required: boolean;
  accept?: string;
  maxSizeMB?: number;
  placeholder?: string;
}

export interface EvaluationStageConfig {
  stageNumber: number;
  title: string;
  objective: string;
  criteria: string;
  maxScore: number;
  weight: number;
  passCriteria: string;
  expectedOutput?: string;
}
