import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';

// Map to keep track of connected users: { userId: Set<Socket> }
// Supports multi-tab: one user can have multiple socket connections
const connectedUsers = new Map<string, Set<Socket>>();

export class NotificationSocket {
  private io: SocketIOServer;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
        methods: ['GET', 'POST'],
        credentials: true
      },
      pingInterval: 25000,
      pingTimeout: 60000,
    });

    this.initialize();
  }

  private initialize() {
    // JWT Authentication middleware
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Authentication error: Token missing'));
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production') as any;
        socket.data.user = decoded;
        next();
      } catch (err) {
        next(new Error('Authentication error: Invalid token'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const userId = socket.data.user?.userId;
      
      if (userId) {
        // Add socket to user's set (multi-tab support)
        if (!connectedUsers.has(userId)) {
          connectedUsers.set(userId, new Set());
        }
        connectedUsers.get(userId)!.add(socket);
        
        // Join personal room for targeted events
        socket.join(`user:${userId}`);
        
        logger.info(`User ${userId} connected (${connectedUsers.get(userId)!.size} active connections)`);

        // ==================== Chat Events ====================
        
        // Join a conversation room
        socket.on('chat:join_conversation', (conversationId: string) => {
          socket.join(`conv:${conversationId}`);
          logger.debug(`User ${userId} joined conversation ${conversationId}`);
        });

        // Leave a conversation room
        socket.on('chat:leave_conversation', (conversationId: string) => {
          socket.leave(`conv:${conversationId}`);
          logger.debug(`User ${userId} left conversation ${conversationId}`);
        });

        // Typing indicator
        socket.on('chat:typing', (data: { conversationId: string; isTyping: boolean }) => {
          socket.to(`conv:${data.conversationId}`).emit('chat:typing', {
            userId,
            conversationId: data.conversationId,
            isTyping: data.isTyping,
          });
        });

        // ==================== Progress Events ====================
        
        // Join a course room to receive progress updates (for instructors)
        socket.on('progress:join_course', (courseId: string) => {
          socket.join(`course:${courseId}`);
          logger.debug(`User ${userId} joined course room ${courseId}`);
        });

        socket.on('progress:leave_course', (courseId: string) => {
          socket.leave(`course:${courseId}`);
        });

        // Broadcast lesson completion to instructors in the course room
        socket.on('progress:lesson_completed', (data: {
          courseId: string;
          courseTitle: string;
          lessonId: string;
          lessonTitle: string;
          progressPercentage: number;
          completedLessons: number;
          totalLessons: number;
        }) => {
          if (data && data.courseId) {
            const studentId = socket.data.user?.userId;
            const studentEmail = socket.data.user?.email || 'Học viên';
            this.broadcastProgressUpdate(data.courseId, {
              ...data,
              studentId,
              studentEmail,
              createdAt: new Date().toISOString(),
            });
            logger.info(`Student ${studentId} (${studentEmail}) completed lesson ${data.lessonId} in course ${data.courseId}`);
          }
        });

        // ==================== Disconnect ====================
        
        socket.on('disconnect', () => {
          const userSockets = connectedUsers.get(userId);
          if (userSockets) {
            userSockets.delete(socket);
            if (userSockets.size === 0) {
              connectedUsers.delete(userId);
            }
          }
          logger.info(`User ${userId} disconnected (${connectedUsers.get(userId)?.size || 0} remaining)`);
        });
      }
    });
  }

  // ==================== Notification Methods ====================

  /** Send a notification to a specific user (all tabs) */
  public sendNotificationToUser(userId: string, eventName: string, data: any) {
    this.io.to(`user:${userId}`).emit(eventName, data);
    logger.debug(`Socket event [${eventName}] emitted to user ${userId}`);
  }

  /** Broadcast to all connected users */
  public broadcastNotification(eventName: string, data: any) {
    this.io.emit(eventName, data);
  }

  // ==================== Chat Methods ====================

  /** Send a new chat message to all participants in a conversation */
  public sendChatMessage(conversationId: string, message: any) {
    this.io.to(`conv:${conversationId}`).emit('chat:new_message', message);
    logger.debug(`Chat message sent to conversation ${conversationId}`);
  }

  /** Notify a user about a new conversation or unread messages */
  public notifyNewConversation(userId: string, conversation: any) {
    this.io.to(`user:${userId}`).emit('chat:new_conversation', conversation);
  }

  /** Send unread count update to a specific user */
  public sendUnreadUpdate(userId: string, data: { conversationId: string; unreadCount: number }) {
    this.io.to(`user:${userId}`).emit('chat:unread_update', data);
  }

  // ==================== Progress Methods ====================

  /** Broadcast a progress update to a course room (instructors watching) */
  public broadcastProgressUpdate(courseId: string, data: any) {
    this.io.to(`course:${courseId}`).emit('progress:lesson_completed', data);
    logger.debug(`Progress update broadcast to course ${courseId}`);
  }

  /** Send progress update to a specific user */
  public sendProgressToUser(userId: string, data: any) {
    this.io.to(`user:${userId}`).emit('progress:update', data);
  }

  // ==================== Utility Methods ====================

  /** Check if a user is currently online */
  public isUserOnline(userId: string): boolean {
    return connectedUsers.has(userId) && connectedUsers.get(userId)!.size > 0;
  }

  /** Get count of online users */
  public getOnlineUserCount(): number {
    return connectedUsers.size;
  }
}

// Global instance to use across user-service controllers
export let notificationSocket: NotificationSocket;

export const initializeSockets = (server: HttpServer) => {
  notificationSocket = new NotificationSocket(server);
  return notificationSocket;
};
