import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { orderService, Order } from '../services/order.service';
import { FiCheckCircle, FiClock, FiAlertCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function CheckoutSuccess() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState<'verifying' | 'success' | 'timeout' | 'error'>('verifying');
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 10; // Poll for about 20 seconds maximum

  useEffect(() => {
    if (!orderId) {
      navigate('/orders');
      return;
    }

    let isMounted = true;

    const verifyPaymentStatus = async () => {
      try {
        const orderData = await orderService.getOrderById(orderId);
        
        if (!isMounted) return;

        setOrder(orderData);

        if (orderData.paymentStatus === 'PAID' || orderData.status === 'COMPLETED' || orderData.status === 'PROCESSING') {
          setStatus('success');
        } else if (orderData.status === 'FAILED' || orderData.status === 'CANCELLED') {
          setStatus('error');
        } else {
          // Still pending, needs to wait and retry
          if (retryCount < MAX_RETRIES) {
            setTimeout(() => {
              if (isMounted) setRetryCount(prev => prev + 1);
            }, 2000);
          } else {
            setStatus('timeout');
          }
        }
      } catch (error) {
        console.error('Failed to verify payment status:', error);
        if (isMounted) {
          toast.error('Không thể tải thông tin đơn hàng');
          setStatus('error');
        }
      }
    };

    if (status === 'verifying') {
      verifyPaymentStatus();
    }

    return () => {
      isMounted = false;
    };
  }, [orderId, retryCount, status, navigate]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center h-full min-h-[60vh] flex flex-col justify-center items-center">
      <div className="card p-8 w-full max-w-lg shadow-sm">
        
        {status === 'verifying' && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary-600"></div>
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Đang xác minh thanh toán...</h2>
            <p className="text-slate-500">
              Vui lòng chờ trong khi chúng tôi xác nhận thanh toán với cổng thanh toán.
              <br />
              Đừng đóng trang này. Quá trình có thể mất vài giây.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <FiCheckCircle className="text-green-500 w-20 h-20" />
            </div>
            <h2 className="text-3xl font-bold text-slate-800">Thanh toán thành công!</h2>
            <p className="text-slate-600">
              Cảm ơn bạn đã mua hàng! Đơn hàng <strong>#{order?.orderNumber}</strong> của bạn đã được xử lý thành công.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-6">
              <button 
                onClick={() => navigate(`/orders/${orderId}`)} 
                className="btn-secondary"
              >
                Xem chi tiết đơn hàng
              </button>
              <button 
                onClick={() => navigate('/purchased-courses')} 
                className="btn-primary"
              >
                Đi đến khóa học của tôi
              </button>
            </div>
          </div>
        )}

        {status === 'timeout' && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <FiClock className="text-yellow-500 w-16 h-16" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Đang xử lý thanh toán</h2>
            <p className="text-slate-600">
              Thanh toán của bạn đã được gửi, nhưng chúng tôi vẫn đang chờ xác nhận từ nhà cung cấp dịch vụ thanh toán. 
              Thông thường quá trình này sẽ không mất nhiều thời gian. Bạn có thể kiểm tra trang chi tiết đơn hàng để cập nhật.
            </p>
            <div className="flex justify-center mt-6">
              <button 
                onClick={() => navigate(`/orders/${orderId}`)} 
                className="btn-primary"
              >
                Kiểm tra trạng thái đơn hàng
              </button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <FiAlertCircle className="text-red-500 w-16 h-16" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Thanh toán không thành công</h2>
            <p className="text-slate-600">
              Đã xảy ra sự cố khi xử lý thanh toán của bạn, hoặc không tìm thấy đơn hàng. Vui lòng thử lại hoặc liên hệ hỗ trợ nếu sự cố vẫn tiếp diễn.
            </p>
            <div className="flex justify-center mt-6">
              <button 
                onClick={() => navigate(`/orders/${orderId}`)} 
                className="btn-primary"
              >
                Quay lại đơn hàng
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
