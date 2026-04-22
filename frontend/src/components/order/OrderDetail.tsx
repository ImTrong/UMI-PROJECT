import { Order } from '../../services/order.service';
import { format } from 'date-fns';
import { FiCheckCircle, FiClock, FiXCircle, FiPackage, FiCreditCard } from 'react-icons/fi';
import { formatVND } from '../../utils/currency';

interface OrderDetailProps {
  order: Order;
  onCancel?: () => void;
  onPay?: () => void;
}

export const OrderDetail = ({ order, onCancel, onPay }: OrderDetailProps) => {
  const getStatusIcon = (status: Order['status']) => {
    switch (status) {
      case 'COMPLETED':
        return <FiCheckCircle className="text-green-500" size={24} />;
      case 'PENDING':
        return <FiClock className="text-yellow-500" size={24} />;
      case 'PROCESSING':
        return <FiPackage className="text-blue-500" size={24} />;
      case 'CANCELLED':
        return <FiXCircle className="text-gray-500" size={24} />;
      case 'FAILED':
        return <FiXCircle className="text-red-500" size={24} />;
      default:
        return <FiPackage className="text-gray-500" size={24} />;
    }
  };

  const getStatusText = (status: Order['status']) => {
    switch (status) {
      case 'COMPLETED':
        return 'Order Completed';
      case 'PENDING':
        return 'Pending Payment';
      case 'PROCESSING':
        return 'Processing';
      case 'CANCELLED':
        return 'Cancelled';
      case 'FAILED':
        return 'Payment Failed';
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Order Header */}
      <div className="card">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-2xl font-bold">Order #{order.orderNumber}</h1>
            <p className="text-gray-500 mt-1">
              Placed on {format(new Date(order.createdAt), 'MMMM dd, yyyy')}
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center space-x-2">
              {getStatusIcon(order.status)}
              <span className="font-semibold">{getStatusText(order.status)}</span>
            </div>
            {order.paymentStatus === 'PAID' && (
              <p className="text-sm text-green-600 mt-1">Payment Confirmed</p>
            )}
          </div>
        </div>

        {/* Order Items */}
        <div className="border-t pt-4">
          <h3 className="font-semibold mb-3">Order Items</h3>
          <div className="space-y-3">
            {order.items.map((item, index) => (
              <div key={index} className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{item.courseTitle}</p>
                  {item.discount > 0 && (
                    <p className="text-sm text-green-600">Giảm {formatVND(item.discount)}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatVND(item.finalPrice)}</p>
                  {item.discount > 0 && (
                    <p className="text-sm text-gray-500 line-through">
                      {formatVND(item.price)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Order Summary */}
        <div className="border-t mt-4 pt-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Subtotal</span>
              <span>{formatVND(order.subtotal)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount</span>
                <span>-{formatVND(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Total</span>
              <span className="text-primary-600">{formatVND(order.totalPrice)}</span>
            </div>
          </div>
        </div>

        {/* Payment Info */}
        {order.paymentId && (
          <div className="border-t pt-4">
            <div className="flex items-center space-x-2 mb-2">
              <FiCreditCard className="text-gray-500" />
              <h3 className="font-semibold">Payment Information</h3>
            </div>
            <p className="text-sm text-gray-600">Payment ID: {order.paymentId}</p>
            <p className="text-sm text-gray-600">Status: {order.paymentStatus}</p>
          </div>
        )}

        {/* Notes */}
        {order.notes && (
          <div className="border-t pt-4">
            <h3 className="font-semibold mb-2">Order Notes</h3>
            <p className="text-gray-600">{order.notes}</p>
          </div>
        )}

        {/* Cancel Reason */}
        {order.cancelledReason && (
          <div className="border-t pt-4">
            <h3 className="font-semibold mb-2 text-red-600">Cancellation Reason</h3>
            <p className="text-gray-600">{order.cancelledReason}</p>
          </div>
        )}

        {/* Actions */}
        {order.status === 'PENDING' && (onCancel || onPay) && (
          <div className="border-t pt-4 mt-4 flex justify-end space-x-4">
            {onCancel && (
              <button
                onClick={onCancel}
                className="btn-secondary text-red-600 hover:text-red-700"
              >
                Hủy đơn hàng
              </button>
            )}
            {onPay && (
              <button
                onClick={onPay}
                className="btn-primary"
              >
                Thanh toán ngay
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
