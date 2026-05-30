import { userApi } from './api';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  isRead: boolean;
  link?: string;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const notificationService = {
  async getNotifications(page: number = 1, limit: number = 20): Promise<NotificationsResponse> {
    const response = await userApi.get(`/api/users/me/notifications?page=${page}&limit=${limit}`);
    return response.data;
  },

  async markAsRead(notificationId: string): Promise<Notification> {
    const response = await userApi.put(`/api/users/me/notifications/${notificationId}/read`);
    return response.data.data;
  },

  async markAllAsRead(): Promise<{ updatedCount: number }> {
    const response = await userApi.put('/api/users/me/notifications/read-all');
    return response.data;
  },

  async deleteNotification(notificationId: string): Promise<void> {
    await userApi.delete(`/api/users/me/notifications/${notificationId}`);
  },
};
