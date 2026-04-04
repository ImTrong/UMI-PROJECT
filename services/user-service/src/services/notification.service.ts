import { PrismaClient, NotificationType } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

import { notificationSocket } from '../sockets/notification.socket';

export interface CreateNotificationData {
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
  link?: string;
}

export class NotificationService {
  static async createNotification(data: CreateNotificationData) {
    const notification = await prisma.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type || 'INFO',
        link: data.link,
      },
    });

    logger.info(`Notification created for user: ${data.userId}`);
    
    // Broadcast via Socket.io in real-time
    if (notificationSocket) {
      notificationSocket.sendNotificationToUser(data.userId, 'new_notification', notification);
    }

    return notification;
  }

  static async getUserNotifications(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where: { userId } }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      notifications,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async markAsRead(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found');
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    return updated;
  }

  static async markAllAsRead(userId: string) {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { updatedCount: result.count };
  }

  static async deleteNotification(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found');
    }

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    return { success: true };
  }
}
