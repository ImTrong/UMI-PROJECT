import {
  FiTrendingUp,
  FiTrendingDown,
  FiMinus,
  FiZap,
  FiAlertCircle,
} from 'react-icons/fi';
import type { SkillAnalyticsData, SkillMetric, SectionStatus } from './learner-analytics.types';

interface SkillAnalyticsProps {
  data: SkillAnalyticsData | null;
  status: SectionStatus;
  onRetry?: () => void;
}

// ── Trend icon ──
function TrendIcon({ direction }: { direction: 'up' | 'down' | 'stable' }) {
  if (direction === 'up') return <FiTrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (direction === 'down') return <FiTrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <FiMinus className="w-3.5 h-3.5 text-slate-400" />;
}

// ── Mastery bar ──
function MasteryBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color =
    pct >= 80
      ? 'bg-emerald-500'
      : pct >= 60
        ? 'bg-indigo-500'
        : pct >= 40
          ? 'bg-amber-500'
          : 'bg-red-400';

  return (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Skill row ──
function SkillRow({ skill }: { skill: SkillMetric }) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors px-2 -mx-2 rounded-lg">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-semibold text-slate-700 truncate">
            {skill.name}
          </span>
          {skill.category && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded flex-shrink-0">
              {skill.category}
            </span>
          )}
        </div>
        <MasteryBar value={skill.currentMastery} />
      </div>

      <div className="text-right flex-shrink-0 w-14">
        <p className="text-sm font-bold text-slate-700">{skill.currentMastery}%</p>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0 w-16 justify-end">
        <span
          className={`text-xs font-bold ${
            skill.growth > 0
              ? 'text-emerald-600'
              : skill.growth < 0
                ? 'text-red-500'
                : 'text-slate-400'
          }`}
        >
          {skill.growth > 0 ? '+' : ''}
          {skill.growth}%
        </span>
        <TrendIcon direction={skill.trend} />
      </div>
    </div>
  );
}

// ── Completion vs Mastery ──
function CompletionVsMastery({
  completion,
  mastery,
  gap,
}: {
  completion: number;
  mastery: number;
  gap: number;
}) {
  return (
    <div className="bg-slate-50 rounded-xl p-4 mt-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">
        Hoàn thành vs Thành thạo
      </p>
      <div className="space-y-2.5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-500 w-20">Hoàn thành</span>
          <div className="flex-1 h-2.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${completion}%` }}
            />
          </div>
          <span className="text-xs font-bold text-slate-700 w-10 text-right">
            {completion}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-500 w-20">Thành thạo</span>
          <div className="flex-1 h-2.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all duration-700"
              style={{ width: `${mastery}%` }}
            />
          </div>
          <span className="text-xs font-bold text-slate-700 w-10 text-right">
            {mastery}%
          </span>
        </div>
      </div>
      {gap > 5 && (
        <p className="text-[10px] text-amber-600 font-medium mt-3 flex items-center gap-1">
          <FiAlertCircle className="w-3 h-3" />
          Khoảng cách {gap}% — Mức thành thạo thấp hơn tiến độ hoàn thành.
        </p>
      )}
    </div>
  );
}

export default function SkillAnalytics({
  data,
  status,
  onRetry,
}: SkillAnalyticsProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Phân tích kỹ năng</h2>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Mức độ thành thạo, tăng trưởng và xu hướng
          </p>
        </div>
        {status === 'ready' && data && (
          <div className="flex items-center gap-2">
            {data.confidence !== undefined && (
              <span className="text-[10px] font-medium text-slate-400">
                Độ tin cậy: {Math.round(data.confidence * 100)}%
              </span>
            )}
            <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg">
              {data.skills.length} kỹ năng
            </span>
          </div>
        )}
      </div>

      {status === 'loading' && (
        <div className="space-y-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <div className="flex-1">
                <div className="w-24 h-3.5 bg-slate-100 rounded mb-2" />
                <div className="w-full h-2 bg-slate-100 rounded-full" />
              </div>
              <div className="w-10 h-4 bg-slate-100 rounded" />
              <div className="w-12 h-4 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="text-center py-8">
          <p className="text-xs text-red-500 font-semibold mb-1">
            Không thể tải dữ liệu kỹ năng
          </p>
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
          <FiZap className="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p className="text-xs text-slate-400 font-medium">
            Chưa có dữ liệu kỹ năng. Hoàn thành quiz và project để cập nhật.
          </p>
        </div>
      )}

      {status === 'ready' && data && (
        <div>
          {/* Strengths & Improvement Areas summary */}
          {(data.strengths.length > 0 || data.improvementAreas.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
              {data.strengths.length > 0 && (
               <div className="bg-emerald-50/60 rounded-xl p-3.5 border border-emerald-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-2 flex items-center gap-1">
                    <FiZap className="w-3 h-3" /> Điểm mạnh
                  </p>
                  <div className="space-y-1">
                    {data.strengths.slice(0, 3).map((s) => (
                      <p key={s.name} className="text-xs font-semibold text-emerald-700">
                        {s.name}
                        <span className="text-emerald-500 ml-1">
                          {s.currentMastery}%{' '}
                          {s.growth > 0 && `+${s.growth}%`}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {data.improvementAreas.length > 0 && (
                <div className="bg-amber-50/60 rounded-xl p-3.5 border border-amber-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-2 flex items-center gap-1">
                    <FiAlertCircle className="w-3 h-3" /> Cần cải thiện
                  </p>
                  <div className="space-y-1">
                    {data.improvementAreas.slice(0, 3).map((s) => (
                      <p key={s.name} className="text-xs font-semibold text-amber-700">
                        {s.name}
                        <span className="text-amber-500 ml-1">
                          {s.currentMastery}%
                          {s.masteryGap !== undefined && s.masteryGap > 0 && (
                            <> (gap -{s.masteryGap}%)</>
                          )}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Skill table */}
          <div className="mb-2">
            <div className="flex items-center gap-4 px-2 py-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">
              <span className="flex-1">Kỹ năng</span>
              <span className="w-14 text-right">Mastery</span>
              <span className="w-16 text-right">Tăng trưởng</span>
            </div>
            {data.skills.map((skill) => (
              <div key={skill.name} className="group">
                <SkillRow skill={skill} />
                {skill.evidences && skill.evidences.length > 0 && (
                  <div className="hidden group-hover:block pl-2 py-2 text-[10px] text-slate-500 bg-slate-50 rounded-b-lg border border-t-0 border-slate-100 -mt-1 relative z-10 mx-[-4px] px-3">
                    <span className="font-semibold text-slate-600">Bằng chứng: </span>
                    <ul className="list-disc pl-4 mt-1 space-y-0.5">
                      {skill.evidences.slice(0, 2).map((ev, i) => (
                         <li key={i}>{ev.detail}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Completion vs Mastery */}
          {data.completionVsMastery && (
            <CompletionVsMastery {...data.completionVsMastery} />
          )}
        </div>
      )}
    </div>
  );
}
