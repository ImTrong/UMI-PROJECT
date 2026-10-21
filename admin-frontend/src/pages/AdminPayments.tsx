import { useState, useEffect } from 'react';
import { paymentService, Payment } from '../services/payment.service';
import { useAuth } from '../hooks/useAuth';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { FiDollarSign, FiTrendingUp, FiRefreshCw } from 'react-icons/fi';
import { formatVND } from '../utils/currency';

export default function AdminPayments() {
  const { user } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasPrevPage: false,
    hasNextPage: false,
  });

  const [selectedRefundModal, setSelectedRefundModal] = useState<{
    refundId: string;
    orderNumber?: string;
    amount: number;
  } | null>(null);
  const [transferRefInput, setTransferRefInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [actualAmountInput, setActualAmountInput] = useState('');
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [paymentsData, statsData] = await Promise.all([
        paymentService.getAllPayments({ page: pagination.page, limit: pagination.limit }),
        paymentService.getPaymentStats(),
      ]);
      setPayments(paymentsData.payments);
      setPagination(paymentsData.pagination);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error('Tải dữ liệu thanh toán thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async (paymentId: string) => {
    const amount = prompt('Nhập số tiền muốn hoàn lại (để trống nếu hoàn toàn bộ):');
    const reason = prompt('Lý do hoàn tiền:');
    
    try {
      const refund = await paymentService.refundPayment(
        paymentId,
        amount ? parseFloat(amount) : undefined,
        reason || undefined
      );
      if (refund?.status === 'PENDING') {
        toast.success('Đã tạo yêu cầu hoàn tiền (Đang chờ xử lý / đối soát ngân hàng)');
      } else {
        toast.success('Xử lý hoàn tiền thành công');
      }
      loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Cấp hoàn tiền thất bại');
    }
  };

  const openConfirmModal = (refundId: string, amount: number, orderNumber?: string) => {
    setSelectedRefundModal({ refundId, amount, orderNumber });
    setTransferRefInput('');
    setNotesInput('');
    setActualAmountInput(String(amount));
  };

  const handleConfirmManualRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRefundModal) return;
    if (!transferRefInput.trim()) {
      toast.error('Vui lòng nhập mã tham chiếu giao dịch chuyển khoản ngân hàng (FT... / mã GD)');
      return;
    }

    try {
      setIsSubmittingRefund(true);
      await paymentService.confirmManualRefund(selectedRefundModal.refundId, {
        transferReference: transferRefInput.trim(),
        actualAmount: Number(actualAmountInput) || selectedRefundModal.amount,
        notes: notesInput.trim() || undefined,
      });
      toast.success('Đã xác nhận hoàn tiền và ghi nhận mã tham chiếu thành công');
      setSelectedRefundModal(null);
      loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Xác nhận hoàn tiền thất bại');
    } finally {
      setIsSubmittingRefund(false);
    }
  };

  if (loading && payments.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (user?.role !== 'ADMIN') {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Từ chối truy cập. Chỉ dành cho Quản trị viên.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Quản lý Thanh toán & Đối soát Cổng TT</h1>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <div className="flex items-center space-x-3">
              <FiDollarSign className="text-2xl text-green-500" />
              <div>
                <p className="text-xs text-gray-500">Tổng Thực thu Cổng TT</p>
                <p className="text-xl font-bold text-gray-900">
                  {formatVND(stats.totalRevenue)}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Thực nhận: {formatVND(stats.netRevenue ?? stats.totalRevenue)}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center space-x-3">
              <FiTrendingUp className="text-2xl text-blue-500" />
              <div>
                <p className="text-xs text-gray-500">Chưa đồng bộ Order</p>
                <p className="text-xl font-bold text-amber-600">
                  {stats.unsyncedCount || 0} giao dịch
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Số tiền: {formatVND(stats.unsyncedRevenue || 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center space-x-3">
              <FiRefreshCw className="text-2xl text-orange-500" />
              <div>
                <p className="text-xs text-gray-500">Khoản CẦN hoàn (Chờ duyệt)</p>
                <p className="text-xl font-bold text-red-600">
                  {formatVND(stats.pendingRefundAmount || 0)}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Đã hoàn: {formatVND(stats.completedRefundAmount || 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center space-x-3">
              <FiRefreshCw className="text-2xl text-purple-500" />
              <div>
                <p className="text-xs text-gray-500">Giao dịch đã thu tiền</p>
                <p className="text-xl font-bold text-gray-900">{stats.totalTransactions}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Thu đơn hủy: {stats.lateOnCancelledCount || 0} GD ({formatVND(stats.lateOnCancelledRevenue || 0)})
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payments Table */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-3 px-4">Đơn hàng / Mã TT</th>
              <th className="text-left py-3 px-4">Số tiền</th>
              <th className="text-left py-3 px-4">Trạng thái</th>
              <th className="text-left py-3 px-4">Ngày</th>
              <th className="text-left py-3 px-4">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => {
              const meta = (payment.metadata as any) || {};
              const isUnsynced = meta.orderSynced === false;
              const isLateCancelled = meta.reconciliationStatus === 'LATE_PAYMENT_ON_CANCELLED_ORDER';
              const isManualRefundPending = meta.reconciliationStatus === 'MANUAL_REFUND_PENDING';

              return (
                <tr key={payment.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-medium">{payment.orderNumber || payment.id.slice(-8)}</p>
                        {isUnsynced && (
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
                            Chưa sync
                          </span>
                        )}
                        {isLateCancelled && (
                          <span className="text-[10px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-bold">
                            Đơn CANCELLED
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">Người dùng: {payment.userId.slice(-8)}</p>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-medium">
                    <p>{formatVND(payment.amount)}</p>
                    {meta.pendingRefundAmount && meta.pendingRefundAmount > 0 ? (
                      <p className="text-[11px] text-red-600 font-semibold">
                        Cần hoàn: {formatVND(meta.pendingRefundAmount)}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      payment.status === 'SUCCEEDED' ? 'bg-green-100 text-green-700' :
                      payment.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                      payment.status === 'REFUNDED' ? 'bg-gray-100 text-gray-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {payment.status}
                    </span>
                    {isManualRefundPending && (
                      <span className="block text-[11px] text-amber-700 font-medium mt-1">
                        Chờ CK hoàn tiền
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-500">
                    {format(new Date(payment.createdAt), 'MMM dd, yyyy HH:mm')}
                  </td>
                  <td className="py-3 px-4 space-x-2">
                    {isManualRefundPending && meta.pendingRefundId ? (
                      <button
                        onClick={() => openConfirmModal(meta.pendingRefundId, meta.pendingRefundAmount || payment.amount, payment.orderNumber)}
                        className="text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-2 py-1 rounded border border-emerald-300 font-medium"
                      >
                        Xác nhận đã hoàn
                      </button>
                    ) : payment.status === 'SUCCEEDED' ? (
                      <button
                        onClick={() => handleRefund(payment.id)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Yêu cầu hoàn tiền
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex justify-center space-x-2 mt-4 pt-4 border-t">
            <button
              onClick={() => {
                setPagination({ ...pagination, page: pagination.page - 1 });
                loadData();
              }}
              disabled={!pagination.hasPrevPage}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Trước
            </button>
            <span className="px-3 py-1">
              Trang {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => {
                setPagination({ ...pagination, page: pagination.page + 1 });
                loadData();
              }}
              disabled={!pagination.hasNextPage}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Tiếp
            </button>
          </div>
        )}
      </div>
      {/* Modal Xác nhận Chuyển khoản Hoàn tiền Thủ công */}
      {selectedRefundModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-gray-100 animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Xác nhận Hoàn tiền Thủ công</h2>
            <p className="text-xs text-gray-500 mb-4">
              Nhập mã đối soát giao dịch ngân hàng để hoàn tất ghi nhận kế toán. Không thể đánh dấu nếu thiếu mã chuyển khoản.
            </p>

            <form onSubmit={handleConfirmManualRefundSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Mã đơn hàng</label>
                <input
                  type="text"
                  disabled
                  value={selectedRefundModal.orderNumber || 'N/A'}
                  className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded text-sm text-gray-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Mã tham chiếu chuyển khoản ngân hàng (FT / Mã GD) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: FT261015123456 hoặc VCB_889900"
                  value={transferRefInput}
                  onChange={(e) => setTransferRefInput(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Mã sao kê hoặc mã giao dịch trên Internet Banking khi Admin chuyển khoản.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Số tiền thực hoàn (VND)</label>
                <input
                  type="number"
                  value={actualAmountInput}
                  onChange={(e) => setActualAmountInput(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Ghi chú đối soát</label>
                <textarea
                  rows={2}
                  placeholder="Ghi chú ngân hàng chuyển hoặc lý do hoàn..."
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setSelectedRefundModal(null)}
                  disabled={isSubmittingRefund}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded border border-gray-300"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRefund || !transferRefInput.trim()}
                  className="px-4 py-2 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 font-medium"
                >
                  {isSubmittingRefund ? 'Đang xác nhận...' : 'Xác nhận Đã Chuyển khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
