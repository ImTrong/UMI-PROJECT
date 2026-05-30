import { FiBookOpen, FiClock, FiLayers, FiDollarSign } from 'react-icons/fi';
import { PathSummary } from '../../services/recommendation.service';
import { formatVND } from '../../utils/currency';

interface Props {
  summary: PathSummary;
  difficulty: string;
  category?: string;
}

const difficultyConfig: Record<string, { label: string; color: string; bg: string }> = {
  BEGINNER: { label: '🌱 Cơ bản', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  INTERMEDIATE: { label: '⚡ Trung cấp', color: 'text-amber-700', bg: 'bg-amber-100' },
  ADVANCED: { label: '🔥 Nâng cao', color: 'text-rose-700', bg: 'bg-rose-100' },
  ALL: { label: 'Đa cấp độ', color: 'text-emerald-700', bg: 'bg-emerald-100' },
};

export default function PathSummaryCard({ summary, difficulty, category }: Props) {
  const diff = difficultyConfig[difficulty] || difficultyConfig.ALL;

  const stats = [
    {
      icon: FiLayers,
      label: 'Tổng chặng',
      value: `${summary.totalMilestones} khóa học`,
      color: 'text-emerald-500',
      bg: 'bg-emerald-50',
    },
    {
      icon: FiBookOpen,
      label: 'Tổng bài học',
      value: `${summary.totalLessons} bài`,
      color: 'text-teal-500',
      bg: 'bg-teal-50',
    },
    {
      icon: FiClock,
      label: 'Thời gian ước tính',
      value: summary.totalEstimatedHours > 0 ? `~${summary.totalEstimatedHours}h` : 'N/A',
      color: 'text-amber-500',
      bg: 'bg-amber-50',
    },
    {
      icon: FiDollarSign,
      label: 'Tổng chi phí',
      value: summary.totalPrice > 0 ? formatVND(summary.totalPrice) : 'Miễn phí',
      color: 'text-emerald-500',
      bg: 'bg-emerald-50',
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <h4 className="text-sm font-bold text-slate-900 mb-4">📊 Tổng quan lộ trình</h4>

      {/* Tags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {category && (
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-emerald-50 text-emerald-600">
            📂 {category}
          </span>
        )}
        <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${diff.bg} ${diff.color}`}>
          {diff.label}
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className={`p-3 rounded-xl ${stat.bg} border border-slate-100/50`}>
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={`w-3.5 h-3.5 ${stat.color}`} />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {stat.label}
              </span>
            </div>
            <p className="text-sm font-extrabold text-slate-900">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
