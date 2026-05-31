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
  const { items, loading: cartLoading } = useSelector((state: RootState) => state.cart);
  
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Tính tổng tiền của các khóa học được chọn
  const selectedTotalPrice = items
    .filter(item => selectedItems.has(item.courseId))
    .reduce((sum, item) => sum + item.price, 0);

  const isAllSelected = items.length > 0 && selectedItems.size === items.length;

  const handleToggleSelect = (courseId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(courseId)) {
      newSelected.delete(courseId);
    } else {
      newSelected.add(courseId);
    }
    setSelectedItems(newSelected);
  };

  const handleToggleAll = () => {
    if (isAllSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(item => item.courseId)));
    }
  };

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
      if (selectedItems.has(courseId)) {
        const newSelected = new Set(selectedItems);
        newSelected.delete(courseId);
        setSelectedItems(newSelected);
      }
    } catch (error) {
      toast.error('Xóa mục thất bại');
    }
  };

  const handleCheckout = async (notes: string) => {
    const itemsToCheckout = items.filter(item => selectedItems.has(item.courseId));
    
    if (itemsToCheckout.length === 0) {
      toast.error('Vui lòng chọn ít nhất một khóa học để thanh toán');
      return;
    }

    setCheckoutLoading(true);
    try {
      const result = await orderService.createOrder({
        items: itemsToCheckout.map(item => ({
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
          items={items.filter(item => selectedItems.has(item.courseId))}
          totalPrice={selectedTotalPrice}
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
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <label className="flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={isAllSelected}
                  onChange={handleToggleAll}
                  className="w-5 h-5 text-primary-600 rounded border-slate-300 focus:ring-primary-500 cursor-pointer mr-3"
                />
                <span className="font-semibold text-slate-700 group-hover:text-primary-600 transition-colors">Chọn tất cả ({items.length} khóa học)</span>
              </label>
              <span className="text-sm text-slate-500">Đã chọn: {selectedItems.size}</span>
            </div>
            <div className="space-y-2">
              {items.map((item) => (
                <CartItem
                  key={item.courseId}
                  item={item}
                  onRemove={handleRemoveFromCart}
                  isSelected={selectedItems.has(item.courseId)}
                  onToggle={handleToggleSelect}
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
                <span className="text-slate-600">Tạm tính ({selectedItems.size} khóa học)</span>
                <span>{formatVND(selectedTotalPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Giảm giá</span>
                <span className="text-green-600">{formatVND(0)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-3 border-t">
                <span>Tổng cộng</span>
                <span className="text-primary-600">{formatVND(selectedTotalPrice)}</span>
              </div>
            </div>
            <button
              onClick={() => {
                if (selectedItems.size === 0) {
                  toast.error('Vui lòng chọn ít nhất một khóa học để thanh toán');
                  return;
                }
                setShowCheckout(true);
              }}
              disabled={selectedItems.size === 0}
              className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
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
