import { useState } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { paymentService } from '../../services/payment.service';
import { FiCreditCard, FiLock } from 'react-icons/fi';
import { formatVND } from '../../utils/currency';

// Load Stripe (ensure VITE_STRIPE_PUBLISHABLE_KEY is set in .env)
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

interface InstructorPaymentFormProps {
  amount: number;
  paymentIntent: any; // Add this
  onSuccess: (paymentId: string) => void;
  onError: (error: string) => void;
}

const PaymentForm = ({ amount, paymentIntent, onSuccess, onError }: InstructorPaymentFormProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  // Remove the useEffect that creates a new payment intent

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);

    const cardElement = elements.getElement(CardElement);

    if (!cardElement || !paymentIntent) {
      setProcessing(false);
      return;
    }

    const { error, paymentIntent: confirmedIntent } = await stripe.confirmCardPayment(
      paymentIntent.clientSecret,
      {
        payment_method: {
          card: cardElement,
        },
      }
    );

    if (error) {
      onError(error.message || 'Payment failed');
      setProcessing(false);
    } else if (confirmedIntent && confirmedIntent.status === 'succeeded') {
      try {
        const payment = await paymentService.confirmPayment({
          paymentIntentId: confirmedIntent.id,
          paymentMethodId: confirmedIntent.payment_method as string,
        });
        onSuccess(payment.id);
      } catch (err) {
        onError('Thanh toán thành công nhưng có lỗi khi cập nhật tài khoản. Vui lòng liên hệ hỗ trợ.');
      }
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
      <div className="bg-gray-50 rounded-lg p-4 shadow-inner">
        <div className="flex items-center space-x-2 mb-3 text-gray-700">
          <FiCreditCard className="text-primary-600" />
          <span className="font-semibold">Chi tiết thẻ thanh toán</span>
        </div>
        <div className="p-3 bg-white rounded border border-gray-200 focus-within:border-primary-500 transition-colors">
          <CardElement options={cardElementOptions} />
        </div>
      </div>

      <div className="flex items-center space-x-2 text-sm text-gray-500 justify-center">
        <FiLock className="text-green-500" />
        <span>Thông tin thanh toán của bạn được bảo mật tuyệt đối</span>
      </div>

      <button
        type="submit"
        disabled={!stripe || !paymentIntent || processing}
        className="w-full btn-primary py-3 text-lg font-bold shadow-lg transform hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100"
      >
        {processing ? 'Đang xử lý...' : `Thanh toán ${formatVND(amount)}`}
      </button>
    </form>
  );
};

export const InstructorPaymentForm = (props: InstructorPaymentFormProps) => {
  return (
    <Elements stripe={stripePromise}>
      <PaymentForm {...props} />
    </Elements>
  );
};
