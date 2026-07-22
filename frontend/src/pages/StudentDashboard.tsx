import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { learningService, CourseProgress, LearningStats, TaskItem, ActivityLog } from '../services/learning.service';
import { recommendationService } from '../services/recommendation.service';
import { ProgressBar } from '../components/learning/ProgressBar';
import { ActivityFeed } from '../components/learning/ActivityFeed';
import RecommendationList from '../components/dashboard/RecommendationList';
import { FiBookOpen, FiClock, FiAward, FiTrendingUp, FiCalendar, FiTarget, FiCheckSquare } from 'react-icons/fi';

export default function StudentDashboard() {
  const { user } = useAuth();
  const [enrolledCourses, setEnrolledCourses] = useState<CourseProgress[]>([]);
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
  const [nextActions, setNextActions] = useState<any[]>([]);
  const [pendingTasks, setPendingTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [coursesData, statsData, activityData, actionsData, tasksData] = await Promise.all([
        learningService.getEnrolledCourses(1, 10),
        learningService.getLearningStats(),
        learningService.getRecentActivity(5),
        recommendationService.getSmartNextActions(),
        learningService.getPendingTasks().catch(() => []),
      ]);
      
      setEnrolledCourses(coursesData.courses);
      setStats(statsData);
      setRecentActivity(activityData);
      setNextActions(actionsData);
      setPendingTasks(tasksData.filter(t => t.status !== 'COMPLETED'));
      
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
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
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-primary-500 to-primary-700 rounded-2xl p-8 text-white mb-8">
        <h1 className="text-3xl font-bold mb-2">
          Chào mừng trở lại, {user?.fullName}!
        </h1>
        <p className="text-primary-100">
          Hãy tiếp tục hành trình học tập. Bạn đang làm rất tốt!
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="card flex items-center space-x-3">
            <FiBookOpen className="text-2xl text-primary-500" />
            <div>
              <p className="text-2xl font-bold">{stats.overall.totalCoursesEnrolled}</p>
              <p className="text-sm text-slate-500">Đã đăng ký</p>
            </div>
          </div>
          <div className="card flex items-center space-x-3">
            <FiAward className="text-2xl text-green-500" />
            <div>
              <p className="text-2xl font-bold">{stats.overall.totalCoursesCompleted}</p>
              <p className="text-sm text-slate-500">Đã hoàn thành</p>
            </div>
          </div>
          <div className="card flex items-center space-x-3">
            <FiClock className="text-2xl text-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{stats.overall.totalStudyTimeHours}</p>
              <p className="text-sm text-slate-500">Giờ học</p>
            </div>
          </div>
          <div className="card flex items-center space-x-3">
            <FiTrendingUp className="text-2xl text-teal-500" />
            <div>
              <p className="text-2xl font-bold">{stats.overall.streakDays}</p>
              <p className="text-sm text-slate-500">Chuỗi ngày học</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Main Content - Enrolled Courses */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Tiếp tục học</h2>
            <Link to="/my-learning" className="text-primary-600 hover:underline text-sm">
              Xem tất cả →
            </Link>
          </div>
          
          {enrolledCourses.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-slate-500 mb-4">Bạn chưa đăng ký khóa học nào.</p>
              <Link to="/courses" className="btn-primary">
                Khám phá Khóa học
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {enrolledCourses.slice(0, 5).map((course) => (
                <Link
                  key={course.id}
                  to={`/learning/${course.courseId}`}
                  className="card block hover:shadow-sm transition"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold text-lg">{course.courseTitle}</h3>
                      <p className="text-sm text-slate-500">
                        Đã hoàn thành {course.completedLessons} / {course.totalLessons} bài học
                      </p>
                    </div>
                    {course.progressPercentage === 100 ? (
                      <span className="bg-green-100 text-green-700 text-sm px-2 py-1 rounded">
                        Đã hoàn thành
                      </span>
                    ) : (
                      <span className="bg-yellow-100 text-yellow-700 text-sm px-2 py-1 rounded">
                        {Math.round(course.progressPercentage)}%
                      </span>
                    )}
                  </div>
                  <ProgressBar percentage={course.progressPercentage} size="sm" />
                  <div className="flex items-center space-x-4 mt-3 text-sm text-slate-500">
                    <span className="flex items-center">
                      <FiClock className="mr-1" size={14} />
                      {Math.floor(course.timeSpentSeconds / 3600)}h {Math.floor((course.timeSpentSeconds % 3600) / 60)}m
                    </span>
                    <span className="flex items-center">
                      <FiCalendar className="mr-1" size={14} />
                      Truy cập lần cuối: {new Date(course.lastAccessedAt).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Recommendations */}
          <RecommendationList />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Next Steps */}
          {nextActions.length > 0 && (
            <div className="card">
              <h3 className="font-semibold mb-3 flex items-center">
                <FiTarget className="mr-2 text-primary-500" />
                Bước tiếp theo
              </h3>
              <div className="space-y-3">
                {nextActions.map((step: any, index: number) => (
                  <div key={index} className="flex items-start space-x-2">
                    <div className="w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 text-sm">
                      {index + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{step.message}</p>
                      {step.action && (
                        <Link to={step.action} className="text-xs text-primary-600 hover:underline">
                          Thực hiện ngay →
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Tasks */}
          <div className="card border-l-4 border-l-primary-500">
            <h3 className="font-semibold mb-3 flex items-center">
              <FiCheckSquare className="mr-2 text-primary-500" />
              Nhiệm vụ cần làm ({pendingTasks.length})
            </h3>
            {pendingTasks.length > 0 ? (
              <div className="space-y-3">
                {pendingTasks.slice(0, 3).map((task) => (
                  <Link key={task.id} to={task.type === 'QUIZ' ? `/tasks/${task.id}/quiz` : `/tasks/${task.id}/assignment`} className="block p-3 bg-slate-50 rounded-xl hover:bg-primary-50 transition">
                    <p className="font-medium text-sm text-slate-900 truncate">{task.title}</p>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-xs text-slate-500 font-semibold">{task.type === 'QUIZ' ? 'Trắc nghiệm' : 'Bài tập'}</span>
                      {task.dueDate && <span className="text-xs text-slate-500"><FiClock className="inline mr-1"/>{new Date(task.dueDate).toLocaleDateString()}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-2">Bạn không có bài tập nào sắp tới.</p>
            )}
            <Link to="/tasks" className="block text-center text-sm text-primary-600 hover:underline mt-4">
              Xem tất cả →
            </Link>
          </div>

          {/* Recent Activity */}
          <div className="card">
            <h3 className="font-semibold mb-3">Hoạt động gần đây</h3>
            <ActivityFeed activities={recentActivity} />
            <Link to="/activity" className="block text-center text-sm text-primary-600 hover:underline mt-4">
              Xem tất cả HĐ →
            </Link>
          </div>

          {/* Quick Stats */}
          {stats && (
            <div className="card">
              <h3 className="font-semibold mb-3">Thống kê nhanh</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Tỷ lệ hoàn thành</span>
                  <span className="font-medium">{Math.round(stats.overall.completionRate)}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Ngày học liên tục</span>
                  <span className="font-medium">{stats.overall.streakDays} ngày</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Tổng số bài học</span>
                  <span className="font-medium">{stats.overall.totalLessonsCompleted}</span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t">
                <Link to="/certificates" className="flex items-center justify-between text-sm text-primary-600 hover:underline">
                  <span>Xem chứng nhận</span>
                  <span>→</span>
                </Link>
                <Link to="/badges" className="flex items-center justify-between text-sm text-primary-600 hover:underline mt-2">
                  <span>Xem huy hiệu</span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
