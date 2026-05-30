import { WeeklyReport } from '../../services/analytics.service';
import { FiTrendingUp, FiTrendingDown, FiMinus, FiAward } from 'react-icons/fi';

interface Props {
  report: WeeklyReport;
}

function TrendIcon({ value }: { value: number }) {
  if (value > 5) return <FiTrendingUp className="w-4 h-4 text-emerald-500" />;
  if (value < -5) return <FiTrendingDown className="w-4 h-4 text-rose-500" />;
  return <FiMinus className="w-4 h-4 text-slate-400" />;
}

function TrendBadge({ value, label }: { value: number; label: string }) {
  const isUp = value > 5;
  const isDown = value < -5;
  return (
    <div className="flex items-center gap-1.5">
      <TrendIcon value={value} />
      <span className={`text-xs font-bold ${isUp ? 'text-emerald-600' : isDown ? 'text-rose-600' : 'text-slate-500'}`}>
        {isUp ? '+' : ''}{value}%
      </span>
      <span className="text-[10px] text-slate-400">{label}</span>
    </div>
  );
}

export default function WeeklyReportCard({ report }: Props) {
  const { thisWeek, trends, dailyBreakdown, achievements } = report;
  const maxDailyMinutes = Math.max(...dailyBreakdown.map((d) => d.minutes), 1);

  const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  return (
    <div className="space-y-4">
      {/* Main Report Card */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            📊 Báo cáo tuần
          </h3>
          <span className="text-[10px] text-slate-400 font-medium">
            {report.period.start ? new Date(report.period.start).toLocaleDateString('vi-VN') : ''} —{' '}
            {report.period.end ? new Date(report.period.end).toLocaleDateString('vi-VN') : ''}
          </span>
        </div>

        {/* Stats Comparison */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="text-center">
            <p className="text-2xl font-black text-slate-900">{thisWeek.totalMinutes}</p>
            <p className="text-[10px] text-slate-500 font-medium">phút học</p>
            <div className="mt-1">
              <TrendBadge value={trends.studyTimeChange} label="vs tuần trước" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-slate-900">{thisWeek.lessonsCompleted}</p>
            <p className="text-[10px] text-slate-500 font-medium">bài hoàn thành</p>
            <div className="mt-1">
              <TrendBadge value={trends.lessonsChange} label="vs tuần trước" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-slate-900">{thisWeek.activeDays}/7</p>
            <p className="text-[10px] text-slate-500 font-medium">ngày hoạt động</p>
            <div className="mt-1">
              <TrendBadge value={trends.consistencyChange} label="vs tuần trước" />
            </div>
          </div>
        </div>

        {/* Daily Activity Bars */}
        <div className="mb-4">
          <h4 className="text-xs font-bold text-slate-700 mb-3">Hoạt động theo ngày</h4>
          <div className="flex items-end gap-2 h-24">
            {dailyBreakdown.map((day, idx) => {
              const heightPercent = (day.minutes / maxDailyMinutes) * 100;
              const isToday = new Date(day.date).toDateString() === new Date().toDateString();

              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-slate-400 font-bold">{day.minutes > 0 ? `${day.minutes}m` : ''}</span>
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t-md transition-all duration-500 ${
                        isToday
                          ? 'bg-gradient-to-t from-emerald-600 to-emerald-400'
                          : day.minutes > 0
                            ? 'bg-gradient-to-t from-slate-300 to-slate-200'
                            : 'bg-slate-100'
                      }`}
                      style={{ height: `${Math.max(heightPercent, 4)}%` }}
                    />
                  </div>
                  <span className={`text-[9px] font-bold ${isToday ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {dayLabels[idx] || ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Comparison Row */}
        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-50">
          <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
            <span className="text-[10px] text-slate-500 font-medium">Quiz hoàn thành</span>
            <span className="text-sm font-bold text-slate-900">{thisWeek.quizzesTaken}</span>
          </div>
          <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
            <span className="text-[10px] text-slate-500 font-medium">Khóa học truy cập</span>
            <span className="text-sm font-bold text-slate-900">{thisWeek.coursesProgressed}</span>
          </div>
        </div>
      </div>

      {/* Achievements */}
      {achievements.length > 0 && (
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-100 p-5 shadow-sm">
          <h4 className="text-sm font-bold text-amber-800 flex items-center gap-2 mb-3">
            <FiAward className="text-amber-500" />
            Thành tựu tuần này
          </h4>
          <div className="space-y-2">
            {achievements.map((achievement, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-white/60 rounded-xl px-3 py-2">
                <span className="text-sm">{achievement}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
