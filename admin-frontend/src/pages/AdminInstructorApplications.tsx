import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiUserCheck, FiFilter, FiCheck, FiX, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { useAuth } from '../hooks/useAuth';
import {
  instructorApplicationService,
  InstructorApplication,
  InstructorApplicationStatus,
} from '../services/instructor-application.service';

const STATUS_LABEL: Record<InstructorApplicationStatus, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
};
const STATUS_STYLE: Record<InstructorApplicationStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};
const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString('vi-VN') : '—');

// ============================
// Reject Modal (a reason is required)
// ============================
function RejectModal({ application, loading, onClose, onConfirm }: {
  application: InstructorApplication | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { setReason(''); }, [application]);
  if (!application) return null;
  const valid = reason.trim().length >= 3;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Từ chối đơn đăng ký</h3>
        <p className="text-sm text-gray-500 mb-4">{application.applicant?.fullName || application.userId} · {application.expertise}</p>
        <label className="block text-sm font-medium text-gray-700 mb-2">Lý do từ chối (người đăng ký sẽ thấy)</label>
        <textarea
          rows={4}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-primary-500"
          placeholder="VD: Vui lòng bổ sung kinh nghiệm giảng dạy hoặc chứng chỉ chuyên môn..."
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">Hủy</button>
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={!valid || loading}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
          >
            Từ chối
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================
// Instructor Applications Page
// ============================
export default function AdminInstructorApplications() {
  const { user: currentUser } = useAuth();
  const [applications, setApplications] = useState<InstructorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<InstructorApplicationStatus | ''>('PENDING');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [rejecting, setRejecting] = useState<InstructorApplication | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await instructorApplicationService.list(statusFilter, page, 10);
      setApplications(result.data);
      setTotalPages(Math.max(result.pagination.totalPages, 1));
      setTotal(result.pagination.total);
    } catch {
      toast.error('Không thể tải danh sách đơn đăng ký');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser?.role === 'ADMIN') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, statusFilter, page]);

  const handleApprove = async (application: InstructorApplication) => {
    if (!confirm(`Duyệt đơn của "${application.applicant?.fullName || application.userId}"? Tài khoản sẽ được chuyển sang quyền Giảng viên.`)) return;
    setActionLoading(true);
    try {
      await instructorApplicationService.approve(application.id);
      toast.success('Đã duyệt đơn đăng ký giảng viên');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Duyệt đơn thất bại');
    }
    setActionLoading(false);
  };

  const handleReject = async (reason: string) => {
    if (!rejecting) return;
    setActionLoading(true);
    try {
      await instructorApplicationService.reject(rejecting.id, reason);
      toast.success('Đã từ chối đơn đăng ký');
      setRejecting(null);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Từ chối đơn thất bại');
    }
    setActionLoading(false);
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
            <FiUserCheck className="text-primary-500" /> Đơn đăng ký Giảng viên
          </h1>
          <p className="text-sm text-gray-500 mt-1">{total} đơn{statusFilter ? ` (${STATUS_LABEL[statusFilter].toLowerCase()})` : ''}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-2">
        <FiFilter className="text-gray-400" size={18} />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as InstructorApplicationStatus | ''); setPage(1); }}
          className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
        >
          <option value="PENDING">Chờ duyệt</option>
          <option value="APPROVED">Đã duyệt</option>
          <option value="REJECTED">Đã từ chối</option>
          <option value="">Tất cả</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : applications.length === 0 ? (
          <div className="text-center py-12">
            <FiUserCheck className="mx-auto text-gray-300 mb-3" size={48} />
            <p className="text-gray-500">Không có đơn đăng ký nào.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Người đăng ký</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Chuyên môn</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Gửi lúc</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Trạng thái</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {applications.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50/50 transition-colors align-top">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{a.applicant?.fullName || '—'}</p>
                      <p className="text-xs text-gray-500">{a.applicant?.email || a.userId}</p>
                      {a.applicant && <p className="text-xs text-gray-400 mt-1">Vai trò hiện tại: {a.applicant.role}</p>}
                    </td>
                    <td className="px-6 py-4 max-w-sm">
                      <p className="text-sm text-gray-900">{a.expertise}</p>
                      {a.motivation && <p className="text-xs text-gray-500 mt-1 line-clamp-3">{a.motivation}</p>}
                      {a.source === 'LEGACY_PAYMENT' && <p className="text-xs text-amber-600 mt-1">Từ luồng thanh toán phí cũ</p>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">{formatDate(a.submittedAt)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                      {a.status !== 'PENDING' && <p className="text-xs text-gray-400 mt-1">{formatDate(a.reviewedAt)}</p>}
                      {a.rejectionReason && <p className="text-xs text-red-600 mt-1 max-w-xs">{a.rejectionReason}</p>}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      {a.status === 'PENDING' && (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleApprove(a)}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50"
                          >
                            <FiCheck size={14} /> Duyệt
                          </button>
                          <button
                            onClick={() => setRejecting(a)}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium disabled:opacity-50"
                          >
                            <FiX size={14} /> Từ chối
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <p className="text-sm text-gray-500">Trang {page} / {totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(page - 1)} disabled={page <= 1} className="p-2 rounded-lg border border-gray-200 disabled:opacity-40"><FiChevronLeft /></button>
              <button onClick={() => setPage(page + 1)} disabled={page >= totalPages} className="p-2 rounded-lg border border-gray-200 disabled:opacity-40"><FiChevronRight /></button>
            </div>
          </div>
        )}
      </div>

      <RejectModal application={rejecting} loading={actionLoading} onClose={() => setRejecting(null)} onConfirm={handleReject} />
    </div>
  );
}
