import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { orderService, Order } from '../services/order.service';
import { OrderDetail as OrderDetailComponent } from '../components/order/OrderDetail';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (id) {
      loadOrder();
    }
  }, [id, isAuthenticated, navigate]);

  const loadOrder = async () => {
    setLoading(true);
    try {
      const data = await orderService.getOrderById(id!);
      setOrder(data);
    } catch (error) {
      console.error('Failed to load order:', error);
      toast.error('Không tìm thấy đơn hàng');
      navigate('/orders');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelOrder = async () => {
    const reason = prompt('Lý do hủy (tùy chọn):');
    try {
      await orderService.cancelOrder(id!, reason || undefined);
      toast.success('Hủy đơn hàng thành công');
      loadOrder();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Hủy đơn hàng thất bại');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!order) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate('/orders')}
        className="mb-4 text-slate-600 hover:text-slate-800"
      >
        ← Quay lại Đơn hàng
      </button>
      <OrderDetailComponent
        order={order}
        onCancel={order.status === 'PENDING' ? handleCancelOrder : undefined}
        onPay={order.status === 'PENDING' ? () => navigate(`/checkout/${order.id}`) : undefined}
      />
    </div>
  );
}
