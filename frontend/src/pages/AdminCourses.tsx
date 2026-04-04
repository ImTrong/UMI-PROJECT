import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { courseService, Course } from '../services/course.service';
import { FiChevronLeft, FiCheckCircle, FiXCircle, FiEye, FiClock } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function AdminCourses() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Pagination & Search
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Reject Modal State
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Debounce search
    const timer = setTimeout(() => {
      loadPendingCourses();
    }, 500);
    return () => clearTimeout(timer);
  }, [page, searchTerm]);

  const loadPendingCourses = async () => {
    setLoading(true);
    try {
      const data = await courseService.getPendingCourses(page, 10, searchTerm); 
      setCourses(data.data);
      if (data.pagination) {
        setTotalPages(data.pagination.totalPages || 1);
      }
    } catch (error) {
      toast.error('Tải danh sách khóa học chờ duyệt thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (courseId: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn phê duyệt khóa học này? Khóa học sẽ được xuất bản ngay lập tức và hiển thị cho học viên.')) return;
    
    setIsProcessing(true);
    try {
      await courseService.approveCourse(courseId);
      toast.success('Phê duyệt và xuất bản khóa học thành công!');
      setCourses(courses.filter(c => c.id !== courseId));
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Phê duyệt khóa học thất bại');
    } finally {
      setIsProcessing(false);
    }
  };

  const submitReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectId || !rejectReason.trim()) {
      toast.error('Vui lòng cung cấp lý do từ chối');
      return;
    }

    setIsProcessing(true);
    try {
      await courseService.rejectCourse(rejectId, rejectReason);
      toast.success('Đã từ chối khóa học.');
      setCourses(courses.filter(c => c.id !== rejectId));
      setRejectId(null);
      setRejectReason('');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Từ chối khóa học thất bại');
    } finally {
      setIsProcessing(false);
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="p-2 bg-white border border-gray-200 shadow-sm rounded-lg hover:bg-gray-50">
            <FiChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Hàng đợi Phê duyệt Khóa học</h1>
            <p className="text-gray-500 text-sm">Xem xét các khóa học do giảng viên đăng lên</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 w-full md:w-auto">
          <input
            type="text"
            placeholder="Tìm kiếm tiêu đề khóa học..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            className="input-field max-w-sm"
          />
          <div className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg font-medium shadow-sm flex items-center gap-2 whitespace-nowrap">
            <FiClock /> {courses.length} Chờ duyệt
          </div>
        </div>
      </div>

      <div className="card overflow-hidden !p-0 shadow-md">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Chi tiết Khóa học</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Mã Giảng viên</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Danh mục & Cấp độ</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Ngày đăng</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Hành động</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {courses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <FiCheckCircle size={48} className="text-green-300 mb-4" />
                      <p className="text-lg font-medium text-gray-700">Đã xử lý xong!</p>
                      <p>Không có khóa học nào chờ phê duyệt.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                courses.map((course) => (
                  <tr key={course.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        {course.thumbnail ? (
                          <img src={course.thumbnail} alt={course.title} className="w-16 h-12 object-cover rounded shadow-sm mr-4" />
                        ) : (
                          <div className="w-16 h-12 bg-primary-100 text-primary-500 rounded flex items-center justify-center mr-4 text-xs font-medium">Không có ảnh</div>
                        )}
                        <div>
                          <Link to={`/courses/${course.slug}`} target="_blank" className="font-semibold text-gray-900 hover:text-primary-600 text-base flex items-center gap-2">
                            {course.title}
                          </Link>
                          <div className="text-sm text-gray-500 truncate max-w-[250px]">
                            {course.description || "Không có mô tả."}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm bg-gray-50/50">
                      <span className="font-mono text-gray-600">{course.instructorId.substring(0, 10)}...</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{course.category?.name || 'Chưa phân loại'}</div>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        course.level === 'BEGINNER' ? 'bg-green-100 text-green-800' :
                        course.level === 'INTERMEDIATE' ? 'bg-blue-100 text-blue-800' :
                        'bg-purple-100 text-purple-800'
                      }`}>
                        {course.level}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(course.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end gap-2">
                        <Link to={`/courses/${course.slug}`} target="_blank" className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors popup-trigger" title="Xem trước Khóa học">
                          <FiEye size={20} />
                        </Link>
                        <button
                          onClick={() => handleApprove(course.id)}
                          disabled={isProcessing}
                          className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors ring-1 ring-green-200"
                          title="Phê duyệt & Xuất bản"
                        >
                          <FiCheckCircle size={20} />
                        </button>
                        <button
                          onClick={() => setRejectId(course.id)}
                          disabled={isProcessing}
                          className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors ring-1 ring-red-200"
                          title="Từ chối"
                        >
                          <FiXCircle size={20} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-8 gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-white border rounded-lg text-gray-600 disabled:opacity-50 hover:bg-gray-50"
          >
            Trước
          </button>
          <span className="px-4 py-2 text-gray-700 font-medium">Trang {page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-white border rounded-lg text-gray-600 disabled:opacity-50 hover:bg-gray-50"
          >
            Tiếp
          </button>
        </div>
      )}

      {/* Reject Modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">Từ chối Khóa học</h3>
              <p className="text-sm text-gray-500 mt-1">Vui lòng cung cấp lý do. Giảng viên sẽ nhận được phản hồi này.</p>
            </div>
            
            <form onSubmit={submitReject} className="p-6">
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Lý do từ chối <span className="text-red-500">*</span></label>
                <textarea
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="input-field min-h-[120px] resize-none"
                  placeholder="VD: Chất lượng âm thanh trong bài 2 quá thấp. Vui lòng ghi âm lại."
                  autoFocus
                />
              </div>
              
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setRejectId(null); setRejectReason(''); }}
                  disabled={isProcessing}
                  className="btn-secondary px-6"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isProcessing || !rejectReason.trim()}
                  className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition font-medium shadow-lg shadow-red-200 disabled:opacity-50 flex items-center gap-2"
                >
                  {isProcessing ? 'Đang xử lý...' : 'Xác nhận Từ chối'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
