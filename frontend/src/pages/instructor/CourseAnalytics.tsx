import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { courseService, Course } from '../../services/course.service';
import { FiChevronLeft, FiUsers, FiDollarSign, FiStar, FiTrendingUp, FiBarChart2 } from 'react-icons/fi';
import { formatVND } from '../../utils/currency';

interface AnalyticsData {
  course: Course;
  ratingDistribution: Record<number, number>;
  students: any[];
}

export default function CourseAnalytics() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (courseId) {
      loadAnalytics();
    }
  }, [courseId]);

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const [courseResult, ratingResult, studentsResult] = await Promise.allSettled([
        courseService.getCourseById(courseId!),
        courseService.getRatingDistribution(courseId!),
        courseService.getCourseStudents(courseId!)
      ]);

      if (courseResult.status === 'rejected') {
        setError('Không thể tải thông tin khóa học. Vui lòng thử lại.');
        console.error('Failed to load course:', courseResult.reason);
        return;
      }

      setData({
        course: courseResult.value,
        ratingDistribution: ratingResult.status === 'fulfilled' ? ratingResult.value : {},
        students: studentsResult.status === 'fulfilled' ? studentsResult.value : []
      });
    } catch (err) {
      setError('Lỗi tải dữ liệu phân tích khóa học');
      console.error(err);
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

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => navigate('/dashboard')} className="p-2 bg-white border rounded-xl hover:bg-slate-50 transition-colors">
            <FiChevronLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-slate-900">Phân tích Khóa học</h1>
        </div>
        <div className="card text-center py-16">
          <FiBarChart2 size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-red-500 font-medium mb-4">{error || 'Không tìm thấy dữ liệu.'}</p>
          <button onClick={loadAnalytics} className="btn-primary">Thử lại</button>
        </div>
      </div>
    );
  }

  const { course, ratingDistribution, students } = data;
  const totalRevenue = course.price * course.enrolledCount;

  // Simple CSS-based bar chart data
  const ratingData = [
    { label: '5 Sao', value: ratingDistribution[5] || 0, color: 'bg-yellow-400' },
    { label: '4 Sao', value: ratingDistribution[4] || 0, color: 'bg-yellow-300' },
    { label: '3 Sao', value: ratingDistribution[3] || 0, color: 'bg-amber-300' },
    { label: '2 Sao', value: ratingDistribution[2] || 0, color: 'bg-orange-300' },
    { label: '1 Sao', value: ratingDistribution[1] || 0, color: 'bg-red-300' },
  ];
  const maxRating = Math.max(...ratingData.map(r => r.value), 1);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <button onClick={() => navigate('/dashboard')} className="p-2 bg-white border rounded-xl hover:bg-slate-50 transition-colors">
          <FiChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Phân tích Khóa học</h1>
          <p className="text-slate-500 text-sm mt-1">{course.title}</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-primary-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 z-10">
            <FiUsers size={24} />
          </div>
          <div className="z-10">
            <p className="text-sm font-medium text-slate-500 mb-1">Tổng học viên</p>
            <p className="text-2xl font-bold text-slate-900">{course.enrolledCount}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-green-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-green-600 flex items-center justify-center shrink-0 z-10">
            <FiDollarSign size={24} />
          </div>
          <div className="z-10">
            <p className="text-sm font-medium text-slate-500 mb-1">Doanh thu dự kiến</p>
            <p className="text-2xl font-bold text-slate-900">{formatVND(totalRevenue)}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-yellow-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div className="w-12 h-12 rounded-xl bg-yellow-100 text-yellow-600 flex items-center justify-center shrink-0 z-10">
            <FiStar size={24} />
          </div>
          <div className="z-10">
            <p className="text-sm font-medium text-slate-500 mb-1">Đánh giá trung bình</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold text-slate-900">{course.rating.toFixed(1)}</p>
              <span className="text-sm text-slate-400">({course.totalReviews} lượt)</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-cyan-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div className="w-12 h-12 rounded-xl bg-cyan-100 text-cyan-600 flex items-center justify-center shrink-0 z-10">
            <FiTrendingUp size={24} />
          </div>
          <div className="z-10">
            <p className="text-sm font-medium text-slate-500 mb-1">Tổng bài học</p>
            <p className="text-2xl font-bold text-slate-900">{course.lessons?.length || 'N/A'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rating Distribution - Pure CSS */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 lg:col-span-1">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Phân bố đánh giá</h3>
          <div className="space-y-3">
            {ratingData.map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-600 w-12 shrink-0">{item.label}</span>
                <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${item.color} rounded-full transition-all duration-500`}
                    style={{ width: `${(item.value / maxRating) * 100}%`, minWidth: item.value > 0 ? '8px' : '0' }}
                  ></div>
                </div>
                <span className="text-sm font-bold text-slate-700 w-8 text-right">{item.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <p className="text-3xl font-bold text-yellow-500">{course.rating.toFixed(1)} <span className="text-lg">★</span></p>
            <p className="text-sm text-slate-500 mt-1">{course.totalReviews} đánh giá</p>
          </div>
        </div>

        {/* Recent Students */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 lg:col-span-2 overflow-hidden flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-slate-800">Học viên tham gia gần đây</h3>
            <button onClick={() => navigate(`/instructor/course/${course.id}/students`)} className="text-sm font-medium text-primary-600 hover:text-primary-700">
              Xem tất cả →
            </button>
          </div>
          
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 font-medium">
                <tr>
                  <th className="py-3 px-4 rounded-l-lg">Học viên</th>
                  <th className="py-3 px-4">Ngày tham gia</th>
                  <th className="py-3 px-4">Tiến độ</th>
                  <th className="py-3 px-4 rounded-r-lg text-right">Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {students.slice(0, 5).map((student: any, index: number) => (
                  <tr key={student.id || index} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {student.user?.avatar ? (
                          <img src={student.user.avatar} alt={student.user.fullName} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-xs">
                            {student.user?.fullName?.charAt(0) || '?'}
                          </div>
                        )}
                        <span className="font-medium text-slate-900">{student.user?.fullName || 'Học viên ẩn danh'}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {student.enrolledAt ? new Date(student.enrolledAt).toLocaleDateString('vi-VN') : 'N/A'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${student.progressPercentage || 0}%` }}
                          ></div>
                        </div>
                        <span className="text-xs font-medium">{(student.progressPercentage || 0).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button 
                        onClick={() => navigate(`/instructor/course/${course.id}/students/${student.userId}`)}
                        className="text-primary-600 hover:text-primary-800 font-medium"
                      >
                        Xem
                      </button>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      Chưa có học viên nào tham gia khóa học này.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
