import { PrismaClient, NotificationType } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

import { notificationSocket } from '../sockets/notification.socket';
import { deriveNotificationId, identityMismatch } from './notification-idempotency';

/** The key was already used for a notification with a different recipient, type or link: nothing was changed. */
export class IdempotencyKeyReusedError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  constructor(readonly fields: string[]) {
    super(`The idempotency key was already used for a different notification (${fields.join(', ')} differ)`);
    this.name = 'IdempotencyKeyReusedError';
  }
}

/** MongoDB refused the _id as a duplicate but the stored notification could not be read back: the caller must retry, never assume success. */
export class IdempotencyRetryError extends Error {
  readonly code = 'IDEMPOTENCY_RETRY';
  constructor() {
    super('A notification with this idempotency key exists or is being written but could not be read; retry the request');
    this.name = 'IdempotencyRetryError';
  }
}

export interface IdempotentResult {
  notification: any;
  deduplicated: boolean;
  /** Only on a replay: the title or message differs from the stored (authoritative) notification. */
  payloadChanged?: boolean;
}

/** Prisma's answer when the deterministic _id is already taken (P2002 on the primary key index `_id_`). */
const isDuplicateId = (e: any) => {
  if (e?.code !== 'P2002') return false;
  const target = e?.meta?.target;
  return target === undefined || (Array.isArray(target) ? target.some((t: any) => String(t).includes('_id')) : String(target).includes('_id'));
};

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

  /**
   * Idempotent variant for requests that carry an X-Idempotency-Key (FIX 06C-4B2B1). The notification's _id is derived from the
   * key, so MongoDB's unique _id lets at most one request create it - sequential retries and concurrent duplicates alike.
   *   - created:  stored with the derived id and the key, pushed over the socket ONCE (a push failure is logged; the
   *               notification stays stored and a retry finds it);
   *   - replay:   nothing is written and nothing is pushed; the stored notification is returned. It must be the same
   *               notification (userId, type, link), otherwise IdempotencyKeyReusedError; a different title / message is
   *               reported as payloadChanged and the stored text stays authoritative;
   *   - duplicate id but nothing to read back: IdempotencyRetryError (never a fake "deduplicated").
   * The key must already be validated (readIdempotencyKey).
   */
  static async createNotificationIdempotent(data: CreateNotificationData, key: string): Promise<IdempotentResult> {
    const id = deriveNotificationId(key);
    let notification: any;
    try {
      notification = await prisma.notification.create({
        data: {
          id,
          userId: data.userId,
          title: data.title,
          message: data.message,
          type: data.type || 'INFO',
          link: data.link,
          idempotencyKey: key,
        },
      });
    } catch (e: any) {
      if (!isDuplicateId(e)) throw e;
      const stored = await prisma.notification.findUnique({ where: { id } });
      if (!stored) throw new IdempotencyRetryError();
      const differs = identityMismatch(stored, data);
      if (stored.idempotencyKey && stored.idempotencyKey !== key) differs.push('idempotencyKey');
      if (differs.length > 0) throw new IdempotencyKeyReusedError(differs);
      const payloadChanged = stored.title !== data.title || stored.message !== data.message;
      if (payloadChanged) {
        logger.warn(`Idempotent notification replay for ${id} carried a different title/message; the stored notification is kept`);
      }
      return { notification: stored, deduplicated: true, ...(payloadChanged ? { payloadChanged: true } : {}) };
    }

    logger.info(`Notification created for user: ${data.userId} (idempotent, id ${id})`);
    try {
      if (notificationSocket) notificationSocket.sendNotificationToUser(data.userId, 'new_notification', notification);
    } catch (pushError) {
      // the notification is stored: a retry with the same key finds it and does not push again
      logger.warn(`Real-time push of notification ${id} failed (the notification is stored):`, pushError);
    }
    return { notification, deduplicated: false };
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
