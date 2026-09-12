import { useState } from 'react';
import {
  FiActivity,
  FiTrendingUp,
  FiTrendingDown,
  FiCalendar,
  FiZap,
  FiMinus,
} from 'react-icons/fi';
import type { EngagementData, SectionStatus, MomentumLevel, DailyActivity } from './learner-analytics.types';

interface EngagementAnalyticsProps {
  data: EngagementData | null;
  status: SectionStatus;
  onRetry?: () => void;
}

// ── Momentum config ──
const MOMENTUM_CONFIG: Record<
  MomentumLevel,
  { label: string; color: string; bgColor: string; icon: React.ReactNode }
> = {
  STRONG: {
    label: 'Mạnh mẽ',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 border-emerald-200',
    icon: <FiTrendingUp className="w-4 h-4" />,
  },
  HEALTHY: {
    label: 'Ổn định',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200',
    icon: <FiTrendingUp className="w-4 h-4" />,
  },
  SLOWING: {
    label: 'Đang giảm',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 border-amber-200',
    icon: <FiTrendingDown className="w-4 h-4" />,
  },
  LOW: {
    label: 'Thấp',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 border-orange-200',
    icon: <FiTrendingDown className="w-4 h-4" />,
  },
  INACTIVE: {
    label: 'Không hoạt động',
    color: 'text-red-500',
    bgColor: 'bg-red-50 border-red-200',
    icon: <FiActivity className="w-4 h-4" />,
  },
  NEW_ACTIVITY: {
    label: 'Mới quay lại',
    color: 'text-teal-600',
    bgColor: 'bg-teal-50 border-teal-200',
    icon: <FiTrendingUp className="w-4 h-4" />,
  },
  INSUFFICIENT_DATA: {
    label: 'Chưa đủ dữ liệu',
    color: 'text-slate-500',
    bgColor: 'bg-slate-50 border-slate-200',
    icon: <FiMinus className="w-4 h-4" />,
  },
};

// ── Day names ──
const DAY_NAMES_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DAY_NAMES_FULL = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ── 7-day Activity Bar Chart with tooltips ──
function ActivityBarChart({ data }: { data: EngagementData }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const last7 = data.dailyActivity.slice(-7);
  if (last7.length === 0) return null;

  const maxMins = Math.max(...last7.map((d) => d.minutesActive), 1);

  return (
    <div className="relative">
      <div className="flex items-end gap-2 h-28">
        {last7.map((day, i) => {
          const height = day.minutesActive > 0
            ? Math.max((day.minutesActive / maxMins) * 100, 8)
            : 4;
          const dayDate = new Date(day.date);
          const label = DAY_NAMES_SHORT[dayDate.getDay()] || '';
          const isActive = day.minutesActive > 0;
          const isHovered = activeIndex === i;

          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              onClick={() => setActiveIndex(activeIndex === i ? null : i)}
            >
              <div className="relative w-full flex justify-center">
                <div
                  className={`w-full max-w-[36px] rounded-t-lg transition-all duration-300 ${
                    isHovered
                      ? 'bg-gradient-to-t from-indigo-600 to-indigo-400 shadow-md shadow-indigo-200'
                      : isActive
                        ? 'bg-gradient-to-t from-indigo-500 to-indigo-400'
                        : 'bg-slate-100'
                  }`}
                  style={{ height: `${height}%`, minHeight: '3px' }}
                />
              </div>
              <span className={`text-[10px] font-semibold transition-colors ${
                isHovered ? 'text-indigo-600' : 'text-slate-400'
              }`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {activeIndex !== null && (
        <ActivityTooltip day={last7[activeIndex]} />
      )}
    </div>
  );
}

// ── Day detail tooltip ──
function ActivityTooltip({ day }: { day: DailyActivity }) {
  const dayDate = new Date(day.date);
  const dayName = DAY_NAMES_FULL[dayDate.getDay()];
  const hasActivity = day.minutesActive > 0 || day.sessions > 0;

  return (
    <div className="mt-3 bg-slate-50 rounded-xl p-3.5 border border-slate-100 transition-all duration-200">
      <p className="text-xs font-bold text-slate-700 mb-2">
        {dayName} — {formatDate(day.date)}
      </p>
      {hasActivity ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <span className="text-slate-500">{day.sessions} phiên học</span>
          <span className="text-slate-500">{day.minutesActive} phút học</span>
          {day.lessonsCompleted > 0 && (
            <span className="text-slate-500">{day.lessonsCompleted} bài hoàn thành</span>
          )}
          {(day.quizSubmissions ?? 0) > 0 && (
            <span className="text-slate-500">{day.quizSubmissions} bài kiểm tra</span>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">Không có hoạt động học tập</p>
      )}
    </div>
  );
}

// ── Stat pill ──
function StatPill({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
      <Icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </p>
        <p className="text-sm font-bold text-slate-700">{value}</p>
      </div>
    </div>
  );
}

export default function EngagementAnalytics({
  data,
  status,
  onRetry,
}: EngagementAnalyticsProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-bold text-slate-800">
            Hoạt động & Nhịp học
          </h3>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">
            Nhịp độ và sự đều đặn trong việc học
          </p>
        </div>
      </div>

      {status === 'loading' && (
        <div className="space-y-4 animate-pulse">
          <div className="h-28 bg-slate-50 rounded-xl" />
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-slate-50 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center py-8">
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
        <div className="text-center py-8">
          <FiActivity className="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p className="text-xs text-slate-400 font-medium">
            Chưa đủ hoạt động để phân tích
          </p>
        </div>
      )}

      {status === 'ready' && data && (
        <div className="space-y-5">
          {/* Activity bars + Momentum side by side */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 7-day Activity bar chart */}
            <div className="md:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">
                Hoạt động 7 ngày gần nhất
              </p>
              <ActivityBarChart data={data} />
            </div>

            {/* Momentum summary */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">
                Nhịp học
              </p>
              {(() => {
                const cfg = MOMENTUM_CONFIG[data.momentum.level] || MOMENTUM_CONFIG.INSUFFICIENT_DATA;
                return (
                  <div
                    className={`rounded-xl border p-3.5 ${cfg.bgColor} h-[80px] flex flex-col justify-center`}
                  >
                    <div className={`flex items-center gap-2 ${cfg.color} mb-1`}>
                      {cfg.icon}
                      <span className="font-bold text-sm">{cfg.label}</span>
                    </div>
                    {data.momentum.changePercent !== null && data.momentum.changePercent !== 0 && (
                      <p
                        className={`text-xl font-black ${cfg.color}`}
                      >
                        {data.momentum.changePercent > 0 ? '+' : ''}
                        {data.momentum.changePercent}%
                      </p>
                    )}
                    <p className="text-[10px] text-slate-500 mt-1 font-medium line-clamp-2">
                      {data.momentum.description}
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatPill icon={FiCalendar} label="Ngày hoạt động" value={data.activeDays} />
            <StatPill icon={FiActivity} label="Phiên học" value={data.totalSessions} />
            <StatPill icon={FiZap} label="Streak hiện tại" value={`${data.currentStreak} ngày`} />
            <StatPill
              icon={FiTrendingUp}
              label="Streak cao nhất"
              value={`${data.longestStreak} ngày`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
