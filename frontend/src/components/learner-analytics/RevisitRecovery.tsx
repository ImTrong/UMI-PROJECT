import { useState } from 'react';
import {
  FiRepeat,
  FiTrendingUp,
  FiRefreshCw,
  FiChevronDown,
  FiChevronUp,
} from 'react-icons/fi';
import type {
  RevisitItem,
  RecoveryDetection,
  RecoveryAnalytics,
  SectionStatus,
} from './learner-analytics.types';

interface RevisitRecoveryProps {
  data: RecoveryAnalytics | null;
  status: SectionStatus;
  onRetry?: () => void;
}

// ── Revisit card with hover preview + click expand ──
function RevisitCard({ item }: { item: RevisitItem }) {
  const [expanded, setExpanded] = useState(false);
  const improved = (item.observedImprovement ?? 0) > 0;
  const changeText = improved
    ? `+${item.observedImprovement} điểm`
    : `${item.observedImprovement ?? 0} điểm`;

  return (
    <div
      className={`bg-slate-50 rounded-xl p-3.5 transition-all duration-200 cursor-pointer ${
        expanded ? 'bg-slate-100/80 ring-1 ring-indigo-100' : 'hover:bg-slate-100/80'
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Compact preview (always visible) */}
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-xs font-bold text-slate-700 truncate flex-1">
          {item.contentTitle}
        </h4>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className="text-[9px] font-bold text-slate-400 bg-white px-2 py-0.5 rounded-lg border">
            {item.revisitCount}× ôn lại
          </span>
          {expanded ? (
            <FiChevronUp className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <FiChevronDown className="w-3.5 h-3.5 text-slate-400" />
          )}
        </div>
      </div>

      {/* Quick stats row */}
      <div className="flex items-center gap-4 text-[11px]">
        <span className="text-slate-500">
          Trước: <strong>{item.beforeScore}%</strong>
        </span>
        <span className="text-slate-400">→</span>
        <span className="text-slate-500">
          Sau: <strong>{item.afterScore}%</strong>
        </span>
        <span
          className={`font-bold ${improved ? 'text-emerald-600' : 'text-red-500'}`}
        >
          {changeText}
        </span>
      </div>

      {/* Expanded detail: mini sequence flow */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-200/60">
          <div className="flex items-center justify-center gap-2 text-[11px]">
            {/* Step 1: Before quiz */}
            <div className="bg-white rounded-lg px-3 py-2 border text-center min-w-[80px]">
              <p className="text-[9px] font-bold text-slate-400 uppercase">Quiz</p>
              <p className="text-base font-black text-slate-700">{item.beforeScore}%</p>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center text-slate-300">
              <span className="text-lg">↓</span>
            </div>

            {/* Step 2: Revisit */}
            <div className="bg-indigo-50 rounded-lg px-3 py-2 border border-indigo-100 text-center min-w-[80px]">
              <p className="text-[9px] font-bold text-indigo-400 uppercase">Ôn tập</p>
              <p className="text-base font-black text-indigo-600">{item.revisitCount} lần</p>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center text-slate-300">
              <span className="text-lg">↓</span>
            </div>

            {/* Step 3: After quiz */}
            <div className={`rounded-lg px-3 py-2 border text-center min-w-[80px] ${
              improved ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'
            }`}>
              <p className={`text-[9px] font-bold uppercase ${improved ? 'text-emerald-400' : 'text-red-400'}`}>
                Quiz
              </p>
              <p className={`text-base font-black ${improved ? 'text-emerald-600' : 'text-red-600'}`}>
                {item.afterScore}%
              </p>
            </div>
          </div>

          {/* Observation note — careful wording, no causal claim */}
          <p className="text-[10px] text-slate-500 text-center mt-3 font-medium">
            {improved
              ? `Điểm đánh giá sau giai đoạn ôn tập tăng ${item.observedImprovement} điểm.`
              : `Thay đổi quan sát được sau giai đoạn ôn tập.`}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Recovery indicator ──
function RecoveryIndicator({ recovery }: { recovery: RecoveryDetection }) {
  if (!recovery.detected) return null;

  const history = recovery.scoreHistory || [];
  const maxV = Math.max(...history, 1);
  const minV = Math.min(...history, 0);
  const range = maxV - minV || 1;

  return (
    <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 mt-3">
      <div className="flex items-center gap-2 mb-2">
        <FiRefreshCw className="w-4 h-4 text-emerald-600" />
        <span className="text-xs font-bold text-emerald-700">
          Phục hồi được phát hiện
        </span>
      </div>
      {recovery.description && (
        <p className="text-[11px] text-emerald-600 mb-3">{recovery.description}</p>
      )}

      {recovery.evidence && recovery.evidence.length > 0 && (
        <div className="mb-3 pt-2 border-t border-emerald-200/50">
          <ul className="list-disc pl-4 text-[10px] text-emerald-700 space-y-0.5">
            {recovery.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
          </ul>
        </div>
      )}

      {history.length > 2 && (
        <div className="flex items-end gap-1 h-10">
          {history.map((score, i) => {
            const heightPct = Math.max(((score - minV) / range) * 100, 8);
            const isLow =
              i > 0 &&
              i < history.length - 1 &&
              score < history[i - 1] &&
              score <= Math.min(...history);
            return (
              <div
                key={i}
                className={`flex-1 rounded-t transition-all duration-300 ${
                  isLow ? 'bg-red-300' : 'bg-emerald-400'
                }`}
                style={{ height: `${heightPct}%` }}
                title={`${score}%`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RevisitRecovery({
  data,
  status,
  onRetry,
}: RevisitRecoveryProps) {
  const hasData = data && (data.revisits.length > 0 || data.recovery?.detected);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Ôn tập & Phục hồi</h3>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">
            Hiệu quả ôn tập và phát hiện phục hồi
          </p>
        </div>
      </div>

      <div className="flex-1">
        {status === 'loading' && (
          <div className="space-y-3 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 bg-slate-50 rounded-xl" />
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

        {(status === 'empty' || (status === 'ready' && !hasData)) && (
          <div className="text-center py-6">
            <FiRepeat className="w-7 h-7 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-medium">
              Chưa có dữ liệu ôn tập để phân tích
            </p>
          </div>
        )}

        {status === 'ready' && data && hasData && (
          <div>
            {data.revisits.length > 0 && (
              <div className="space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                  <FiRepeat className="w-3 h-3" /> Nội dung đã ôn lại
                  <span className="text-[9px] font-normal ml-1">(nhấn để xem chi tiết)</span>
                </p>
                {data.revisits.map((r, idx) => (
                  <RevisitCard key={idx} item={r} />
                ))}
              </div>
            )}

            {data.recovery?.detected && <RecoveryIndicator recovery={data.recovery} />}

            {!data.recovery?.detected && data.revisits.length > 0 && (
              <div className="mt-3 bg-slate-50 rounded-xl p-3 text-center">
                <p className="text-[10px] text-slate-400 font-medium flex items-center justify-center gap-1">
                  <FiTrendingUp className="w-3 h-3" />
                  Chưa phát hiện pattern phục hồi
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
