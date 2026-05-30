import { learningApi } from './api';

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

    const response = await learningApi.get(`/learning/admin/paths?${params.toString()}`);
    return response.data;
  },

  getPathById: async (id: string): Promise<AdminLearningPath> => {
    const response = await learningApi.get(`/learning/admin/paths/${id}`);
    return response.data.data;
  },

  createPath: async (data: Partial<AdminLearningPath>) => {
    const response = await learningApi.post('/learning/admin/paths', data);
    return response.data.data;
  },

  updatePath: async (id: string, data: Partial<AdminLearningPath>) => {
    const response = await learningApi.put(`/learning/admin/paths/${id}`, data);
    return response.data.data;
  },

  updateStatus: async (id: string, status: string) => {
    const response = await learningApi.put(`/learning/admin/paths/${id}/status`, { status });
    return response.data.data;
  },

  deletePath: async (id: string) => {
    const response = await learningApi.delete(`/learning/admin/paths/${id}`);
    return response.data;
  },

  duplicatePath: async (id: string) => {
    const response = await learningApi.post(`/learning/admin/paths/${id}/duplicate`);
    return response.data.data;
  }
};
