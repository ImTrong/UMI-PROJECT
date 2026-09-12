import {
  FiCheck,
  FiBookOpen,
  FiFileText,
  FiAward,
  FiZap,
  FiTrendingUp,
  FiTrendingDown,
  FiMinus,
  FiRepeat,
  FiFlag,
  FiAlertTriangle,
  FiMapPin,
} from 'react-icons/fi';
import type { TimelineMilestone, SectionStatus } from './learner-analytics.types';

interface LearningTimelineProps {
  milestones: TimelineMilestone[];
  status: SectionStatus;
  onRetry?: () => void;
}

// ── Icon by milestone type ──
const MILESTONE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LEARNING_PATH_ENROLLED: FiFlag,
  COURSE_STARTED: FiBookOpen,
  LESSON_COMPLETED: FiCheck,
  LESSON_REVISITED: FiRepeat,
  QUIZ_SUBMITTED: FiFileText,
  QUIZ_PASSED: FiCheck,
  QUIZ_FAILED: FiAlertTriangle,
  PROJECT_SUBMITTED: FiFileText,
  PROJECT_EVALUATED: FiAward,
  SKILL_UPDATED: FiZap,
  CERTIFICATE_ISSUED: FiAward,
};

// ── Status badge colors ──
const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  revisited: 'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_LABELS: Record<string, string> = {
  completed: 'Hoàn thành',
  in_progress: 'Đang thực hiện',
  failed: 'Chưa đạt',
  revisited: 'Ôn lại',
};

// ── Stage color ──
const STAGE_COLORS: Record<string, string> = {
  GETTING_STARTED: 'from-slate-400 to-slate-500',
  FOUNDATION: 'from-blue-400 to-blue-600',
  DEVELOPMENT: 'from-indigo-400 to-indigo-600',
  APPLICATION: 'from-purple-400 to-purple-600',
  FINAL_PROJECT: 'from-violet-500 to-violet-700',
  ASSESSMENT: 'from-amber-400 to-amber-600',
  MASTERY: 'from-emerald-400 to-emerald-600',
};

// ── Milestone Card ──
function MilestoneCard({ milestone }: { milestone: TimelineMilestone }) {
  const Icon = MILESTONE_ICONS[milestone.type] || FiMapPin;
  const stageGradient = STAGE_COLORS[milestone.stage] || 'from-slate-400 to-slate-500';
  const statusStyle = STATUS_STYLES[milestone.status ?? 'completed'];
  const statusLabel = STATUS_LABELS[milestone.status ?? 'completed'];

  const insightIcon =
    milestone.insightDirection === 'up' ? (
      <FiTrendingUp className="w-3.5 h-3.5 text-emerald-600" />
    ) : milestone.insightDirection === 'down' ? (
      <FiTrendingDown className="w-3.5 h-3.5 text-red-500" />
    ) : (
      <FiMinus className="w-3.5 h-3.5 text-slate-400" />
    );

  return (
    <div className="relative pl-10 pb-8 last:pb-0 group">
      {/* Timeline connector line */}
      <div className="absolute left-[15px] top-10 bottom-0 w-[2px] bg-slate-100 group-last:hidden" />

      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-1 w-8 h-8 rounded-xl bg-gradient-to-br ${stageGradient} flex items-center justify-center shadow-sm`}
      >
        <Icon className="w-4 h-4 text-white" />
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 hover:shadow-md hover:border-slate-200 transition-all duration-300">
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {milestone.stageLabel}
            </span>
            <h4 className="text-sm font-bold text-slate-800 mt-0.5">
              {milestone.title}
            </h4>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {milestone.status && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${statusStyle}`}
              >
                {statusLabel}
              </span>
            )}
            <span className="text-[10px] text-slate-400 font-medium">
              {milestone.date}
            </span>
          </div>
        </div>

        {/* Metrics row */}
        <div className="flex flex-wrap gap-4 text-xs">
          {milestone.completion !== undefined && (
            <div>
              <span className="text-slate-400 font-medium">Hoàn thành</span>
              <p className="font-bold text-slate-700">{milestone.completion}%</p>
            </div>
          )}
          {milestone.assessment !== undefined && (
            <div>
              <span className="text-slate-400 font-medium">Đánh giá</span>
              <p className="font-bold text-slate-700">{milestone.assessment}%</p>
            </div>
          )}
          {milestone.skillGrowth !== undefined && (
            <div>
              <span className="text-slate-400 font-medium">Kỹ năng</span>
              <p
                className={`font-bold ${
                  milestone.skillGrowth > 0
                    ? 'text-emerald-600'
                    : milestone.skillGrowth < 0
                      ? 'text-red-500'
                      : 'text-slate-500'
                }`}
              >
                {milestone.skillGrowth > 0 ? '+' : ''}
                {milestone.skillGrowth}%
              </p>
            </div>
          )}
        </div>

        {/* Insight */}
        {milestone.insight && (
          <div className="mt-3 pt-3 border-t border-slate-50 flex items-center gap-1.5">
            {insightIcon}
            <span className="text-xs font-medium text-slate-500">
              {milestone.insight}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Loading Skeleton ──
function TimelineSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="relative pl-10 pb-8 last:pb-0">
          <div className="absolute left-[15px] top-10 bottom-0 w-[2px] bg-slate-100 last:hidden" />
          <div className="absolute left-0 top-1 w-8 h-8 rounded-xl bg-slate-100 animate-pulse" />
          <div className="bg-white rounded-2xl border border-slate-100 p-5 animate-pulse">
            <div className="flex justify-between mb-3">
              <div>
                <div className="w-20 h-3 bg-slate-100 rounded mb-2" />
                <div className="w-40 h-4 bg-slate-100 rounded" />
              </div>
              <div className="w-16 h-5 bg-slate-100 rounded-lg" />
            </div>
            <div className="flex gap-4">
              <div className="w-16 h-8 bg-slate-50 rounded" />
              <div className="w-16 h-8 bg-slate-50 rounded" />
              <div className="w-16 h-8 bg-slate-50 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty State ──
function TimelineEmpty() {
  return (
    <div className="text-center py-12">
      <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <FiMapPin className="w-6 h-6 text-slate-300" />
      </div>
      <p className="text-sm font-semibold text-slate-500 mb-1">
        Hành trình học tập của bạn sẽ hiển thị ở đây
      </p>
      <p className="text-xs text-slate-400">
        Bắt đầu học để tạo các milestone trên timeline.
      </p>
    </div>
  );
}

// ── Main Component ──
export default function LearningTimeline({
  milestones,
  status,
  onRetry,
}: LearningTimelineProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Hành trình học tập</h2>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Các milestone quan trọng trong quá trình học
          </p>
        </div>
        {status === 'ready' && milestones.length > 0 && (
          <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg">
            {milestones.length} milestone
          </span>
        )}
      </div>

      {status === 'loading' && <TimelineSkeleton />}
      {status === 'error' && (
        <div className="text-center py-8">
          <p className="text-sm text-red-600 font-semibold mb-2">
            Không thể tải timeline
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
      )}
      {status === 'empty' && <TimelineEmpty />}
      {status === 'ready' && milestones.length === 0 && <TimelineEmpty />}
      {status === 'ready' && milestones.length > 0 && (
        <div>
          {milestones.map((milestone) => (
            <MilestoneCard key={milestone.id} milestone={milestone} />
          ))}
        </div>
      )}
    </div>
  );
}
