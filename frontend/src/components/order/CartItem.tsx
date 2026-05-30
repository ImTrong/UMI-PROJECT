import { FiTrash2, FiShoppingCart } from 'react-icons/fi';
import { CartItem as CartItemType } from '../../services/order.service';
import { formatVND } from '../../utils/currency';

interface CartItemProps {
  item: CartItemType;
  onRemove: (courseId: string) => void;
}

export const CartItem = ({ item, onRemove }: CartItemProps) => {
  return (
    <div className="flex items-center space-x-4 py-4 border-b border-slate-100 last:border-0">
      {/* Thumbnail */}
      <div className="w-20 h-20 bg-slate-100 rounded-xl overflow-hidden flex-shrink-0">
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt={item.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400">
            <FiShoppingCart size={24} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1">
        <h3 className="font-semibold text-slate-900">{item.title}</h3>
        <p className="text-sm text-slate-500">Khóa học</p>
      </div>

      {/* Price */}
      <div className="text-right">
        <p className="font-bold text-primary-600">{formatVND(item.price)}</p>
      </div>

      {/* Remove Button */}
      <button
        onClick={() => onRemove(item.courseId)}
        className="text-slate-400 hover:text-red-500 transition"
        title="Xóa khỏi giỏ hàng"
      >
        <FiTrash2 size={18} />
      </button>
    </div>
  );
};
