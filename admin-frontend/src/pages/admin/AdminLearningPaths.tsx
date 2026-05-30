import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminPathService, AdminLearningPath } from '../../services/admin-path.service';
import { FiPlus, FiEdit2, FiTrash2, FiCopy, FiSearch, FiFilter } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function AdminLearningPaths() {
  const [paths, setPaths] = useState<AdminLearningPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });

  useEffect(() => {
    loadPaths();
  }, [filters.status, pagination.page]);

  const loadPaths = async () => {
    try {
      setLoading(true);
      const data = await adminPathService.getPaths({
        search: filters.search,
        status: filters.status,
        page: pagination.page,
        limit: pagination.limit
      });
      setPaths(data.paths || []);
      setPagination(data.pagination || { page: 1, limit: 10, total: 0, totalPages: 0 });
    } catch (error) {
      toast.error('Tải danh sách lộ trình thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPagination(p => ({ ...p, page: 1 }));
    loadPaths();
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa lộ trình "${title}"?`)) return;
    try {
      await adminPathService.deletePath(id);
      toast.success('Xóa lộ trình thành công');
      loadPaths();
    } catch {
      toast.error('Xóa lộ trình thất bại');
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await adminPathService.duplicatePath(id);
      toast.success('Nhân bản lộ trình thành công');
      loadPaths();
    } catch {
      toast.error('Nhân bản lộ trình thất bại');
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await adminPathService.updateStatus(id, newStatus);
      toast.success('Cập nhật trạng thái thành công');
      loadPaths();
    } catch {
      toast.error('Cập nhật trạng thái thất bại');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 select-none font-sans bg-slate-50 min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quản lý Lộ trình Học tập</h1>
          <p className="text-sm text-slate-500 mt-1">Quản lý các lộ trình, khóa học và điều kiện tiên quyết</p>
        </div>
        <Link
          to="/admin/learning-paths/create"
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
        >
          <FiPlus className="w-5 h-5" />
          Tạo Lộ trình mới
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-4 justify-between bg-slate-50/50">
          <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm kiếm lộ trình..."
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </form>
          
          <div className="flex items-center gap-2">
            <FiFilter className="text-slate-400" />
            <select
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="DRAFT">Bản nháp (DRAFT)</option>
              <option value="PUBLISHED">Đã xuất bản (PUBLISHED)</option>
              <option value="ARCHIVED">Đã lưu trữ (ARCHIVED)</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-medium">Thông tin Lộ trình</th>
                <th className="px-6 py-4 font-medium">Khóa học</th>
                <th className="px-6 py-4 font-medium">Học viên</th>
                <th className="px-6 py-4 font-medium">Trạng thái</th>
                <th className="px-6 py-4 font-medium text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-400">Đang tải...</td>
                </tr>
              ) : paths.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-400">Không tìm thấy lộ trình học tập nào</td>
                </tr>
              ) : paths.map((path) => (
                <tr key={path.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {path.imageUrl ? (
                        <img src={path.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover bg-slate-100" />
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-slate-100 flex items-center justify-center text-slate-400 font-bold">
                          {path.title?.charAt(0) || '?'}
                        </div>
                      )}
                      <div>
                        <p className="font-bold text-slate-900">{path.title}</p>
                        <p className="text-xs text-slate-500">{path.category || 'Chưa phân loại'} • {
                          path.difficulty === 'BEGINNER' ? 'Cơ bản' : 
                          path.difficulty === 'INTERMEDIATE' ? 'Trung cấp' : 
                          path.difficulty === 'ADVANCED' ? 'Nâng cao' : 'Mọi cấp độ'
                        }</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-medium">
                    {path.courseIds?.length || 0} <span className="text-slate-400 font-normal">khóa học</span>
                  </td>
                  <td className="px-6 py-4 font-medium">
                    {path.enrollmentCount} <span className="text-slate-400 font-normal">học viên</span>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      className={`text-xs font-bold px-2 py-1 rounded-full outline-none border cursor-pointer
                        ${path.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 
                          path.status === 'DRAFT' ? 'bg-amber-50 text-amber-600 border-amber-200' : 
                          'bg-slate-100 text-slate-600 border-slate-200'}`}
                      value={path.status}
                      onChange={(e) => handleStatusChange(path.id, e.target.value)}
                    >
                      <option value="DRAFT">BẢN NHÁP</option>
                      <option value="PUBLISHED">ĐÃ XUẤT BẢN</option>
                      <option value="ARCHIVED">ĐÃ LƯU TRỮ</option>
                    </select>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Link 
                        to={`/admin/learning-paths/${path.id}/edit`}
                        className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                        title="Sửa lộ trình"
                      >
                        <FiEdit2 className="w-4 h-4" />
                      </Link>
                      <button 
                        onClick={() => handleDuplicate(path.id)}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Nhân bản lộ trình"
                      >
                        <FiCopy className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(path.id, path.title)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Xóa lộ trình"
                      >
                        <FiTrash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 flex justify-between items-center bg-slate-50">
            <span className="text-sm text-slate-500">
              Đang hiển thị trang {pagination.page} trên {pagination.totalPages}
            </span>
            <div className="flex gap-1">
              <button
                disabled={pagination.page === 1}
                onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                className="px-3 py-1 border border-slate-300 rounded text-sm disabled:opacity-50 bg-white hover:bg-slate-100"
              >
                Trước
              </button>
              <button
                disabled={pagination.page === pagination.totalPages}
                onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                className="px-3 py-1 border border-slate-300 rounded text-sm disabled:opacity-50 bg-white hover:bg-slate-100"
              >
                Tiếp
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
