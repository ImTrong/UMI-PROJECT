import { authApi as api } from './api';

export interface LoginData {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  fullName: string;
}

export interface AuthResponse {
  message: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    emailVerified: boolean;
    role: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN';
  };
  accessToken: string;
  refreshToken: string;
}

export interface VerifyTokenResponse {
  valid: boolean;
  user?: {
    userId: string;
    email: string;
    fullName: string;
  };
}

export const authService = {
  async login(data: LoginData): Promise<AuthResponse> {
    const response = await api.post('/api/auth/login', data);
    return response.data;
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await api.post('/api/auth/register', data);
    return response.data;
  },

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem('refreshToken');
    const accessToken = localStorage.getItem('accessToken');
    
    try {
      if (refreshToken && accessToken) {
        await api.post('/api/auth/logout', { refreshToken });
      }
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  },

  async verifyToken(token: string): Promise<VerifyTokenResponse> {
    const response = await api.post('/api/auth/verify-token', { token });
    return response.data;
  },

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await api.post('/api/auth/refresh-token', { refreshToken });
    return response.data;
  },

  async changePassword(data: { currentPassword: string; newPassword: string }): Promise<{ message: string }> {
    const response = await api.post('/api/auth/change-password', data);
    return response.data;
  },

  async forgotPassword(data: { email: string }): Promise<{ message: string }> {
    const response = await api.post('/api/auth/forgot-password', data);
    return response.data;
  },

  async resetPassword(data: { token: string; newPassword: string }): Promise<{ message: string }> {
    const response = await api.post('/api/auth/reset-password', data);
    return response.data;
  },

  async verifyEmail(data: { token: string }): Promise<{ message: string }> {
    const response = await api.post('/api/auth/verify-email', data);
    return response.data;
  },
};
