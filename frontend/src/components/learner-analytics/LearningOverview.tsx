import {
  FiTrendingUp,
  FiTrendingDown,
  FiTarget,
  FiZap,
  FiHeart,
  FiLayers,
  FiActivity,
  FiMinus,
} from 'react-icons/fi';
import type { LearningOverviewData, SectionStatus, AnalyticsMetric } from './learner-analytics.types';

interface LearningOverviewProps {
  data: LearningOverviewData | null;
  status: SectionStatus;
  onRetry?: () => void;
}

// ── KPI Card ──
function KPICard({
  metric,
  icon: Icon,
  gradient,
  accentColor,
}: {
  metric: AnalyticsMetric;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  accentColor: string;
}) {
  const trendIcon =
    metric.trendDirection === 'up' ? (
      <FiTrendingUp className="w-3.5 h-3.5" />
    ) : metric.trendDirection === 'down' ? (
      <FiTrendingDown className="w-3.5 h-3.5" />
    ) : (
      <FiMinus className="w-3.5 h-3.5" />
    );

    const statusColors: Record<string, string> = {
      positive: 'text-emerald-600 bg-emerald-50',
      neutral: 'text-slate-500 bg-slate-50',
      warning: 'text-amber-600 bg-amber-50',
      critical: 'text-red-600 bg-red-50',
      insufficient_data: 'text-slate-400 bg-slate-50',
    };

    const statusCls = statusColors[metric.status ?? 'neutral'];
    const isInsufficient = metric.status === 'insufficient_data';

    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-5 hover:shadow-md hover:border-slate-200 transition-all duration-300 group">
        <div className="flex items-start justify-between mb-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${gradient} shadow-sm`}
          >
            <Icon className={`w-5 h-5 ${accentColor}`} />
          </div>
          {metric.trend !== undefined && !isInsufficient && (
            <span
              className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg ${statusCls}`}
            >
              {trendIcon}
              {metric.trend > 0 ? '+' : ''}
              {metric.trend}
              {typeof metric.value === 'number' ? '%' : ''}
            </span>
          )}
        </div>

        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
          {metric.label}
        </p>
        <p className="text-2xl font-black text-slate-800 leading-tight">
          {isInsufficient ? '---' : typeof metric.value === 'number' ? `${metric.value}%` : metric.value}
        </p>
        {metric.description && (
          <p className="text-xs text-slate-500 mt-1.5 font-medium leading-relaxed">
            {metric.description}
          </p>
        )}
      </div>
    );
  }

  // ── Loading Skeleton ──
  function OverviewSkeleton() {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-2xl border border-slate-100 p-5 animate-pulse"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100" />
              <div className="w-14 h-5 rounded-lg bg-slate-100" />
            </div>
            <div className="w-16 h-3 bg-slate-100 rounded mb-2" />
            <div className="w-12 h-7 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  // ── Empty State ──
  function OverviewEmpty() {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
        <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <FiActivity className="w-6 h-6 text-slate-300" />
        </div>
        <p className="text-sm font-semibold text-slate-500 mb-1">
          Chưa đủ dữ liệu phân tích
        </p>
        <p className="text-xs text-slate-400">
          Hoàn thành thêm bài học để hệ thống có thể phân tích tiến trình của bạn.
        </p>
      </div>
    );
  }

  // ── Error State ──
  function OverviewError({ onRetry }: { onRetry?: () => void }) {
    return (
      <div className="bg-white rounded-2xl border border-red-100 p-8 text-center">
        <p className="text-sm font-semibold text-red-600 mb-2">
          Không thể tải dữ liệu phân tích
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
          >
            Thử lại
          </button>
        )}
      </div>
    );
  }

  // ── Main Component ──
  export default function LearningOverview({
    data,
    status,
    onRetry,
  }: LearningOverviewProps) {
    if (status === 'loading') return <OverviewSkeleton />;
    if (status === 'error') return <OverviewError onRetry={onRetry} />;
    if (status === 'empty' || !data) return <OverviewEmpty />;

    const cards: {
      metric: AnalyticsMetric;
      icon: React.ComponentType<{ className?: string }>;
      gradient: string;
      accentColor: string;
    }[] = [
      {
        metric: data.progress,
        icon: FiTarget,
        gradient: 'bg-indigo-50',
        accentColor: 'text-indigo-600',
      },
      {
        metric: data.mastery,
        icon: FiZap,
        gradient: 'bg-purple-50',
        accentColor: 'text-purple-600',
      },
      {
        metric: data.effectiveness,
        icon: FiHeart,
        gradient: 'bg-rose-50',
        accentColor: 'text-rose-600',
      },
      {
        metric: data.stage,
        icon: FiLayers,
        gradient: 'bg-teal-50',
        accentColor: 'text-teal-600',
      },
      {
        metric: data.status,
        icon: FiActivity,
        gradient: 'bg-amber-50',
        accentColor: 'text-amber-600',
      },
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <KPICard key={card.metric.label} {...card} />
        ))}
      </div>
    );
  }
