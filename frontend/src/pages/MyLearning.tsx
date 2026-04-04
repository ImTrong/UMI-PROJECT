import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { learningService, CourseProgress } from '../services/learning.service';
import { ProgressBar } from '../components/learning/ProgressBar';
import { useAuth } from '../hooks/useAuth';
import { FiBookOpen, FiCheckCircle, FiClock, FiTrendingUp } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function MyLearning() {
  const { isAuthenticated } = useAuth();
  const [courses, setCourses] = useState<CourseProgress[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'in-progress' | 'completed'>('all');

  useEffect(() => {
    if (!isAuthenticated) return;
    loadData();
  }, [isAuthenticated, filter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [coursesData, statsData] = await Promise.all([
        learningService.getEnrolledCourses(1, 100, filter === 'all' ? undefined : filter),
        learningService.getLearningStats(),
      ]);
      setCourses(coursesData.courses);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load learning data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      const result = await learningService.syncEnrollments();
      toast.success(`Đã đồng bộ ${result.syncedCount} khóa học`);
      loadData();
    } catch (error) {
      toast.error('Đồng bộ khóa học thất bại');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Góc học tập</h1>
        <button onClick={handleSync} className="text-sm text-primary-600 hover:text-primary-700">
          Đồng bộ Khóa học
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="card flex items-center space-x-3">
            <FiBookOpen className="text-2xl text-primary-500" />
            <div>
              <p className="text-2xl font-bold">{stats.overall.totalCoursesEnrolled}</p>
              <p className="text-sm text-gray-500">Đã đăng ký</p>
            </div>
          </div>
          <div className="card flex items-center space-x-3">
            <FiCheckCircle className="text-2xl text-green-500" />
            <div>
              <p className="text-2xl font-bold">{stats.overall.totalCoursesCompleted}</p>
              <p className="text-sm text-gray-500">Đã hoàn thành</p>
            </div>
          </div>
          <div className="card flex items-center space-x-3">
            <FiClock className="text-2xl text-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{stats.overall.totalStudyTimeHours}</p>
              <p className="text-sm text-gray-500">Giờ học</p>
            </div>
          </div>
          <div className="card flex items-center space-x-3">
            <FiTrendingUp className="text-2xl text-purple-500" />
            <div>
              <p className="text-2xl font-bold">{stats.overall.streakDays}</p>
              <p className="text-sm text-gray-500">Ngày liên tục</p>
            </div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex space-x-2 mb-6 border-b">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 ${filter === 'all' ? 'border-b-2 border-primary-500 text-primary-600' : 'text-gray-500'}`}
        >
          Tất cả Khóa học
        </button>
        <button
          onClick={() => setFilter('in-progress')}
          className={`px-4 py-2 ${filter === 'in-progress' ? 'border-b-2 border-primary-500 text-primary-600' : 'text-gray-500'}`}
        >
          Đang học
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`px-4 py-2 ${filter === 'completed' ? 'border-b-2 border-primary-500 text-primary-600' : 'text-gray-500'}`}
        >
          Đã hoàn thành
        </button>
      </div>

      {/* Course List */}
      {courses.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">Không tìm thấy khóa học nào</p>
          <Link to="/courses" className="btn-primary mt-4 inline-block">
            Khám phá Khóa học
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {courses.map((course) => (
            <Link
              key={course.id}
              to={`/learning/${course.courseId}`}
              className="card hover:shadow-md transition"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{course.courseTitle}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Ngày đăng ký: {new Date(course.enrolledAt).toLocaleDateString()}
                  </p>
                  {course.completedAt && (
                    <p className="text-sm text-green-600 mt-1">
                      Ngày hoàn thành: {new Date(course.completedAt).toLocaleDateString()}
                    </p>
                  )}
                  <div className="mt-3">
                    <ProgressBar percentage={course.progressPercentage} size="sm" />
                    <p className="text-sm text-gray-500 mt-1">
                      Đã xong {course.completedLessons} / {course.totalLessons} bài học • Học trong {Math.floor(course.timeSpentSeconds / 60)} phút
                    </p>
                  </div>
                </div>
                <div className="ml-4">
                  {course.progressPercentage === 100 ? (
                    <span className="bg-green-100 text-green-700 text-sm px-3 py-1 rounded-full">
                      Đã hoàn thành
                    </span>
                  ) : course.progressPercentage > 0 ? (
                    <span className="bg-yellow-100 text-yellow-700 text-sm px-3 py-1 rounded-full">
                      {Math.round(course.progressPercentage)}%
                    </span>
                  ) : (
                    <span className="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full">
                      Chưa bắt đầu
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
