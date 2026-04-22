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
      await paymentService.refundPayment(
        paymentId,
        amount ? parseFloat(amount) : undefined,
        reason || undefined
      );
      toast.success('Xử lý hoàn tiền thành công');
      loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Cấp hoàn tiền thất bại');
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
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Quản lý Thanh toán</h1>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card">
            <div className="flex items-center space-x-3">
              <FiDollarSign className="text-2xl text-green-500" />
              <div>
                <p className="text-sm text-gray-500">Tổng Doanh thu</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatVND(stats.totalRevenue)}
                </p>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="flex items-center space-x-3">
              <FiTrendingUp className="text-2xl text-blue-500" />
              <div>
                <p className="text-sm text-gray-500">Tổng Giao dịch</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalTransactions}</p>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="flex items-center space-x-3">
              <FiRefreshCw className="text-2xl text-orange-500" />
              <div>
                <p className="text-sm text-gray-500">Tỷ lệ Thành công</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats.totalTransactions > 0
                    ? ((stats.byStatus.find((s: any) => s.status === 'SUCCEEDED')?._count || 0) /
                        stats.totalTransactions *
                        100).toFixed(1)
                    : 0}%
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
              <th className="text-left py-3 px-4">Đơn hàng</th>
              <th className="text-left py-3 px-4">Số tiền</th>
              <th className="text-left py-3 px-4">Trạng thái</th>
              <th className="text-left py-3 px-4">Ngày</th>
              <th className="text-left py-3 px-4">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 px-4">
                  <div>
                    <p className="font-medium">{payment.orderNumber}</p>
                    <p className="text-xs text-gray-500">Người dùng: {payment.userId.slice(-8)}</p>
                  </div>
                </td>
                <td className="py-3 px-4 font-medium">{formatVND(payment.amount)}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    payment.status === 'SUCCEEDED' ? 'bg-green-100 text-green-700' :
                    payment.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                    payment.status === 'REFUNDED' ? 'bg-gray-100 text-gray-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {payment.status}
                  </span>
                </td>
                <td className="py-3 px-4 text-sm text-gray-500">
                  {format(new Date(payment.createdAt), 'MMM dd, yyyy HH:mm')}
                </td>
                <td className="py-3 px-4">
                  {payment.status === 'SUCCEEDED' && (
                    <button
                      onClick={() => handleRefund(payment.id)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      Hoàn tiền
                    </button>
                  )}
                </td>
              </tr>
            ))}
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
    </div>
  );
}
