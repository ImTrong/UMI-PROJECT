import { FiCpu, FiInfo, FiRefreshCw } from 'react-icons/fi';
import type { AILearningSummaryData, SectionStatus } from './learner-analytics.types';

interface AILearningSummaryProps {
  data: AILearningSummaryData | null;
  status: SectionStatus;
  onRetry?: () => void;
}

function formatDateTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return isoStr;
  }
}

export default function AILearningSummary({
  data,
  status,
  onRetry,
}: AILearningSummaryProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-violet-100 to-purple-100 rounded-xl flex items-center justify-center">
            <FiCpu className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">AI Tổng kết học tập</h2>
            <p className="text-xs text-slate-400 font-medium">
              Tổng hợp bởi AI dựa trên dữ liệu phân tích
            </p>
          </div>
        </div>
        {status === 'ready' && onRetry && (
          <button
            onClick={onRetry}
            className="text-[10px] font-bold text-slate-400 hover:text-indigo-600 flex items-center gap-1 transition-colors cursor-pointer"
            title="Tạo lại tổng kết"
          >
            <FiRefreshCw className="w-3.5 h-3.5" />
            Làm mới
          </button>
        )}
      </div>

      {status === 'loading' && (
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-100 rounded w-full" />
          <div className="h-4 bg-slate-100 rounded w-5/6" />
          <div className="h-4 bg-slate-100 rounded w-4/6" />
          <div className="h-4 bg-slate-100 rounded w-3/4" />
        </div>
      )}

      {status === 'error' && (
        <div className="text-center py-6 bg-slate-50 rounded-xl">
          <p className="text-xs text-red-500 font-semibold mb-1">
            Chưa thể tạo tổng kết lúc này.
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer"
            >
              Thử lại
            </button>
          )}
        </div>
      )}

      {status === 'empty' && (
        <div className="text-center py-8 bg-slate-50 rounded-xl">
          <FiCpu className="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-500 mb-1">
            Hiện chưa có đủ dữ liệu để đưa ra tổng kết chi tiết
          </p>
          <p className="text-xs text-slate-400">
            Hãy tiếp tục học và hoàn thành thêm các bài đánh giá để hệ thống có thể phân tích chính xác hơn.
          </p>
        </div>
      )}

      {status === 'ready' && data && (
        <div>
          {/* Summary text */}
          <div className="bg-gradient-to-br from-slate-50 to-violet-50/30 rounded-xl p-5 mb-4 border border-slate-100/60">
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {data.summary}
            </p>
          </div>

          {/* Data sources */}
          <div className="flex items-start justify-between">
            {data.basedOn && data.basedOn.length > 0 && (
              <div className="flex items-start gap-2 text-[10px] text-slate-400">
                <FiInfo className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-bold">Dựa trên: </span>
                  {data.basedOn.join(', ')}
                </div>
              </div>
            )}

            {data.generatedAt && (
              <p className="text-[9px] text-slate-400 flex-shrink-0 ml-4">
                Tạo lúc: {formatDateTime(data.generatedAt)}
              </p>
            )}
          </div>

          {/* AI-generated label */}
          <div className="mt-3 flex items-center gap-1.5 text-[9px] text-violet-400">
            <FiCpu className="w-3 h-3" />
            <span>Nội dung được tạo bởi AI và dựa trên dữ liệu phân tích thực tế</span>
          </div>
        </div>
      )}
    </div>
  );
}
