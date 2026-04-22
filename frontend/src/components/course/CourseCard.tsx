import { Link } from 'react-router-dom';
import { FiStar, FiUsers } from 'react-icons/fi';
import { Course } from '../../services/course.service';
import { formatVND } from '../../utils/currency';

interface CourseCardProps {
  course: Course;
  showInstructor?: boolean;
}

export const CourseCard = ({ course, showInstructor = false }: CourseCardProps) => {
  const getLevelColor = (level: string) => {
    switch (level) {
      case 'BEGINNER':
        return 'bg-green-100 text-green-700';
      case 'INTERMEDIATE':
        return 'bg-yellow-100 text-yellow-700';
      case 'ADVANCED':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <Link to={`/courses/${course.slug}`} className="block group">
      <div className="card hover:shadow-lg transition-shadow duration-300">
        {/* Thumbnail */}
        <div className="relative h-48 bg-gray-200 rounded-lg overflow-hidden mb-4">
          {course.thumbnail ? (
            <img
              src={course.thumbnail}
              alt={course.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              Không có ảnh
            </div>
          )}
          {!course.published && (
            <span className="absolute top-2 right-2 bg-yellow-500 text-white text-xs px-2 py-1 rounded">
              Bản nháp
            </span>
          )}
        </div>

        {/* Content */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={`text-xs px-2 py-1 rounded-full ${getLevelColor(course.level)}`}>
              {course.level === 'BEGINNER' ? 'Cơ bản' : 
               course.level === 'INTERMEDIATE' ? 'Trung bình' : 'Nâng cao'}
            </span>
            <span className="text-lg font-bold text-primary-600">
              {formatVND(course.price)}
            </span>
          </div>

          <h3 className="font-semibold text-lg line-clamp-2 group-hover:text-primary-600 transition">
            {course.title}
          </h3>

          <p className="text-gray-600 text-sm line-clamp-2">
            {course.description}
          </p>

          <div className="flex items-center space-x-4 text-sm text-gray-500">
            <div className="flex items-center">
              <FiStar className="mr-1 text-yellow-400" />
              <span>{course.rating.toFixed(1)}</span>
              <span className="ml-1">({course.totalReviews})</span>
            </div>
            <div className="flex items-center">
              <FiUsers className="mr-1" />
              <span>{course.enrolledCount} học viên</span>
            </div>
          </div>

          {showInstructor && course.instructorId && (
            <p className="text-sm text-gray-500">
              Giảng viên: {course.instructorId}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
};
