import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { courseService, Course } from '../services/course.service';
import { 
  FiBookOpen, 
  FiUsers, 
  FiDollarSign, 
  FiTrendingUp,
  FiEdit2,
  FiEye,
  FiEyeOff,
  FiTrash2,
  FiPlus,
  FiBarChart2
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { formatVND } from '../utils/currency';

export default function InstructorDashboard() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [stats, setStats] = useState({
    totalCourses: 0,
    totalStudents: 0,
    totalRevenue: 0,
    averageRating: 0,
    monthlyEnrollments: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role !== 'INSTRUCTOR' && user?.role !== 'ADMIN') return;
    loadDashboardData();
  }, [user]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const myCourses = await courseService.getMyCourses(1, 100);
      setCourses(myCourses.courses);
      
      // Calculate stats
      const totalStudents = myCourses.courses.reduce((sum, c) => sum + c.enrolledCount, 0);
      const totalRevenue = myCourses.courses.reduce((sum, c) => sum + (c.price * c.enrolledCount), 0);
      const avgRating = myCourses.courses.reduce((sum, c) => sum + c.rating, 0) / (myCourses.courses.length || 1);
      
      setStats({
        totalCourses: myCourses.pagination.total,
        totalStudents,
        totalRevenue,
        averageRating: avgRating,
        monthlyEnrollments: myCourses.courses.reduce((sum, c) => sum + (c.enrolledCount > 0 ? 1 : 0), 0),
      });
      
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

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
        loadDashboardData();
      } catch (error) {
        console.error('Failed to delete course:', error);
      }
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
        <h1 className="text-3xl font-bold text-gray-900">Bảng điều khiển Giảng viên</h1>
        <Link to="/courses/create" className="btn-primary flex items-center space-x-2">
          <FiPlus size={18} />
          <span>Tạo Khóa học mới</span>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tổng số Khóa học</p>
              <p className="text-2xl font-bold">{stats.totalCourses}</p>
            </div>
            <FiBookOpen className="text-3xl text-primary-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tổng số Học viên</p>
              <p className="text-2xl font-bold">{stats.totalStudents}</p>
            </div>
            <FiUsers className="text-3xl text-primary-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tổng doanh thu</p>
              <p className="text-2xl font-bold">{formatVND(stats.totalRevenue)}</p>
            </div>
            <FiDollarSign className="text-3xl text-primary-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Đánh giá trung bình</p>
              <p className="text-2xl font-bold">{stats.averageRating.toFixed(1)}</p>
            </div>
            <FiTrendingUp className="text-3xl text-primary-500" />
          </div>
        </div>
      </div>

      {/* My Courses */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Khóa học của tôi</h2>
        
        {courses.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">Bạn chưa tạo khóa học nào.</p>
            <Link to="/courses/create" className="btn-primary">
              Tạo khóa học đầu tiên của bạn
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4">Khóa học</th>
                  <th className="text-left py-3 px-4">Học viên</th>
                  <th className="text-left py-3 px-4">Giá tiền</th>
                  <th className="text-left py-3 px-4">Đánh giá</th>
                  <th className="text-left py-3 px-4">Trạng thái</th>
                  <th className="text-left py-3 px-4">Hành động</th>
                 </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium">{course.title}</p>
                        <p className="text-xs text-gray-500">{course.slug}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4">{course.enrolledCount}</td>
                    <td className="py-3 px-4">{formatVND(course.price)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center">
                        <span className="mr-1">{course.rating.toFixed(1)}</span>
                        <span className="text-yellow-400">★</span>
                        <span className="text-xs text-gray-500 ml-1">({course.totalReviews})</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        course.published ? 'bg-green-100 text-green-700' :
                        (course as any).approvalStatus === 'PENDING_REVIEW' ? 'bg-blue-100 text-blue-700' :
                        (course as any).approvalStatus === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {course.published ? 'Đã xuất bản' :
                         (course as any).approvalStatus === 'PENDING_REVIEW' ? 'Chờ duyệt' :
                         (course as any).approvalStatus === 'REJECTED' ? 'Bị từ chối' :
                         'Bản nháp'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex space-x-2">
                        <Link
                          to={`/courses/${course.slug}/edit`}
                          className="p-1 text-gray-500 hover:text-primary-600"
                          title="Sửa"
                        >
                          <FiEdit2 size={16} />
                        </Link>
                        <Link
                          to={`/courses/${course.slug}`}
                          className="p-1 text-gray-500 hover:text-primary-600"
                          title="Xem"
                        >
                          <FiEye size={16} />
                        </Link>
                        {(course as any).approvalStatus !== 'PENDING_REVIEW' && (
                          <button
                            onClick={() => handlePublish(course.id, course.published)}
                            className="p-1 text-gray-500 hover:text-green-600"
                            title={course.published ? "Ngừng xuất bản" : "Gửi duyệt"}
                          >
                            {course.published ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(course.id, course.title)}
                          className="p-1 text-gray-500 hover:text-red-600"
                          title="Xóa"
                        >
                          <FiTrash2 size={16} />
                        </button>
                        <Link
                          to={`/analytics/course/${course.id}`}
                          className="p-1 text-gray-500 hover:text-primary-600"
                          title="Phân tích"
                        >
                          <FiBarChart2 size={16} />
                        </Link>
                        <Link
                          to={`/instructor/course/${course.id}/students`}
                          className="p-1 text-gray-500 hover:text-blue-600"
                          title="Quản lý học viên"
                        >
                          <FiUsers size={16} />
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
        <div className="bg-blue-50 rounded-lg p-4">
          <h3 className="font-semibold text-blue-800 mb-2">📚 Tạo nội dung chất lượng</h3>
          <p className="text-sm text-blue-600">Video chất lượng cao và nội dung hấp dẫn sẽ thu hút nhiều học viên hơn.</p>
        </div>
        <div className="bg-green-50 rounded-lg p-4">
          <h3 className="font-semibold text-green-800 mb-2">💬 Tương tác với học viên</h3>
          <p className="text-sm text-green-600">Trả lời câu hỏi và bình luận để xây dựng cộng đồng lớp học.</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-4">
          <h3 className="font-semibold text-purple-800 mb-2">📊 Theo dõi số liệu</h3>
          <p className="text-sm text-purple-600">Theo dõi tiến độ học tập và tỷ lệ hoàn thành khóa học của học viên.</p>
        </div>
      </div>
    </div>
  );
}
