import { FiAlertCircle, FiRepeat, FiXCircle } from 'react-icons/fi';
import type { BottleneckAnalytics, PotentialBottleneck, SectionStatus } from './learner-analytics.types';

interface BottleneckDetectionProps {
  data: BottleneckAnalytics | null;
  status: SectionStatus;
  onRetry?: () => void;
}

const SEVERITY_STYLES: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  HIGH: {
    label: 'Cần chú ý',
    cls: 'bg-red-50 border-red-100',
    dot: 'bg-red-400',
  },
  MEDIUM: {
    label: 'Theo dõi',
    cls: 'bg-amber-50 border-amber-100',
    dot: 'bg-amber-400',
  },
  LOW: {
    label: 'Nhẹ',
    cls: 'bg-slate-50 border-slate-200',
    dot: 'bg-slate-400',
  },
};

function BottleneckCard({ item }: { item: PotentialBottleneck }) {
  const severity = SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.MEDIUM;

  return (
    <div
      className={`rounded-xl border p-4 ${severity.cls} hover:shadow-sm transition-all duration-200`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-2.5 h-2.5 rounded-full ${severity.dot} mt-1 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-slate-800 truncate">
              {item.contentTitle}
            </h4>
            <span className="text-[9px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded-lg border border-slate-200 flex-shrink-0 ml-2">
              {severity.label}
            </span>
          </div>

          {/* Type / Module */}
          <div className="mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {item.type}
            </span>
            {item.moduleName && (
              <span className="text-[10px] text-slate-500 ml-2">
                — {item.moduleName}
              </span>
            )}
          </div>

          {/* Evidence metrics */}
          <div className="flex flex-wrap gap-3 text-xs mb-3">
            {item.revisitCount > 0 && (
              <span className="flex items-center gap-1 text-slate-500">
                <FiRepeat className="w-3 h-3" />
                {item.revisitCount} lần xem lại
              </span>
            )}
            {item.failedAttempts > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <FiXCircle className="w-3 h-3" />
                {item.failedAttempts} lần chưa đạt
              </span>
            )}
            {item.assessmentScore !== undefined && (
              <span className="text-slate-500">
                Đánh giá: <strong>{item.assessmentScore}%</strong>
              </span>
            )}
            {item.skillMastery !== undefined && (
              <span className="text-slate-500">
                Mastery: <strong>{item.skillMastery}%</strong>
              </span>
            )}
          </div>

          {/* Detailed Evidence List */}
          {item.evidence && item.evidence.length > 0 && (
             <div className="pt-2 border-t border-slate-200/50">
               <ul className="list-disc pl-4 text-[10px] text-slate-500 space-y-0.5">
                 {item.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
               </ul>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BottleneckDetection({
  data,
  status,
  onRetry,
}: BottleneckDetectionProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          {/* "Potential" wording per user feedback */}
          <h3 className="text-sm font-bold text-slate-800">
            Điểm nghẽn tiềm năng
          </h3>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">
            Nội dung có tín hiệu cần hỗ trợ thêm
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
              <div key={i} className="h-20 bg-slate-50 rounded-xl" />
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
            <FiAlertCircle className="w-7 h-7 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-medium">
              Chưa phát hiện điểm nghẽn
            </p>
          </div>
        )}

        {status === 'ready' && data && data.bottlenecks.length === 0 && (
          <div className="text-center py-6">
            <p className="text-xs text-emerald-600 font-semibold">
              ✅ Không phát hiện điểm nghẽn tiềm năng
            </p>
          </div>
        )}

        {status === 'ready' && data && data.bottlenecks.length > 0 && (
          <div className="space-y-3">
            {data.bottlenecks.map((b, idx) => (
              <BottleneckCard key={b.contentId || idx} item={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
