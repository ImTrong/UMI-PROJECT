import { SkillStrength, CategoryInsight } from '../../services/recommendation.service';
import { FiTrendingUp, FiTrendingDown, FiMinus } from 'react-icons/fi';

interface Props {
  skillStrengths: SkillStrength[];
  categoryDistribution: CategoryInsight[];
  weeklyProgress: {
    lessonsThisWeek: number;
    lessonsLastWeek: number;
    trend: 'up' | 'down' | 'stable';
    trendPercentage: number;
  };
}

const barColors = [
  'from-emerald-500 to-teal-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-cyan-500 to-cyan-500',
  'from-fuchsia-500 to-teal-500',
];

const labelColors: Record<string, string> = {
  'Xuất sắc': 'bg-emerald-100 text-emerald-700',
  'Tốt': 'bg-cyan-100 text-cyan-700',
  'Đang phát triển': 'bg-amber-100 text-amber-700',
  'Mới bắt đầu': 'bg-slate-100 text-slate-600',
};

export default function SkillsChart({ skillStrengths, categoryDistribution, weeklyProgress }: Props) {
  if (skillStrengths.length === 0 && categoryDistribution.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
        <p className="text-slate-400 text-sm font-medium">
          Hãy bắt đầu học để xem phân tích kỹ năng của bạn
        </p>
      </div>
    );
  }

  const maxTime = Math.max(...categoryDistribution.map((c) => c.totalTimeHours), 1);

  return (
    <div className="space-y-6">
      {/* Weekly Progress Trend */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h4 className="text-sm font-bold text-slate-900 mb-4">📈 Tiến độ tuần này</h4>
        <div className="flex items-center gap-6">
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900">
                {weeklyProgress.lessonsThisWeek}
              </span>
              <span className="text-sm text-slate-500 font-medium">bài học hoàn thành</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {weeklyProgress.trend === 'up' && (
                <>
                  <FiTrendingUp className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-bold text-emerald-600">
                    +{weeklyProgress.trendPercentage}% so với tuần trước
                  </span>
                </>
              )}
              {weeklyProgress.trend === 'down' && (
                <>
                  <FiTrendingDown className="w-4 h-4 text-rose-500" />
                  <span className="text-xs font-bold text-rose-600">
                    {weeklyProgress.trendPercentage}% so với tuần trước
                  </span>
                </>
              )}
              {weeklyProgress.trend === 'stable' && (
                <>
                  <FiMinus className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold text-slate-500">
                    Ổn định so với tuần trước
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-1 items-end h-12">
            {/* Mini bar chart for this week vs last week */}
            <div className="flex flex-col items-center gap-1">
              <div
                className="w-8 bg-slate-200 rounded-t-md transition-all duration-500"
                style={{
                  height: `${Math.max(8, (weeklyProgress.lessonsLastWeek / Math.max(weeklyProgress.lessonsThisWeek, weeklyProgress.lessonsLastWeek, 1)) * 48)}px`,
                }}
              />
              <span className="text-[9px] text-slate-400 font-bold">Tuần trước</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div
                className="w-8 bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-md transition-all duration-500"
                style={{
                  height: `${Math.max(8, (weeklyProgress.lessonsThisWeek / Math.max(weeklyProgress.lessonsThisWeek, weeklyProgress.lessonsLastWeek, 1)) * 48)}px`,
                }}
              />
              <span className="text-[9px] text-emerald-600 font-bold">Tuần này</span>
            </div>
          </div>
        </div>
      </div>

      {/* Skills Strength Bars */}
      {skillStrengths.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h4 className="text-sm font-bold text-slate-900 mb-4">🎯 Mức độ thành thạo</h4>
          <div className="space-y-3">
            {skillStrengths.map((skill, index) => (
              <div key={skill.category}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700">{skill.category}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${labelColors[skill.label] || 'bg-slate-100 text-slate-600'}`}>
                    {skill.label}
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${barColors[index % barColors.length]} transition-all duration-700 ease-out`}
                    style={{ width: `${skill.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time Distribution */}
      {categoryDistribution.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h4 className="text-sm font-bold text-slate-900 mb-4">⏱️ Thời gian học theo chủ đề</h4>
          <div className="space-y-3">
            {categoryDistribution.slice(0, 5).map((cat, index) => (
              <div key={cat.categoryId} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-700 truncate">
                      {cat.categoryName}
                    </span>
                    <span className="text-[11px] text-slate-500 font-medium flex-shrink-0 ml-2">
                      {cat.totalTimeHours.toFixed(1)}h
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${barColors[index % barColors.length]} transition-all duration-700 ease-out`}
                      style={{ width: `${(cat.totalTimeHours / maxTime) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className="text-[10px] text-slate-400 font-bold">
                    {cat.completedCount}/{cat.courseCount}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
