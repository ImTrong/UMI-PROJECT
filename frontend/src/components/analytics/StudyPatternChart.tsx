import { StudyPatterns } from '../../services/analytics.service';

interface Props {
  patterns: StudyPatterns;
}

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const TIME_LABELS: Record<string, string> = {
  morning: '🌅 Buổi sáng (5h-12h)',
  afternoon: '☀️ Buổi chiều (12h-17h)',
  evening: '🌆 Buổi tối (17h-21h)',
  night: '🌙 Ban đêm (21h-5h)',
};

function getIntensityColor(intensity: number): string {
  if (intensity === 0) return 'bg-slate-50 border-slate-100';
  if (intensity < 0.2) return 'bg-teal-100 border-teal-200';
  if (intensity < 0.4) return 'bg-teal-200 border-teal-300';
  if (intensity < 0.6) return 'bg-teal-400 border-teal-500 text-white';
  if (intensity < 0.8) return 'bg-teal-500 border-teal-600 text-white';
  return 'bg-teal-700 border-teal-800 text-white';
}

export default function StudyPatternChart({ patterns }: Props) {
  // Build the 7x24 grid from hourlyDistribution
  const matrix: Record<string, { intensity: number; minutes: number; sessions: number }> = {};
  patterns.hourlyDistribution.forEach((h) => {
    matrix[`${h.dayOfWeek}-${h.hour}`] = {
      intensity: h.intensity,
      minutes: h.totalMinutes,
      sessions: h.sessionCount,
    };
  });

  // Display only active hour range (compress empty ranges)
  const activeHours = new Set<number>();
  patterns.hourlyDistribution.forEach((h) => {
    if (h.totalMinutes > 0) {
      activeHours.add(h.hour);
      // Also add neighbors for context
      if (h.hour > 0) activeHours.add(h.hour - 1);
      if (h.hour < 23) activeHours.add(h.hour + 1);
    }
  });

  // If no data, show common range
  const displayHours = activeHours.size > 0
    ? Array.from(activeHours).sort((a, b) => a - b)
    : Array.from({ length: 18 }, (_, i) => i + 6); // 6h-23h default

  return (
    <div className="space-y-6">
      {/* Pattern Matrix */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-1">
          🔬 Mô hình học tập theo giờ
        </h3>
        <p className="text-[11px] text-slate-400 mb-5">
          Phân tích 90 ngày qua · Ô càng đậm = học tập càng nhiều
        </p>

        {/* Matrix Grid */}
        <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          <div className="inline-block min-w-full">
            {/* Hour headers */}
            <div className="flex mb-1">
              <div className="w-10 flex-shrink-0" />
              {displayHours.map((h) => (
                <div key={h} className="w-9 flex-shrink-0 text-center text-[9px] text-slate-400 font-medium">
                  {h}h
                </div>
              ))}
            </div>

            {/* Days */}
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <div key={d} className="flex items-center mb-[3px]">
                <span className="w-10 text-[10px] text-slate-500 font-semibold flex-shrink-0">
                  {DAY_LABELS[d]}
                </span>
                {displayHours.map((h) => {
                  const cell = matrix[`${d}-${h}`] || { intensity: 0, minutes: 0, sessions: 0 };
                  return (
                    <div key={`${d}-${h}`} className="w-9 flex-shrink-0 px-[2px]">
                      <div
                        className={`h-8 rounded-lg border transition-all duration-200 hover:scale-110 hover:shadow-sm cursor-default flex items-center justify-center ${getIntensityColor(cell.intensity)}`}
                        title={`${DAY_LABELS[d]} ${h}:00 — ${cell.minutes} phút, ${cell.sessions} phiên`}
                      >
                        {cell.minutes > 0 && (
                          <span className="text-[8px] font-bold opacity-80">
                            {cell.minutes}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-50">
          <span className="text-[10px] text-slate-400">Cường độ:</span>
          <div className="flex gap-1">
            {[0, 0.1, 0.3, 0.5, 0.7, 0.9].map((v, i) => (
              <div key={i} className={`w-4 h-4 rounded-sm border ${getIntensityColor(v)}`} />
            ))}
          </div>
          <span className="text-[10px] text-slate-400">phút</span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Preferred Time */}
        <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-xl p-4 border border-teal-100">
          <p className="text-[10px] text-teal-500 font-bold uppercase tracking-wider mb-1">Thời gian ưa thích</p>
          <p className="text-sm font-bold text-teal-800">{TIME_LABELS[patterns.preferredTimeOfDay]}</p>
        </div>

        {/* Avg Daily */}
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
          <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider mb-1">Trung bình/ngày</p>
          <p className="text-sm font-bold text-emerald-800">{patterns.averageDailyMinutes} phút</p>
        </div>

        {/* Peak Hours */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100">
          <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider mb-1">Giờ vàng</p>
          <p className="text-sm font-bold text-amber-800">
            {patterns.peakHours.slice(0, 2).map((h) => h.label).join(', ') || 'Chưa đủ dữ liệu'}
          </p>
        </div>

        {/* Total Sessions */}
        <div className="bg-gradient-to-br from-rose-50 to-pink-50 rounded-xl p-4 border border-rose-100">
          <p className="text-[10px] text-rose-500 font-bold uppercase tracking-wider mb-1">Tổng phiên học</p>
          <p className="text-sm font-bold text-rose-800">{patterns.totalSessions} phiên</p>
        </div>
      </div>

      {/* Peak Hours Detail */}
      {patterns.peakHours.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
          <h4 className="text-sm font-bold text-slate-900 mb-3">⏰ Top giờ học hiệu quả nhất</h4>
          <div className="space-y-2">
            {patterns.peakHours.map((peak, idx) => (
              <div key={peak.hour} className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  idx === 0 ? 'bg-amber-100 text-amber-700' :
                  idx === 1 ? 'bg-slate-100 text-slate-600' :
                  'bg-orange-50 text-orange-500'
                }`}>
                  {idx + 1}
                </span>
                <span className="text-sm font-semibold text-slate-700 w-16">{peak.label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-700"
                    style={{ width: `${Math.min(100, (peak.avgMinutes / Math.max(patterns.peakHours[0]?.avgMinutes, 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500 font-medium w-20 text-right">{peak.avgMinutes} phút/ngày</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
