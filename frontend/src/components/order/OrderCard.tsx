import { Link } from 'react-router-dom';
import { Order } from '../../services/order.service';
import { formatDistanceToNow } from 'date-fns';

interface OrderCardProps {
  order: Order;
  onCancel?: (orderId: string) => void;
  canCancel?: boolean;
}

export const OrderCard = ({ order, onCancel, canCancel }: OrderCardProps) => {
  const getStatusColor = (status: Order['status']) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-100 text-green-700';
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-700';
      case 'PROCESSING':
        return 'bg-blue-100 text-blue-700';
      case 'CANCELLED':
        return 'bg-gray-100 text-gray-700';
      case 'FAILED':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getPaymentStatusColor = (status: Order['paymentStatus']) => {
    switch (status) {
      case 'PAID':
        return 'bg-green-100 text-green-700';
      case 'UNPAID':
        return 'bg-yellow-100 text-yellow-700';
      case 'REFUNDED':
        return 'bg-blue-100 text-blue-700';
      case 'FAILED':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="card hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <Link to={`/orders/${order.id}`} className="text-primary-600 hover:underline">
            <h3 className="font-semibold">Order #{order.orderNumber}</h3>
          </Link>
          <p className="text-sm text-gray-500">
            {formatDistanceToNow(new Date(order.createdAt), { addSuffix: true })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-primary-600">
            ${order.totalPrice.toFixed(2)}
          </p>
          <div className="flex space-x-2 mt-1">
            <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(order.status)}`}>
              {order.status}
            </span>
            <span className={`text-xs px-2 py-1 rounded-full ${getPaymentStatusColor(order.paymentStatus)}`}>
              {order.paymentStatus}
            </span>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-2 mb-4">
        {order.items.slice(0, 3).map((item, index) => (
          <div key={index} className="flex justify-between text-sm">
            <span className="text-gray-600">{item.courseTitle}</span>
            <span className="text-gray-900">${item.finalPrice.toFixed(2)}</span>
          </div>
        ))}
        {order.items.length > 3 && (
          <p className="text-sm text-gray-500">
            +{order.items.length - 3} more items
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
        <Link
          to={`/orders/${order.id}`}
          className="text-sm text-primary-600 hover:text-primary-700"
        >
          View Details
        </Link>
        {canCancel && order.status === 'PENDING' && onCancel && (
          <button
            onClick={() => onCancel(order.id)}
            className="text-sm text-red-600 hover:text-red-700"
          >
            Cancel Order
          </button>
        )}
      </div>
    </div>
  );
};
