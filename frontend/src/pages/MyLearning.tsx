import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { learningService, CourseProgress } from '../services/learning.service';
import { courseService, Course } from '../services/course.service';
import { useAuth } from '../hooks/useAuth';
import { FiBookOpen, FiCheckCircle, FiClock, FiTrendingUp, FiPlayCircle, FiRefreshCw, FiBook, FiAward } from 'react-icons/fi';
import toast from 'react-hot-toast';

interface EnrichedCourse extends CourseProgress {
  details?: Course;
}

export default function MyLearning() {
  const { isAuthenticated } = useAuth();
  const [courses, setCourses] = useState<EnrichedCourse[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'in-progress' | 'completed'>('all');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadData();
    window.scrollTo(0, 0);
  }, [isAuthenticated, filter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [progressData, statsData] = await Promise.all([
        learningService.getEnrolledCourses(1, 100, filter === 'all' ? undefined : filter),
        learningService.getLearningStats(),
      ]);
      
      const enrolledCourses: CourseProgress[] = progressData.courses;
      
      if (enrolledCourses.length > 0) {
        // Fetch detailed data for thumbnails
        const courseIds = enrolledCourses.map((c) => c.courseId);
        const detailedCourses = await courseService.getBatchCourses(courseIds);
  
        // Map details
        const enriched: EnrichedCourse[] = enrolledCourses.map((progress) => {
          const details = detailedCourses.find((c) => c.id === progress.courseId);
          return {
            ...progress,
            details,
          };
        });
        setCourses(enriched);
      } else {
        setCourses([]);
      }
      
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load learning data:', error);
      toast.error('Không thể tải dữ liệu tiến độ học tập');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await learningService.syncEnrollments();
      toast.success(`Đồng bộ thành công ${result.syncedCount} khóa học`);
      loadData();
    } catch (error) {
      toast.error('Đồng bộ khóa học thất bại');
    } finally {
      setIsSyncing(false);
    }
  };

  if (loading && courses.length === 0) {
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
    <div className="min-h-screen bg-slate-50/50 pt-8 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Hero Banner Area */}
        <div className="relative mb-10 p-8 rounded-3xl overflow-hidden bg-gradient-to-br from-emerald-600 via-primary-700 to-primary-900 shadow-sm overflow-hidden group">
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-white/10 blur-3xl group-hover:scale-150 transition-transform duration-1000"></div>
          <div className="absolute bottom-0 left-10 -mb-20 w-48 h-48 rounded-full bg-primary-400/20 blur-2xl group-hover:scale-150 transition-transform duration-1000"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-3">Tiến độ học tập</h1>
              <p className="text-primary-100 text-lg max-w-2xl font-medium">
                Tiếp tục hành trình chinh phục tri thức. Hôm nay bạn sẽ học gì?
              </p>
            </div>
            
            <button 
              onClick={handleSync} 
              disabled={isSyncing}
              className="mt-6 md:mt-0 flex items-center bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm border border-white/20 disabled:opacity-75"
            >
              <FiRefreshCw className={`mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ khóa học'}
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4">
              <div className="w-12 h-12 bg-cyan-50 text-cyan-500 rounded-full flex items-center justify-center shrink-0">
                <FiBook className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-900">{stats.overall.totalCoursesEnrolled}</p>
                <p className="text-xs sm:text-sm text-slate-500 font-medium">Đang đăng ký</p>
              </div>
            </div>
            
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4">
              <div className="w-12 h-12 bg-green-50 text-green-500 rounded-full flex items-center justify-center shrink-0">
                <FiAward className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-900">{stats.overall.totalCoursesCompleted}</p>
                <p className="text-xs sm:text-sm text-slate-500 font-medium">Hoàn thành</p>
              </div>
            </div>
            
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4">
              <div className="w-12 h-12 bg-orange-50 text-orange-500 rounded-full flex items-center justify-center shrink-0">
                <FiClock className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-900">{Math.round(stats.overall.totalStudyTimeHours)}</p>
                <p className="text-xs sm:text-sm text-slate-500 font-medium">Giờ học (Tổng)</p>
              </div>
            </div>
            
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4">
              <div className="w-12 h-12 bg-teal-50 text-teal-500 rounded-full flex items-center justify-center shrink-0">
                <FiTrendingUp className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-extrabold text-slate-900">{stats.overall.streakDays}</p>
                <p className="text-xs sm:text-sm text-slate-500 font-medium">Ngày liên tiếp</p>
              </div>
            </div>
          </div>
        )}

        {/* Filters Tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-8 bg-white p-2 rounded-2xl border border-slate-100 shadow-sm max-w-fit">
          <button
            onClick={() => setFilter('all')}
            className={`px-6 py-2.5 rounded-xl font-medium text-sm transition-all ${
              filter === 'all' 
                ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/30' 
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Tất cả
          </button>
          <button
            onClick={() => setFilter('in-progress')}
            className={`px-6 py-2.5 rounded-xl font-medium text-sm transition-all ${
              filter === 'in-progress' 
                ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/30' 
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Đang học
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-6 py-2.5 rounded-xl font-medium text-sm transition-all ${
              filter === 'completed' 
                ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/30' 
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Đã hoàn thành
          </button>
        </div>

        {/* Settings Grid view */}
        {courses.length === 0 ? (
          <div className="bg-white rounded-3xl p-16 text-center shadow-sm border border-slate-100">
            <div className="w-24 h-24 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-6">
              <FiBookOpen className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-3">Chưa có khóa học nào để hiển thị</h2>
            <p className="text-slate-500 mb-8 max-w-md mx-auto">Bạn chưa có khóa học nào hoặc không có khóa học nào khớp với bộ lọc.</p>
            <Link 
              to="/courses" 
              className="inline-flex items-center justify-center px-8 py-3.5 text-base font-semibold text-primary-600 bg-primary-50 rounded-xl hover:bg-primary-100 transition-all"
            >
              Khám phá khóa học
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {courses.map((course) => {
              const isCompleted = course.progressPercentage === 100;
              
              return (
                <Link
                  key={course.id}
                  to={`/learning/${course.courseId}`}
                  className="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-sm transition-all duration-300 border border-slate-100 flex flex-col hover:-translate-y-1"
                >
                  <div className="relative h-44 overflow-hidden bg-slate-100">
                    {course.details?.thumbnail ? (
                      <img
                        src={course.details.thumbnail}
                        alt={course.courseTitle}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-in-out"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-emerald-50">
                        <FiBookOpen size={40} className="text-emerald-200" />
                      </div>
                    )}
                    
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                      <div className="bg-white text-slate-900 px-5 py-2.5 rounded-full font-bold shadow-sm flex items-center transform scale-75 group-hover:scale-100 transition-all">
                        <FiPlayCircle className="mr-2 text-primary-600" size={20} /> Tiếp tục học
                      </div>
                    </div>
                  </div>

                  <div className="p-5 flex flex-col flex-grow">
                     <h3 className="font-bold text-slate-900 text-base leading-snug mb-4 line-clamp-2 min-h-[3rem] group-hover:text-primary-600 transition-colors">
                      {course.courseTitle}
                    </h3>
                    
                    <div className="mt-auto space-y-4">
                      {/* Detailed Progress Bar */}
                      <div>
                        <div className="flex justify-between items-end mb-1.5">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tiến độ</span>
                          <span className={`text-sm font-bold ${isCompleted ? 'text-green-600' : 'text-primary-600'}`}>
                            {Math.round(course.progressPercentage)}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div 
                            className={`h-2 rounded-full transition-all duration-1000 ${isCompleted ? 'bg-green-500' : 'bg-primary-500'}`} 
                            style={{ width: `${Math.min(100, Math.max(0, course.progressPercentage))}%` }}
                          ></div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                        <div className="flex items-center bg-slate-50 px-2 py-1 rounded-lg">
                          <FiCheckCircle className="mr-1.5 w-3.5 h-3.5" />
                          <span>{course.completedLessons} / {course.totalLessons}</span>
                        </div>
                        <div className="flex items-center bg-slate-50 px-2 py-1 rounded-lg">
                          <FiClock className="mr-1.5 w-3.5 h-3.5" />
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
