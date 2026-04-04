import { userApi as api } from './api';

export interface UserProfile {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  avatar?: string;
  bio?: string;
  role: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN';
  phoneNumber?: string;
  address?: string;
  dateOfBirth?: string;
  isActive?: boolean;
  badges: string[];
  preferences: {
    theme?: string;
    notifications?: boolean;
    language?: string;
  };
  education: Education[];
  work: WorkExperience[];
  createdAt: string;
  updatedAt: string;
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  endDate?: string;
  grade?: string;
  description?: string;
}

export interface WorkExperience {
  id: string;
  company: string;
  position: string;
  location?: string;
  startDate: string;
  endDate?: string;
  current: boolean;
  description?: string;
}

export interface UpdateProfileData {
  fullName?: string;
  avatar?: string;
  bio?: string;
  phoneNumber?: string;
  address?: string;
  dateOfBirth?: string;
  preferences?: {
    theme?: string;
    notifications?: boolean;
    language?: string;
  };
}

export interface CreateEducationData {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  endDate?: string;
  grade?: string;
  description?: string;
}

export interface CreateWorkData {
  company: string;
  position: string;
  location?: string;
  startDate: string;
  endDate?: string;
  current?: boolean;
  description?: string;
}

export interface UserStats {
  totalEducation: number;
  totalWorkExperience: number;
  currentWork: WorkExperience | null;
  badges: string[];
  role: string;
  createdAt: string;
}

export interface UsersListResponse {
  users: UserProfile[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const userService = {
  // === Profile ===
  async getProfile(): Promise<UserProfile> {
    const response = await api.get('/api/users/me');
    return response.data.data;
  },

  async getUserById(userId: string): Promise<UserProfile> {
    const response = await api.get(`/api/users/${userId}`);
    return response.data.data;
  },

  async updateProfile(data: UpdateProfileData): Promise<UserProfile> {
    const response = await api.put('/api/users/me', data);
    return response.data.data;
  },

  async deleteProfile(): Promise<void> {
    await api.delete('/api/users/me');
  },

  async getUserStats(): Promise<UserStats> {
    const response = await api.get('/api/users/me/stats');
    return response.data.data;
  },

  // === Education ===
  async addEducation(data: CreateEducationData): Promise<Education> {
    const response = await api.post('/api/users/me/education', data);
    return response.data.data;
  },

  async updateEducation(educationId: string, data: Partial<CreateEducationData>): Promise<Education> {
    const response = await api.put(`/api/users/me/education/${educationId}`, data);
    return response.data.data;
  },

  async deleteEducation(educationId: string): Promise<void> {
    await api.delete(`/api/users/me/education/${educationId}`);
  },

  // === Work Experience ===
  async addWorkExperience(data: CreateWorkData): Promise<WorkExperience> {
    const response = await api.post('/api/users/me/work', data);
    return response.data.data;
  },

  async updateWorkExperience(workId: string, data: Partial<CreateWorkData>): Promise<WorkExperience> {
    const response = await api.put(`/api/users/me/work/${workId}`, data);
    return response.data.data;
  },

  async deleteWorkExperience(workId: string): Promise<void> {
    await api.delete(`/api/users/me/work/${workId}`);
  },

  // === Admin ===
  async getAllUsers(page: number = 1, limit: number = 10, filters?: {
    role?: string;
    isActive?: boolean;
    search?: string;
  }): Promise<UsersListResponse> {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    if (filters?.role) params.append('role', filters.role);
    if (filters?.isActive !== undefined) params.append('isActive', filters.isActive.toString());
    if (filters?.search) params.append('search', filters.search);
    const response = await api.get(`/api/users?${params.toString()}`);
    return response.data;
  },

  async adminUpdateUser(userId: string, data: Partial<UpdateProfileData & { role?: string; isActive?: boolean }>): Promise<UserProfile> {
    const response = await api.put(`/api/users/${userId}`, data);
    return response.data.data;
  },

  async adminDeleteUser(userId: string): Promise<void> {
    await api.delete(`/api/users/${userId}`);
  },

  async getAnalytics(): Promise<any> {
    const response = await api.get('/api/users/analytics');
    return response.data.data;
  },

  async becomeInstructor(data: {
    bio?: string;
    phoneNumber?: string;
    address?: string;
    expertise?: string;
    dateOfBirth?: string;
    education?: CreateEducationData[];
    work?: CreateWorkData[];
  }): Promise<any> {
    const response = await api.post('/api/users/become-instructor', data);
    return response.data;
  },
};
