import { authApi, userApi } from './api';

export interface HealthStatus {
  service: string;
  status: 'active' | 'degraded';
  timestamp: string;
  uptime?: number;
  database: 'connected' | 'disconnected';
}

export const healthService = {
  async checkAuthService(): Promise<HealthStatus> {
    const response = await authApi.get('/api/auth/health');
    return response.data;
  },

  async checkUserService(): Promise<HealthStatus> {
    const response = await userApi.get('/api/users/health');
    return response.data;
  },

  async checkAllServices(): Promise<Record<string, HealthStatus>> {
    const [auth, user] = await Promise.allSettled([
      this.checkAuthService(),
      this.checkUserService(),
    ]);

    return {
      auth: auth.status === 'fulfilled' ? auth.value : { service: 'auth-service', status: 'degraded', timestamp: new Date().toISOString(), database: 'disconnected' },
      user: user.status === 'fulfilled' ? user.value : { service: 'user-service', status: 'degraded', timestamp: new Date().toISOString(), database: 'disconnected' },
    };
  },
};
