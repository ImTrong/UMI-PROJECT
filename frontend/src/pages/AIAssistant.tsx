import { useState, useEffect, useRef, useCallback } from 'react';
import { aiService, Conversation, Message } from '../services/ai.service';
import {
  FiPlus, FiTrash2, FiSend, FiEdit3, FiCheck, FiX,
  FiMessageSquare, FiMenu, FiChevronLeft, FiZap, FiLoader
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
    return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${lang || 'code'}</span><button class="copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(code.trim())}'));this.textContent='Đã sao chép!';setTimeout(()=>this.textContent='Sao chép',1500)">Sao chép</button></div><pre class="code-block"><code>${escapedCode}</code></pre></div>`;
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

  // Line breaks (double newline = paragraph)
  html = html.replace(/\n\n/g, '</p><p class="md-p">');
  html = '<p class="md-p">' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p class="md-p"><\/p>/g, '');
  html = html.replace(/<p class="md-p">(<(?:h[2-4]|ul|ol|div))/g, '$1');
  html = html.replace(/(<\/(?:h[2-4]|ul|ol|div)>)<\/p>/g, '$1');

  return html;
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

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ==================== Load Data ====================

  useEffect(() => {
    loadConversations();
  }, []);

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
      // Silent fail on initial load
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

  // ==================== Actions ====================

  const handleNewChat = async () => {
    setActiveConversationId(null);
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  };

  const handleAskCoach = (prompt: string) => {
    setInput(prompt);
    // Auto-send after a tiny delay so input is set
    setTimeout(() => {
      // Use direct send logic
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

      // Add AI response
      const aiMsg: Message = {
        id: result.messageId,
        conversationId: result.conversationId,
        role: 'ASSISTANT',
        content: result.message,
        createdAt: new Date().toISOString(),
      };

      setMessages(prev => {
        // Replace temp user message with real one, and add AI message
        const filtered = prev.filter(m => m.id !== tempUserMsg.id);
        return [...filtered, { ...tempUserMsg, conversationId: result.conversationId }, aiMsg];
      });

      // If new conversation, update state
      if (!activeConversationId) {
        setActiveConversationId(result.conversationId);
      }

      // Refresh sidebar
      await loadConversations();
    } catch (error: any) {
      toast.error('Không thể gửi tin nhắn. Vui lòng thử lại.');
      // Remove temp message on error
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
      setInput(msg); // Restore input
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
  };

  const handleRenameStart = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(currentTitle);
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

  // ==================== Render ====================

  return (
    <div className="flex h-[calc(100vh-64px)] bg-slate-50 overflow-hidden">
      {/* ====== SIDEBAR ====== */}
      <aside className={`${sidebarOpen ? 'w-72 translate-x-0' : 'w-0 -translate-x-full md:w-0'} flex-shrink-0 bg-slate-900 text-white flex flex-col transition-all duration-300 overflow-hidden absolute md:relative z-30 h-full`}>
        <div className="p-3 flex-shrink-0">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-500/20"
          >
            <FiPlus className="w-4 h-4" />
            Cuộc trò chuyện mới
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5 scrollbar-thin">
          {loadingConversations ? (
            <div className="flex items-center justify-center py-8">
              <FiLoader className="w-5 h-5 animate-spin text-slate-500" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              Chưa có cuộc trò chuyện nào
            </div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors text-sm ${
                  activeConversationId === conv.id
                    ? 'bg-slate-700/80 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <FiMessageSquare className="w-4 h-4 flex-shrink-0 opacity-60" />

                {editingId === conv.id ? (
                  <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      className="flex-1 bg-slate-700 text-white text-sm px-2 py-0.5 rounded border border-slate-600 outline-none focus:border-emerald-400"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(conv.id); if (e.key === 'Escape') setEditingId(null); }}
                      autoFocus
                    />
                    <button onClick={() => handleRenameSubmit(conv.id)} className="p-1 hover:text-emerald-400"><FiCheck className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingId(null)} className="p-1 hover:text-red-400"><FiX className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 truncate">{conv.title}</span>
                    <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={e => handleRenameStart(conv.id, conv.title, e)} className="p-1 hover:text-emerald-400 rounded"><FiEdit3 className="w-3.5 h-3.5" /></button>
                      <button onClick={e => handleDelete(conv.id, e)} className="p-1 hover:text-red-400 rounded"><FiTrash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ====== MAIN CHAT AREA ====== */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            {sidebarOpen ? <FiChevronLeft className="w-5 h-5 text-slate-600" /> : <FiMenu className="w-5 h-5 text-slate-600" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
              <FiZap className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-sm">AI Learning Assistant</h1>
              <p className="text-[11px] text-slate-500">Trợ lý học tập thông minh</p>
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 && !loadingMessages ? (
            /* AI Dashboard — replaces static empty state */
            <div className="flex items-center justify-center min-h-full py-8">
              <AIDashboard onAskCoach={handleAskCoach} />
            </div>
          ) : loadingMessages ? (
            <div className="flex items-center justify-center h-full">
              <FiLoader className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'USER' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'ASSISTANT' && (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center flex-shrink-0 mt-1">
                      <FiZap className="w-4 h-4 text-white" />
                    </div>
                  )}

                  <div className={`max-w-[85%] ${
                    msg.role === 'USER'
                      ? 'bg-emerald-600 text-white rounded-2xl rounded-br-md px-4 py-3'
                      : 'bg-white border border-slate-200 rounded-2xl rounded-bl-md px-5 py-4 shadow-sm'
                  }`}>
                    {msg.role === 'ASSISTANT' ? (
                      <div
                        className="ai-message-content prose prose-sm max-w-none text-slate-800"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      />
                    ) : (
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    )}
                  </div>

                  {msg.role === 'USER' && (
                    <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-xs font-bold text-slate-600">Bạn</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {sending && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                    <FiZap className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-5 py-4 shadow-sm">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      <span className="text-xs text-slate-400 ml-2">AI đang suy nghĩ...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="px-4 pb-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 bg-white border border-slate-200 rounded-2xl shadow-sm px-4 py-2 focus-within:border-emerald-400 focus-within:shadow-emerald-100 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Nhập câu hỏi của bạn..."
                rows={1}
                className="flex-1 resize-none outline-none text-sm text-slate-800 placeholder:text-slate-400 max-h-32 py-2 bg-transparent"
                style={{ minHeight: '40px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 128) + 'px';
                }}
                disabled={sending}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="p-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl hover:from-emerald-600 hover:to-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0 shadow-sm"
              >
                {sending ? <FiLoader className="w-4 h-4 animate-spin" /> : <FiSend className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 text-center mt-2">
              AI có thể mắc sai sót. Hãy kiểm tra lại thông tin quan trọng.
            </p>
          </div>
        </div>
      </main>

      {/* ====== STYLES ====== */}
      <style>{`
        .ai-message-content .md-h2 { font-size: 1.15em; font-weight: 700; margin: 1em 0 0.5em; color: #1e293b; }
        .ai-message-content .md-h3 { font-size: 1.05em; font-weight: 700; margin: 0.8em 0 0.4em; color: #334155; }
        .ai-message-content .md-h4 { font-size: 0.95em; font-weight: 700; margin: 0.6em 0 0.3em; color: #475569; }
        .ai-message-content .md-p { margin: 0.4em 0; line-height: 1.7; }
        .ai-message-content .md-ul { list-style: disc; padding-left: 1.5em; margin: 0.5em 0; }
        .ai-message-content .md-ol { list-style: decimal; padding-left: 1.5em; margin: 0.5em 0; }
        .ai-message-content .md-li, .ai-message-content .md-oli { margin: 0.2em 0; line-height: 1.6; }
        .ai-message-content .inline-code {
          background: #f1f5f9; color: #e11d48; padding: 0.15em 0.4em; border-radius: 4px;
          font-size: 0.88em; font-family: 'Fira Code', monospace;
        }
        .ai-message-content .code-block-wrapper {
          margin: 0.8em 0; border-radius: 12px; overflow: hidden;
          border: 1px solid #e2e8f0; background: #1e293b;
        }
        .ai-message-content .code-block-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 0.4em 1em; background: #334155; border-bottom: 1px solid #475569;
        }
        .ai-message-content .code-lang {
          font-size: 0.75em; color: #94a3b8; font-weight: 600; text-transform: uppercase;
        }
        .ai-message-content .copy-btn {
          font-size: 0.72em; color: #94a3b8; cursor: pointer; background: none; border: none;
          padding: 0.2em 0.5em; border-radius: 4px; transition: all 0.2s;
        }
        .ai-message-content .copy-btn:hover { color: #e2e8f0; background: #475569; }
        .ai-message-content .code-block {
          margin: 0; padding: 1em; overflow-x: auto;
          font-size: 0.85em; line-height: 1.6; color: #e2e8f0;
          font-family: 'Fira Code', 'Cascadia Code', monospace;
        }
        .ai-message-content strong { font-weight: 700; color: #1e293b; }
        .ai-message-content em { font-style: italic; }

        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
      `}</style>
    </div>
  );
}
