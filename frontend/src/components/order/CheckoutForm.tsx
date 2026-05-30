import { useState } from 'react';
import { CartItem } from '../../services/order.service';
import { FiCreditCard, FiShield } from 'react-icons/fi';
import { formatVND } from '../../utils/currency';

interface CheckoutFormProps {
  items: CartItem[];
  totalPrice: number;
  onSubmit: (notes: string) => Promise<void>;
  isLoading?: boolean;
}

export const CheckoutForm = ({ items, totalPrice, onSubmit, isLoading }: CheckoutFormProps) => {
  const [notes, setNotes] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreeTerms) {
      alert('Vui lòng đồng ý với các điều khoản và điều kiện');
      return;
    }
    await onSubmit(notes);
  };

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* Order Summary */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Tóm tắt đơn hàng</h2>
        <div className="space-y-3 mb-4">
          {items.map((item, index) => (
            <div key={index} className="flex justify-between">
              <span className="text-slate-600">{item.title}</span>
              <span className="font-medium">{formatVND(item.price)}</span>
            </div>
          ))}
        </div>
        <div className="border-t pt-3 space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-600">Tạm tính</span>
            <span>{formatVND(totalPrice)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Giảm giá</span>
            <span className="text-green-600">{formatVND(0)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg pt-2 border-t">
            <span>Tổng cộng</span>
            <span className="text-primary-600">{formatVND(totalPrice)}</span>
          </div>
        </div>
      </div>

      {/* Checkout Form */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Thanh toán</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Ghi chú đơn hàng (Tùy chọn)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="input-field"
              placeholder="Ghi chú thêm về đơn hàng..."
            />
          </div>

          <div className="bg-slate-50 rounded-xl p-4">
            <div className="flex items-center space-x-2 mb-3">
              <FiCreditCard className="text-slate-500" />
              <span className="font-medium">Phương thức thanh toán</span>
            </div>
            <p className="text-sm text-slate-600">
              Bạn sẽ được chuyển hướng một cách an toàn đến trang thanh toán sau khi xác nhận đơn hàng.
            </p>
          </div>

          <div className="flex items-start space-x-2">
            <input
              type="checkbox"
              id="terms"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-1"
            />
            <label htmlFor="terms" className="text-sm text-slate-600">
              Tôi đồng ý với các <a href="/terms" className="text-primary-600 hover:underline">Điều khoản dịch vụ</a> và <a href="/privacy" className="text-primary-600 hover:underline">Chính sách bảo mật</a>
            </label>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full btn-primary disabled:opacity-50"
          >
            {isLoading ? 'Đang xử lý...' : `Tiến hành đặt hàng • ${formatVND(totalPrice)}`}
          </button>

          <div className="flex items-center justify-center space-x-2 text-xs text-slate-500 mt-4">
            <FiShield />
            <span>Xử lý thanh toán bảo mật</span>
          </div>
        </form>
      </div>
    </div>
  );
};
