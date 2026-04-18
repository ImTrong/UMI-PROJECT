import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { learningService, CourseProgress } from '../services/learning.service';
import { courseService, Course } from '../services/course.service';
import { useAuth } from '../hooks/useAuth';
import { FiBookOpen, FiClock, FiStar, FiPlayCircle, FiCheckCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

interface EnrichedCourse extends CourseProgress {
  details?: Course;
}

export default function PurchasedCourses() {
  const { isAuthenticated } = useAuth();
  const [courses, setCourses] = useState<EnrichedCourse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadPurchasedCourses();
  }, [isAuthenticated]);

  const loadPurchasedCourses = async () => {
    setLoading(true);
    try {
      // 1. Fetch user's enrolled courses (purchases)
      const progressData = await learningService.getEnrolledCourses(1, 100);
      const enrolledCourses: CourseProgress[] = progressData.courses;

      if (enrolledCourses.length === 0) {
        setCourses([]);
        setLoading(false);
        return;
      }

      // 2. Extract IDs and fetch detailed data
      const courseIds = enrolledCourses.map((c) => c.courseId);
      const detailedCourses = await courseService.getBatchCourses(courseIds);

      // 3. Map details into the enriched array
      const enriched: EnrichedCourse[] = enrolledCourses.map((progress) => {
        const details = detailedCourses.find((c) => c.id === progress.courseId);
        return {
          ...progress,
          details,
        };
      });

      setCourses(enriched);
    } catch (error) {
      console.error('Failed to load purchased courses:', error);
      toast.error('Không thể tải dữ liệu khóa học');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[500px]">
        <div className="relative w-16 h-16">
          <div className="absolute top-0 left-0 w-full h-full border-4 border-primary-200 rounded-full animate-ping"></div>
          <div className="absolute top-0 left-0 w-full h-full border-4 border-primary-600 rounded-full border-t-transparent animate-spin"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 pt-8 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header Section with Glassmorphism */}
        <div className="relative mb-12 p-8 rounded-3xl overflow-hidden bg-gradient-to-br from-primary-900 to-primary-700 shadow-xl overflow-hidden group">
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-white/10 blur-3xl group-hover:scale-150 transition-transform duration-1000"></div>
          <div className="absolute bottom-0 left-10 -mb-20 w-48 h-48 rounded-full bg-primary-400/20 blur-2xl group-hover:scale-150 transition-transform duration-1000"></div>
          
          <div className="relative z-10">
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Khóa học đã mua</h1>
            <p className="text-primary-100 text-lg max-w-2xl font-medium">
              Bạn đang sở hữu {courses.length} khóa học. Khám phá kho tàng tri thức của bạn và tiếp tục chinh phục những kiến thức mới!
            </p>
          </div>
        </div>

        {courses.length === 0 ? (
          <div className="bg-white rounded-3xl p-16 text-center shadow-sm border border-gray-100">
            <div className="w-24 h-24 bg-primary-50 text-primary-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <FiBookOpen className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Thư viện của bạn đang trống</h2>
            <p className="text-gray-500 mb-8 max-w-md mx-auto">Bạn chưa đăng ký khóa học nào. Hãy khám phá và mua khóa học để bắt đầu hành trình học tập.</p>
            <Link 
              to="/courses" 
              className="inline-flex items-center justify-center px-8 py-3.5 text-base font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 shadow-lg shadow-primary-600/30 transition-all hover:-translate-y-0.5"
            >
              Khám phá khóa học ngay
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {courses.map((course) => {
              const isCompleted = course.progressPercentage === 100;
              
              return (
                <Link
                  key={course.courseId}
                  to={`/learning/${course.courseId}`}
                  className="group relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-300 border border-gray-100 flex flex-col hover:-translate-y-1"
                >
                  {/* Thumbnail Container */}
                  <div className="relative h-48 overflow-hidden bg-gray-100">
                    {course.details?.thumbnail ? (
                      <img
                        src={course.details.thumbnail}
                        alt={course.courseTitle}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-in-out"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 bg-gradient-to-br from-gray-50 to-gray-100">
                        <FiBookOpen size={48} className="mb-2 opacity-50" />
                        <span className="text-sm font-medium">Chưa có ảnh</span>
                      </div>
                    )}
                    
                    {/* Overlay with subtle dark gradient for text readability */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60"></div>
                    
                    {/* Play Overlay effect on hover */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/20 transition-opacity duration-300">
                      <div className="bg-white/90 p-4 rounded-full shadow-xl transform scale-75 group-hover:scale-100 transition-all duration-300">
                        <FiPlayCircle className="w-8 h-8 text-primary-600" />
                      </div>
                    </div>
                    
                    {/* Category Label */}
                    {course.details?.category?.name && (
                      <div className="absolute top-4 border border-white/20 left-4 bg-white/20 backdrop-blur-md text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm">
                        {course.details.category.name}
                      </div>
                    )}
                  </div>

                  {/* Content Area */}
                  <div className="p-5 flex flex-col flex-grow">
                    <h3 className="font-bold text-gray-900 leading-tight mb-2 line-clamp-2 min-h-[2.5rem] group-hover:text-primary-600 transition-colors">
                      {course.courseTitle}
                    </h3>
                    
                    {/* Rating & meta info */}
                    <div className="flex items-center text-xs text-gray-500 mb-4 space-x-3">
                      {course.details?.rating !== undefined && (
                        <div className="flex items-center">
                          <FiStar className="text-yellow-400 fill-current mr-1 w-3.5 h-3.5" />
                          <span className="font-medium">{course.details.rating.toFixed(1)}</span>
                        </div>
                      )}
                      {course.details?.instructorId && (
                        <div className="px-1.5 border-l border-gray-200">
                          {course.details.instructorId}
                        </div>
                      )}
                    </div>

                    <div className="mt-auto">
                      {/* Progress Stats */}
                      <div className="flex items-center justify-between text-xs font-medium mb-2">
                        <span className={isCompleted ? "text-green-600 flex items-center" : "text-gray-500"}>
                          {isCompleted ? (
                            <><FiCheckCircle className="inline mr-1"/> Hoàn thành</>
                          ) : (
                            'Tiến độ học tập'
                          )}
                        </span>
                        <span className={isCompleted ? "text-green-600" : "text-primary-600 font-bold"}>
                          {Math.round(course.progressPercentage)}%
                        </span>
                      </div>
                      
                      {/* Premium Progress Bar */}
                      <div className="relative w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ease-out ${
                            isCompleted ? 'bg-gradient-to-r from-green-400 to-green-500' : 'bg-gradient-to-r from-primary-400 to-primary-600'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, course.progressPercentage))}%` }}
                        />
                      </div>
                      
                      {/* Bottom Meta */}
                      <div className="flex items-center justify-between mt-4 text-[11px] text-gray-400 font-medium uppercase tracking-wide">
                        <div className="flex items-center">
                          <FiPlayCircle className="mr-1 w-3.5 h-3.5" />
                          <span>{course.completedLessons}/{course.totalLessons} bài</span>
                        </div>
                        <div className="flex items-center">
                          <FiClock className="mr-1 w-3.5 h-3.5" />
                          <span>{Math.floor(course.timeSpentSeconds / 60)} phút</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
