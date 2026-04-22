import axios from 'axios';
import toast from 'react-hot-toast';

// All API requests go through the Nginx gateway (same origin)
// The gateway routes /api/auth/* -> auth-service, /api/users/* -> user-service, etc.
const API_GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || '';

const createApi = () => axios.create({
  baseURL: API_GATEWAY_URL,
  headers: { 'Content-Type': 'application/json' },
});

export const authApi = createApi();
export const userApi = createApi();
export const courseApi = createApi();
export const orderApi = createApi();
export const paymentApi = createApi();
export const learningApi = createApi();

// Request interceptor cho tất cả API
const authInterceptor = (config: any) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
};

authApi.interceptors.request.use(authInterceptor);
userApi.interceptors.request.use(authInterceptor);
courseApi.interceptors.request.use(authInterceptor);
orderApi.interceptors.request.use(authInterceptor);
paymentApi.interceptors.request.use(authInterceptor);
learningApi.interceptors.request.use(authInterceptor);

// Response interceptor
const responseInterceptor = (error: any) => {
  if (error.response?.status === 401) {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    window.location.href = '/login';
    toast.error('Session expired. Please login again.');
  }
  return Promise.reject(error);
};

authApi.interceptors.response.use((response) => response, responseInterceptor);
userApi.interceptors.response.use((response) => response, responseInterceptor);
courseApi.interceptors.response.use((response) => response, responseInterceptor);
orderApi.interceptors.response.use((response) => response, responseInterceptor);
paymentApi.interceptors.response.use((response) => response, responseInterceptor);
learningApi.interceptors.response.use((response) => response, responseInterceptor);
