import { useState } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { loadStripe, type PaymentIntent, type StripeError } from '@stripe/stripe-js';
import { runDemoPayment, syncCardPayment } from './payment-flow';
import { FiCreditCard, FiLock, FiCheck } from 'react-icons/fi';
import { formatVND } from '../../utils/currency';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const isStripeConfigured =
  !!publishableKey &&
  !publishableKey.includes('placeholder') &&
  !publishableKey.startsWith('your_') &&
  publishableKey.startsWith('pk_');

const stripePromise = isStripeConfigured ? loadStripe(publishableKey) : null;

/** Stripe.js refuses to confirm an intent that already succeeded and hands it back: that intent, else null. */
export function alreadyChargedIntent(error: StripeError | undefined): PaymentIntent | null {
  const intent = error?.code === 'payment_intent_unexpected_state' ? error.payment_intent : undefined;
  return intent && intent.status === 'succeeded' ? intent : null;
}

interface StripePaymentFormProps {
  orderId: string;
  orderNumber: string;
  amount: number;
  clientSecret: string;
  stripePaymentIntentId: string;
  onSuccess: (paymentId: string) => void;
  /** still processing, or the answer could not be verified (FIX 07B-1.3): never shown as a success */
  onPending: (message: string) => void;
  onError: (error: string) => void;
}

const MockPaymentForm = ({
  orderId,
  amount,
  onSuccess,
  onPending,
  onError,
}: StripePaymentFormProps) => {
  const [processing, setProcessing] = useState(false);

  const handleMockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    try {
      // success only if the demo answered a SUCCEEDED payment; a refused demo (404 when disabled) or an error is not
      await runDemoPayment(orderId, { onSuccess, onPending, onError });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleMockSubmit} className="space-y-4">
      <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800">
        <p className="font-semibold flex items-center gap-1.5 mb-1">
          <span>🧪</span>
          <span>Chế độ Demo / Sandbox Stripe</span>
        </p>
        <p className="text-amber-700">
          Chưa cấu hình Stripe API Key thật trong hệ thống. Thẻ thử nghiệm dưới đây đã được điền sẵn để bạn có thể kiểm thử toàn bộ quy trình mua khóa học ngay lập tức.
        </p>
      </div>

      <div className="bg-slate-50 rounded-xl p-4 space-y-3 border border-slate-200">
        <div className="flex items-center space-x-2 mb-1">
          <FiCreditCard className="text-slate-600" />
          <span className="text-sm font-semibold text-slate-800">Thẻ thanh toán quốc tế</span>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Số thẻ (Test Card)</label>
          <input
            type="text"
            readOnly
            value="4242 •••• •••• 4242"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-700"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Hạn dùng</label>
            <input
              type="text"
              readOnly
              value="12/30"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">CVC</label>
            <input
              type="text"
              readOnly
              value="123"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-700"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-2 text-xs text-slate-500">
        <FiLock size={13} className="text-emerald-600" />
        <span>Giao dịch an toàn và mã hóa end-to-end</span>
      </div>

      <button
        type="submit"
        disabled={processing}
        className="w-full btn-primary disabled:opacity-50 py-3 flex items-center justify-center gap-2"
      >
        {processing ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            <span>Đang xác nhận thanh toán...</span>
          </>
        ) : (
          <>
            <FiCheck size={16} />
            <span>Thanh toán {formatVND(amount)} (Demo Sandbox)</span>
          </>
        )}
      </button>
    </form>
  );
};

const PaymentForm = ({
  orderId: _orderId,
  orderNumber: _orderNumber,
  amount,
  clientSecret,
  stripePaymentIntentId: _stripePaymentIntentId,
  onSuccess,
  onPending,
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

      // This intent was already charged by an earlier attempt whose backend sync failed: sync it now instead of an error.
      const alreadyCharged = alreadyChargedIntent(error);
      if (error && !alreadyCharged) {
        onError(error.message || 'Thanh toán thất bại');
        setProcessing(false);
        return;
      }

      const intent = alreadyCharged || confirmedIntent;
      if (intent && intent.status === 'succeeded') {
        // Stripe.js accepted the card; what the backend verified decides the screen (FIX 07B-1.3): success only for SUCCEEDED,
        // "processing" when it is not verified yet (the webhook will update the order) - never success after an error.
        const paymentMethodId = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id || '';
        await syncCardPayment(_orderId, paymentMethodId, intent.id, { onSuccess, onPending, onError });
      } else if (confirmedIntent && confirmedIntent.status === 'requires_action') {
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
      <div className="bg-slate-50 rounded-xl p-4">
        <div className="flex items-center space-x-2 mb-3">
          <FiCreditCard className="text-slate-500" />
          <span className="font-medium">Thông tin thẻ</span>
        </div>
        <CardElement options={cardElementOptions} className="p-3 bg-white rounded border" />
      </div>

      <div className="flex items-center space-x-2 text-sm text-slate-500">
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
  const isMock = !isStripeConfigured || !stripePromise || props.clientSecret.includes('mock');

  if (isMock) {
    return <MockPaymentForm {...props} />;
  }

  return (
    <Elements stripe={stripePromise}>
      <PaymentForm {...props} />
    </Elements>
  );
};
