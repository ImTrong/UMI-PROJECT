import axios from 'axios';

const API_GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:8080';

const apiClient = axios.create({
  baseURL: API_GATEWAY_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface ServiceHealth {
  service: string;
  status: string;
  timestamp: string;
  uptime: number;
  database?: string;
}

export const healthService = {
  // Check gateway health
  checkGatewayHealth: async (): Promise<ServiceHealth> => {
    try {
      const response = await apiClient.get('/health');
      return { ...response.data, service: 'api-gateway' };
    } catch (error) {
      return {
        service: 'api-gateway',
        status: 'down',
        timestamp: new Date().toISOString(),
        uptime: 0,
      };
    }
  },

  // Check individual service health
  checkServiceHealth: async (serviceName: string, port: number): Promise<ServiceHealth> => {
    try {
      const serviceUrl = `http://localhost:${port}`;
      const response = await axios.get(`${serviceUrl}/health`, { timeout: 5000 });
      return response.data;
    } catch (error) {
      return {
        service: serviceName,
        status: 'down',
        timestamp: new Date().toISOString(),
        uptime: 0,
      };
    }
  },

  // Check all services
  checkAllServices: async () => {
    const services = [
      { name: 'auth-service', port: 3001 },
      { name: 'user-service', port: 3002 },
      { name: 'course-service', port: 3003 },
      { name: 'order-service', port: 3004 },
      { name: 'payment-service', port: 3005 },
      { name: 'learning-service', port: 3006 },
    ];

    const healthChecks = await Promise.all(
      services.map((service) =>
        healthService.checkServiceHealth(service.name, service.port)
      )
    );

    return healthChecks;
  },
};

// Example: Sample API calls
export const sampleApi = {
  getCourses: async () => {
    try {
      const response = await apiClient.get('/api/courses');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch courses:', error);
      throw error;
    }
  },

  getUsers: async () => {
    try {
      const response = await apiClient.get('/api/users');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch users:', error);
      throw error;
    }
  },
};

export default apiClient;
