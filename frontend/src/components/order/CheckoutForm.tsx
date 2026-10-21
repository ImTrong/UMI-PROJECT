import { useState } from 'react';
import { CartItem } from '../../services/order.service';
import { FiShield } from 'react-icons/fi';
import { formatVND } from '../../utils/currency';

interface CheckoutFormProps {
  items: CartItem[];
  totalPrice: number;
  onSubmit: (notes: string, paymentMethod: 'stripe' | 'payos') => Promise<void>;
  isLoading?: boolean;
}

export const CheckoutForm = ({ items, totalPrice, onSubmit, isLoading }: CheckoutFormProps) => {
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'payos'>('payos');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreeTerms) {
      alert('Vui lòng đồng ý với các điều khoản và điều kiện');
      return;
    }
    await onSubmit(notes, paymentMethod);
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

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Chọn phương thức thanh toán
            </label>
            <div className="space-y-3">
              <label
                className={`flex items-start p-3.5 border-2 rounded-xl cursor-pointer transition-all ${
                  paymentMethod === 'payos'
                    ? 'border-primary-600 bg-primary-50/40 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value="payos"
                  checked={paymentMethod === 'payos'}
                  onChange={() => setPaymentMethod('payos')}
                  className="mt-1 text-primary-600 focus:ring-primary-500"
                />
                <div className="ml-3 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900 text-sm">
                      🏦 Chuyển khoản QR Ngân hàng (VietQR / payOS)
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      Khuyên dùng
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Quét mã QR qua app ngân hàng hoặc ví điện tử tại VN. Xác nhận ngay lập tức.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start p-3.5 border-2 rounded-xl cursor-pointer transition-all ${
                  paymentMethod === 'stripe'
                    ? 'border-primary-600 bg-primary-50/40 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value="stripe"
                  checked={paymentMethod === 'stripe'}
                  onChange={() => setPaymentMethod('stripe')}
                  className="mt-1 text-primary-600 focus:ring-primary-500"
                />
                <div className="ml-3 flex-1">
                  <span className="font-medium text-slate-900 text-sm">
                    💳 Thẻ Quốc tế (Stripe)
                  </span>
                  <p className="text-xs text-slate-500 mt-1">
                    Hỗ trợ Visa, MasterCard, JCB. Thanh toán bảo mật chuẩn PCI-DSS.
                  </p>
                </div>
              </label>
            </div>
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
