import { Payment } from '../../services/payment.service';
import { format } from 'date-fns';
import { FiCheckCircle, FiClock, FiXCircle, FiRefreshCw, FiCreditCard } from 'react-icons/fi';
import { formatVND } from '../../utils/currency';

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
        return 'bg-cyan-100 text-cyan-700';
      case 'FAILED':
        return 'bg-red-100 text-red-700';
      case 'REFUNDED':
        return 'bg-slate-100 text-slate-700';
      case 'CANCELLED':
        return 'bg-slate-100 text-slate-700';
      default:
        return 'bg-slate-100 text-slate-700';
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
        return <FiRefreshCw className="text-slate-500" />;
      default:
        return <FiCreditCard className="text-slate-500" />;
    }
  };

  return (
    <div className="card hover:shadow-sm transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center space-x-2">
            {getStatusIcon(payment.status)}
            <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(payment.status)}`}>
              {payment.status}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Đơn hàng #{payment.orderNumber}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-primary-600">
            {formatVND(payment.amount)}
          </p>
          <p className="text-xs text-slate-500">
            {format(new Date(payment.createdAt), 'MMM dd, yyyy')}
          </p>
        </div>
      </div>

      <div className="text-sm text-slate-600 space-y-1">
        <p>Mã thanh toán: {payment.stripePaymentIntentId?.slice(-8) || payment.id.slice(-8)}</p>
        {payment.paymentMethodId && (
          <p>Phương thức: {payment.paymentMethodId.slice(-4)}</p>
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
            Yêu cầu hoàn tiền
          </button>
        </div>
      )}
    </div>
  );
};
