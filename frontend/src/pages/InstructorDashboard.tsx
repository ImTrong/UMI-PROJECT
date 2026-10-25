import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { courseService, Course, InstructorDashboardStats } from '../services/course.service';
import { FiUsers, FiEdit2, FiEye, FiEyeOff, FiTrash2, FiPlus, FiBarChart2, FiBook, FiFileText } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { formatVND } from '../utils/currency';
import { DashboardKpis, CourseStatusBadge, CourseTodoNotes, formatRating } from '../components/instructor/DashboardPanels';

export default function InstructorDashboard() {
  const { user } = useAuth();
  // IMPLEMENT-02: KPIs come from GET /api/courses/instructor/dashboard; the course list (GET /api/courses/me) only feeds the
  // management table. Each is loaded on its own, so one failing does not take the other down.
  const [stats, setStats] = useState<InstructorDashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      setStats(await courseService.getInstructorDashboard());
    } catch (error: any) {
      setStats(null);
      setStatsError(error?.response?.data?.error || 'Không tải được số liệu tổng quan.');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadCourses = useCallback(async () => {
    setCoursesLoading(true);
    setCoursesError(null);
    try {
      const myCourses = await courseService.getMyCourses(1, 100);
      setCourses(myCourses.courses);
    } catch (error: any) {
      setCoursesError(error?.response?.data?.error || 'Không tải được danh sách khóa học.');
    } finally {
      setCoursesLoading(false);
    }
  }, []);

  const loadDashboardData = useCallback(() => {
    loadStats();
    loadCourses();
  }, [loadStats, loadCourses]);

  useEffect(() => {
    if (user?.role !== 'INSTRUCTOR' && user?.role !== 'ADMIN') return;
    loadDashboardData();
  }, [user, loadDashboardData]);

  const handlePublish = async (courseId: string, isPublished: boolean) => {
    try {
      await courseService.publishCourse(courseId);
      if (isPublished) {
        toast.success('Đã ngừng xuất bản khóa học');
      } else {
        toast.success('Đã gửi khóa học để Admin xét duyệt!');
      }
      loadDashboardData();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Thao tác thất bại');
    }
  };

  const handleDelete = async (courseId: string, courseTitle: string) => {
    if (confirm(`Bạn có chắc chắn muốn xóa khóa học "${courseTitle}"?`)) {
      try {
        await courseService.deleteCourse(courseId);
        toast.success('Xóa khóa học thành công');
        loadDashboardData();
      } catch (error: any) {
        // e.g. 409 COURSE_HAS_LEARNERS: the server explains why (FIX-INS-02)
        toast.error(error.response?.data?.error || 'Không thể xóa khóa học');
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Bảng điều khiển Giảng viên</h1>
        <Link to="/courses/create" className="btn-primary flex items-center space-x-2">
          <FiPlus size={18} />
          <span>Tạo Khóa học mới</span>
        </Link>
      </div>

      {/* KPIs (course-service dashboard API) - no revenue / earnings / learner count: no reliable data for them yet */}
      <DashboardKpis stats={stats} loading={statsLoading} error={statsError} onRetry={loadStats} />

      {/* My Courses */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Khóa học của tôi</h2>

        {coursesLoading ? (
          <div className="flex justify-center py-12" data-testid="courses-loading">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : coursesError ? (
          <div className="text-center py-12" data-testid="courses-error">
            <p className="text-red-600 mb-4">{coursesError}</p>
            <button onClick={loadCourses} className="btn-secondary">Thử lại</button>
          </div>
        ) : courses.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500 mb-4">Bạn chưa tạo khóa học nào.</p>
            <Link to="/courses/create" className="btn-primary">
              Tạo khóa học đầu tiên của bạn
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-3 px-4">Khóa học</th>
                  <th className="text-left py-3 px-4" title="Số lượt ghi danh qua đơn hàng đã thanh toán - không phải số người học duy nhất">Lượt ghi danh</th>
                  <th className="text-left py-3 px-4">Giá tiền</th>
                  <th className="text-left py-3 px-4">Đánh giá</th>
                  <th className="text-left py-3 px-4">Trạng thái</th>
                  <th className="text-left py-3 px-4">Hành động</th>
                 </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium">{course.title}</p>
                        <p className="text-xs text-slate-500">{course.slug}</p>
                        <CourseTodoNotes course={course} />
                      </div>
                    </td>
                    <td className="py-3 px-4">{course.enrolledCount}</td>
                    <td className="py-3 px-4">{formatVND(course.price)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center">
                        <span className="mr-1">{formatRating(course.rating)}</span>
                        <span className="text-yellow-400">★</span>
                        <span className="text-xs text-slate-500 ml-1">({course.totalReviews})</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <CourseStatusBadge course={course} />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex space-x-2">
                        <Link
                          to={`/courses/${course.slug}/edit`}
                          className="p-1 text-slate-500 hover:text-primary-600"
                          title="Sửa"
                        >
                          <FiEdit2 size={16} />
                        </Link>
                        <Link
                          to={`/courses/${course.slug}`}
                          className="p-1 text-slate-500 hover:text-primary-600"
                          title="Xem"
                        >
                          <FiEye size={16} />
                        </Link>
                        {course.approvalStatus !== 'PENDING_REVIEW' && (
                          <button
                            onClick={() => handlePublish(course.id, course.published)}
                            className="p-1 text-slate-500 hover:text-green-600"
                            title={course.published ? "Ngừng xuất bản" : "Gửi duyệt"}
                          >
                            {course.published ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(course.id, course.title)}
                          className="p-1 text-slate-500 hover:text-red-600"
                          title="Xóa"
                        >
                          <FiTrash2 size={16} />
                        </button>
                        <Link
                          to={`/analytics/course/${course.id}`}
                          className="p-1 text-slate-500 hover:text-primary-600"
                          title="Phân tích"
                        >
                          <FiBarChart2 size={16} />
                        </Link>
                        <Link
                          to={`/instructor/course/${course.id}/students`}
                          className="p-1 text-slate-500 hover:text-cyan-600"
                          title="Quản lý học viên"
                        >
                          <FiUsers size={16} />
                        </Link>
                        <Link
                          to={`/instructor/course/${course.id}/assignments`}
                          className="p-1 text-slate-500 hover:text-indigo-600"
                          title="Bài tập tự luận"
                        >
                          <FiFileText size={16} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Tips */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <div className="bg-cyan-50 rounded-xl p-4">
          <h3 className="font-semibold text-cyan-800 mb-2"><FiBook className="inline mr-1" /> Tạo nội dung chất lượng</h3>
          <p className="text-sm text-cyan-600">Video chất lượng cao và nội dung hấp dẫn sẽ thu hút nhiều học viên hơn.</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <h3 className="font-semibold text-green-800 mb-2">💬 Tương tác với học viên</h3>
          <p className="text-sm text-green-600">Trả lời câu hỏi và bình luận để xây dựng cộng đồng lớp học.</p>
        </div>
        <div className="bg-teal-50 rounded-xl p-4">
          <h3 className="font-semibold text-teal-800 mb-2">📊 Theo dõi số liệu</h3>
          <p className="text-sm text-teal-600">Theo dõi tiến độ học tập và tỷ lệ hoàn thành khóa học của học viên.</p>
        </div>
      </div>
    </div>
  );
}
