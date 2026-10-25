import { useReducer, useState, useEffect, useRef } from 'react';
import { FiSend, FiAlertCircle, FiRefreshCw, FiBookOpen, FiLock, FiInfo, FiCornerDownRight } from 'react-icons/fi';
import { ragChatService, RAG_MAX_MESSAGE_LENGTH, RagScope, RagSource } from '../../services/rag-chat.service';
import {
  askLesson,
  lessonChatReducer,
  scopeKeyOf,
  threadOf,
  ChatTurn,
  LessonThread,
  SourceSplit,
} from '../../utils/lesson-chat';
import type { SourceJump } from '../../utils/source-highlight';
import { AnswerMarkdown } from './MarkdownContent';
import { pdfCitationOf } from '../../utils/pdf-source-locator';

/**
 * RAG-MVP-05A/05D — "Hỏi về bài học": chat about the lesson that is open, answered from that lesson's indexed documents only.
 *
 * Scope = the courseId / lessonId of the displayed lesson, sent with every question; access (enrolled learner, course
 * instructor, ADMIN) is decided by the backend with the learner's own token. One thread per lesson: switching lesson
 * switches thread, never continues the previous lesson's conversation.
 * 05D: a cited source (inline "[Nguồn n]" or its card) can be opened: the page scrolls to and highlights that passage of the
 * lesson text (`onSourceSelect`); the outcome is shown under the answer, and nothing is scrolled when it is not located exactly.
 * RAG-PDF-05: a source in a lesson PDF opens that PDF at its page; the outcome then arrives later (a Promise) - only the
 * latest click of the current lesson is shown.
 */
interface LessonChatPanelProps {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  onSourceSelect?: (source: RagSource) => SourceJump | Promise<SourceJump>;
}

/** The citation opened last: which answer, which source, and what happened. */
export interface ActiveCitation {
  turnId: string;
  sourceIndex: number;
  jump: SourceJump;
}

export function LessonChatPanel({ courseId, lessonId, lessonTitle, onSourceSelect }: LessonChatPanelProps) {
  const [threads, dispatch] = useReducer(lessonChatReducer, {});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [active, setActive] = useState<Record<string, ActiveCitation | null>>({});
  const openSeq = useRef(0);
  const scope: RagScope = { courseId, lessonId };
  const scopeKey = scopeKeyOf(scope);
  const thread = threadOf(threads, scopeKey);
  const draft = drafts[scopeKey] ?? '';

  // the page clears its highlight when the lesson changes: forget which citation was open, too
  useEffect(() => {
    openSeq.current++;
    setActive({});
  }, [scopeKey]);

  const send = (question: string) => {
    const text = question.trim();
    if (!text || thread.pending || thread.blocked) return;
    setDrafts((d) => ({ ...d, [scopeKey]: '' }));
    void askLesson(scope, thread, text, dispatch, ragChatService.ask);
  };

  const openSource = onSourceSelect
    ? (turnId: string, source: RagSource) => {
        const seq = ++openSeq.current;
        const show = (jump: SourceJump) => setActive((a) => ({ ...a, [scopeKey]: { turnId, sourceIndex: source.sourceIndex, jump } }));
        const result = onSourceSelect(source);
        if (!(result instanceof Promise)) return show(result);
        show({ status: 'pdf-opening' });
        void result.then((jump) => {
          if (openSeq.current === seq) show(jump); // a later click (or another lesson) wins
        });
      }
    : undefined;

  return (
    <LessonChatView
      lessonTitle={lessonTitle}
      thread={thread}
      draft={draft}
      onDraftChange={(value) => setDrafts((d) => ({ ...d, [scopeKey]: value }))}
      onSend={() => send(draft)}
      onRetry={() => thread.error && send(thread.error.question)}
      onDismissError={() => dispatch({ type: 'DISMISS_ERROR', scopeKey })}
      onOpenSource={openSource}
      activeCitation={active[scopeKey] ?? null}
    />
  );
}

// ==================== presentational parts (rendered statically in tests) ====================

interface LessonChatViewProps {
  lessonTitle: string;
  thread: LessonThread;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onDismissError: () => void;
  onOpenSource?: (turnId: string, source: RagSource) => void;
  activeCitation?: ActiveCitation | null;
}

