import { Link } from 'react-router-dom';
import { FiStar, FiUsers } from 'react-icons/fi';
import { Course } from '../../services/course.service';
import { formatVND } from '../../utils/currency';

interface CourseCardProps {
  course: Course;
  showInstructor?: boolean;
}

export const CourseCard = ({ course, showInstructor = false }: CourseCardProps) => {
  const getLevelStyle = (level: string) => {
    switch (level) {
      case 'BEGINNER':
        return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'INTERMEDIATE':
        return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'ADVANCED':
        return 'bg-rose-50 text-rose-700 border-rose-100';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-100';
    }
  };

  return (
    <Link to={`/courses/${course.slug}`} className="block group h-full">
      <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-100 overflow-hidden hover:border-emerald-200 hover:shadow-sm hover:-translate-y-1 transition-all duration-300">
        {/* Thumbnail */}
        <div className="relative h-48 bg-slate-100 overflow-hidden shrink-0">
          {course.thumbnail ? (
            <img
              src={course.thumbnail}
              alt={course.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300 font-medium text-sm">
              Không có ảnh
            </div>
          )}
          {!course.published && (
            <span className="absolute top-3 left-3 bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-sm">
              BẢN NHÁP
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${getLevelStyle(course.level)}`}>
              {course.level === 'BEGINNER' ? 'CƠ BẢN' : 
               course.level === 'INTERMEDIATE' ? 'TRUNG BÌNH' : 'NÂNG CAO'}
            </span>
            <span className="text-sm font-extrabold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full shrink-0">
              {formatVND(course.price)}
            </span>
          </div>

          <h3 className="font-bold text-base text-slate-900 line-clamp-2 group-hover:text-emerald-600 transition-colors mb-2 leading-snug">
            {course.title}
          </h3>

          <p className="text-slate-500 text-xs line-clamp-2 mb-4 leading-relaxed flex-1">
            {course.description}
          </p>

          <div className="pt-4 border-t border-slate-100 mt-auto flex items-center justify-between text-xs text-slate-500 font-medium">
            <div className="flex items-center gap-1.5">
              <FiStar className="text-amber-400 fill-amber-400 w-3.5 h-3.5" />
              <span className="font-bold text-slate-700">{course.rating.toFixed(1)}</span>
              <span className="text-slate-400">({course.totalReviews})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <FiUsers className="w-3.5 h-3.5" />
              <span>{course.enrolledCount} học viên</span>
            </div>
          </div>

          {showInstructor && course.instructorId && (
            <div className="mt-3 pt-3 border-t border-slate-50">
              <p className="text-[11px] text-slate-400 font-medium truncate">
                Giảng viên: <span className="text-slate-600">{course.instructorId}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
};
