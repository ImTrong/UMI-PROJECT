import { useState, useEffect } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { paymentService } from '../../services/payment.service';
import { FiCreditCard, FiLock } from 'react-icons/fi';

// Load Stripe
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

interface StripePaymentFormProps {
  orderId: string;
  orderNumber: string;
  amount: number;
  onSuccess: (paymentId: string) => void;
  onError: (error: string) => void;
}

const PaymentForm = ({ orderId, orderNumber, amount, onSuccess, onError }: StripePaymentFormProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [paymentIntent, setPaymentIntent] = useState<any>(null);

  useEffect(() => {
    const createPaymentIntent = async () => {
      try {
        const intent = await paymentService.createPaymentIntent({
          orderId,
          orderNumber,
          amount,
        });
        setPaymentIntent(intent);
      } catch (error) {
        onError('Failed to initialize payment');
      }
    };
    createPaymentIntent();
  }, [orderId, orderNumber, amount]);

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
          billing_details: {
            name: 'Customer',
          },
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
        onError('Failed to confirm payment');
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
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center space-x-2 mb-3">
          <FiCreditCard className="text-gray-500" />
          <span className="font-medium">Card Details</span>
        </div>
        <CardElement options={cardElementOptions} className="p-3 bg-white rounded border" />
      </div>

      <div className="flex items-center space-x-2 text-sm text-gray-500">
        <FiLock size={14} />
        <span>Your payment information is secure</span>
      </div>

      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full btn-primary disabled:opacity-50"
      >
        {processing ? 'Processing...' : `Pay $${amount.toFixed(2)}`}
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
