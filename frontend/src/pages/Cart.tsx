import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { orderService } from '../services/order.service';
import { CartItem } from '../components/order/CartItem';
import { CheckoutForm } from '../components/order/CheckoutForm';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiShoppingBag, FiArrowLeft } from 'react-icons/fi';
import { fetchCart, removeFromCart } from '../store/cartSlice';
import { formatVND } from '../utils/currency';

export default function Cart() {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated } = useAuth();
  const { items, totalPrice, loading: cartLoading } = useSelector((state: RootState) => state.cart);
  
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    dispatch(fetchCart());
  }, [isAuthenticated, navigate, dispatch]);

  const handleRemoveFromCart = async (courseId: string) => {
    try {
      await dispatch(removeFromCart(courseId)).unwrap();
    } catch (error) {
      toast.error('Xóa mục thất bại');
    }
  };

  const handleCheckout = async (notes: string) => {
    if (items.length === 0) {
      toast.error('Giỏ hàng của bạn đang trống');
      return;
    }

    setCheckoutLoading(true);
    try {
      const result = await orderService.createOrder({
        items: items.map(item => ({
          courseId: item.courseId,
          courseTitle: item.title,
          price: item.price,
        })),
        notes,
      });
      toast.success('Tạo đơn hàng thành công! Đang chuyển đến thanh toán...');
      navigate(`/checkout/${result.order.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Không thể tạo đơn hàng');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (cartLoading && items.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <FiShoppingBag className="mx-auto text-6xl text-slate-400 mb-4" />
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Giỏ hàng rỗng</h2>
        <p className="text-slate-600 mb-6">Có vẻ như bạn chưa thêm khóa học nào vào giỏ hàng.</p>
        <button
          onClick={() => navigate('/courses')}
          className="btn-primary inline-flex items-center space-x-2"
        >
          <FiArrowLeft />
          <span>Khám phá khóa học</span>
        </button>
      </div>
    );
  }

  if (showCheckout) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <button
          onClick={() => setShowCheckout(false)}
          className="mb-4 text-slate-600 hover:text-slate-800 flex items-center space-x-1"
        >
          <FiArrowLeft />
          <span>Quay lại Giỏ hàng</span>
        </button>
        <CheckoutForm
          items={items}
          totalPrice={totalPrice}
          onSubmit={handleCheckout}
          isLoading={checkoutLoading}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">Giỏ hàng</h1>

      <div className="grid md:grid-cols-3 gap-8">
        {/* Cart Items */}
        <div className="md:col-span-2">
          <div className="card">
            <div className="space-y-2">
              {items.map((item) => (
                <CartItem
                  key={item.courseId}
                  item={item}
                  onRemove={handleRemoveFromCart}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Order Summary */}
        <div>
          <div className="card sticky top-24">
            <h2 className="text-xl font-semibold mb-4">Tóm tắt đơn hàng</h2>
            <div className="space-y-3 mb-4">
              <div className="flex justify-between">
                <span className="text-slate-600">Tạm tính</span>
                <span>{formatVND(totalPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Giảm giá</span>
                <span className="text-green-600">{formatVND(0)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-3 border-t">
                <span>Tổng cộng</span>
                <span className="text-primary-600">{formatVND(totalPrice)}</span>
              </div>
            </div>
            <button
              onClick={() => setShowCheckout(true)}
              className="w-full btn-primary"
            >
              Tiến hành thanh toán
            </button>
            <button
              onClick={() => navigate('/courses')}
              className="w-full mt-3 btn-secondary"
            >
              Tiếp tục mua sắm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
