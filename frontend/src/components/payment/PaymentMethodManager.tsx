import { useState, useEffect } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { paymentService, PaymentMethod } from '../../services/payment.service';
import { FiCreditCard, FiStar } from 'react-icons/fi';
import toast from 'react-hot-toast';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const AddPaymentMethodForm = ({ onSuccess }: { onSuccess: () => void }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [setupIntent, setSetupIntent] = useState<any>(null);

  useEffect(() => {
    const createSetupIntent = async () => {
      try {
        const intent = await paymentService.createSetupIntent();
        setSetupIntent(intent);
      } catch (error) {
        toast.error('Failed to initialize');
      }
    };
    createSetupIntent();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements || !setupIntent) return;

    setProcessing(true);

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    const { error, setupIntent: confirmedIntent } = await stripe.confirmCardSetup(
      setupIntent.clientSecret,
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
      toast.error(error.message || 'Failed to save payment method');
      setProcessing(false);
    } else if (confirmedIntent) {
      await paymentService.savePaymentMethod(confirmedIntent.payment_method as string);
      toast.success('Payment method saved successfully');
      onSuccess();
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
    },
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <CardElement options={cardElementOptions} className="p-3 border rounded" />
      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full btn-primary"
      >
        {processing ? 'Saving...' : 'Add Payment Method'}
      </button>
    </form>
  );
};

interface PaymentMethodManagerProps {
  onMethodSelected?: (methodId: string) => void;
  selectedMethodId?: string;
}

export const PaymentMethodManager = ({ onMethodSelected, selectedMethodId }: PaymentMethodManagerProps) => {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  const loadMethods = async () => {
    try {
      const data = await paymentService.getPaymentMethods();
      setMethods(data.paymentMethods);
    } catch (error) {
      console.error('Failed to load payment methods:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMethods();
  }, []);

  if (loading) {
    return <div className="text-center py-4">Loading payment methods...</div>;
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Payment Methods</h3>

      {methods.length === 0 ? (
        <p className="text-gray-500 text-sm">No saved payment methods</p>
      ) : (
        <div className="space-y-2">
          {methods.map((method) => (
            <div
              key={method.id}
              className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition ${
                selectedMethodId === method.id ? 'border-primary-500 bg-primary-50' : 'hover:bg-gray-50'
              }`}
              onClick={() => onMethodSelected?.(method.id)}
            >
              <div className="flex items-center space-x-3">
                <FiCreditCard className="text-gray-500" />
                <div>
                  <p className="font-medium">
                    {method.card.brand} •••• {method.card.last4}
                  </p>
                  <p className="text-sm text-gray-500">
                    Expires {method.card.expMonth}/{method.card.expYear}
                  </p>
                </div>
                {method.isDefault && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                    Default
                  </span>
                )}
              </div>
              {selectedMethodId === method.id && (
                <FiStar className="text-primary-500" />
              )}
            </div>
          ))}
        </div>
      )}

      {!showAddForm ? (
        <button
          onClick={() => setShowAddForm(true)}
          className="text-primary-600 hover:text-primary-700 text-sm"
        >
          + Add new payment method
        </button>
      ) : (
        <div className="border rounded-lg p-4 mt-2">
          <h4 className="font-medium mb-3">Add New Card</h4>
          <Elements stripe={stripePromise}>
            <AddPaymentMethodForm onSuccess={() => {
              setShowAddForm(false);
              loadMethods();
            }} />
          </Elements>
          <button
            onClick={() => setShowAddForm(false)}
            className="mt-2 text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};
