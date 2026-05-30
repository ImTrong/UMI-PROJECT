import { useState } from 'react';
import { HeatmapDay } from '../../services/analytics.service';
import { FiCalendar } from 'react-icons/fi';

interface Props {
  data: HeatmapDay[];
  year?: number;
}

const MONTHS = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

const intensityColors = [
  'bg-slate-100 dark:bg-slate-800',              // 0 - no activity
  'bg-emerald-200 dark:bg-emerald-900',           // 1 - light
  'bg-emerald-400 dark:bg-emerald-700',           // 2 - moderate
  'bg-emerald-500 dark:bg-emerald-500',           // 3 - high
  'bg-emerald-700 dark:bg-emerald-400',           // 4 - very high
];

export default function StudyHeatmap({ data, year }: Props) {
  const [hoveredDay, setHoveredDay] = useState<HeatmapDay | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const currentYear = year || new Date().getFullYear();

  // Build a map for quick lookup
  const dayMap: Record<string, HeatmapDay> = {};
  data.forEach((d) => {
    dayMap[d.date] = d;
  });

  // Generate weeks grid
  const startDate = new Date(currentYear, 0, 1);
  const startDay = startDate.getDay(); // 0=Sun

  const weeks: (HeatmapDay | null)[][] = [];
  let currentWeek: (HeatmapDay | null)[] = [];

  // Pad first week with nulls
  for (let i = 0; i < startDay; i++) {
    currentWeek.push(null);
  }

  const today = new Date();
  const endDate = new Date(currentYear, 11, 31);
  const iterEnd = endDate < today ? endDate : today;

  const current = new Date(startDate);
  while (current <= iterEnd) {
    const dateKey = current.toISOString().split('T')[0];
    const dayData = dayMap[dateKey] || { date: dateKey, totalMinutes: 0, lessonsCompleted: 0, intensity: 0 };
    currentWeek.push(dayData);

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    current.setDate(current.getDate() + 1);
  }

  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  // Calculate total stats
  const totalDays = data.filter((d) => d.totalMinutes > 0).length;
  const totalMinutes = data.reduce((sum, d) => sum + d.totalMinutes, 0);
  const totalLessons = data.reduce((sum, d) => sum + d.lessonsCompleted, 0);

  const handleMouseEnter = (day: HeatmapDay, e: React.MouseEvent) => {
    setHoveredDay(day);
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FiCalendar className="inline mr-1" /> Lịch sử học tập {currentYear}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {totalDays} ngày hoạt động · {Math.round(totalMinutes / 60)} giờ · {totalLessons} bài học
          </p>
        </div>
      </div>

      {/* Heatmap container */}
      <div className="overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
        <div className="inline-block min-w-full">
          {/* Month labels */}
          <div className="flex mb-1 ml-[30px] relative h-4">
            {MONTHS.map((month, i) => {
              // Calculate approximate position
              const weekIdx = Math.floor((i * weeks.length) / 12);
              return (
                <span
                  key={month}
                  className="text-[10px] text-slate-400 font-medium absolute"
                  style={{ left: `${weekIdx * 16}px` }}
                >
                  {month}
                </span>
              );
            })}
          </div>

          {/* Heatmap grid */}
          <div className="flex gap-[3px]">
            {/* Day labels */}
            <div className="flex flex-col gap-[3px] w-6 mr-1 flex-shrink-0 text-right pr-1">
              {DAYS.map((day, i) => (
                <div
                  key={day}
                  className="h-[13px] flex items-center justify-end text-[9px] text-slate-400 font-medium leading-none"
                  style={{ visibility: i % 2 === 1 ? 'visible' : 'hidden' }}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Weeks */}
            {weeks.map((week, weekIdx) => (
              <div key={weekIdx} className="flex flex-col gap-[3px] flex-shrink-0">
                {week.map((day, dayIdx) => {
                  if (!day) {
                    return <div key={dayIdx} className="w-[13px] h-[13px]" />;
                  }

                  return (
                    <div
                      key={day.date}
                      className={`w-[13px] h-[13px] rounded-[3px] cursor-pointer transition-all duration-150 hover:ring-2 hover:ring-emerald-400 hover:ring-offset-1 ${intensityColors[day.intensity]}`}
                      onMouseEnter={(e) => handleMouseEnter(day, e)}
                      onMouseLeave={() => setHoveredDay(null)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400 font-medium">Ít</span>
          {intensityColors.map((color, i) => (
            <div key={i} className={`w-[13px] h-[13px] rounded-[3px] ${color}`} />
          ))}
          <span className="text-[10px] text-slate-400 font-medium">Nhiều</span>
        </div>
      </div>

      {/* Tooltip */}
      {hoveredDay && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-xl shadow-sm whitespace-nowrap">
            <p className="font-bold">
              {new Date(hoveredDay.date).toLocaleDateString('vi-VN', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <p className="text-slate-300 mt-0.5">
              {hoveredDay.totalMinutes > 0
                ? `${hoveredDay.totalMinutes} phút · ${hoveredDay.lessonsCompleted} bài`
                : 'Không hoạt động'}
            </p>
            <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45" />
          </div>
        </div>
      )}
    </div>
  );
}
