import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { courseService } from '../../services/course.service';
import { FiArrowLeft, FiUser, FiClock, FiSearch, FiEye } from 'react-icons/fi';
import toast from 'react-hot-toast';

type ProgressFilter = 'ALL' | 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export default function CourseStudents() {
  const { courseId } = useParams<{ courseId: string }>();
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState<{ id: string; title: string } | null>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('ALL');

  useEffect(() => {
    if (courseId) {
      loadStudents(courseId);
    }
  }, [courseId]);

  const loadStudents = async (id: string) => {
    try {
      setLoading(true);
      const data = await courseService.getCourseStudents(id);
      setCourse(data.course);
      setStudents(data.students);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Không thể tải danh sách học viên');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Chưa xác định';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const getProgressStatus = (progress: number): ProgressFilter => {
    if (progress >= 100) return 'COMPLETED';
    if (progress > 0) return 'IN_PROGRESS';
    return 'NOT_STARTED';
  };

  const filteredStudents = students.filter((student) => {
    const name = student.user?.fullName?.toLowerCase() || '';
    const matchesSearch = name.includes(searchTerm.toLowerCase());
    const matchesProgress = progressFilter === 'ALL' || getProgressStatus(student.progressPercentage || 0) === progressFilter;
    return matchesSearch && matchesProgress;
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link to="/instructor/dashboard" className="text-primary-600 hover:text-primary-800 flex items-center mb-4">
          <FiArrowLeft className="mr-2" /> Trở về Bảng điều khiển
        </Link>
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Quản lý học viên
          </h1>
          <p className="text-gray-600 font-medium">Khóa học: <span className="text-gray-900">{course?.title}</span></p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b bg-gray-50 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm theo tên học viên..."
              className="w-full pl-10 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <select
            value={progressFilter}
            onChange={(e) => setProgressFilter(e.target.value as ProgressFilter)}
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="ALL">Tất cả tiến độ</option>
            <option value="NOT_STARTED">Chưa học</option>
            <option value="IN_PROGRESS">Đang học</option>
            <option value="COMPLETED">Hoàn thành</option>
          </select>
        </div>

        {filteredStudents.length === 0 ? (
          <div className="text-center py-12">
            <FiUser className="mx-auto h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">Chưa có học viên</h3>
            <p className="text-gray-500">Không có học viên phù hợp với bộ lọc hiện tại.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Học viên
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tiến độ
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Thời gian học
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ngày đăng ký
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Truy cập lần cuối
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Hành động
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredStudents.map((student, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          {student.user?.avatar ? (
                            <img className="h-10 w-10 rounded-full object-cover" src={student.user.avatar} alt="" />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold">
                              {student.user?.fullName?.charAt(0).toUpperCase() || 'U'}
                            </div>
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{student.user?.fullName || 'Người dùng ẩn danh'}</div>
                          <div className="text-xs text-gray-500">ID: {student.user?.userId || student.userId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="w-full max-w-xs">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium">{Math.round(student.progressPercentage || 0)}%</span>
                          <span className="text-gray-500">{student.completedLessons || 0}/{student.totalLessons || 0} bài học</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${student.progressPercentage === 100 ? 'bg-green-500' : 'bg-primary-600'}`} 
                            style={{ width: `${student.progressPercentage || 0}%` }}
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex items-center">
                        <FiClock className="mr-1.5 text-gray-400" />
                        {Math.round((student.timeSpentSeconds || 0) / 60)} phút
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(student.enrolledAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(student.lastAccessedAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <Link
                        to={`/instructor/course/${courseId}/students/${student.userId || student.user?.userId}`}
                        className="inline-flex items-center px-3 py-1.5 text-primary-700 bg-primary-50 rounded-md hover:bg-primary-100"
                      >
                        <FiEye className="mr-1.5" /> Xem chi tiết
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
