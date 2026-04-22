import { useState } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { orderService } from '../../services/order.service';
import { FiCreditCard, FiLock } from 'react-icons/fi';
import { formatVND } from '../../utils/currency';

// Load Stripe
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

interface StripePaymentFormProps {
  orderId: string;
  orderNumber: string;
  amount: number;
  clientSecret: string;
  stripePaymentIntentId: string;
  onSuccess: (paymentId: string) => void;
  onError: (error: string) => void;
}

const PaymentForm = ({
  orderId: _orderId,
  orderNumber: _orderNumber,
  amount,
  clientSecret,
  stripePaymentIntentId: _stripePaymentIntentId,
  onSuccess,
  onError,
}: StripePaymentFormProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);

    const cardElement = elements.getElement(CardElement);

    if (!cardElement || !clientSecret) {
      setProcessing(false);
      onError('Không thể khởi tạo thanh toán');
      return;
    }

    try {
      // Confirm card payment directly with Stripe.js (client-side)
      const { error, paymentIntent: confirmedIntent } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: 'Customer',
            },
          },
        }
      );

      if (error) {
        onError(error.message || 'Thanh toán thất bại');
        setProcessing(false);
        return;
      }

      if (confirmedIntent && confirmedIntent.status === 'succeeded') {
        try {
          // Send request directly to order-service to sync the payment status and trigger course enrollments
          const response = await orderService.processPayment(
            _orderId,
            confirmedIntent.payment_method as string
          );
          
          if (response.success) {
            onSuccess(response.payment.id || confirmedIntent.id);
          } else {
            console.warn('Backend returned success=false but Stripe was fully processed');
            onSuccess(confirmedIntent.id);
          }
        } catch (err) {
          // Even if backend sync fails, payment was successful on Stripe
          // The webhook will handle it eventually, but the order might be delayed
          console.warn('Backend sync failed, webhook will handle:', err);
          onSuccess(confirmedIntent.id);
        }
      } else if (confirmedIntent && confirmedIntent.status === 'requires_action') {
        // 3D Secure or additional authentication required - Stripe.js handles this
        onError('Yêu cầu xác thực thêm. Vui lòng thử lại.');
      } else {
        onError('Thanh toán chưa hoàn tất. Vui lòng thử lại.');
      }
    } catch (err: any) {
      onError(err.message || 'Đã xảy ra lỗi khi thanh toán');
    } finally {
      setProcessing(false);
    }
  };

  const cardElementOptions = {
    style: {
      base: {
        fontSize: '16px',
        color: '#424770',
        '::placeholder': {
          color: '#aab7c4',
        },
      },
      invalid: {
        color: '#9e2146',
      },
    },
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center space-x-2 mb-3">
          <FiCreditCard className="text-gray-500" />
          <span className="font-medium">Thông tin thẻ</span>
        </div>
        <CardElement options={cardElementOptions} className="p-3 bg-white rounded border" />
      </div>

      <div className="flex items-center space-x-2 text-sm text-gray-500">
        <FiLock size={14} />
        <span>Thông tin thanh toán của bạn được bảo mật</span>
      </div>

      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full btn-primary disabled:opacity-50"
      >
        {processing ? 'Đang xử lý...' : `Thanh toán ${formatVND(amount)}`}
      </button>
    </form>
  );
};

export const StripePaymentForm = (props: StripePaymentFormProps) => {
  return (
    <Elements stripe={stripePromise}>
      <PaymentForm {...props} />
    </Elements>
  );
};
