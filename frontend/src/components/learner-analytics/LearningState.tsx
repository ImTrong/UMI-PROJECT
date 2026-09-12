import {
  FiTrendingUp,
  FiTrendingDown,
  FiMinus,
  FiAlertTriangle,
  FiCheckCircle,
  FiPauseCircle,
  FiRefreshCw,
  FiActivity,
} from 'react-icons/fi';
import type { LearningStateData, LearningStateType, SectionStatus } from './learner-analytics.types';

interface LearningStateProps {
  data: LearningStateData | null;
  status: SectionStatus;
  onRetry?: () => void;
}

// ── State config ──
const STATE_CONFIG: Record<
  LearningStateType,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  PROGRESSING: {
    label: 'Đang tiến bộ',
    icon: FiTrendingUp,
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
  },
  STABLE: {
    label: 'Ổn định',
    icon: FiCheckCircle,
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  STAGNATING: {
    label: 'Đình trệ',
    icon: FiPauseCircle,
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  REGRESSING: {
    label: 'Đang giảm',
    icon: FiTrendingDown,
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  RECOVERING: {
    label: 'Đang phục hồi',
    icon: FiRefreshCw,
    color: 'text-teal-700',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
  },
  AT_RISK: {
    label: 'Cần chú ý',
    icon: FiAlertTriangle,
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  PAUSED: {
    label: 'Tạm ngưng',
    icon: FiPauseCircle,
    color: 'text-slate-600',
    bgColor: 'bg-slate-100',
    borderColor: 'border-slate-200',
  },
  INSUFFICIENT_DATA: {
    label: 'Thiếu dữ liệu',
    icon: FiActivity,
    color: 'text-slate-400',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-100',
  },
};

// ── Evidence direction icon ──
function DirectionIcon({ direction }: { direction: 'up' | 'down' | 'stable' }) {
  if (direction === 'up') return <FiTrendingUp className="w-3 h-3 text-emerald-500" />;
  if (direction === 'down') return <FiTrendingDown className="w-3 h-3 text-red-400" />;
  return <FiMinus className="w-3 h-3 text-slate-400" />;
}

export default function LearningState({
  data,
  status,
  onRetry,
}: LearningStateProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm h-full flex flex-col">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-slate-800">
          Trạng thái học tập
        </h3>
        <p className="text-[10px] text-slate-400 font-medium mt-0.5">
          Đánh giá tổng hợp dựa trên nhiều tín hiệu
        </p>
      </div>

      <div className="flex-1">
        {status === 'loading' && (
          <div className="animate-pulse space-y-3">
            <div className="h-16 bg-slate-50 rounded-xl" />
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-5 bg-slate-50 rounded" />
              ))}
            </div>
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
            <FiActivity className="w-7 h-7 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-medium">
              Cần thêm dữ liệu để xác định trạng thái học tập
            </p>
          </div>
        )}

        {status === 'ready' && data && (() => {
          const cfg = STATE_CONFIG[data.state] || STATE_CONFIG['INSUFFICIENT_DATA'];
          const Icon = cfg.icon;

          return (
            <div>
              {/* State indicator */}
              <div
                className={`rounded-xl border p-4 ${cfg.bgColor} ${cfg.borderColor} mb-4`}
              >
                <div className={`flex items-center gap-2 ${cfg.color} mb-1`}>
                  <Icon className="w-5 h-5" />
                  <span className="text-base font-black">{cfg.label}</span>
                </div>
                <p className={`text-xs font-medium ${cfg.color} opacity-80`}>
                  {data.description}
                </p>
              </div>

              {/* Evidence list — crucial per user feedback */}
              {data.evidence && data.evidence.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Bằng chứng
                  </p>
                  <div className="space-y-1.5">
                    {data.evidence.map((ev, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs bg-slate-50 px-3 py-2 rounded-lg"
                      >
                        <DirectionIcon direction={ev.direction} />
                        <span className="text-slate-500 font-medium">
                          {ev.metric}:
                        </span>
                        <span className="font-bold text-slate-700">{ev.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-50">
                {data.confidence !== undefined && (
                  <span className="text-[10px] font-bold text-slate-400">
                    Độ tin cậy: {Math.round(data.confidence * 100)}%
                  </span>
                )}
                {data.lastUpdated && (
                  <span className="text-[9px] text-slate-400">
                    Cập nhật: {data.lastUpdated}
                  </span>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
