import { FiAlertTriangle } from 'react-icons/fi';
import type { KnowledgeGapAnalytics, KnowledgeGapItem, SectionStatus } from './learner-analytics.types';

interface KnowledgeGapProps {
  data: KnowledgeGapAnalytics | null;
  status: SectionStatus;
  onRetry?: () => void;
}

const PRIORITY_STYLES: Record<string, { label: string; cls: string }> = {
  HIGH: { label: 'Ưu tiên cao', cls: 'text-red-600 bg-red-50 border-red-200' },
  MEDIUM: { label: 'Ưu tiên vừa', cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  LOW: { label: 'Ưu tiên thấp', cls: 'text-slate-500 bg-slate-50 border-slate-200' },
};

function GapCard({ item }: { item: KnowledgeGapItem }) {
  const priority = PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.MEDIUM;
  const expectedPct = Math.min(item.expected, 100);
  const currentPct = Math.min(item.current, 100);

  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 hover:shadow-sm hover:border-slate-200 transition-all duration-200">
      <div className="flex items-start justify-between mb-3">
        <h4 className="text-sm font-bold text-slate-800">{item.skill}</h4>
        <span
          className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border ${priority.cls}`}
        >
          {priority.label}
        </span>
      </div>

      {/* Dual bar visualization — Expected vs Current */}
      <div className="space-y-2">
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-slate-400 font-medium">Kỳ vọng</span>
            <span className="text-[10px] font-bold text-slate-500">{item.expected}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-slate-300 rounded-full transition-all duration-500"
              style={{ width: `${expectedPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-slate-400 font-medium">Hiện tại</span>
            <span className="text-[10px] font-bold text-indigo-600">{item.current}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${currentPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Gap indicator */}
      <div className="mt-3 pt-3 border-t border-slate-50 flex items-center justify-between">
        <span className="text-[10px] text-slate-400 font-medium">Khoảng cách</span>
        <span className="text-sm font-black text-red-500">-{Math.abs(item.gap)}%</span>
      </div>
      
      {/* Evidence */}
      {item.evidence && item.evidence.length > 0 && (
         <div className="mt-3 pt-2 border-t border-slate-50">
           <ul className="list-disc pl-4 text-[10px] text-slate-500 space-y-0.5">
             {item.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
           </ul>
         </div>
      )}
    </div>
  );
}

export default function KnowledgeGap({
  data,
  status,
  onRetry,
}: KnowledgeGapProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Khoảng cách kiến thức</h3>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">
            Chênh lệch giữa mức kỳ vọng và thực tế
          </p>
        </div>
        {status === 'ready' && data && data.confidence !== undefined && (
          <span className="text-[10px] font-medium text-slate-400">
            Độ tin cậy: {Math.round(data.confidence * 100)}%
          </span>
        )}
      </div>

      <div className="flex-1">
        {status === 'loading' && (
          <div className="space-y-3 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="h-28 bg-slate-50 rounded-xl" />
            ))}
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-6">
            <p className="text-xs text-red-500 font-semibold mb-1">Lỗi tải dữ liệu</p>
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
          <div className="text-center py-6">
            <FiAlertTriangle className="w-7 h-7 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-medium">
              Chưa phát hiện khoảng cách kiến thức
            </p>
          </div>
        )}

        {status === 'ready' && data && data.gaps.length === 0 && (
          <div className="text-center py-6">
            <p className="text-xs text-emerald-600 font-semibold">
              🎉 Không có khoảng cách đáng kể!
            </p>
          </div>
        )}

        {status === 'ready' && data && data.gaps.length > 0 && (
          <div className="space-y-3">
            {data.gaps.map((gap) => (
              <GapCard key={gap.skill} item={gap} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
