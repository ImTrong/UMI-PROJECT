import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { orderService, Order } from '../services/order.service';
import { StripePaymentForm } from '../components/payment/StripePaymentForm';
import { PaymentMethodManager } from '../components/payment/PaymentMethodManager';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiShield } from 'react-icons/fi';

export default function Checkout() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<string>('');
  const [useSavedMethod, setUseSavedMethod] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (orderId) {
      loadOrder();
    }
  }, [orderId, isAuthenticated, navigate]);

  const loadOrder = async () => {
    try {
      const data = await orderService.getOrderById(orderId!);
      if (data.paymentStatus === 'PAID') {
        toast.success('Đơn hàng này đã được thanh toán');
        navigate(`/orders/${orderId}`);
        return;
      }
      setOrder(data);
    } catch (error) {
      console.error('Failed to load order:', error);
      toast.error('Không tìm thấy đơn hàng');
      navigate('/orders');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = async (_paymentId: string) => {
    toast.success('Thanh toán thành công!');
    navigate(`/orders/${orderId}`);
  };

  const handlePaymentError = (error: string) => {
    toast.error(error);
    setProcessing(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate(`/orders/${orderId}`)}
        className="mb-4 text-gray-600 hover:text-gray-800 flex items-center space-x-1"
      >
        <FiArrowLeft />
        <span>Quay lại Đơn hàng</span>
      </button>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Payment Section */}
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Chi tiết Thanh toán</h2>
            
            {/* Payment Method Toggle */}
            <div className="flex space-x-4 mb-6">
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  checked={!useSavedMethod}
                  onChange={() => setUseSavedMethod(false)}
                  className="text-primary-600"
                />
                <span>Thẻ mới</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  checked={useSavedMethod}
                  onChange={() => setUseSavedMethod(true)}
                  className="text-primary-600"
                />
                <span>Thẻ đã lưu</span>
              </label>
            </div>

            {useSavedMethod ? (
              <PaymentMethodManager
                onMethodSelected={setSelectedMethod}
                selectedMethodId={selectedMethod}
              />
            ) : (
              <StripePaymentForm
                orderId={order.id}
                orderNumber={order.orderNumber}
                amount={order.totalPrice}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
              />
            )}

            {useSavedMethod && selectedMethod && (
              <button
                onClick={() => {
                  setProcessing(true);
                  // Implement payment with saved method
                  handlePaymentSuccess('saved-method');
                }}
                disabled={processing}
                className="w-full mt-4 btn-primary"
              >
                {processing ? 'Đang xử lý...' : `Thanh toán $${order.totalPrice.toFixed(2)}`}
              </button>
            )}
          </div>

          <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
            <FiShield />
            <span>Thanh toán bảo mật qua Stripe</span>
          </div>
        </div>

        {/* Order Summary */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Tóm tắt Đơn hàng</h2>
          <div className="space-y-3 mb-4">
            {order.items.map((item, index) => (
              <div key={index} className="flex justify-between">
                <span className="text-gray-600">{item.courseTitle}</span>
                <span>${item.finalPrice.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Tạm tính</span>
              <span>${order.subtotal.toFixed(2)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Giảm giá</span>
                <span>-${order.discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Tổng cộng</span>
              <span className="text-primary-600">${order.totalPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
