import { useState, useEffect, useCallback, useRef } from 'react';
import { FiBell, FiCheck, FiCheckCircle, FiAlertTriangle, FiAlertCircle, FiInfo, FiX, FiTrash2 } from 'react-icons/fi';
import { useSocket } from '../../contexts/SocketContext';
import { notificationService, Notification } from '../../services/notification.service';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasNewPulse, setHasNewPulse] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { onNotification, offNotification } = useSocket();

  // Fetch notifications on mount
  useEffect(() => {
    fetchNotifications();
  }, []);

  // Listen for real-time notifications
  useEffect(() => {
    const handleNewNotification = (notification: Notification) => {
      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(prev => prev + 1);
      setHasNewPulse(true);
      setTimeout(() => setHasNewPulse(false), 3000);
    };

    onNotification(handleNewNotification);
    return () => offNotification(handleNewNotification);
  }, [onNotification, offNotification]);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const result = await notificationService.getNotifications(1, 20);
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await notificationService.markAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await notificationService.deleteNotification(id);
      const deleted = notifications.find(n => n.id === id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (deleted && !deleted.isRead) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      await handleMarkRead(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
      setIsOpen(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'SUCCESS': return <FiCheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'WARNING': return <FiAlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'ERROR': return <FiAlertCircle className="w-4 h-4 text-red-500" />;
      default: return <FiInfo className="w-4 h-4 text-cyan-500" />;
    }
  };

  const getTypeBg = (type: string) => {
    switch (type) {
      case 'SUCCESS': return 'bg-emerald-50 border-emerald-200';
      case 'WARNING': return 'bg-amber-50 border-amber-200';
      case 'ERROR': return 'bg-red-50 border-red-200';
      default: return 'bg-cyan-50 border-cyan-200';
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-500 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-all duration-200"
        id="notification-bell-btn"
      >
        <FiBell size={20} />
        {unreadCount > 0 && (
          <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white rounded-full shadow-sm ${hasNewPulse ? 'animate-bounce' : ''}`}
            style={{ background: 'linear-gradient(135deg, #ef4444, #f97316)' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {hasNewPulse && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full animate-ping opacity-40"
            style={{ background: 'linear-gradient(135deg, #ef4444, #f97316)' }}
          />
        )}
      </button>

      {/* Notification Panel */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-96 max-h-[500px] bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden z-[100]"
          style={{
            animation: 'notifSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-cyan-50">
            <div>
              <h3 className="text-base font-bold text-slate-800">Thông báo</h3>
              {unreadCount > 0 && (
                <p className="text-xs text-slate-500 mt-0.5">{unreadCount} chưa đọc</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-100 rounded-xl transition-colors"
                >
                  <FiCheck className="w-3.5 h-3.5" />
                  Đọc tất cả
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto max-h-[400px] divide-y divide-gray-50">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <FiBell className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm font-medium">Chưa có thông báo nào</p>
                <p className="text-xs mt-1">Các thông báo mới sẽ xuất hiện tại đây</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`group flex items-start gap-3 px-5 py-3.5 cursor-pointer transition-all duration-150 hover:bg-slate-50 ${
                    !notification.isRead ? 'bg-primary-50/30' : ''
                  }`}
                >
                  {/* Type Icon */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${getTypeBg(notification.type)}`}>
                    {getTypeIcon(notification.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${!notification.isRead ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                      {notification.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                      {notification.message}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: vi })}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!notification.isRead && (
                      <div className="w-2.5 h-2.5 rounded-full bg-primary-500 shadow-sm" />
                    )}
                    <button
                      onClick={(e) => handleDelete(notification.id, e)}
                      className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors"
                      title="Xóa"
                    >
                      <FiTrash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes notifSlideIn {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
