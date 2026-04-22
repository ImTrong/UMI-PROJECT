import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { orderService, Order } from '../services/order.service';
import { paymentService, PaymentIntent } from '../services/payment.service';
import { StripePaymentForm } from '../components/payment/StripePaymentForm';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiShield, FiAlertCircle } from 'react-icons/fi';
import { formatVND } from '../utils/currency';

export default function Checkout() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (orderId) {
      loadOrderAndPayment();
    }
  }, [orderId, isAuthenticated, navigate]);

  const loadOrderAndPayment = async () => {
    try {
      // Load order details
      const orderData = await orderService.getOrderById(orderId!);

      if (orderData.paymentStatus === 'PAID') {
        toast.success('Đơn hàng này đã được thanh toán');
        navigate(`/orders/${orderId}`);
        return;
      }

      if (orderData.status === 'CANCELLED' || orderData.status === 'FAILED') {
        toast.error('Đơn hàng này đã bị hủy hoặc thất bại');
        navigate(`/orders/${orderId}`);
        return;
      }

      setOrder(orderData);

      // Load payment intent (clientSecret) for this order
      try {
        const payment = await paymentService.getPaymentByOrder(orderId!);
        setPaymentIntent(payment);
      } catch (paymentError: any) {
        // If no payment intent exists yet, create one
        if (paymentError.response?.status === 404) {
          try {
            const newPayment = await paymentService.createPaymentIntent({
              orderId: orderId!,
              orderNumber: orderData.orderNumber,
              amount: orderData.totalPrice,
            });
            setPaymentIntent(newPayment);
          } catch (createError: any) {
            setError('Không thể khởi tạo thanh toán. Vui lòng thử lại sau.');
            console.error('Failed to create payment intent:', createError);
          }
        } else {
          setError('Không thể tải thông tin thanh toán. Vui lòng thử lại sau.');
          console.error('Failed to load payment:', paymentError);
        }
      }
    } catch (err) {
      console.error('Failed to load order:', err);
      toast.error('Không tìm thấy đơn hàng');
      navigate('/orders');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = async (_paymentId: string) => {
    // Navigate to the success page which will poll the order status
    navigate(`/checkout/success/${orderId}`);
  };

  const handlePaymentError = (errorMsg: string) => {
    toast.error(errorMsg);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Đang tải thông tin thanh toán...</p>
        </div>
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

            {error ? (
              <div className="flex items-center space-x-2 text-red-600 bg-red-50 p-4 rounded-lg">
                <FiAlertCircle size={20} />
                <span>{error}</span>
              </div>
            ) : paymentIntent?.clientSecret ? (
              <StripePaymentForm
                orderId={order.id}
                orderNumber={order.orderNumber}
                amount={order.totalPrice}
                clientSecret={paymentIntent.clientSecret}
                stripePaymentIntentId={paymentIntent.stripePaymentIntentId}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
              />
            ) : (
              <div className="flex items-center space-x-2 text-yellow-600 bg-yellow-50 p-4 rounded-lg">
                <FiAlertCircle size={20} />
                <span>Đang khởi tạo thanh toán...</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
            <FiShield />
            <span>Thanh toán bảo mật qua Stripe</span>
          </div>

          {/* Test card info for development */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm font-medium text-blue-800 mb-2">🧪 Thẻ test để thử nghiệm:</p>
            <div className="text-sm text-blue-700 space-y-1">
              <p><strong>Số thẻ:</strong> 4242 4242 4242 4242</p>
              <p><strong>Hết hạn:</strong> 12/34 (bất kỳ ngày nào trong tương lai)</p>
              <p><strong>CVC:</strong> 123 (bất kỳ 3 số)</p>
              <p><strong>ZIP:</strong> 12345 (bất kỳ)</p>
            </div>
          </div>
        </div>

        {/* Order Summary */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Tóm tắt Đơn hàng</h2>
          <div className="space-y-3 mb-4">
            {order.items.map((item, index) => (
              <div key={index} className="flex justify-between">
                <span className="text-gray-600">{item.courseTitle}</span>
                <span>{formatVND(item.finalPrice)}</span>
              </div>
            ))}
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Tạm tính</span>
              <span>{formatVND(order.subtotal)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Giảm giá</span>
                <span>-{formatVND(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Tổng cộng</span>
              <span className="text-primary-600">{formatVND(order.totalPrice)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
