import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { aiService, Conversation, Message } from '../services/ai.service';
import {
  FiPlus, FiTrash2, FiSend, FiEdit3, FiCheck, FiX,
  FiMessageSquare, FiMenu, FiChevronLeft, FiZap, FiLoader,
  FiSearch, FiCopy, FiMoreHorizontal
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import AIDashboard from '../components/ai/AIDashboard';

// ==================== Markdown Renderer ====================

function renderMarkdown(text: string): string {
  let html = text;

  // Code blocks (```lang ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${lang || 'code'}</span><button class="copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(code.trim())}'));this.textContent='✓ Đã sao chép';setTimeout(()=>this.textContent='Sao chép',1500)">Sao chép</button></div><pre class="code-block"><code>${escapedCode}</code></pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');

  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, '<li class="md-li">$1</li>');
  html = html.replace(/((?:<li class="md-li">.*<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-oli">$1</li>');
  html = html.replace(/((?:<li class="md-oli">.*<\/li>\n?)+)/g, '<ol class="md-ol">$1</ol>');

  // Line breaks
  html = html.replace(/\n\n/g, '</p><p class="md-p">');
  html = '<p class="md-p">' + html + '</p>';

  // Clean up
  html = html.replace(/<p class="md-p"><\/p>/g, '');
  html = html.replace(/<p class="md-p">(<(?:h[2-4]|ul|ol|div))/g, '$1');
  html = html.replace(/(<\/(?:h[2-4]|ul|ol|div)>)<\/p>/g, '$1');

  return html;
}

// ==================== Time grouping helper ====================

function groupConversationsByTime(conversations: Conversation[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const week = new Date(today.getTime() - 7 * 86400000);
  const month = new Date(today.getTime() - 30 * 86400000);

  const groups: { label: string; items: Conversation[] }[] = [
    { label: 'Hôm nay', items: [] },
    { label: 'Hôm qua', items: [] },
    { label: '7 ngày trước', items: [] },
    { label: '30 ngày trước', items: [] },
    { label: 'Cũ hơn', items: [] },
  ];

  conversations.forEach(conv => {
    const d = new Date(conv.updatedAt || conv.createdAt);
    if (d >= today) groups[0].items.push(conv);
    else if (d >= yesterday) groups[1].items.push(conv);
    else if (d >= week) groups[2].items.push(conv);
    else if (d >= month) groups[3].items.push(conv);
    else groups[4].items.push(conv);
  });

  return groups.filter(g => g.items.length > 0);
}

// ==================== Main Component ====================

export default function AIAssistant() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ==================== Load Data ====================

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setActiveMenu(null);
    if (activeMenu) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [activeMenu]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadConversations = async () => {
    try {
      setLoadingConversations(true);
      const data = await aiService.getConversations();
      setConversations(data);
    } catch {
      // Silent fail
    } finally {
      setLoadingConversations(false);
    }
  };

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      setLoadingMessages(true);
      const data = await aiService.getConversationById(conversationId);
      setMessages(data.messages);
      setActiveConversationId(conversationId);
    } catch {
      toast.error('Không thể tải tin nhắn');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Filtered & grouped conversations
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(c => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const groupedConversations = useMemo(
    () => groupConversationsByTime(filteredConversations),
    [filteredConversations]
  );

  // ==================== Actions ====================

  const handleNewChat = async () => {
    setActiveConversationId(null);
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  };

  const handleAskCoach = (prompt: string) => {
    setInput(prompt);
    setTimeout(() => {
      handleSendWithMessage(prompt);
    }, 100);
  };

  const handleSendWithMessage = async (msg: string) => {
    if (!msg.trim() || sending) return;

    const tempUserMsg: Message = {
      id: 'temp-user-' + Date.now(),
      conversationId: activeConversationId || '',
      role: 'USER',
      content: msg.trim(),
      createdAt: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempUserMsg]);
    setInput('');
    setSending(true);

    try {
      const result = await aiService.chat(msg.trim(), activeConversationId || undefined);

      const aiMsg: Message = {
        id: result.messageId,
        conversationId: result.conversationId,
        role: 'ASSISTANT',
        content: result.message,
        createdAt: new Date().toISOString(),
      };

      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== tempUserMsg.id);
        return [...filtered, { ...tempUserMsg, conversationId: result.conversationId }, aiMsg];
      });

      if (!activeConversationId) {
        setActiveConversationId(result.conversationId);
      }

      await loadConversations();
    } catch {
      toast.error('Không thể gửi tin nhắn. Vui lòng thử lại.');
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
      setInput(msg);
    } finally {
      setSending(false);
    }
  };

  const handleSelectConversation = (id: string) => {
    if (id === activeConversationId) return;
    loadMessages(id);
    setActiveMenu(null);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sending) return;

    const tempUserMsg: Message = {
      id: 'temp-user-' + Date.now(),
      conversationId: activeConversationId || '',
      role: 'USER',
      content: msg,
      createdAt: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempUserMsg]);
    setInput('');
    setSending(true);

    try {
      const result = await aiService.chat(msg, activeConversationId || undefined);

      const aiMsg: Message = {
        id: result.messageId,
        conversationId: result.conversationId,
        role: 'ASSISTANT',
        content: result.message,
        createdAt: new Date().toISOString(),
      };

      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== tempUserMsg.id);
        return [...filtered, { ...tempUserMsg, conversationId: result.conversationId }, aiMsg];
      });

      if (!activeConversationId) {
        setActiveConversationId(result.conversationId);
      }

      await loadConversations();
    } catch (error: any) {
      toast.error('Không thể gửi tin nhắn. Vui lòng thử lại.');
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
      setInput(msg);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Xóa cuộc trò chuyện này?')) return;

    try {
      await aiService.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
      toast.success('Đã xóa cuộc trò chuyện');
    } catch {
      toast.error('Không thể xóa');
    }
    setActiveMenu(null);
  };

  const handleRenameStart = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(currentTitle);
    setActiveMenu(null);
  };

  const handleRenameSubmit = async (id: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }

    try {
      await aiService.renameConversation(id, editTitle.trim());
      setConversations(prev => prev.map(c => c.id === id ? { ...c, title: editTitle.trim() } : c));
      toast.success('Đã đổi tên');
    } catch {
      toast.error('Không thể đổi tên');
    } finally {
      setEditingId(null);
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success('Đã sao chép nội dung');
  };

  // ==================== Render ====================

  return (
    <div className="flex h-[calc(100vh-64px)] bg-white overflow-hidden">
      {/* ====== SIDEBAR ====== */}
      <aside className={`${sidebarOpen ? 'w-[300px] translate-x-0' : 'w-0 -translate-x-full md:w-0'} flex-shrink-0 bg-slate-50 border-r border-slate-200/80 flex flex-col transition-all duration-300 overflow-hidden absolute md:relative z-30 h-full`}>
        {/* New Chat Button */}
        <div className="p-3 flex-shrink-0">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow"
          >
            <FiPlus className="w-4 h-4" />
            Cuộc hội thoại mới
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm hội thoại..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 sidebar-scroll">
          {loadingConversations ? (
            <div className="flex items-center justify-center py-10">
              <FiLoader className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="text-center py-10">
              <FiMessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">
                {searchQuery ? 'Không tìm thấy kết quả' : 'Chưa có cuộc trò chuyện'}
              </p>
            </div>
          ) : (
            groupedConversations.map(group => (
              <div key={group.label} className="mb-1">
                <p className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {group.label}
                </p>
                {group.items.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv.id)}
                    className={`group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all text-sm mb-0.5 ${
                      activeConversationId === conv.id
                        ? 'bg-white shadow-sm border border-slate-200/80 text-slate-900'
                        : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
                    }`}
                  >
                    <FiMessageSquare className={`w-4 h-4 flex-shrink-0 ${
                      activeConversationId === conv.id ? 'text-blue-500' : 'text-slate-400'
                    }`} />

                    {editingId === conv.id ? (
                      <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input
                          type="text"
                          className="flex-1 bg-white text-slate-800 text-sm px-2 py-1 rounded-lg border border-blue-400 outline-none focus:ring-2 focus:ring-blue-100"
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(conv.id); if (e.key === 'Escape') setEditingId(null); }}
                          autoFocus
                        />
                        <button onClick={(e) => { e.stopPropagation(); handleRenameSubmit(conv.id); }} className="p-1 hover:text-blue-500 transition-colors"><FiCheck className="w-3.5 h-3.5" /></button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingId(null); }} className="p-1 hover:text-red-400 transition-colors"><FiX className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 truncate font-medium">{conv.title}</span>

                        {/* More button */}
                        <div className="relative flex-shrink-0">
                          <button
                            onClick={e => { e.stopPropagation(); setActiveMenu(activeMenu === conv.id ? null : conv.id); }}
                            className={`p-1 rounded-md transition-all ${
                              activeMenu === conv.id
                                ? 'opacity-100 bg-slate-100'
                                : 'opacity-0 group-hover:opacity-100 hover:bg-slate-100'
                            }`}
                          >
                            <FiMoreHorizontal className="w-3.5 h-3.5 text-slate-500" />
                          </button>

                          {/* Dropdown */}
                          {activeMenu === conv.id && (
                            <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50 min-w-[140px]">
                              <button
                                onClick={e => handleRenameStart(conv.id, conv.title, e)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
                              >
                                <FiEdit3 className="w-3.5 h-3.5" /> Đổi tên
                              </button>
                              <button
                                onClick={e => handleDelete(conv.id, e)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <FiTrash2 className="w-3.5 h-3.5" /> Xóa
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ====== MAIN CHAT AREA ====== */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 md:px-6 py-3 bg-white/80 backdrop-blur-md border-b border-slate-100 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
          >
            {sidebarOpen ? <FiChevronLeft className="w-5 h-5 text-slate-500" /> : <FiMenu className="w-5 h-5 text-slate-500" />}
          </button>
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-md shadow-slate-900/15">
                <FiZap className="w-4 h-4 text-white" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-sm leading-tight">AI Learning Assistant</h1>
              <p className="text-[11px] text-blue-600 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                Trực tuyến
              </p>
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto chat-scroll">
          {messages.length === 0 && !loadingMessages ? (
            <div className="flex items-center justify-center min-h-full py-8">
              <AIDashboard onAskCoach={handleAskCoach} />
            </div>
          ) : loadingMessages ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center animate-pulse shadow-md shadow-slate-900/10">
                <FiZap className="w-5 h-5 text-white" />
              </div>
              <span className="text-sm text-slate-400 font-medium">Đang tải...</span>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto px-4 md:px-6 pt-8 pb-32 space-y-6">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'USER' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex gap-3 max-w-[85%] md:max-w-[75%] ${msg.role === 'USER' ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar */}
                    <div className="flex-shrink-0 mt-1">
                      {msg.role === 'ASSISTANT' ? (
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-sm shadow-slate-900/15">
                          <FiZap className="w-4 h-4 text-white" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-xl bg-slate-200 flex items-center justify-center">
                          <span className="text-xs font-bold text-slate-600">Bạn</span>
                        </div>
                      )}
                    </div>

                    {/* Content Bubble */}
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className={`px-5 py-3.5 rounded-2xl shadow-sm ${
                        msg.role === 'USER' 
                          ? 'bg-blue-600 text-white rounded-tr-sm' 
                          : 'bg-white border border-slate-200 rounded-tl-sm'
                      }`}>
                        {msg.role === 'ASSISTANT' ? (
                          <div className="space-y-2">
                            <div
                              className="ai-message-content text-[15px] text-slate-800 leading-[1.75]"
                              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                            />
                            {/* Action buttons */}
                            <div className="flex items-center gap-1 pt-2 border-t border-slate-100 mt-2">
                              <button
                                onClick={() => handleCopyMessage(msg.content)}
                                className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-all font-medium"
                              >
                                <FiCopy className="w-3 h-3" /> Sao chép
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[15px] whitespace-pre-wrap leading-[1.75]">{msg.content}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Thinking indicator */}
              {sending && (
                <div className="flex justify-start">
                  <div className="flex gap-3 max-w-[85%] md:max-w-[75%]">
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-sm animate-pulse shadow-slate-900/15">
                        <FiZap className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                          <span className="text-xs text-slate-500 font-medium">Đang suy nghĩ...</span>
                        </div>
                        <div className="space-y-2">
                          <div className="h-3 bg-slate-100 rounded-full w-full shimmer" />
                          <div className="h-3 bg-slate-100 rounded-full w-4/5 shimmer" style={{ animationDelay: '0.2s' }} />
                          <div className="h-3 bg-slate-100 rounded-full w-3/5 shimmer" style={{ animationDelay: '0.4s' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="px-4 md:px-6 pb-6 pt-2 flex-shrink-0 bg-gradient-to-t from-white via-white to-transparent">
          <div className="max-w-4xl mx-auto">
            <div className="relative bg-white border border-slate-200 rounded-2xl shadow-lg shadow-slate-200/50 focus-within:border-blue-400 focus-within:shadow-blue-100 focus-within:shadow-xl transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Hỏi bất kỳ điều gì về học tập..."
                rows={1}
                className="w-full resize-none outline-none text-[15px] text-slate-800 placeholder:text-slate-400 px-5 pt-4 pb-3 bg-transparent rounded-2xl"
                style={{ minHeight: '52px', maxHeight: '200px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                }}
                disabled={sending}
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <p className="text-[10px] text-slate-400 pl-2">
                  <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px] font-mono">Enter</kbd> gửi · <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px] font-mono">Shift+Enter</kbd> xuống dòng
                </p>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="w-10 h-10 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center shadow-md shadow-blue-500/20 hover:shadow-lg hover:scale-105 active:scale-95"
                >
                  {sending ? <FiLoader className="w-4 h-4 animate-spin" /> : <FiSend className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 text-center mt-2.5">
              AI có thể mắc sai sót. Hãy kiểm tra lại thông tin quan trọng.
            </p>
          </div>
        </div>
      </main>

      {/* ====== STYLES ====== */}
      <style>{`
        /* AI Logo Glow */
        .ai-logo-glow {
          animation: logoGlow 3s ease-in-out infinite;
        }
        @keyframes logoGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(139, 92, 246, 0.15), 0 8px 32px rgba(139, 92, 246, 0.1); }
          50% { box-shadow: 0 0 30px rgba(139, 92, 246, 0.25), 0 8px 40px rgba(139, 92, 246, 0.15); }
        }

        /* Shimmer skeleton */
        .shimmer {
          background-size: 200% 100%;
          animation: shimmer 1.8s ease-in-out infinite;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* Chat scroll */
        .chat-scroll::-webkit-scrollbar { width: 6px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 8px; }
        .chat-scroll::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }

        /* Sidebar scroll */
        .sidebar-scroll::-webkit-scrollbar { width: 4px; }
        .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
        .sidebar-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }

        /* ====== AI Message Content Styles ====== */
        .ai-message-content .md-h2 {
          font-size: 1.2em; font-weight: 800; margin: 1.2em 0 0.5em; color: #0f172a;
          padding-bottom: 0.3em; border-bottom: 2px solid #f1f5f9;
        }
        .ai-message-content .md-h3 {
          font-size: 1.08em; font-weight: 700; margin: 1em 0 0.4em; color: #1e293b;
        }
        .ai-message-content .md-h4 {
          font-size: 0.98em; font-weight: 700; margin: 0.8em 0 0.3em; color: #334155;
        }
        .ai-message-content .md-p {
          margin: 0.5em 0; line-height: 1.75; color: #334155;
        }
        .ai-message-content .md-ul {
          list-style: none; padding-left: 0; margin: 0.6em 0;
        }
        .ai-message-content .md-ul .md-li {
          position: relative; padding-left: 1.5em; margin: 0.35em 0; line-height: 1.7; color: #475569;
        }
        .ai-message-content .md-ul .md-li::before {
          content: ''; position: absolute; left: 0.3em; top: 0.65em;
          width: 6px; height: 6px; border-radius: 50%; background: linear-gradient(135deg, #1e293b, #334155);
        }
        .ai-message-content .md-ol {
          list-style: none; padding-left: 0; margin: 0.6em 0; counter-reset: ol-counter;
        }
        .ai-message-content .md-ol .md-oli {
          position: relative; padding-left: 2em; margin: 0.35em 0; line-height: 1.7; color: #475569;
          counter-increment: ol-counter;
        }
        .ai-message-content .md-ol .md-oli::before {
          content: counter(ol-counter); position: absolute; left: 0; top: 0.15em;
          width: 1.4em; height: 1.4em; border-radius: 50%; font-size: 0.72em; font-weight: 700;
          background: #f1f5f9; color: #334155; display: flex; align-items: center; justify-content: center;
        }
        .ai-message-content .inline-code {
          background: #f8fafc; color: #0f172a; padding: 0.15em 0.5em; border-radius: 6px;
          font-size: 0.88em; font-family: 'JetBrains Mono', 'Fira Code', monospace;
          border: 1px solid #e2e8f0;
        }
        .ai-message-content .code-block-wrapper {
          margin: 1em 0; border-radius: 16px; overflow: hidden;
          border: 1px solid #1e293b; background: #0f172a;
        }
        .ai-message-content .code-block-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 0.6em 1em; background: #1e293b; border-bottom: 1px solid #334155;
        }
        .ai-message-content .code-lang {
          font-size: 0.72em; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
        }
        .ai-message-content .copy-btn {
          font-size: 0.72em; color: #94a3b8; cursor: pointer; background: none; border: 1px solid #334155;
          padding: 0.3em 0.8em; border-radius: 6px; transition: all 0.2s; font-weight: 500;
        }
        .ai-message-content .copy-btn:hover { color: #e2e8f0; background: #334155; border-color: #475569; }
        .ai-message-content .code-block {
          margin: 0; padding: 1.2em 1em; overflow-x: auto;
          font-size: 0.85em; line-height: 1.7; color: #e2e8f0;
          font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
        }
        .ai-message-content strong { font-weight: 700; color: #1e293b; }
        .ai-message-content em { font-style: italic; color: #475569; }
      `}</style>
    </div>
  );
}
