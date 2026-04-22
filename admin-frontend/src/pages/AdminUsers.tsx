import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { userService, UserProfile } from '../services/user.service';
import {
  FiSearch, FiFilter, FiTrash2, FiX,
  FiUsers, FiChevronLeft, FiChevronRight, FiUser,
  FiMail, FiCalendar, FiMapPin, FiPhone,
  FiEdit3, FiSave
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { Navigate } from 'react-router-dom';

// ============================
// User Detail Modal
// ============================
// ... (Keeping exact same as before, see next block for details if needed, I'll put it here)
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
        </div>
      </div>
    </div>
  );
}

// ============================
// Edit Role Modal
// ============================
function EditRoleModal({
  user, isOpen, onClose, onSave, loading
}: {
  user: UserProfile | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (role: string, isActive: boolean) => void;
  loading: boolean;
}) {
  const [role, setRole] = useState(user?.role || 'STUDENT');
  const [isActive, setIsActive] = useState(user?.isActive !== false);

  useEffect(() => {
    if (user) {
      setRole(user.role);
      setIsActive(user.isActive !== false);
    }
  }, [user, isOpen]);

  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <FiEdit3 /> Phân quyền
        </h3>
        
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-sm font-medium text-gray-900">{user.fullName}</p>
            <p className="text-xs text-gray-500">{user.email}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vai trò</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'STUDENT' | 'INSTRUCTOR' | 'ADMIN')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="STUDENT">Học viên</option>
              <option value="INSTRUCTOR">Giảng viên</option>
              <option value="ADMIN">Quản trị viên</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Trạng thái tài khoản</label>
            <div className="flex items-center gap-2 mt-2">
              <input 
                type="checkbox" 
                id="activeStatus"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 text-primary-600 rounded"
              />
              <label htmlFor="activeStatus" className="text-sm text-gray-700">
                Cho phép hoạt động
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Hủy</button>
          <button onClick={() => onSave(role, isActive)} disabled={loading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium flex items-center gap-2">
            <FiSave size={16} /> {loading ? 'Đang lưu...' : 'Lưu lại'}
          </button>
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
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
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

  const handleUpdateRole = async (role: string, isActive: boolean) => {
    if (!editUser) return;
    setActionLoading(true);
    try {
      await userService.adminUpdateUser(editUser.userId, { role, isActive });
      toast.success('Cập nhật quyền thành công!');
      setEditUser(null);
      loadUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Cập nhật thất bại');
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
    return <Navigate to="/dashboard" />;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FiUsers className="text-primary-500" /> Quản lý Người dùng
          </h1>
          <p className="text-sm text-gray-500 mt-1">{total} người dùng trong hệ thống</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-4">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm kiếm..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-primary-500 transition-colors"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors">
            Tìm
          </button>
        </form>
        <div className="flex items-center gap-2">
          <FiFilter className="text-gray-400" size={18} />
          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="">Tất cả Vai trò</option>
            <option value="STUDENT">Học viên</option>
            <option value="INSTRUCTOR">Giảng viên</option>
            <option value="ADMIN">Quản trị viên</option>
          </select>
        </div>
      </div>

      {/* User Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
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
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Người dùng</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Vai trò</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Trạng thái</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
                          <span className="text-sm font-bold text-white">
                            {u.fullName?.charAt(0)?.toUpperCase() || 'U'}
                          </span>
                        </div>
                        <span className="font-medium text-gray-900">{u.fullName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{u.email}</td>
                    <td className="px-6 py-4">{getRoleBadge(u.role)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${u.isActive !== false ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        <span className="text-sm text-gray-600">{u.isActive !== false ? 'Hoạt động' : 'Tạm khóa'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditUser(u)}
                          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          title="Phân quyền"
                        >
                          <FiEdit3 size={18} />
                        </button>
                        <button
                          onClick={() => setSelectedUser(u)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Xem chi tiết"
                        >
                          <FiUser size={18} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(u.userId)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Xóa"
                          disabled={u.email === currentUser?.email}
                        >
                          <FiTrash2 size={18} />
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

      <UserDetailModal user={selectedUser} isOpen={!!selectedUser} onClose={() => setSelectedUser(null)} />
      <EditRoleModal user={editUser} isOpen={!!editUser} onClose={() => setEditUser(null)} onSave={handleUpdateRole} loading={actionLoading} />

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-fadeIn">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Xóa Người dùng</h3>
            <p className="text-sm text-gray-600 mb-6">Bạn có chắc chắn muốn xóa vĩnh viễn người dùng này? Thao tác này không thể hoàn tác.</p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg font-medium">Hủy</button>
              <button onClick={handleDelete} disabled={actionLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium">
                {actionLoading ? 'Đang xóa...' : 'Xóa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
