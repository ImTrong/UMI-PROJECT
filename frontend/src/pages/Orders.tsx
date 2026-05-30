import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { orderService, Order } from '../services/order.service';
import { OrderCard } from '../components/order/OrderCard';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiPackage, FiFilter } from 'react-icons/fi';

export default function Orders() {
  const { isAuthenticated } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [statusFilter, setStatusFilter] = useState<Order['status'] | ''>('');
  const [showFilters, setShowFilters] = useState(false);

  const loadOrders = async (page: number = 1) => {
    setLoading(true);
    try {
      const result = await orderService.getMyOrders(page, 10, statusFilter || undefined);
      setOrders(result.orders);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to load orders:', error);
      toast.error('Tải đơn hàng thất bại');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadOrders();
    }
  }, [isAuthenticated, statusFilter]);

  const handleCancelOrder = async (orderId: string) => {
    const reason = prompt('Lý do hủy (tùy chọn):');
    try {
      await orderService.cancelOrder(orderId, reason || undefined);
      toast.success('Hủy đơn hàng thành công');
      loadOrders(pagination.page);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Hủy đơn hàng thất bại');
    }
  };

  if (loading && orders.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Đơn hàng của tôi</h1>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center space-x-2 text-slate-600 hover:text-slate-800"
        >
          <FiFilter />
          <span>Lọc</span>
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="card mb-6 p-4">
          <div className="flex flex-wrap gap-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Order['status'] | '')}
              className="input-field w-auto"
            >
              <option value="">Tất cả Đơn hàng</option>
              <option value="PENDING">Đang chờ</option>
              <option value="PROCESSING">Đang xử lý</option>
              <option value="COMPLETED">Hoàn thành</option>
              <option value="CANCELLED">Đã hủy</option>
              <option value="FAILED">Thất bại</option>
            </select>
          </div>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="card text-center py-12">
          <FiPackage className="mx-auto text-4xl text-slate-400 mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Chưa có đơn hàng nào</h2>
          <p className="text-slate-600 mb-6">Bạn chưa thực hiện đơn hàng nào.</p>
          <Link to="/courses" className="btn-primary">
            Khám phá Khóa học
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onCancel={handleCancelOrder}
                canCancel={order.status === 'PENDING'}
              />
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center space-x-2 mt-8">
              <button
                onClick={() => loadOrders(pagination.page - 1)}
                disabled={!pagination.hasPrevPage}
                className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Trước
              </button>
              <span className="px-3 py-1">
                Trang {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => loadOrders(pagination.page + 1)}
                disabled={!pagination.hasNextPage}
                className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Tiếp
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