export function LessonChatView({
  lessonTitle, thread, draft, onDraftChange, onSend, onRetry, onDismissError, onOpenSource, activeCitation = null,
}: LessonChatViewProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [thread.turns.length, thread.pending]);

  const canSend = !thread.pending && !thread.blocked && draft.trim().length > 0;

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="lesson-chat">
      <div className="px-4 py-3 border-b bg-slate-50 flex-shrink-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Hỏi về bài học</p>
        <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate" title={lessonTitle}>{lessonTitle}</p>
        <p className="text-xs text-slate-500 mt-1 flex items-start gap-1">
          <FiInfo className="mt-0.5 flex-shrink-0" size={12} />
          <span>Trợ lý chỉ trả lời dựa trên tài liệu của bài học này.</span>
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" data-region="history">
        {thread.turns.length === 0 && !thread.pending && !thread.blocked && (
          <p className="text-sm text-slate-500 text-center mt-6 px-4">
            Đặt câu hỏi về nội dung bài học, ví dụ: một khái niệm chưa rõ hoặc sự khác nhau giữa hai ý trong bài.
          </p>
        )}
        {thread.turns.map((turn) => (
          <ChatTurnView
            key={turn.id}
            turn={turn}
            onOpenSource={onOpenSource}
            activeCitation={activeCitation?.turnId === turn.id ? activeCitation : null}
          />
        ))}
        {thread.pending && (
          <div className="flex items-center gap-2 text-sm text-slate-500" role="status" data-state="pending">
            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
            Đang tìm trong tài liệu bài học và soạn câu trả lời…
          </div>
        )}
        {thread.error && <ChatErrorNotice thread={thread} onRetry={onRetry} onDismiss={onDismissError} />}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3 flex-shrink-0 bg-white" data-region="composer">
        {thread.blocked ? (
          <p className="text-xs text-slate-500 flex items-center gap-1" data-state="blocked">
            <FiLock size={12} /> Không thể gửi câu hỏi cho bài học này.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) onSend();
                }
              }}
              maxLength={RAG_MAX_MESSAGE_LENGTH}
              rows={2}
              placeholder="Nhập câu hỏi về bài học…"
              disabled={thread.pending}
              aria-label="Câu hỏi về bài học"
              className="flex-1 min-w-0 select-text resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Gửi câu hỏi"
              className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-primary-600 text-white disabled:opacity-40"
            >
              <FiSend size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ChatTurnViewProps {
  turn: ChatTurn;
  onOpenSource?: (turnId: string, source: RagSource) => void;
  activeCitation?: ActiveCitation | null;
}

export function ChatTurnView({ turn, onOpenSource, activeCitation = null }: ChatTurnViewProps) {
  if (turn.role === 'USER') {
    return (
      <div className="flex justify-end" data-role="user">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary-600 text-white px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {turn.content}
        </div>
      </div>
    );
  }
  const used = turn.sources?.used ?? [];
  const open = onOpenSource
    ? (n: number) => {
        const source = used.find((s) => s.sourceIndex === n);
        if (source) onOpenSource(turn.id, source);
      }
    : undefined;
  return (
    <div className="flex justify-start" data-role="assistant" data-grounded={turn.grounded ? 'true' : 'false'}>
      <div className="max-w-[95%] min-w-0 rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
        {!turn.grounded && (
          <p className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1" data-state="not-found">
            <FiAlertCircle size={12} /> Chưa tìm thấy nội dung phù hợp trong bài học
          </p>
        )}
        <AnswerMarkdown
          content={turn.content}
          citable={turn.grounded ? used.map((s) => s.sourceIndex) : []}
          onCite={open}
          activeIndex={activeCitation?.sourceIndex ?? null}
        />
        {turn.grounded && turn.sources && (
          <SourcesBlock split={turn.sources} onOpen={open} activeCitation={activeCitation} />
        )}
      </div>
    </div>
  );
}

interface SourcesBlockProps {
  split: SourceSplit;
  onOpen?: (sourceIndex: number) => void;
  activeCitation?: ActiveCitation | null;
}

export function SourcesBlock({ split, onOpen, activeCitation = null }: SourcesBlockProps) {
  if (split.used.length === 0 && split.unused.length === 0) return null;
  return (
    <div className="mt-2 border-t border-slate-200 pt-2 space-y-2" data-testid="sources">
      {split.used.length > 0 ? (
        <div data-group="used">
          <p className="text-xs font-semibold text-slate-600 flex items-center gap-1">
            <FiBookOpen size={12} /> Nguồn được trích dẫn
          </p>
          <ul className="mt-1 space-y-1">
            {split.used.map((s) => (
              <SourceItem
                key={s.sourceIndex}
                source={s}
                onOpen={onOpen}
                active={activeCitation?.sourceIndex === s.sourceIndex}
              />
            ))}
          </ul>
          {activeCitation && <JumpNotice jump={activeCitation.jump} />}
        </div>
      ) : (
        <p className="text-xs text-amber-700" data-group="no-citation">Câu trả lời không trích dẫn nguồn cụ thể.</p>
      )}
      {split.unused.length > 0 && (
        <details data-group="unused">
          <summary className="text-xs text-slate-500 cursor-pointer">
            Đoạn được truy xuất nhưng không được trích dẫn ({split.unused.length})
          </summary>
          <ul className="mt-1 space-y-1 opacity-70">
            {split.unused.map((s) => <SourceItem key={s.sourceIndex} source={s} />)}
          </ul>
        </details>
      )}
    </div>
  );
}

