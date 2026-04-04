import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { userService, UserProfile } from '../services/user.service';
import {
  FiSearch, FiFilter, FiTrash2, FiX,
  FiUsers, FiChevronLeft, FiChevronRight, FiUser,
  FiMail, FiCalendar, FiMapPin, FiPhone,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';

// ============================
// User Detail Modal
// ============================
function UserDetailModal({
  user, isOpen, onClose,
}: {
  user: UserProfile | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-bold text-gray-900">Chi tiết Người dùng</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <FiX size={20} />
          </button>
        </div>
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-400 to-primary-600 rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold text-white">
                {user.fullName?.charAt(0)?.toUpperCase() || 'U'}
              </span>
            </div>
            <div>
              <h4 className="text-xl font-bold text-gray-900">{user.fullName}</h4>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                user.role === 'INSTRUCTOR' ? 'bg-blue-100 text-blue-700' :
                'bg-green-100 text-green-700'
              }`}>{user.role}</span>
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <FiMail className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Email</p>
                <p className="text-sm font-medium">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <FiPhone className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Điện thoại</p>
                <p className="text-sm font-medium">{user.phoneNumber || 'Không có'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <FiMapPin className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Địa chỉ</p>
                <p className="text-sm font-medium">{user.address || 'Không có'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <FiCalendar className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Tham gia</p>
                <p className="text-sm font-medium">{new Date(user.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          {/* Bio */}
          {user.bio && (
            <div>
              <h5 className="text-sm font-semibold text-gray-700 mb-1">Tiểu sử</h5>
              <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">{user.bio}</p>
            </div>
          )}

          {/* Education */}
          {user.education && user.education.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-gray-700 mb-2">Học vấn ({user.education.length})</h5>
              <div className="space-y-2">
                {user.education.map((edu) => (
                  <div key={edu.id} className="p-3 bg-gray-50 rounded-lg border-l-3 border-primary-400">
                    <p className="font-medium text-sm">{edu.degree} — {edu.fieldOfStudy}</p>
                    <p className="text-xs text-gray-500">{edu.institution}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Work */}
          {user.work && user.work.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-gray-700 mb-2">Kinh nghiệm làm việc ({user.work.length})</h5>
              <div className="space-y-2">
                {user.work.map((w) => (
                  <div key={w.id} className="p-3 bg-gray-50 rounded-lg border-l-3 border-blue-400">
                    <p className="font-medium text-sm">{w.position} {w.current && <span className="text-xs text-green-600">(Hiện tại)</span>}</p>
                    <p className="text-xs text-gray-500">{w.company}{w.location ? ` · ${w.location}` : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Badges */}
          {user.badges && user.badges.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-gray-700 mb-2">Huy hiệu</h5>
              <div className="flex flex-wrap gap-2">
                {user.badges.map((b, i) => (
                  <span key={i} className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full">🏆 {b}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================
// Admin Users Page
// ============================
export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const result = await userService.getAllUsers(page, 10, {
        search: search || undefined,
        role: roleFilter || undefined,
      });
      setUsers(result.users);
      setTotalPages(result.pagination.totalPages);
      setTotal(result.pagination.total);
    } catch (error) {
      console.error('Failed to load users:', error);
      toast.error('Không thể tải danh sách người dùng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser?.role === 'ADMIN') {
      loadUsers();
    }
  }, [currentUser, page, roleFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadUsers();
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setActionLoading(true);
    try {
      await userService.adminDeleteUser(deleteConfirm);
      toast.success('Xóa người dùng thành công');
      setDeleteConfirm(null);
      loadUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Xóa người dùng thất bại');
    }
    setActionLoading(false);
  };

  const getRoleBadge = (role: string) => {
    const styles: Record<string, string> = {
      ADMIN: 'bg-purple-100 text-purple-700',
      INSTRUCTOR: 'bg-blue-100 text-blue-700',
      STUDENT: 'bg-green-100 text-green-700',
    };
    return (
      <span className={`text-xs px-2 py-1 rounded-full font-medium ${styles[role] || 'bg-gray-100 text-gray-700'}`}>
        {role}
      </span>
    );
  };

  if (currentUser?.role !== 'ADMIN') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center">
        <p className="text-red-600 text-lg">Từ chối truy cập. Chỉ dành cho Quản trị viên.</p>
        <Link to="/dashboard" className="text-primary-600 hover:underline mt-2 inline-block">
          ← Quay lại Bảng điều khiển
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link to="/dashboard" className="hover:text-primary-600">Bảng điều khiển</Link>
            <span>/</span>
            <span className="text-gray-900">Quản lý Người dùng</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FiUsers className="text-primary-500" /> Quản lý Người dùng
          </h1>
          <p className="text-sm text-gray-500 mt-1">{total} tổng số người dùng</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm kiếm theo tên hoặc email..."
                className="input-field pl-10"
              />
            </div>
            <button type="submit" className="btn-primary">Tìm kiếm</button>
          </form>
          <div className="flex items-center gap-2">
            <FiFilter className="text-gray-400" size={18} />
            <select
              value={roleFilter}
              onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
              className="input-field w-auto"
            >
              <option value="">Tất cả Vai trò</option>
              <option value="STUDENT">Học viên</option>
              <option value="INSTRUCTOR">Giảng viên</option>
              <option value="ADMIN">Quản trị viên</option>
            </select>
          </div>
        </div>
      </div>

      {/* User Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12">
            <FiUsers className="mx-auto text-gray-300 mb-3" size={48} />
            <p className="text-gray-500">Không tìm thấy người dùng nào.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Người dùng</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Vai trò</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Trạng thái</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Ngày tham gia</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-primary-300 to-primary-500 rounded-full flex items-center justify-center">
                          <span className="text-sm font-bold text-white">
                            {u.fullName?.charAt(0)?.toUpperCase() || 'U'}
                          </span>
                        </div>
                        <span className="font-medium text-gray-900">{u.fullName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{u.email}</td>
                    <td className="py-3 px-4">{getRoleBadge(u.role)}</td>
                    <td className="py-3 px-4">
                      <span className={`w-2 h-2 rounded-full inline-block mr-1 ${u.isActive !== false ? 'bg-green-500' : 'bg-red-500'}`}></span>
                      <span className="text-sm text-gray-600">{u.isActive !== false ? 'Hoạt động' : 'Vô hiệu'}</span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setSelectedUser(u)}
                          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          title="Xem chi tiết"
                        >
                          <FiUser size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(u.userId)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Xóa người dùng"
                          disabled={u.email === currentUser?.email}
                        >
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <p className="text-sm text-gray-500">
              Trang {page} / {totalPages} ({total} người dùng)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg border hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiChevronLeft size={16} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                if (pageNum > totalPages) return null;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium ${
                      pageNum === page ? 'bg-primary-600 text-white' : 'border hover:bg-white text-gray-600'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="p-2 rounded-lg border hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User Detail Modal */}
      <UserDetailModal
        user={selectedUser}
        isOpen={!!selectedUser}
        onClose={() => setSelectedUser(null)}
      />

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Xóa Người dùng</h3>
            <p className="text-gray-600 mb-6">
              Bạn có chắc chắn muốn xóa người dùng này? Tất cả dữ liệu của họ bao gồm học vấn và kinh nghiệm làm việc sẽ bị xóa vĩnh viễn.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary">Hủy</button>
              <button onClick={handleDelete} disabled={actionLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium">
                {actionLoading ? 'Đang xóa...' : 'Xóa Người dùng'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
