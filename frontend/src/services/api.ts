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
export const aiApi = createApi();

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
aiApi.interceptors.request.use(authInterceptor);

let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response interceptor
const responseInterceptor = async (error: any) => {
  const originalRequest = error.config;

  if (error.response?.status === 401 && !originalRequest._retry) {
    if (isRefreshing) {
      return new Promise(function(resolve, reject) {
        failedQueue.push({ resolve, reject });
      })
        .then(token => {
          originalRequest.headers.Authorization = 'Bearer ' + token;
          return axios(originalRequest);
        })
        .catch(err => Promise.reject(err));
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) throw new Error('No refresh token');

      const response = await axios.post(`${API_GATEWAY_URL}/api/auth/refresh-token`, { refreshToken });
      
      const newAccessToken = response.data.accessToken;
      const newRefreshToken = response.data.refreshToken;
      
      localStorage.setItem('accessToken', newAccessToken);
      localStorage.setItem('refreshToken', newRefreshToken);
      
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      
      processQueue(null, newAccessToken);
      isRefreshing = false;
      
      return axios(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      isRefreshing = false;
      
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      
      // Only redirect if not already on login page
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
        toast.error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }
      return Promise.reject(refreshError);
    }
  }
  return Promise.reject(error);
};

authApi.interceptors.response.use((response) => response, responseInterceptor);
userApi.interceptors.response.use((response) => response, responseInterceptor);
courseApi.interceptors.response.use((response) => response, responseInterceptor);
orderApi.interceptors.response.use((response) => response, responseInterceptor);
paymentApi.interceptors.response.use((response) => response, responseInterceptor);
learningApi.interceptors.response.use((response) => response, responseInterceptor);
aiApi.interceptors.response.use((response) => response, responseInterceptor);

