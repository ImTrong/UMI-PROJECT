import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { orderService, Order } from '../services/order.service';
import {
  FiShoppingCart, FiDollarSign, FiSearch, FiFilter, 
  FiClock, FiCheckCircle, FiXCircle, FiTrendingUp,
  FiChevronLeft, FiChevronRight, FiEdit
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { formatVND } from '../utils/currency';
import { format } from 'date-fns';

export default function AdminOrders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Data Overview Stats
  const [stats, setStats] = useState({
    totalOrders: 0, totalRevenue: 0,
    byStatus: [] as any[]
  });

  // Filters & Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  
  // Update Status Modal State
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [newStatus, setNewStatus] = useState<Order['status']>('PENDING');
  const [rejectReason, setRejectReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    loadData();
  }, [user, page, statusFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ordersRes, statsRes] = await Promise.all([
        orderService.getAllOrders({ 
          page, 
          limit: 10,
          status: statusFilter as Order['status'] || undefined
        }),
        orderService.getOrderStats()
      ]);
      setOrders(ordersRes.orders);
      setTotalPages(ordersRes.pagination.totalPages || 1);
      setStats({
        totalOrders: statsRes.totalOrders,
        totalRevenue: statsRes.totalRevenue,
        byStatus: statsRes.byStatus
      });
    } catch (error) {
      toast.error('Tải dữ liệu giám sát giao dịch thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editOrder) return;
    setIsProcessing(true);
    try {
      await orderService.updateOrderStatus(editOrder.id, newStatus, rejectReason);
      toast.success('Cập nhật trạng thái thành công!');
      setEditOrder(null);
      setRejectReason('');
      loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Không thể cập nhật trạng thái đơn hàng');
    } finally {
      setIsProcessing(false);
    }
  };

  const openEditModal = (order: Order) => {
    setEditOrder(order);
    setNewStatus(order.status);
    setRejectReason('');
  };

  // UI Helpers
  const getStatusBadge = (status: Order['status']) => {
    switch (status) {
      case 'COMPLETED': return <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2.5 py-1 rounded-full text-xs font-medium"><FiCheckCircle size={14}/> Hoàn thành</span>;
      case 'PENDING': return <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full text-xs font-medium"><FiClock size={14}/> Chờ xử lý</span>;
      case 'PROCESSING': return <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full text-xs font-medium"><FiTrendingUp size={14}/> Đang xử lý</span>;
      case 'CANCELLED': case 'FAILED': return <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-2.5 py-1 rounded-full text-xs font-medium"><FiXCircle size={14}/> Đã hủy/Thất bại</span>;
      default: return <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full text-xs">{status}</span>;
    }
  };

  if (user?.role !== 'ADMIN') {
     return <div className="p-8 text-center text-red-600">Từ chối truy cập. Chỉ dành cho Quản trị viên.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FiShoppingCart className="text-primary-500" /> Giám sát Giao dịch & Đơn hàng
          </h1>
          <p className="text-sm text-gray-500 mt-1">Theo dõi quá trình mua khóa học, xử lý sai sót và hỗ trợ học viên</p>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition">
          <div className="w-12 h-12 bg-primary-50 text-primary-600 rounded-full flex items-center justify-center text-2xl">
            <FiDollarSign />
          </div>
          <div>
             <p className="text-sm text-gray-500 font-medium">Tổng Doanh thu Giao dịch</p>
             <p className="text-2xl font-bold text-gray-900">{formatVND(stats.totalRevenue)}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center text-2xl">
            <FiClock />
          </div>
          <div>
             <p className="text-sm text-gray-500 font-medium">Tổng Đơn hàng</p>
             <p className="text-2xl font-bold text-gray-900">{stats.totalOrders}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition">
          <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center text-2xl">
            <FiCheckCircle />
          </div>
          <div>
             <p className="text-sm text-gray-500 font-medium">Tỷ lệ Thành công</p>
             <p className="text-2xl font-bold text-gray-900">
               {stats.totalOrders > 0 
                  ? `${((stats.byStatus.find((s: any) => s.status === 'COMPLETED')?._count || 0) / stats.totalOrders * 100).toFixed(1)}%` 
                  : '0%'}
             </p>
          </div>
        </div>
      </div>

      {/* Filters and List in one card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-50 flex items-center gap-4 justify-between bg-gray-50/30">
          <div className="flex items-center gap-2 max-w-sm w-full">
            <FiSearch className="text-gray-400" />
            <span className="text-sm text-gray-500 font-medium hidden sm:block">Lọc danh sách</span>
          </div>
          <div className="flex items-center gap-2">
            <FiFilter className="text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
            >
              <option value="">Tất cả Trạng thái</option>
              <option value="PENDING">Chờ xử lý</option>
              <option value="PROCESSING">Đang xử lý</option>
              <option value="COMPLETED">Hoàn thành</option>
              <option value="CANCELLED">Hủy / Thất bại</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-x-auto min-h-[300px]">
          {loading ? (
            <div className="flex justify-center items-center h-64">
               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16">
              <FiShoppingCart size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 font-medium">Không tìm thấy giao dịch nào.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Mã Đơn</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Khách hàng</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Giá trị / SP</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Trạng thái</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Thời gian</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Thao tác</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-mono text-sm font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded">
                        #{order.orderNumber}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                       <p className="text-sm font-medium text-gray-900">{order.userId.substring(0, 10)}...</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                       <p className="text-sm font-bold text-gray-900">{formatVND(order.totalPrice)}</p>
                       <p className="text-xs text-gray-500">{order.items?.length || 0} khóa học</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                       {getStatusBadge(order.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                       <span title={format(new Date(order.createdAt), 'dd MMMM yyyy, HH:mm:ss')}>
                         {format(new Date(order.createdAt), 'dd/MM/yyyy HH:mm')}
                       </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                       <button
                         onClick={() => openEditModal(order)}
                         className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                         title="Cập nhật trạng thái"
                       >
                         <FiEdit size={18} />
                       </button>
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
             <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50">
                <FiChevronLeft size={16} />
             </button>
             <span className="px-4 text-sm font-medium text-gray-600">Trang {page} / {totalPages}</span>
             <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50">
                <FiChevronRight size={16} />
             </button>
          </div>
        )}
      </div>

      {/* Edit Status Modal */}
      {editOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden animate-fadeIn">
             <div className="p-5 border-b border-gray-100 flex items-center gap-3">
               <div className="w-10 h-10 bg-primary-50 text-primary-600 rounded-full flex items-center justify-center"><FiEdit /></div>
               <div>
                  <h3 className="text-lg font-bold text-gray-900">Chi tiết Giao dịch</h3>
                  <p className="text-sm font-mono text-gray-500">#{editOrder.orderNumber}</p>
               </div>
             </div>
             
             <form onSubmit={handleUpdateStatus} className="p-5 space-y-4">
                <div>
                   <label className="block text-sm font-medium text-gray-700 mb-1">Trạng thái hiện tại</label>
                   <div className="mb-4">{getStatusBadge(editOrder.status)}</div>

                   <label className="block text-sm font-medium text-gray-700 mb-1">Cập nhật thành</label>
                   <select
                     value={newStatus}
                     onChange={(e) => setNewStatus(e.target.value as Order['status'])}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                   >
                     <option value="PENDING">Chờ xử lý</option>
                     <option value="PROCESSING">Đang xử lý</option>
                     <option value="COMPLETED">Hoàn Thành</option>
                     <option value="CANCELLED">Hủy bỏ</option>
                   </select>
                </div>

                {newStatus === 'CANCELLED' && (
                  <div className="animate-fadeIn">
                     <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">Lý do hủy <span className="text-red-500">*</span></label>
                     <textarea
                       required
                       value={rejectReason}
                       onChange={(e) => setRejectReason(e.target.value)}
                       className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 text-sm min-h-[80px]"
                       placeholder="VD: Gian lận thanh toán..."
                     />
                  </div>
                )}

                <div className="pt-2 flex justify-end gap-3">
                  <button type="button" onClick={() => setEditOrder(null)} disabled={isProcessing} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
                    Bỏ qua
                  </button>
                  <button type="submit" disabled={isProcessing || (newStatus === editOrder.status)} className="px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50">
                    {isProcessing ? 'Đang lưu...' : 'Xác nhận Cập nhật'}
                  </button>
                </div>
             </form>
          </div>
        </div>
      )}
    </div>
  );
}
