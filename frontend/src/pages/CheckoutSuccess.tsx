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
          toast.error('Failed to load order details');
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
      <div className="card p-8 w-full max-w-lg shadow-lg">
        
        {status === 'verifying' && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary-600"></div>
            </div>
            <h2 className="text-2xl font-bold text-gray-800">Verifying your payment...</h2>
            <p className="text-gray-500">
              Please wait while we confirm your payment with the payment gateway.
              <br />
              Do not close this page. This might take a few seconds.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <FiCheckCircle className="text-green-500 w-20 h-20" />
            </div>
            <h2 className="text-3xl font-bold text-gray-800">Payment Successful!</h2>
            <p className="text-gray-600">
              Thank you for your purchase! Your order <strong>#{order?.orderNumber}</strong> has been successfully processed.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-6">
              <button 
                onClick={() => navigate(`/orders/${orderId}`)} 
                className="btn-secondary"
              >
                View Order Details
              </button>
              <button 
                onClick={() => navigate('/purchased-courses')} 
                className="btn-primary"
              >
                Go to My Courses
              </button>
            </div>
          </div>
        )}

        {status === 'timeout' && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <FiClock className="text-yellow-500 w-16 h-16" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800">Payment Processing</h2>
            <p className="text-gray-600">
              Your payment has been submitted, but we are still waiting for confirmation from our payment provider. 
              Usually, this shouldn't take long. You can check the order details page for updates.
            </p>
            <div className="flex justify-center mt-6">
              <button 
                onClick={() => navigate(`/orders/${orderId}`)} 
                className="btn-primary"
              >
                Check Order Status
              </button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <FiAlertCircle className="text-red-500 w-16 h-16" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800">Payment Unsuccessful</h2>
            <p className="text-gray-600">
              There was an issue processing your payment, or the order was not found. Please try again or contact support if the issue persists.
            </p>
            <div className="flex justify-center mt-6">
              <button 
                onClick={() => navigate(`/orders/${orderId}`)} 
                className="btn-primary"
              >
                Back to Order
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
