import { FiTrendingUp, FiTrendingDown, FiMinus } from 'react-icons/fi';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { TrendChartData, SectionStatus } from './learner-analytics.types';

interface PerformanceTrendChartProps {
  data: TrendChartData | null;
  status: SectionStatus;
  onRetry?: () => void;
}

// ── Trend badge ──
function TrendBadge({ trend, label }: { trend: string; label: string }) {
  if (trend === 'INSUFFICIENT_DATA') return null;

  const config: Record<string, { icon: React.ReactNode; color: string }> = {
    IMPROVING: {
      icon: <FiTrendingUp className="w-3 h-3" />,
      color: 'text-emerald-600 bg-emerald-50',
    },
    STABLE: {
      icon: <FiMinus className="w-3 h-3" />,
      color: 'text-slate-500 bg-slate-50',
    },
    DECLINING: {
      icon: <FiTrendingDown className="w-3 h-3" />,
      color: 'text-red-500 bg-red-50',
    },
    RECOVERING: {
      icon: <FiTrendingUp className="w-3 h-3" />,
      color: 'text-amber-600 bg-amber-50',
    },
  };

  const c = config[trend] || config.STABLE;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg ${c.color}`}
    >
      {c.icon}
      {label}
    </span>
  );
}

// ── Custom Tooltip ──
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-800 text-white text-xs rounded-lg p-3 shadow-lg border border-slate-700 max-w-xs">
        <p className="font-semibold mb-1 text-slate-300">{label}</p>
        <div className="flex justify-between items-center mb-1">
          <span className="font-bold text-sm text-purple-400">Điểm: {data.value}%</span>
          {data.passed !== undefined && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${data.passed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
              {data.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}
            </span>
          )}
        </div>
        {data.change !== undefined && (
          <p className={`text-[10px] font-bold ${data.change > 0 ? 'text-emerald-400' : data.change < 0 ? 'text-red-400' : 'text-slate-400'}`}>
            {data.change > 0 ? '▲' : data.change < 0 ? '▼' : '▬'} {Math.abs(data.change)}% so với lần trước
          </p>
        )}
        {data.context && (
          <p className="mt-2 pt-2 border-t border-slate-600 text-slate-300">
            {data.context}
          </p>
        )}
      </div>
    );
  }
  return null;
};

export default function PerformanceTrendChart({
  data,
  status,
  onRetry,
}: PerformanceTrendChartProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Xu hướng kết quả</h3>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">
            Kết quả học tập đang thay đổi thế nào?
          </p>
        </div>
        {data?.trend && <TrendBadge trend={data.trend} label={data.trendLabel} />}
      </div>

      <div className="flex-1 flex flex-col justify-center min-h-[160px]">
        {status === 'loading' && (
          <div className="w-full h-full bg-slate-50 rounded-xl animate-pulse" />
        )}
        {status === 'error' && (
          <div className="text-center">
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
          <div className="text-center py-4">
            <FiTrendingUp className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-medium">
              Cần thêm dữ liệu đánh giá để hiển thị xu hướng
            </p>
          </div>
        )}
        {status === 'ready' && data && data.dataPoints && (
          <>
            <div className="w-full flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.dataPoints}
                  margin={{ top: 10, right: 0, left: -25, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorPerf" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#94a3b8' }} 
                    minTickGap={20}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    domain={[0, 100]}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorPerf)"
                    activeDot={{ r: 6, strokeWidth: 0, fill: '#8b5cf6' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {data.currentScore !== undefined && (
              <div className="flex justify-between items-center mt-3 pt-2 border-t border-slate-50">
                <span className="text-[10px] text-slate-400 font-medium">
                  {data.dataPoints[data.dataPoints.length - 1]?.date}
                </span>
                <span className="text-sm font-bold text-purple-600">
                  {data.currentScore}% trung bình
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