function SourceItem({ source, onOpen, active = false }: { source: RagSource; onOpen?: (sourceIndex: number) => void; active?: boolean }) {
  const pdfPage = pdfCitationOf(source)?.page;
  const body = (
    <>
      <span className="font-semibold text-slate-700">[Nguồn {source.sourceIndex}]</span>{' '}
      <span className="text-slate-600">{source.title || 'Tài liệu bài học'}</span>
      {source.snippet && <span className="block text-slate-500 mt-0.5 line-clamp-3 break-words">“{source.snippet}…”</span>}
    </>
  );
  return (
    <li
      className={`text-xs rounded-lg border px-2 py-1.5 ${active ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}
      data-source-index={source.sourceIndex}
      data-active={active ? 'true' : undefined}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(source.sourceIndex)}
          className="w-full text-left"
          aria-label={`Mở đoạn tài liệu của nguồn ${source.sourceIndex}`}
        >
          {body}
          <span className="mt-1 flex items-center gap-1 text-primary-700 font-medium">
            <FiCornerDownRight size={11} /> {pdfPage ? `Xem trong PDF (trang ${pdfPage})` : 'Xem trong bài học'}
          </span>
        </button>
      ) : (
        body
      )}
    </li>
  );
}

export const JUMP_MESSAGES = {
  highlighted: 'Đã chuyển tới đoạn nguồn trong nội dung bài học.',
  'scrolled-only': 'Đã chuyển tới đoạn nguồn (trình duyệt này không hỗ trợ tô sáng).',
  'not-located': 'Không xác định được vị trí chính xác trong tài liệu đang hiển thị.',
  'other-lesson': 'Nguồn này không thuộc bài học đang mở.',
  // RAG-PDF-05
  'pdf-opening': 'Đang mở tài liệu PDF…',
} as const;

/** What the learner is told after opening a citation (PDF statuses name the page). */
export function jumpMessage(jump: SourceJump): string {
  switch (jump.status) {
    case 'pdf-highlighted':
      return `Đã mở PDF tới trang ${jump.page} và tô sáng đoạn nguồn.`;
    case 'pdf-scrolled-only':
      return `Đã mở PDF tới đoạn nguồn ở trang ${jump.page} (trình duyệt này không hỗ trợ tô sáng).`;
    case 'pdf-page-only':
      return `Đã chuyển tới trang ${jump.page} của PDF nhưng chưa xác định được đoạn trích dẫn chính xác.`;
    case 'pdf-unavailable':
      return jump.reason === 'page-out-of-range'
        ? 'Tài liệu PDF đang hiển thị không có trang được trích dẫn.'
        : jump.reason === 'closed'
          ? 'Tài liệu PDF đã được đóng.'
          : jump.reason === 'not-a-lesson-file'
            ? 'Tệp PDF của nguồn này không còn thuộc bài học đang mở.'
            : 'Không mở được tệp PDF của nguồn này.';
    default:
      return JUMP_MESSAGES[jump.status];
  }
}

function JumpNotice({ jump }: { jump: SourceJump }) {
  const ok = ['highlighted', 'scrolled-only', 'pdf-highlighted', 'pdf-scrolled-only'].includes(jump.status);
  const tone = ok ? 'text-emerald-700' : jump.status === 'pdf-opening' ? 'text-slate-500' : 'text-amber-700';
  return (
    <p className={`mt-1 text-xs ${tone}`} role="status" data-jump={jump.status}>
      {jumpMessage(jump)}
    </p>
  );
}

export function ChatErrorNotice({ thread, onRetry, onDismiss }: { thread: LessonThread; onRetry: () => void; onDismiss: () => void }) {
  const error = thread.error!;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-error-kind={error.kind}>
      <p className="flex items-start gap-1"><FiAlertCircle className="mt-0.5 flex-shrink-0" size={14} /> {error.message}</p>
      <div className="flex gap-3 mt-2">
        {error.retryable && !thread.blocked && (
          <button type="button" onClick={onRetry} className="text-xs font-semibold text-red-700 flex items-center gap-1" data-action="retry">
            <FiRefreshCw size={12} /> Thử lại
          </button>
        )}
        {!thread.blocked && (
          <button type="button" onClick={onDismiss} className="text-xs text-red-600">Đóng</button>
        )}
      </div>
    </div>
  );
}
