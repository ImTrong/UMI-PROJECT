import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import {
  fetchProfile,
  updateProfile,
  addEducation,
  updateEducation,
  deleteEducation,
  addWorkExperience,
  updateWorkExperience,
  deleteWorkExperience,
  fetchUserStats,
} from '../store/userSlice';
import { useAuth } from '../hooks/useAuth';
import { Education, WorkExperience, CreateEducationData, CreateWorkData } from '../services/user.service';
import {
  FiUser, FiMail, FiPhone, FiMapPin, FiCalendar, FiEdit2, FiPlus,
  FiTrash2, FiSave, FiX, FiBriefcase, FiBook, FiAward, FiBarChart2, FiLock,
} from 'react-icons/fi';
import { authService } from '../services/auth.service';

// ============================
// Education Modal Component
// ============================
function EducationModal({
  isOpen, onClose, onSubmit, initialData, loading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateEducationData) => void;
  initialData?: Education | null;
  loading?: boolean;
}) {
  const [form, setForm] = useState<CreateEducationData>({
    institution: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '', grade: '', description: '',
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        institution: initialData.institution,
        degree: initialData.degree,
        fieldOfStudy: initialData.fieldOfStudy,
        startDate: initialData.startDate?.split('T')[0] || '',
        endDate: initialData.endDate?.split('T')[0] || '',
        grade: initialData.grade || '',
        description: initialData.description || '',
      });
    } else {
      setForm({ institution: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '', grade: '', description: '' });
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-bold text-gray-900">
            {initialData ? 'Chỉnh sửa Học vấn' : 'Thêm Học vấn mới'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <FiX size={20} />
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên trường *</label>
            <input type="text" required value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })}
              className="input-field" placeholder="VD: Đại học Bách Khoa Hà Nội" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bằng cấp *</label>
              <input type="text" required value={form.degree}
                onChange={(e) => setForm({ ...form, degree: e.target.value })}
                className="input-field" placeholder="VD: Cử nhân" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngành học *</label>
              <input type="text" required value={form.fieldOfStudy}
                onChange={(e) => setForm({ ...form, fieldOfStudy: e.target.value })}
                className="input-field" placeholder="VD: Khoa học máy tính" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày bắt đầu *</label>
              <input type="date" required value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày kết thúc</label>
              <input type="date" value={form.endDate || ''}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="input-field" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Xếp loại / GPA</label>
            <input type="text" value={form.grade || ''}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
              className="input-field" placeholder="VD: 3.2/4.0 GPA hoặc Giỏi" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả thêm</label>
            <textarea value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field" rows={3} placeholder="Hoạt động, thành tích..." />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              <FiSave size={16} />
              {loading ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================
// Work Experience Modal Component
// ============================
function WorkModal({
  isOpen, onClose, onSubmit, initialData, loading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateWorkData) => void;
  initialData?: WorkExperience | null;
  loading?: boolean;
}) {
  const [form, setForm] = useState<CreateWorkData>({
    company: '', position: '', location: '', startDate: '', endDate: '', current: false, description: '',
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        company: initialData.company,
        position: initialData.position,
        location: initialData.location || '',
        startDate: initialData.startDate?.split('T')[0] || '',
        endDate: initialData.endDate?.split('T')[0] || '',
        current: initialData.current,
        description: initialData.description || '',
      });
    } else {
      setForm({ company: '', position: '', location: '', startDate: '', endDate: '', current: false, description: '' });
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-bold text-gray-900">
            {initialData ? 'Chỉnh sửa Kinh nghiệm' : 'Thêm Kinh nghiệm mới'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <FiX size={20} />
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Công ty *</label>
              <input type="text" required value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="input-field" placeholder="VD: VNPT" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vị trí *</label>
              <input type="text" required value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                className="input-field" placeholder="VD: Lập trình viên" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Địa điểm</label>
            <input type="text" value={form.location || ''}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="input-field" placeholder="VD: Hà Nội, VN" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày bắt đầu *</label>
              <input type="date" required value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày kết thúc</label>
              <input type="date" value={form.endDate || ''} disabled={form.current}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="input-field disabled:bg-gray-100" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="current" checked={form.current}
              onChange={(e) => setForm({ ...form, current: e.target.checked, endDate: e.target.checked ? '' : form.endDate })}
              className="w-4 h-4 text-primary-600 rounded" />
            <label htmlFor="current" className="text-sm text-gray-700">Tôi đang làm công việc này</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả công việc</label>
            <textarea value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field" rows={3} placeholder="Nhiệm vụ, dự án, thành tựu..." />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              <FiSave size={16} />
              {loading ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================
// Confirm Dialog
// ============================
function ConfirmDialog({
  isOpen, onClose, onConfirm, title, message, loading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  loading?: boolean;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end space-x-3">
          <button onClick={onClose} className="btn-secondary">Hủy bỏ</button>
          <button onClick={onConfirm} disabled={loading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium">
            {loading ? 'Đang xóa...' : 'Xóa dữ liệu'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================
// Main Profile Page
// ============================
export default function Profile() {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useAuth();
  const { profile, stats, loading } = useSelector((state: RootState) => state.user);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'education' | 'work' | 'stats' | 'security'>('overview');
  const [actionLoading, setActionLoading] = useState(false);

  // Security Form State
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState({ type: '', text: '' });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Mật khẩu mới không khớp' });
      return;
    }
    setPasswordLoading(true);
    setPasswordMessage({ type: '', text: '' });
    try {
      await authService.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordMessage({ type: 'success', text: 'Đổi mật khẩu thành công' });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      setPasswordMessage({ type: 'error', text: err.response?.data?.error || 'Đổi mật khẩu thất bại' });
    } finally {
      setPasswordLoading(false);
    }
  };

  // Profile form
  const [formData, setFormData] = useState({
    fullName: '', bio: '', phoneNumber: '', address: '', dateOfBirth: '',
  });

  // Education modal state
  const [eduModalOpen, setEduModalOpen] = useState(false);
  const [editingEdu, setEditingEdu] = useState<Education | null>(null);
  const [deleteEduConfirm, setDeleteEduConfirm] = useState<string | null>(null);

  // Work modal state
  const [workModalOpen, setWorkModalOpen] = useState(false);
  const [editingWork, setEditingWork] = useState<WorkExperience | null>(null);
  const [deleteWorkConfirm, setDeleteWorkConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      dispatch(fetchProfile());
      dispatch(fetchUserStats());
    }
  }, [dispatch, user]);

  useEffect(() => {
    if (profile) {
      setFormData({
        fullName: profile.fullName || '',
        bio: profile.bio || '',
        phoneNumber: profile.phoneNumber || '',
        address: profile.address || '',
        dateOfBirth: profile.dateOfBirth?.split('T')[0] || '',
      });
    }
  }, [profile]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await dispatch(updateProfile(formData)).unwrap();
      setIsEditing(false);
    } catch {
      // handled by slice
    }
  };

  // Education handlers
  const handleAddEducation = async (data: CreateEducationData) => {
    setActionLoading(true);
    try {
      await dispatch(addEducation(data)).unwrap();
      setEduModalOpen(false);
    } catch { /* handled */ }
    setActionLoading(false);
  };

  const handleUpdateEducation = async (data: CreateEducationData) => {
    if (!editingEdu) return;
    setActionLoading(true);
    try {
      await dispatch(updateEducation({ id: editingEdu.id, data })).unwrap();
      setEditingEdu(null);
      setEduModalOpen(false);
    } catch { /* handled */ }
    setActionLoading(false);
  };

  const handleDeleteEducation = async () => {
    if (!deleteEduConfirm) return;
    setActionLoading(true);
    try {
      await dispatch(deleteEducation(deleteEduConfirm)).unwrap();
      setDeleteEduConfirm(null);
    } catch { /* handled */ }
    setActionLoading(false);
  };

  // Work handlers
  const handleAddWork = async (data: CreateWorkData) => {
    setActionLoading(true);
    try {
      await dispatch(addWorkExperience(data)).unwrap();
      setWorkModalOpen(false);
    } catch { /* handled */ }
    setActionLoading(false);
  };

  const handleUpdateWork = async (data: CreateWorkData) => {
    if (!editingWork) return;
    setActionLoading(true);
    try {
      await dispatch(updateWorkExperience({ id: editingWork.id, data })).unwrap();
      setEditingWork(null);
      setWorkModalOpen(false);
    } catch { /* handled */ }
    setActionLoading(false);
  };

  const handleDeleteWork = async () => {
    if (!deleteWorkConfirm) return;
    setActionLoading(true);
    try {
      await dispatch(deleteWorkExperience(deleteWorkConfirm)).unwrap();
      setDeleteWorkConfirm(null);
    } catch { /* handled */ }
    setActionLoading(false);
  };

  if (loading && !profile) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const tabs = [
    { key: 'overview' as const, label: 'Tổng quan', icon: FiUser },
    { key: 'education' as const, label: 'Học vấn', icon: FiBook },
    { key: 'work' as const, label: 'Kinh nghiệm làm việc', icon: FiBriefcase },
    { key: 'stats' as const, label: 'Thống kê', icon: FiBarChart2 },
    { key: 'security' as const, label: 'Bảo mật', icon: FiLock },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* ========== Profile Header ========== */}
      <div className="card">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-20 h-20 bg-gradient-to-br from-primary-400 to-primary-600 rounded-full flex items-center justify-center shadow-lg">
              <span className="text-3xl font-bold text-white">
                {profile?.fullName?.charAt(0)?.toUpperCase() || 'U'}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{profile?.fullName}</h1>
              <span className={`inline-block mt-1 text-xs px-3 py-1 rounded-full font-medium ${
                profile?.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                profile?.role === 'INSTRUCTOR' ? 'bg-blue-100 text-blue-700' :
                'bg-green-100 text-green-700'
              }`}>
                {profile?.role}
              </span>
              {profile?.bio && <p className="text-gray-500 text-sm mt-1 max-w-md">{profile.bio}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-gray-500">
            {profile?.email && (
              <div className="flex items-center gap-1"><FiMail size={14} /> {profile.email}</div>
            )}
            {profile?.phoneNumber && (
              <div className="flex items-center gap-1"><FiPhone size={14} /> {profile.phoneNumber}</div>
            )}
            {profile?.address && (
              <div className="flex items-center gap-1"><FiMapPin size={14} /> {profile.address}</div>
            )}
            {profile?.createdAt && (
              <div className="flex items-center gap-1">
                <FiCalendar size={14} /> Tham gia từ {new Date(profile.createdAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========== Badges ========== */}
      {profile?.badges && profile.badges.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <FiAward className="text-primary-500" /> Huy hiệu & Thành tựu
          </h2>
          <div className="flex flex-wrap gap-2">
            {profile.badges.map((badge, i) => (
              <span key={i} className="px-3 py-1 bg-gradient-to-r from-yellow-100 to-amber-100 text-amber-700 rounded-full text-sm font-medium">
                🏆 {badge}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ========== Tabs ========== */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
              {tab.key === 'education' && profile?.education?.length ? (
                <span className="bg-primary-100 text-primary-600 px-2 py-0.5 rounded-full text-xs">{profile.education.length}</span>
              ) : null}
              {tab.key === 'work' && profile?.work?.length ? (
                <span className="bg-primary-100 text-primary-600 px-2 py-0.5 rounded-full text-xs">{profile.work.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      {/* ========== Tab Content ========== */}

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Thông tin cá nhân</h2>
            <button onClick={() => setIsEditing(!isEditing)}
              className="text-primary-600 hover:text-primary-700 flex items-center gap-1 text-sm font-medium">
              <FiEdit2 size={16} /> {isEditing ? 'Hủy' : 'Chỉnh sửa'}
            </button>
          </div>

          {isEditing ? (
            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Họ và tên</label>
                  <input type="text" value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="input-field" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Số điện thoại</label>
                  <input type="tel" value={formData.phoneNumber}
                    onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                    className="input-field" placeholder="+84 xxx xxx xxx" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Địa chỉ</label>
                  <input type="text" value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="input-field" placeholder="Thành phố, Quốc gia" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ngày sinh</label>
                  <input type="date" value={formData.dateOfBirth}
                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                    className="input-field" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Giới thiệu bản thân (Bio)</label>
                <textarea value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  className="input-field" rows={3} placeholder="Giới thiệu đôi nét về bạn..." />
              </div>
              <div className="flex space-x-3">
                <button type="submit" className="btn-primary flex items-center gap-2">
                  <FiSave size={16} /> Lưu thay đổi
                </button>
                <button type="button" onClick={() => setIsEditing(false)} className="btn-secondary">
                  Hủy bỏ
                </button>
              </div>
            </form>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { label: 'Họ và tên', value: profile?.fullName, icon: FiUser },
                { label: 'Email', value: profile?.email, icon: FiMail },
                { label: 'Số điện thoại', value: profile?.phoneNumber || 'Chưa thiết lập', icon: FiPhone },
                { label: 'Địa chỉ', value: profile?.address || 'Chưa thiết lập', icon: FiMapPin },
                { label: 'Ngày sinh', value: profile?.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString() : 'Chưa thiết lập', icon: FiCalendar },
                { label: 'Tham gia từ', value: profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '', icon: FiCalendar },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                  <item.icon className="text-primary-500 mt-0.5" size={18} />
                  <div>
                    <p className="text-xs text-gray-500">{item.label}</p>
                    <p className="text-sm font-medium text-gray-900">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Education Tab */}
      {activeTab === 'education' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Học vấn</h2>
            <button onClick={() => { setEditingEdu(null); setEduModalOpen(true); }}
              className="btn-primary flex items-center gap-2 text-sm">
              <FiPlus size={16} /> Thêm Học vấn
            </button>
          </div>

          {profile?.education && profile.education.length > 0 ? (
            <div className="space-y-4">
              {profile.education.map((edu) => (
                <div key={edu.id} className="card border-l-4 border-primary-500">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900">{edu.degree}</h3>
                      <p className="text-primary-600 font-medium">{edu.institution}</p>
                      <p className="text-sm text-gray-500">{edu.fieldOfStudy}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        {new Date(edu.startDate).toLocaleDateString('vi-VN', { year: 'numeric', month: 'short' })} — {' '}
                        {edu.endDate ? new Date(edu.endDate).toLocaleDateString('vi-VN', { year: 'numeric', month: 'short' }) : 'Hiện tại'}
                      </p>
                      {edu.grade && <p className="text-sm text-gray-600 mt-1">Xếp loại: {edu.grade}</p>}
                      {edu.description && <p className="text-sm text-gray-600 mt-2">{edu.description}</p>}
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button onClick={() => { setEditingEdu(edu); setEduModalOpen(true); }}
                        className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                        <FiEdit2 size={16} />
                      </button>
                      <button onClick={() => setDeleteEduConfirm(edu.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <FiTrash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card text-center py-12">
              <FiBook className="mx-auto text-gray-300 mb-3" size={48} />
              <p className="text-gray-500 mb-4">Chưa có thông tin học vấn nào được thêm.</p>
              <button onClick={() => { setEditingEdu(null); setEduModalOpen(true); }}
                className="btn-primary text-sm">
                <FiPlus className="inline mr-1" size={14} /> Thêm Học vấn đầu tiên của bạn
              </button>
            </div>
          )}
        </div>
      )}

      {/* Work Experience Tab */}
      {activeTab === 'work' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Kinh nghiệm làm việc</h2>
            <button onClick={() => { setEditingWork(null); setWorkModalOpen(true); }}
              className="btn-primary flex items-center gap-2 text-sm">
              <FiPlus size={16} /> Thêm Kinh nghiệm
            </button>
          </div>

          {profile?.work && profile.work.length > 0 ? (
            <div className="space-y-4">
              {profile.work.map((work) => (
                <div key={work.id} className={`card border-l-4 ${work.current ? 'border-green-500' : 'border-gray-300'}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-900">{work.position}</h3>
                        {work.current && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Hiện tại</span>
                        )}
                      </div>
                      <p className="text-primary-600 font-medium">{work.company}</p>
                      {work.location && <p className="text-sm text-gray-500">{work.location}</p>}
                      <p className="text-sm text-gray-400 mt-1">
                        {new Date(work.startDate).toLocaleDateString('vi-VN', { year: 'numeric', month: 'short' })} — {' '}
                        {work.current ? 'Hiện tại' : work.endDate ? new Date(work.endDate).toLocaleDateString('vi-VN', { year: 'numeric', month: 'short' }) : 'Hiện tại'}
                      </p>
                      {work.description && <p className="text-sm text-gray-600 mt-2">{work.description}</p>}
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button onClick={() => { setEditingWork(work); setWorkModalOpen(true); }}
                        className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                        <FiEdit2 size={16} />
                      </button>
                      <button onClick={() => setDeleteWorkConfirm(work.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <FiTrash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card text-center py-12">
              <FiBriefcase className="mx-auto text-gray-300 mb-3" size={48} />
              <p className="text-gray-500 mb-4">Chưa có kinh nghiệm làm việc nào được thêm.</p>
              <button onClick={() => { setEditingWork(null); setWorkModalOpen(true); }}
                className="btn-primary text-sm">
                <FiPlus className="inline mr-1" size={14} /> Thêm Kinh nghiệm đầu tiên của bạn
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stats Tab */}
      {activeTab === 'stats' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Thống kê của bạn</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card text-center">
              <FiBook className="mx-auto text-primary-500 mb-2" size={28} />
              <p className="text-2xl font-bold text-gray-900">{stats?.totalEducation ?? profile?.education?.length ?? 0}</p>
              <p className="text-sm text-gray-500">Học vấn</p>
            </div>
            <div className="card text-center">
              <FiBriefcase className="mx-auto text-blue-500 mb-2" size={28} />
              <p className="text-2xl font-bold text-gray-900">{stats?.totalWorkExperience ?? profile?.work?.length ?? 0}</p>
              <p className="text-sm text-gray-500">Kinh nghiệm</p>
            </div>
            <div className="card text-center">
              <FiAward className="mx-auto text-amber-500 mb-2" size={28} />
              <p className="text-2xl font-bold text-gray-900">{stats?.badges?.length ?? profile?.badges?.length ?? 0}</p>
              <p className="text-sm text-gray-500">Huy hiệu</p>
            </div>
            <div className="card text-center">
              <FiCalendar className="mx-auto text-green-500 mb-2" size={28} />
              <p className="text-2xl font-bold text-gray-900">
                {stats?.createdAt || profile?.createdAt
                  ? Math.floor((Date.now() - new Date(stats?.createdAt || profile!.createdAt).getTime()) / (1000 * 60 * 60 * 24))
                  : 0}
              </p>
              <p className="text-sm text-gray-500">Ngày tham gia</p>
            </div>
          </div>

          {stats?.currentWork && (
            <div className="card">
              <h3 className="font-semibold text-gray-700 mb-2">Công việc hiện tại</h3>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <FiBriefcase className="text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{stats.currentWork.position}</p>
                  <p className="text-sm text-gray-500">{stats.currentWork.company}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="card max-w-lg">
          <h2 className="text-lg font-semibold mb-4">Đổi Mật khẩu</h2>
          {passwordMessage.text && (
            <div className={`p-3 mb-4 text-sm rounded-md ${passwordMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {passwordMessage.text}
            </div>
          )}
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu hiện tại</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  className="input-field pl-10"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu mới</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className="input-field pl-10"
                  required
                  minLength={6}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Xác nhận mật khẩu mới</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  className="input-field pl-10"
                  required
                  minLength={6}
                />
              </div>
            </div>
            <button type="submit" disabled={passwordLoading} className="btn-primary w-full disabled:opacity-50">
              {passwordLoading ? 'Đang cập nhật...' : 'Cập nhật Mật khẩu'}
            </button>
          </form>
        </div>
      )}

      {/* ========== Modals ========== */}
      <EducationModal
        isOpen={eduModalOpen}
        onClose={() => { setEduModalOpen(false); setEditingEdu(null); }}
        onSubmit={editingEdu ? handleUpdateEducation : handleAddEducation}
        initialData={editingEdu}
        loading={actionLoading}
      />

      <WorkModal
        isOpen={workModalOpen}
        onClose={() => { setWorkModalOpen(false); setEditingWork(null); }}
        onSubmit={editingWork ? handleUpdateWork : handleAddWork}
        initialData={editingWork}
        loading={actionLoading}
      />

      <ConfirmDialog
        isOpen={!!deleteEduConfirm}
        onClose={() => setDeleteEduConfirm(null)}
        onConfirm={handleDeleteEducation}
        title="Xóa Học vấn"
        message="Bạn có chắc chắn muốn xóa học vấn này? Hành động này không thể hoàn tác."
        loading={actionLoading}
      />

      <ConfirmDialog
        isOpen={!!deleteWorkConfirm}
        onClose={() => setDeleteWorkConfirm(null)}
        onConfirm={handleDeleteWork}
        title="Xóa Kinh nghiệm"
        message="Bạn có chắc chắn muốn xóa kinh nghiệm làm việc này? Hành động này không thể hoàn tác."
        loading={actionLoading}
      />
    </div>
  );
}
