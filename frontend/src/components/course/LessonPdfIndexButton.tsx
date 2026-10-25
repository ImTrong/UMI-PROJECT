import { useState } from 'react';
import { FiCpu, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';
import { lessonPdfKey, ragIndexService } from '../../services/rag-index.service';

/**
 * RAG-PDF-02 — "Lập chỉ mục cho Trợ lý AI" on a lesson of LessonManager whose uploaded file (videoUrl) is a PDF.
 * Nothing is rendered for video / other lessons. Indexing is an explicit action (it costs one embedding per chunk);
 * re-running it on an unchanged PDF is a no-op on the backend.
 */
export type IndexState =
  | { status: 'idle' }
  | { status: 'indexing' }
  | { status: 'done'; chunkCount: number; pagesWithText?: number; pages?: number }
  | { status: 'error'; message: string };

export function LessonPdfIndexButton({ courseId, lessonId, videoUrl }: { courseId: string; lessonId: string; videoUrl: string }) {
  const [state, setState] = useState<IndexState>({ status: 'idle' });
  const fileKey = lessonPdfKey(videoUrl);
  if (!fileKey) return null;

  const run = async () => {
    setState({ status: 'indexing' });
    try {
      const result = await ragIndexService.indexLessonPdf(courseId, lessonId, fileKey);
      setState({ status: 'done', chunkCount: result.chunkCount, pages: result.pages, pagesWithText: result.pagesWithText });
    } catch (error: any) {
      setState({ status: 'error', message: error?.message || 'Không lập chỉ mục được tài liệu lúc này.' });
    }
  };

  return <LessonPdfIndexView state={state} onIndex={run} />;
}

export function LessonPdfIndexView({ state, onIndex }: { state: IndexState; onIndex: () => void }) {
  return (
    <div className="flex flex-col items-end gap-1" data-testid="lesson-pdf-index">
      <button
        type="button"
        onClick={onIndex}
        disabled={state.status === 'indexing'}
        className="flex items-center gap-1 p-2 text-indigo-600 hover:bg-indigo-50 rounded text-xs font-medium border border-indigo-100 disabled:opacity-50"
        title="Cho phép Trợ lý AI trả lời dựa trên nội dung PDF của bài học"
      >
        <FiCpu size={14} /> {state.status === 'indexing' ? 'Đang lập chỉ mục…' : state.status === 'done' ? 'Lập chỉ mục lại' : 'Lập chỉ mục cho Trợ lý AI'}
      </button>
      {state.status === 'done' && (
        <span className="text-[11px] text-emerald-700 flex items-center gap-1" data-state="done">
          <FiCheckCircle size={11} /> Đã lập chỉ mục {state.chunkCount} đoạn
          {state.pagesWithText !== undefined && state.pages !== undefined ? ` từ ${state.pagesWithText}/${state.pages} trang có chữ` : ''}
        </span>
      )}
      {state.status === 'error' && (
        <span className="text-[11px] text-red-600 flex items-center gap-1 max-w-xs text-right" role="alert" data-state="error">
          <FiAlertCircle size={11} className="flex-shrink-0" /> {state.message}
        </span>
      )}
    </div>
  );
}
