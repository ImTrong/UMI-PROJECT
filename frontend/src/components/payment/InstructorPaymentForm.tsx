import { useState } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { confirmInstructorPayment } from './payment-flow';
import { FiCreditCard, FiLock } from 'react-icons/fi';
import { formatVND } from '../../utils/currency';

// Load Stripe (ensure VITE_STRIPE_PUBLISHABLE_KEY is set in .env)
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

interface InstructorPaymentFormProps {
  amount: number;
  paymentIntent: any; // Add this
  onSuccess: (paymentId: string) => void;
  /** still processing, or the answer could not be verified (FIX 07B-1.3): never shown as a success */
  onPending: (message: string) => void;
  onError: (error: string) => void;
}

const PaymentForm = ({ amount, paymentIntent, onSuccess, onPending, onError }: InstructorPaymentFormProps) => {
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
      // success only if the backend answers a SUCCEEDED payment (FIX 07B-1.3)
      await confirmInstructorPayment(confirmedIntent.id, confirmedIntent.payment_method as string, { onSuccess, onPending, onError });
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
      <div className="bg-slate-50 rounded-xl p-4 shadow-inner">
        <div className="flex items-center space-x-2 mb-3 text-slate-700">
          <FiCreditCard className="text-primary-600" />
          <span className="font-semibold">Chi tiết thẻ thanh toán</span>
        </div>
        <div className="p-3 bg-white rounded border border-slate-100 focus-within:border-primary-500 transition-colors">
          <CardElement options={cardElementOptions} />
        </div>
      </div>

      <div className="flex items-center space-x-2 text-sm text-slate-500 justify-center">
        <FiLock className="text-green-500" />
        <span>Thông tin thanh toán của bạn được bảo mật tuyệt đối</span>
      </div>

      <button
        type="submit"
        disabled={!stripe || !paymentIntent || processing}
        className="w-full btn-primary py-3 text-lg font-bold shadow-sm transform hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100"
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
