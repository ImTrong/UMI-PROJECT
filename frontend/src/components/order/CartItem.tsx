import { FiTrash2, FiShoppingCart } from 'react-icons/fi';
import { CartItem as CartItemType } from '../../services/order.service';

interface CartItemProps {
  item: CartItemType;
  onRemove: (courseId: string) => void;
}

export const CartItem = ({ item, onRemove }: CartItemProps) => {
  return (
    <div className="flex items-center space-x-4 py-4 border-b border-gray-200 last:border-0">
      {/* Thumbnail */}
      <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt={item.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <FiShoppingCart size={24} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1">
        <h3 className="font-semibold text-gray-900">{item.title}</h3>
        <p className="text-sm text-gray-500">Khóa học</p>
      </div>

      {/* Price */}
      <div className="text-right">
        <p className="font-bold text-primary-600">${item.price.toFixed(2)}</p>
      </div>

      {/* Remove Button */}
      <button
        onClick={() => onRemove(item.courseId)}
        className="text-gray-400 hover:text-red-500 transition"
        title="Xóa khỏi giỏ hàng"
      >
        <FiTrash2 size={18} />
      </button>
    </div>
  );
};
