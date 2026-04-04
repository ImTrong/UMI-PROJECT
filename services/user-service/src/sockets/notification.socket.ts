import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';

// Map to keep track of connected users: { userId: Socket }
const connectedUsers = new Map<string, Socket>();

export class NotificationSocket {
  private io: SocketIOServer;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    this.initialize();
  }

  private initialize() {
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
        connectedUsers.set(userId, socket);
        logger.info(`User ${userId} connected to sockets`);

        // Join personal room for targeted events
        socket.join(userId);

        socket.on('disconnect', () => {
          connectedUsers.delete(userId);
          logger.info(`User ${userId} disconnected from sockets`);
        });
      }
    });
  }

  // Method to trigger notification from anywhere internally
  public sendNotificationToUser(userId: string, eventName: string, data: any) {
    this.io.to(userId).emit(eventName, data);
    logger.debug(`Socket event [${eventName}] emitted to user ${userId}`);
  }

  // Broadcast to all
  public broadcastNotification(eventName: string, data: any) {
    this.io.emit(eventName, data);
  }
}

// Global instance to use across user-service controllers
export let notificationSocket: NotificationSocket;

export const initializeSockets = (server: HttpServer) => {
  notificationSocket = new NotificationSocket(server);
  return notificationSocket;
};
