import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useSelector } from 'react-redux';
import { RootState } from '../store';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  // Notification helpers
  onNotification: (callback: (data: any) => void) => void;
  offNotification: (callback: (data: any) => void) => void;
  // Chat helpers
  joinConversation: (conversationId: string) => void;
  leaveConversation: (conversationId: string) => void;
  sendTyping: (conversationId: string, isTyping: boolean) => void;
  onChatMessage: (callback: (data: any) => void) => void;
  offChatMessage: (callback: (data: any) => void) => void;
  onTyping: (callback: (data: any) => void) => void;
  offTyping: (callback: (data: any) => void) => void;
  onUnreadUpdate: (callback: (data: any) => void) => void;
  offUnreadUpdate: (callback: (data: any) => void) => void;
  onNewConversation: (callback: (data: any) => void) => void;
  offNewConversation: (callback: (data: any) => void) => void;
  // Progress helpers
  joinCourseRoom: (courseId: string) => void;
  leaveCourseRoom: (courseId: string) => void;
  onProgressUpdate: (callback: (data: any) => void) => void;
  offProgressUpdate: (callback: (data: any) => void) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  onNotification: () => {},
  offNotification: () => {},
  joinConversation: () => {},
  leaveConversation: () => {},
  sendTyping: () => {},
  onChatMessage: () => {},
  offChatMessage: () => {},
  onTyping: () => {},
  offTyping: () => {},
  onUnreadUpdate: () => {},
  offUnreadUpdate: () => {},
  onNewConversation: () => {},
  offNewConversation: () => {},
  joinCourseRoom: () => {},
  leaveCourseRoom: () => {},
  onProgressUpdate: () => {},
  offProgressUpdate: () => {},
});

export const useSocket = () => useContext(SocketContext);

interface SocketProviderProps {
  children: React.ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const { isAuthenticated } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    if (!isAuthenticated) {
      // Disconnect if logged out
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    const token = localStorage.getItem('accessToken');
    if (!token) return;

    // Determine the socket URL based on environment
    // In development, connect to user-service directly
    // In production (via Nginx), connect to same origin (Nginx proxies /socket.io)
    const socketUrl = import.meta.env.VITE_API_GATEWAY_URL || window.location.origin;

    const socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('🔌 Socket.io connected:', socket.id);
    });

    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      console.log('🔌 Socket.io disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
      console.warn('🔌 Socket.io connection error:', error.message);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [isAuthenticated]);

  // ==================== Notification Helpers ====================

  const onNotification = useCallback((callback: (data: any) => void) => {
    socketRef.current?.on('new_notification', callback);
  }, []);

  const offNotification = useCallback((callback: (data: any) => void) => {
    socketRef.current?.off('new_notification', callback);
  }, []);

  // ==================== Chat Helpers ====================

  const joinConversation = useCallback((conversationId: string) => {
    socketRef.current?.emit('chat:join_conversation', conversationId);
  }, []);

  const leaveConversation = useCallback((conversationId: string) => {
    socketRef.current?.emit('chat:leave_conversation', conversationId);
  }, []);

  const sendTyping = useCallback((conversationId: string, isTyping: boolean) => {
    socketRef.current?.emit('chat:typing', { conversationId, isTyping });
  }, []);

  const onChatMessage = useCallback((callback: (data: any) => void) => {
    socketRef.current?.on('chat:new_message', callback);
  }, []);

  const offChatMessage = useCallback((callback: (data: any) => void) => {
    socketRef.current?.off('chat:new_message', callback);
  }, []);

  const onTyping = useCallback((callback: (data: any) => void) => {
    socketRef.current?.on('chat:typing', callback);
  }, []);

  const offTyping = useCallback((callback: (data: any) => void) => {
    socketRef.current?.off('chat:typing', callback);
  }, []);

  const onUnreadUpdate = useCallback((callback: (data: any) => void) => {
    socketRef.current?.on('chat:unread_update', callback);
  }, []);

  const offUnreadUpdate = useCallback((callback: (data: any) => void) => {
    socketRef.current?.off('chat:unread_update', callback);
  }, []);

  const onNewConversation = useCallback((callback: (data: any) => void) => {
    socketRef.current?.on('chat:new_conversation', callback);
  }, []);

  const offNewConversation = useCallback((callback: (data: any) => void) => {
    socketRef.current?.off('chat:new_conversation', callback);
  }, []);

  // ==================== Progress Helpers ====================

  const joinCourseRoom = useCallback((courseId: string) => {
    socketRef.current?.emit('progress:join_course', courseId);
  }, []);

  const leaveCourseRoom = useCallback((courseId: string) => {
    socketRef.current?.emit('progress:leave_course', courseId);
  }, []);

  const onProgressUpdate = useCallback((callback: (data: any) => void) => {
    socketRef.current?.on('progress:lesson_completed', callback);
  }, []);

  const offProgressUpdate = useCallback((callback: (data: any) => void) => {
    socketRef.current?.off('progress:lesson_completed', callback);
  }, []);

  const value: SocketContextType = {
    socket: socketRef.current,
    isConnected,
    onNotification,
    offNotification,
    joinConversation,
    leaveConversation,
    sendTyping,
    onChatMessage,
    offChatMessage,
    onTyping,
    offTyping,
    onUnreadUpdate,
    offUnreadUpdate,
    onNewConversation,
    offNewConversation,
    joinCourseRoom,
    leaveCourseRoom,
    onProgressUpdate,
    offProgressUpdate,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};
