import { Link } from 'react-router-dom';
import { FiPlay, FiClock } from 'react-icons/fi';
import { RecommendedCourse } from '../../services/recommendation.service';

interface ContinueLearningCardProps {
  course: RecommendedCourse;
}

export const ContinueLearningCard = ({ course }: ContinueLearningCardProps) => {
  const progress = Math.round(course.progressPercentage || 0);
  const remaining = (course.totalLessons || 0) - (course.completedLessons || 0);

  // Format last accessed
  const getLastAccessed = () => {
    if (!course.lastAccessedAt) return '';
    const diff = Date.now() - new Date(course.lastAccessedAt).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Vừa xong';
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Hôm qua';
    if (days < 7) return `${days} ngày trước`;
    return `${Math.floor(days / 7)} tuần trước`;
  };

  return (
    <Link to={`/courses/${course.slug}`} className="block group h-full">
      <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-100 overflow-hidden hover:border-emerald-200 hover:shadow-md hover:-translate-y-1 transition-all duration-300">
        {/* Thumbnail with play overlay */}
        <div className="relative h-40 bg-slate-100 overflow-hidden shrink-0">
          {course.thumbnail ? (
            <img
              src={course.thumbnail}
              alt={course.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50">
              <span className="text-4xl">📚</span>
            </div>
          )}
          {/* Play Button Overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform scale-75 group-hover:scale-100 shadow-lg">
              <FiPlay className="w-5 h-5 text-emerald-600 ml-0.5" />
            </div>
          </div>
          {/* Category Badge */}
          {course.category && (
            <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm text-[10px] font-bold px-2.5 py-1 rounded-full text-slate-700 shadow-sm">
              {course.category.name}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 p-4">
          <h3 className="font-bold text-sm text-slate-900 line-clamp-2 group-hover:text-emerald-600 transition-colors mb-2 leading-snug">
            {course.title}
          </h3>

          {/* Progress Info */}
          <div className="mt-auto space-y-3">
            {/* Progress Bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-slate-700">{progress}% hoàn thành</span>
                <span className="text-slate-400">
                  {course.completedLessons}/{course.totalLessons} bài
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progress}%`,
                    background: progress >= 80
                      ? 'linear-gradient(to right, #10b981, #059669)'
                      : progress >= 40
                      ? 'linear-gradient(to right, #f59e0b, #d97706)'
                      : 'linear-gradient(to right, #6366f1, #4f46e5)',
                  }}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <FiClock className="w-3 h-3" />
                <span>{getLastAccessed()}</span>
              </div>
              <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                {remaining > 0 ? `Còn ${remaining} bài` : 'Sắp xong!'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
};
