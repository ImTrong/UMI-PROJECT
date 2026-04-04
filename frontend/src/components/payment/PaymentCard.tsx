import { Payment } from '../../services/payment.service';
import { format } from 'date-fns';
import { FiCheckCircle, FiClock, FiXCircle, FiRefreshCw, FiCreditCard } from 'react-icons/fi';

interface PaymentCardProps {
  payment: Payment;
  onRefund?: (paymentId: string) => void;
}

export const PaymentCard = ({ payment, onRefund }: PaymentCardProps) => {
  const getStatusColor = (status: Payment['status']) => {
    switch (status) {
      case 'SUCCEEDED':
        return 'bg-green-100 text-green-700';
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-700';
      case 'PROCESSING':
        return 'bg-blue-100 text-blue-700';
      case 'FAILED':
        return 'bg-red-100 text-red-700';
      case 'REFUNDED':
        return 'bg-gray-100 text-gray-700';
      case 'CANCELLED':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusIcon = (status: Payment['status']) => {
    switch (status) {
      case 'SUCCEEDED':
        return <FiCheckCircle className="text-green-500" />;
      case 'PENDING':
      case 'PROCESSING':
        return <FiClock className="text-yellow-500" />;
      case 'FAILED':
        return <FiXCircle className="text-red-500" />;
      case 'REFUNDED':
        return <FiRefreshCw className="text-gray-500" />;
      default:
        return <FiCreditCard className="text-gray-500" />;
    }
  };

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center space-x-2">
            {getStatusIcon(payment.status)}
            <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(payment.status)}`}>
              {payment.status}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Order #{payment.orderNumber}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-primary-600">
            ${payment.amount.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500">
            {format(new Date(payment.createdAt), 'MMM dd, yyyy')}
          </p>
        </div>
      </div>

      <div className="text-sm text-gray-600 space-y-1">
        <p>Payment ID: {payment.stripePaymentIntentId?.slice(-8) || payment.id.slice(-8)}</p>
        {payment.paymentMethodId && (
          <p>Method: {payment.paymentMethodId.slice(-4)}</p>
        )}
        {payment.errorMessage && (
          <p className="text-red-600 text-xs mt-2">{payment.errorMessage}</p>
        )}
      </div>

      {payment.status === 'SUCCEEDED' && onRefund && (
        <div className="mt-3 pt-3 border-t">
          <button
            onClick={() => onRefund(payment.id)}
            className="text-sm text-red-600 hover:text-red-700"
          >
            Request Refund
          </button>
        </div>
      )}
    </div>
  );
};
