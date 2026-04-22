import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { courseService, Course } from '../services/course.service';
import {
  FiCheckCircle, FiXCircle, FiEye, FiClock,
  FiSearch, FiTrash2, FiBook, FiFilter,
  FiChevronLeft, FiChevronRight
} from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function AdminCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Tabs
  const [activeTab, setActiveTab] = useState<'PENDING' | 'ALL'>('PENDING');

  // Pagination & Search
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modals Data
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Reset page when tab changes
    setPage(1);
    setSearchTerm('');
  }, [activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadCourses();
    }, 500);
    return () => clearTimeout(timer);
  }, [page, searchTerm, activeTab]);

  const loadCourses = async () => {
    setLoading(true);
    try {
      if (activeTab === 'PENDING') {
        const data = await courseService.getPendingCourses(page, 10, searchTerm);
        setCourses(data.data);
        setTotalPages(data.pagination?.totalPages || 1);
      } else {
        const data = await courseService.getCourses({
          page,
          limit: 10,
          search: searchTerm || undefined,
        });
        setCourses(data.courses);
        setTotalPages(data.pagination?.totalPages || 1);
      }
    } catch (error) {
      toast.error('Tải danh sách khóa học thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (courseId: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn phê duyệt khóa học này? Khóa học sẽ được xuất bản ngay lập tức.')) return;
    
    setIsProcessing(true);
    try {
      await courseService.approveCourse(courseId);
      toast.success('Phê duyệt và xuất bản khóa học thành công!');
      loadCourses();
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
      setRejectId(null);
      setRejectReason('');
      loadCourses();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Từ chối khóa học thất bại');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setIsProcessing(true);
    try {
      await courseService.deleteCourse(deleteConfirm);
      toast.success('Đã gỡ bỏ khóa học vi phạm!');
      setDeleteConfirm(null);
      loadCourses();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Gỡ bỏ khóa học thất bại');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header and Summary */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FiBook className="text-primary-500" /> Quản lý Khóa học
        </h1>
        <p className="text-sm text-gray-500 mt-1">Duyệt, tìm kiếm và quản lý nội dung khóa học trên hệ thống</p>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
        {/* Tabs */}
        <div className="border-b border-gray-100">
          <div className="flex px-4 pt-2">
            <button
              onClick={() => setActiveTab('PENDING')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'PENDING' 
                  ? 'border-primary-500 text-primary-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <FiClock /> Chờ phê duyệt
              {activeTab === 'PENDING' && courses.length > 0 && (
                <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">{courses.length}</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('ALL')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'ALL' 
                  ? 'border-primary-500 text-primary-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <FiFilter /> Tất cả Khóa học
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-50 bg-gray-50/30 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Tìm kiếm bằng tên khóa học..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
        </div>

        {/* Content Table */}
        <div className="flex-1 overflow-x-auto min-h-[400px]">
          {loading ? (
            <div className="flex justify-center items-center h-64">
               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : courses.length === 0 ? (
            <div className="text-center py-16">
              {activeTab === 'PENDING' ? (
                <>
                  <FiCheckCircle size={48} className="mx-auto text-green-300 mb-4" />
                  <p className="text-lg font-medium text-gray-700">Đã cập nhật xong!</p>
                  <p className="text-gray-500">Không có khóa học nào đang chờ phê duyệt.</p>
                </>
              ) : (
                <>
                  <FiBook size={48} className="mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">Không tìm thấy khóa học nào phù hợp.</p>
                </>
              )}
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Khóa học</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Thông tin</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Trạng thái</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Thao tác</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {courses.map((course) => (
                  <tr key={course.id} className="hover:bg-gray-50/50 transition-colors">
                    {/* KHÓA HỌC */}
                    <td className="px-6 py-4">
                      <div className="flex items-start">
                        {course.thumbnail ? (
                          <img src={course.thumbnail} alt={course.title} className="w-20 h-14 object-cover rounded shadow-sm mr-4 flex-shrink-0" />
                        ) : (
                          <div className="w-20 h-14 bg-primary-50 text-primary-400 rounded flex items-center justify-center mr-4 text-[10px] font-medium flex-shrink-0">
                            Không ảnh
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-gray-900 text-sm line-clamp-1" title={course.title}>
                            {course.title}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{course.category?.name || 'Không phân loại'}</p>
                          <p className="text-xs text-gray-400 mt-1 font-mono">ID KV: {course.instructorId.substring(0, 8)}</p>
                        </div>
                      </div>
                    </td>

                    {/* THÔNG TIN */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      <p>Giá: <span className="font-medium text-gray-900">{course.price ? `${course.price.toLocaleString('vi-VN')} ₫` : 'Miễn phí'}</span></p>
                      <p className="mt-0.5">Cấp độ: {course.level}</p>
                    </td>

                    {/* TRẠNG THÁI */}
                    <td className="px-6 py-4 whitespace-nowrap">
                       {activeTab === 'PENDING' ? (
                         <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
                           <FiClock size={12} /> Chờ duyệt
                         </span>
                       ) : (
                         course.published ? (
                           <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Đang xuất bản</span>
                         ) : course.approvalStatus === 'REJECTED' ? (
                           <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">Đã bị từ chối</span>
                         ) : (
                           <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Bản nháp / Ẩn</span>
                         )
                       )}
                    </td>

                    {/* THAO TÁC */}
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      <div className="flex justify-end gap-2">
                        {/* Always show View Course */}
                        <Link 
                          to={`/courses/${course.slug}`} 
                          target="_blank" 
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" 
                          title="Xem chi tiết nội dung (Mở tab mới)"
                        >
                          <FiEye size={18} />
                        </Link>

                        {activeTab === 'PENDING' && (
                          <>
                            <button
                              onClick={() => handleApprove(course.id)}
                              className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors ring-1 ring-green-200 bg-white"
                              title="Phê duyệt khóa học"
                            >
                              <FiCheckCircle size={18} />
                            </button>
                            <button
                              onClick={() => setRejectId(course.id)}
                              className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors ring-1 ring-red-200 bg-white"
                              title="Từ chối khóa học"
                            >
                              <FiXCircle size={18} />
                            </button>
                          </>
                        )}

                        {activeTab === 'ALL' && (
                          <button
                            onClick={() => setDeleteConfirm(course.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Gỡ bỏ khóa học vi phạm"
                          >
                            <FiTrash2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50/50 justify-end">
            <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                <FiChevronLeft size={16} />
              </button>
              <span className="px-4 text-sm font-medium text-gray-600">Trang {page} / {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="p-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                <FiChevronRight size={16} />
              </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {/* Reject Modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden animate-fadeIn">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Từ chối Khóa học</h3>
              <p className="text-sm text-gray-500 mt-1">Lý do từ chối sẽ được gửi đến giảng viên bằng email.</p>
            </div>
            
            <form onSubmit={submitReject} className="p-5">
              <div className="mb-4">
                <textarea
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 min-h-[120px] text-sm"
                  placeholder="VD: Chất lượng video không đạt yêu cầu..."
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 px-1">
                <button type="button" onClick={() => { setRejectId(null); setRejectReason(''); }} disabled={isProcessing} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
                  Hủy
                </button>
                <button type="submit" disabled={isProcessing || !rejectReason.trim()} className="px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-50">
                  Xác nhận Từ chối
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete/Remove Violating Course Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-fadeIn">
            <h3 className="text-lg font-bold text-gray-900 mb-2 text-red-600 flex items-center gap-2">
              <FiTrash2 /> Cảnh báo: Gỡ bỏ khóa học
            </h3>
            <p className="text-sm text-gray-600 mb-6">Bạn đang thực hiện thao tác xóa vĩnh viễn khóa học này khỏi hệ thống do vi phạm nguyên tắc. Tất cả dữ liệu của khóa học (bài học, tài nguyên học tập) sẽ bị mất hoàn toàn.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200">Hủy</button>
              <button onClick={handleDelete} disabled={isProcessing} className="px-5 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50">
                 {isProcessing ? 'Đang gỡ...' : 'Tôi chắc chắn xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
