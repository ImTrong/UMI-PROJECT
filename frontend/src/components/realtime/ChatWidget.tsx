import { useState, useEffect, useCallback, useRef } from 'react';
import { FiMessageCircle, FiX, FiSend, FiArrowLeft, FiSearch, FiBook } from 'react-icons/fi';
import { useSocket } from '../../contexts/SocketContext';
import { chatService, Conversation, ChatMessage } from '../../services/chat.service';
import { useAuth } from '../../hooks/useAuth';
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';
import { vi } from 'date-fns/locale';
import { userService } from '../../services/user.service';

type ViewMode = 'list' | 'chat';

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({});
  const [participantAvatars, setParticipantAvatars] = useState<Record<string, string | undefined>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<any>(null);
  const { user } = useAuth();
  const {
    joinConversation, leaveConversation, sendTyping,
    onChatMessage, offChatMessage,
    onTyping, offTyping,
    onUnreadUpdate, offUnreadUpdate,
  } = useSocket();

  // Fetch conversations on open
  useEffect(() => {
    if (isOpen) {
      fetchConversations();
    }
  }, [isOpen]);

  // Real-time message listener
  useEffect(() => {
    const handleNewMessage = (message: ChatMessage) => {
      if (activeConversation && message.conversationId === activeConversation.id) {
        setMessages(prev => [...prev, message]);
        scrollToBottom();
        // Mark as read if we're viewing this conversation
        if (message.senderId !== user?.id) {
          chatService.markAsRead(activeConversation.id).catch(() => {});
        }
      }
      // Update conversation list
      setConversations(prev =>
        prev.map(c =>
          c.id === message.conversationId
            ? { ...c, lastMessage: message.content, lastMessageAt: message.createdAt }
            : c
        ).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
      );
    };

    onChatMessage(handleNewMessage);
    return () => offChatMessage(handleNewMessage);
  }, [activeConversation, user, onChatMessage, offChatMessage]);

  // Typing indicator listener
  useEffect(() => {
    const handleTyping = (data: { userId: string; conversationId: string; isTyping: boolean }) => {
      if (activeConversation && data.conversationId === activeConversation.id) {
        setTypingUsers(prev => ({ ...prev, [data.userId]: data.isTyping }));
        // Auto-clear typing after 3 seconds
        if (data.isTyping) {
          setTimeout(() => {
            setTypingUsers(prev => ({ ...prev, [data.userId]: false }));
          }, 3000);
        }
      }
    };

    onTyping(handleTyping);
    return () => offTyping(handleTyping);
  }, [activeConversation, onTyping, offTyping]);

  // Unread update listener
  useEffect(() => {
    const handleUnreadUpdate = (data: { conversationId: string; unreadCount: number }) => {
      setConversations(prev =>
        prev.map(c =>
          c.id === data.conversationId ? { ...c, unreadCount: data.unreadCount } : c
        )
      );
      // Recalculate total unread
      setTotalUnread(prev => {
        const currentConvUnread = conversations.find(c => c.id === data.conversationId)?.unreadCount || 0;
        return prev - currentConvUnread + data.unreadCount;
      });
    };

    onUnreadUpdate(handleUnreadUpdate);
    return () => offUnreadUpdate(handleUnreadUpdate);
  }, [conversations, onUnreadUpdate, offUnreadUpdate]);

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      const convs = await chatService.getConversations();
      setConversations(convs);
      setTotalUnread(convs.reduce((sum, c) => sum + c.unreadCount, 0));

      // Fetch participant names
      const allParticipantIds = new Set<string>();
      convs.forEach(c => c.participants.forEach(p => {
        if (p !== user?.id) allParticipantIds.add(p);
      }));

      for (const pid of allParticipantIds) {
        if (!participantNames[pid]) {
          try {
            const profile = await userService.getUserById(pid);
            setParticipantNames(prev => ({ ...prev, [pid]: profile.fullName }));
            setParticipantAvatars(prev => ({ ...prev, [pid]: profile.avatar }));
          } catch {
            setParticipantNames(prev => ({ ...prev, [pid]: 'Người dùng' }));
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoading(false);
    }
  }, [user, participantNames]);

  const openConversation = useCallback(async (conversation: Conversation) => {
    setActiveConversation(conversation);
    setViewMode('chat');
    joinConversation(conversation.id);

    try {
      const result = await chatService.getMessages(conversation.id);
      setMessages(result.messages);
      setTimeout(scrollToBottom, 100);

      // Mark as read
      if (conversation.unreadCount > 0) {
        await chatService.markAsRead(conversation.id);
        setConversations(prev =>
          prev.map(c => (c.id === conversation.id ? { ...c, unreadCount: 0 } : c))
        );
        setTotalUnread(prev => Math.max(0, prev - conversation.unreadCount));
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }, [joinConversation]);

  // Listen to open-chat-session custom window event
  useEffect(() => {
    const handleOpenChatEvent = async (e: Event) => {
      const customEvent = e as CustomEvent<{ participantId: string; courseId?: string; courseTitle?: string }>;
      if (!customEvent.detail) return;
      
      const { participantId, courseId, courseTitle } = customEvent.detail;
      setIsOpen(true);
      setLoading(true);
      setViewMode('chat');
      
      try {
        const conv = await chatService.createConversation(participantId, courseId, courseTitle);
        setConversations(prev => {
          if (prev.some(c => c.id === conv.id)) return prev;
          return [conv, ...prev];
        });
        
        await openConversation(conv);
      } catch (err) {
        console.error('Failed to open chat from event:', err);
      } finally {
        setLoading(false);
      }
    };
    
    window.addEventListener('open-chat-session', handleOpenChatEvent);
    return () => window.removeEventListener('open-chat-session', handleOpenChatEvent);
  }, [openConversation]);

  const closeConversation = useCallback(() => {
    if (activeConversation) {
      leaveConversation(activeConversation.id);
    }
    setActiveConversation(null);
    setViewMode('list');
    setMessages([]);
    setTypingUsers({});
  }, [activeConversation, leaveConversation]);

  const handleSendMessage = useCallback(async () => {
    if (!newMessage.trim() || !activeConversation || !user) return;

    const content = newMessage.trim();
    setNewMessage('');

    try {
      await chatService.sendMessage(
        activeConversation.id,
        content,
        user.fullName || user.email,
        undefined
      );
      // Clear typing indicator
      sendTyping(activeConversation.id, false);
    } catch (err) {
      console.error('Failed to send message:', err);
      setNewMessage(content); // Restore on error
    }
  }, [newMessage, activeConversation, user, sendTyping]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    if (activeConversation) {
      sendTyping(activeConversation.id, true);
      // Clear previous timeout
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        sendTyping(activeConversation.id, false);
      }, 2000);
    }
  }, [activeConversation, sendTyping]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getOtherParticipant = (conv: Conversation) => {
    const otherId = conv.participants.find(p => p !== user?.id);
    return {
      id: otherId || '',
      name: participantNames[otherId || ''] || 'Đang tải...',
      avatar: participantAvatars[otherId || ''],
    };
  };

  const formatMessageTime = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return format(date, 'HH:mm');
    if (isYesterday(date)) return 'Hôm qua ' + format(date, 'HH:mm');
    return format(date, 'dd/MM HH:mm');
  };

  const formatConvTime = (dateStr: string) => {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: vi });
  };

  const isOwnMessage = (msg: ChatMessage) => msg.senderId === user?.id;

  const isTypingActive = Object.values(typingUsers).some(Boolean);

  const filteredConversations = searchQuery
    ? conversations.filter(c => {
        const other = getOtherParticipant(c);
        return other.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
               c.courseTitle?.toLowerCase().includes(searchQuery.toLowerCase());
      })
    : conversations;

  if (!user) return null;

  return (
    <>
      {/* Floating Chat Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-sm flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-3xl"
        style={{
          background: isOpen
            ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
            : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
        }}
        id="chat-widget-btn"
      >
        {isOpen ? (
          <FiX className="w-6 h-6 text-white" />
        ) : (
          <>
            <FiMessageCircle className="w-6 h-6 text-white" />
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] flex items-center justify-center px-1 text-[11px] font-bold text-white rounded-full shadow-sm"
                style={{ background: 'linear-gradient(135deg, #ef4444, #f97316)' }}
              >
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </>
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div
          className="fixed bottom-24 right-6 z-50 w-[380px] h-[520px] bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col"
          style={{
            animation: 'chatPanelIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {viewMode === 'list' ? (
            <>
              {/* Header - Conversation List */}
              <div className="flex-shrink-0 px-5 py-4 border-b border-slate-100"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
              >
                <h3 className="text-lg font-bold text-white">Tin nhắn</h3>
                <p className="text-xs text-emerald-200 mt-0.5">
                  {conversations.length > 0
                    ? `${conversations.length} cuộc trò chuyện`
                    : 'Chưa có cuộc trò chuyện nào'}
                </p>
              </div>

              {/* Search */}
              <div className="flex-shrink-0 px-4 py-3 border-b border-slate-100">
                <div className="relative">
                  <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="text"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all"
                    placeholder="Tìm kiếm cuộc trò chuyện..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Conversation List */}
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
                  </div>
                ) : filteredConversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 px-6">
                    <FiMessageCircle className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm font-medium text-center">
                      {searchQuery ? 'Không tìm thấy cuộc trò chuyện' : 'Chưa có cuộc trò chuyện nào'}
                    </p>
                    <p className="text-xs mt-1 text-center">
                      Bắt đầu trò chuyện với giảng viên từ trang khóa học
                    </p>
                  </div>
                ) : (
                  filteredConversations.map((conv) => {
                    const other = getOtherParticipant(conv);
                    return (
                      <div
                        key={conv.id}
                        onClick={() => openConversation(conv)}
                        className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all hover:bg-slate-50 border-b border-slate-50 ${
                          conv.unreadCount > 0 ? 'bg-emerald-50/40' : ''
                        }`}
                      >
                        {/* Avatar */}
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                          {other.avatar ? (
                            <img src={other.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                          ) : (
                            other.name.charAt(0).toUpperCase()
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className={`text-sm truncate ${conv.unreadCount > 0 ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
                              {other.name}
                            </p>
                            <span className="text-[11px] text-slate-400 flex-shrink-0 ml-2">
                              {formatConvTime(conv.lastMessageAt)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className={`text-xs truncate ${conv.unreadCount > 0 ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
                              {conv.lastMessage || 'Chưa có tin nhắn'}
                            </p>
                            {conv.unreadCount > 0 && (
                              <span className="flex-shrink-0 min-w-[20px] h-[20px] flex items-center justify-center text-[10px] font-bold text-white rounded-full ml-2"
                                style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
                              >
                                {conv.unreadCount}
                              </span>
                            )}
                          </div>
                          {conv.courseTitle && (
                            <p className="text-[10px] text-emerald-500 mt-0.5 truncate">
                              <FiBook className="inline mr-1" /> {conv.courseTitle}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              {/* Header - Chat Detail */}
              <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-slate-100"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
              >
                <button
                  onClick={closeConversation}
                  className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                >
                  <FiArrowLeft className="w-5 h-5" />
                </button>
                {activeConversation && (
                  <>
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-semibold">
                      {getOtherParticipant(activeConversation).name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {getOtherParticipant(activeConversation).name}
                      </p>
                      {isTypingActive ? (
                        <p className="text-xs text-emerald-200 flex items-center gap-1">
                          Đang gõ
                          <span className="inline-flex gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-emerald-200 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1 h-1 rounded-full bg-emerald-200 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1 h-1 rounded-full bg-emerald-200 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                        </p>
                      ) : activeConversation.courseTitle ? (
                        <p className="text-xs text-emerald-200 truncate"><FiBook className="inline mr-1" /> {activeConversation.courseTitle}</p>
                      ) : null}
                    </div>
                  </>
                )}
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ background: 'linear-gradient(180deg, #f8fafc, #f1f5f9)' }}>
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400">
                    <FiMessageCircle className="w-10 h-10 mb-2 opacity-30" />
                    <p className="text-sm">Bắt đầu cuộc trò chuyện!</p>
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const own = isOwnMessage(msg);
                    const showDate = idx === 0 ||
                      new Date(msg.createdAt).toDateString() !== new Date(messages[idx - 1].createdAt).toDateString();

                    return (
                      <div key={msg.id}>
                        {showDate && (
                          <div className="flex items-center justify-center my-3">
                            <span className="text-[10px] text-slate-400 bg-white/80 px-3 py-1 rounded-full shadow-sm">
                              {isToday(new Date(msg.createdAt))
                                ? 'Hôm nay'
                                : isYesterday(new Date(msg.createdAt))
                                ? 'Hôm qua'
                                : format(new Date(msg.createdAt), 'dd/MM/yyyy')}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed shadow-sm ${
                              own
                                ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-br-md'
                                : 'bg-white text-slate-800 border border-slate-100 rounded-bl-md'
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            <p className={`text-[10px] mt-1 ${own ? 'text-emerald-200' : 'text-slate-400'} text-right`}>
                              {formatMessageTime(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Typing Indicator */}
              {isTypingActive && (
                <div className="flex-shrink-0 px-4 py-1">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="inline-flex gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    <span>Đang gõ...</span>
                  </div>
                </div>
              )}

              {/* Input Area */}
              <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-t border-slate-100 bg-white">
                <input
                  ref={inputRef}
                  type="text"
                  className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all"
                  placeholder="Nhập tin nhắn..."
                  value={newMessage}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim()}
                  className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: newMessage.trim()
                      ? 'linear-gradient(135deg, #4f46e5, #7c3aed)'
                      : '#e5e7eb',
                  }}
                >
                  <FiSend className={`w-4.5 h-4.5 ${newMessage.trim() ? 'text-white' : 'text-slate-400'}`} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        @keyframes chatPanelIn {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </>
  );
}
