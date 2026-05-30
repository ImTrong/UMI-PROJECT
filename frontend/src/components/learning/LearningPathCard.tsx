import { Link } from 'react-router-dom';
import { FiArrowRight, FiClock, FiCheckCircle, FiPlay } from 'react-icons/fi';
import { EnrolledPathSummary } from '../../services/recommendation.service';

interface Props {
  path: EnrolledPathSummary;
  onSelect: (pathId: string) => void;
}

const difficultyConfig: Record<string, { label: string; color: string }> = {
  BEGINNER: { label: 'Cơ bản', color: 'bg-emerald-100 text-emerald-700' },
  INTERMEDIATE: { label: 'Trung cấp', color: 'bg-amber-100 text-amber-700' },
  ADVANCED: { label: 'Nâng cao', color: 'bg-rose-100 text-rose-700' },
  ALL: { label: 'Tất cả', color: 'bg-slate-100 text-slate-600' },
};

export default function LearningPathCard({ path, onSelect }: Props) {
  const isCompleted = path.status === 'COMPLETED';
  const circumference = 2 * Math.PI * 38;
  const offset = circumference - (path.progressPercentage / 100) * circumference;
  const diff = difficultyConfig[path.pathDifficulty] || difficultyConfig.ALL;

  const timeSinceLastActivity = () => {
    if (!path.lastActivityAt) return 'Chưa có hoạt động';
    const days = Math.floor(
      (Date.now() - new Date(path.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (days === 0) return 'Hôm nay';
    if (days === 1) return 'Hôm qua';
    return `${days} ngày trước`;
  };

  // Unique gradient ID to avoid SVG conflicts when multiple cards render
  const gradientId = `progressGrad-${path.pathId}`;

  return (
    <div
      className={`group relative rounded-2xl border p-5 transition-all duration-300 hover:shadow-sm cursor-pointer ${
        isCompleted
          ? 'bg-gradient-to-br from-emerald-50/50 to-teal-50/30 border-emerald-200/60'
          : 'bg-white border-slate-100 hover:border-emerald-200'
      }`}
      onClick={() => onSelect(path.pathId)}
    >
      {/* Completed Badge */}
      {isCompleted && (
        <div className="absolute -top-2.5 -right-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-[10px] font-extrabold px-3 py-1 rounded-full shadow-sm z-10">
          🎉 Hoàn thành!
        </div>
      )}

      <div className="flex items-start gap-4">
        {/* Left side: Image or Circular Progress */}
        <div className="relative flex-shrink-0">
          {path.pathImageUrl ? (
            <div className="relative w-[88px] h-[88px] rounded-xl overflow-hidden">
              <img
                src={path.pathImageUrl}
                alt={path.pathTitle}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {/* Progress overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-1.5 left-1.5 right-1.5">
                <div className="w-full bg-white/30 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-700 ${
                      isCompleted
                        ? 'bg-emerald-400'
                        : 'bg-gradient-to-r from-emerald-400 to-teal-400'
                    }`}
                    style={{ width: `${path.progressPercentage}%` }}
                  />
                </div>
                <span className="text-[9px] text-white font-bold mt-0.5 block text-center">
                  {path.progressPercentage}%
                </span>
              </div>
            </div>
          ) : (
            <div className="w-[88px] h-[88px]">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 88 88">
                <circle
                  cx="44" cy="44" r="38"
                  stroke="currentColor" strokeWidth="5" fill="none"
                  className="text-slate-100"
                />
                <circle
                  cx="44" cy="44" r="38"
                  stroke={`url(#${gradientId})`}
                  strokeWidth="5" fill="none"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  className="transition-all duration-700 ease-out"
                />
                <defs>
                  <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={isCompleted ? '#10b981' : '#6366f1'} />
                    <stop offset="100%" stopColor={isCompleted ? '#14b8a6' : '#8b5cf6'} />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-lg font-black ${isCompleted ? 'text-emerald-600' : 'text-emerald-600'}`}>
                  {path.progressPercentage}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-slate-900 text-sm leading-snug group-hover:text-emerald-600 transition-colors truncate">
            {path.pathTitle}
          </h4>

          {/* Description preview */}
          {path.pathDescription && (
            <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
              {path.pathDescription}
            </p>
          )}

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {path.pathCategory && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-600">
                {path.pathCategory}
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${diff.color}`}>
              {diff.label}
            </span>
          </div>

          {/* Milestone Stats */}
          <div className="flex items-center gap-3 mt-2.5 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <FiCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
              <span className="font-semibold">{path.completedCourses}/{path.totalCourses}</span> chặng
            </span>
            <span className="flex items-center gap-1">
              <FiClock className="w-3.5 h-3.5" />
              {timeSinceLastActivity()}
            </span>
          </div>

          {/* Next Milestone */}
          {path.nextMilestone && !isCompleted && (
            <div className="mt-3 p-2.5 bg-emerald-50/50 rounded-xl border border-emerald-100/50">
              <p className="text-[11px] text-emerald-400 font-bold mb-1">CHẶNG TIẾP THEO</p>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-800 truncate pr-2">
                  {path.nextMilestone.courseTitle}
                </p>
                <Link
                  to={`/learning/${path.nextMilestone.courseId}`}
                  className="flex-shrink-0 flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:text-emerald-700 transition"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FiPlay className="w-3 h-3" />
                  Học ngay
                </Link>
              </div>
              {path.nextMilestone.progressPercentage > 0 && (
                <div className="w-full bg-emerald-100 rounded-full h-1 mt-2">
                  <div
                    className="h-1 bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${path.nextMilestone.progressPercentage}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Arrow */}
        <FiArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
      </div>
    </div>
  );
}
