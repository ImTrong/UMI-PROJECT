import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { orderService, Order } from '../services/order.service';
import { paymentService, PaymentIntent } from '../services/payment.service';
import { StripePaymentForm } from '../components/payment/StripePaymentForm';
import { PaymentPendingNotice } from '../components/payment/PaymentPendingNotice';
import { runDemoPayment } from '../components/payment/payment-flow';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import {
  FiArrowLeft,
  FiShield,
  FiAlertCircle,
  FiCheck,
  FiCopy,
  FiExternalLink,
  FiRefreshCw,
  FiSmartphone,
} from 'react-icons/fi';
import { formatVND } from '../utils/currency';

interface PayosPaymentData {
  orderCode?: string | number;
  checkoutUrl?: string;
  qrCode?: string;
  amount?: number;
  isMock?: boolean;
}

export default function Checkout() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const [order, setOrder] = useState<Order | null>(null);
  const [activeMethod, setActiveMethod] = useState<'payos' | 'stripe'>('payos');
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [payosData, setPayosData] = useState<PayosPaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrLoading, setQrLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(15 * 60); // 15 mins countdown

  const pollingRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

  const handleSimulatePayosPayment = async () => {
    if (!orderId) return;
    try {
      setSimulating(true);
      // success only if the demo answered a SUCCEEDED payment (FIX 07B-1.3)
      await runDemoPayment(orderId, {
        onSuccess: () => {
          toast.success('Mô phỏng thanh toán thành công! Đang kích hoạt đơn hàng...');
          setTimeout(() => {
            navigate(`/checkout/success/${orderId}`);
          }, 1200);
        },
        onPending: handlePaymentPending,
        onError: handlePaymentError,
      });
    } finally {
      setSimulating(false);
    }
  };

  // Load order and initial payment
  const loadOrderAndPayment = useCallback(async () => {
    if (!orderId) return;

    try {
      setLoading(true);
      setError(null);

      const orderData = await orderService.getOrderById(orderId);

      if (orderData.paymentStatus === 'PAID' || orderData.status === 'COMPLETED') {
        toast.success('Đơn hàng này đã được thanh toán');
        navigate(`/checkout/success/${orderId}`);
        return;
      }

      if (orderData.status === 'CANCELLED' || orderData.status === 'FAILED') {
        toast.error('Đơn hàng này đã bị hủy hoặc thất bại');
        navigate(`/orders/${orderId}`);
        return;
      }

      setOrder(orderData);

      // Preferred method from order or default to payos
      const preferred = orderData.paymentMethod === 'stripe' ? 'stripe' : 'payos';
      setActiveMethod(preferred);

      // Check existing payment in payment-service
      try {
        const payment = await paymentService.getPaymentByOrder(orderId);
        if (payment.provider === 'payos' || payment.payosQrCode || payment.payosCheckoutUrl) {
          setPayosData({
            orderCode: payment.payosOrderCode,
            checkoutUrl: payment.payosCheckoutUrl,
            qrCode: payment.payosQrCode,
            amount: payment.amount,
            isMock: payment.isMock,
          });
        }
        if (payment.clientSecret) {
          setPaymentIntent(payment);
        }
      } catch (paymentErr: any) {
        // No payment record yet - will be initialized based on selected method
      }
    } catch (err: any) {
      console.error('Failed to load order:', err);
      toast.error('Không tìm thấy đơn hàng');
      navigate('/orders');
    } finally {
      setLoading(false);
    }
  }, [orderId, navigate]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadOrderAndPayment();
  }, [isAuthenticated, loadOrderAndPayment, navigate]);

  // Initialize payOS payment
  const initPayos = useCallback(async (forceRegenerate: boolean = false) => {
    if (!orderId) return;
    if (!forceRegenerate && payosData?.checkoutUrl) return;

    try {
      setQrLoading(true);
      setError(null);
      const result = await orderService.initiatePayosPayment(orderId, forceRegenerate);
      setPayosData({
        orderCode: result.orderCode,
        checkoutUrl: result.checkoutUrl,
        qrCode: result.qrCode,
        amount: result.amount,
        isMock: (result as any).isMock,
      });
      setTimeLeft(15 * 60);
    } catch (err: any) {
      console.error('Failed to init PayOS:', err);
      setError(err.response?.data?.error || 'Không thể tạo mã QR PayOS. Vui lòng thử lại.');
    } finally {
      setQrLoading(false);
    }
  }, [orderId, payosData?.checkoutUrl]);

  // Initialize Stripe payment intent
  const initStripe = useCallback(async () => {
    if (!orderId || !order || paymentIntent?.clientSecret) return;

    try {
      const newPayment = await paymentService.createPaymentIntent({
        orderId,
        orderNumber: order.orderNumber,
        amount: order.totalPrice,
        currency: 'vnd',
      });
      setPaymentIntent(newPayment);
    } catch (err: any) {
      console.error('Failed to create stripe payment intent:', err);
      setError('Không thể khởi tạo thanh toán thẻ Stripe. Vui lòng thử lại sau.');
    }
  }, [orderId, order, paymentIntent?.clientSecret]);

  // When active method changes, load appropriate provider data
  useEffect(() => {
    if (!order) return;
    if (activeMethod === 'payos' && !payosData?.checkoutUrl) {
      initPayos();
    } else if (activeMethod === 'stripe' && !paymentIntent?.clientSecret) {
      initStripe();
    }
  }, [activeMethod, order, payosData?.checkoutUrl, paymentIntent?.clientSecret, initPayos, initStripe]);

  // Polling order status (detect when user pays on mobile or external bank app)
  useEffect(() => {
    if (!orderId || !order || order.paymentStatus === 'PAID') return;

    pollingRef.current = setInterval(async () => {
      try {
        const latest = await orderService.getOrderById(orderId);
        if (latest.paymentStatus === 'PAID' || latest.status === 'COMPLETED') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          toast.success('Xác nhận thanh toán thành công!');
          navigate(`/checkout/success/${orderId}`);
        } else if (latest.status === 'CANCELLED' || latest.status === 'FAILED') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          toast.error('Đơn hàng đã kết thúc mà chưa thanh toán.');
          navigate(`/orders/${orderId}`);
        }
      } catch (err) {
        // Polling error non-blocking
      }
    }, 3000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [orderId, order, navigate]);

  // Countdown timer for QR code validity
  useEffect(() => {
    if (activeMethod !== 'payos') return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeMethod]);

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    toast.success(`Đã sao chép ${fieldName}`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePaymentSuccess = async () => {
    navigate(`/checkout/success/${orderId}`);
  };

  const handlePaymentError = (errorMsg: string) => {
    setPendingMessage(null);
    toast.error(errorMsg);
  };

  // not a success: show it and keep polling the order, which only the payment webhook / outbox moves to PAID (FIX 07B-1.3)
  function handlePaymentPending(message: string) {
    setPendingMessage(message);
  }

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-slate-600 font-medium">Đang tải thông tin thanh toán...</p>
        </div>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate(`/orders/${orderId}`)}
        className="mb-6 text-slate-600 hover:text-slate-900 flex items-center space-x-2 font-medium transition-colors"
      >
        <FiArrowLeft />
        <span>Quay lại chi tiết đơn hàng</span>
      </button>

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Payment Main Section */}
        <div className="lg:col-span-7 space-y-6">
          {/* Payment Method Selector Tabs */}
          <div className="card">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Phương thức thanh toán</h2>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <button
                type="button"
                onClick={() => {
                  setActiveMethod('payos');
                  setError(null);
                }}
                className={`p-4 rounded-xl border-2 text-left transition-all flex flex-col justify-between ${
                  activeMethod === 'payos'
                    ? 'border-primary-600 bg-primary-50/50 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-2">
                  <span className="text-2xl">🏦</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Khuyên dùng
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">VietQR (payOS)</p>
                  <p className="text-xs text-slate-500 mt-0.5">Quét QR qua mọi app ngân hàng</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveMethod('stripe');
                  setError(null);
                }}
                className={`p-4 rounded-xl border-2 text-left transition-all flex flex-col justify-between ${
                  activeMethod === 'stripe'
                    ? 'border-primary-600 bg-primary-50/50 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-2">
                  <span className="text-2xl">💳</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    Visa / Master
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">Thẻ Quốc Tế (Stripe)</p>
                  <p className="text-xs text-slate-500 mt-0.5">Thanh toán thẻ tín dụng / ghi nợ</p>
                </div>
              </button>
            </div>

            {error && (
              <div className="flex items-start space-x-3 text-red-700 bg-red-50 p-4 rounded-xl mb-4 border border-red-200">
                <FiAlertCircle className="mt-0.5 shrink-0" size={18} />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {pendingMessage && <PaymentPendingNotice message={pendingMessage} />}

            {/* PayOS VietQR Content */}
            {activeMethod === 'payos' && (
              <div className="space-y-6 pt-2">
                <div className="border border-slate-200 rounded-2xl p-6 bg-slate-50/50">
                  <div className="flex flex-col sm:flex-row items-center gap-6">
                    {/* QR Code Container */}
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center shrink-0">
                      {qrLoading ? (
                        <div className="w-52 h-52 flex flex-col items-center justify-center space-y-3">
                          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
                          <span className="text-xs text-slate-500">Đang tạo mã VietQR...</span>
                        </div>
                      ) : payosData?.qrCode ? (
                        <div className="relative">
                          <img
                            src={
                              payosData.qrCode.startsWith('data:') || payosData.qrCode.startsWith('http')
                                ? payosData.qrCode
                                : `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                                    payosData.qrCode
                                  )}`
                            }
                            alt="VietQR Payment Code"
                            className="w-52 h-52 object-contain rounded-lg"
                          />
                          {timeLeft === 0 && (
                            <div className="absolute inset-0 bg-white/90 backdrop-blur-xs flex flex-col items-center justify-center p-4 rounded-lg text-center">
                              <FiAlertCircle className="text-red-500 mb-1" size={28} />
                              <p className="text-xs font-semibold text-red-600">Mã QR đã hết hạn</p>
                              <button
                                onClick={() => initPayos(true)}
                                className="mt-2 text-xs btn-primary py-1 px-3"
                              >
                                Tạo lại mã
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-52 h-52 flex flex-col items-center justify-center p-4 text-center">
                          <p className="text-xs text-slate-500 mb-3">Chưa có mã QR thanh toán</p>
                          <button
                            onClick={() => initPayos(false)}
                            className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
                          >
                            <FiRefreshCw size={13} />
                            <span>Tạo mã QR</span>
                          </button>
                        </div>
                      )}
                      <div className="mt-2 text-center">
                        <span className="text-[11px] font-medium text-slate-500 flex items-center justify-center gap-1">
                          <FiSmartphone size={12} />
                          Quét bằng app ngân hàng / MoMo
                        </span>
                      </div>
                    </div>

                    {/* Bank Transfer Details */}
                    <div className="flex-1 space-y-3 w-full">
                      <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                        <p className="text-xs text-slate-500">Số tiền cần chuyển</p>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xl font-bold text-primary-600">
                            {formatVND(order.totalPrice)}
                          </p>
                          <button
                            onClick={() => copyToClipboard(String(Math.round(order.totalPrice)), 'Số tiền')}
                            className="text-xs text-slate-500 hover:text-primary-600 p-1.5 hover:bg-slate-50 rounded flex items-center gap-1"
                          >
                            {copiedField === 'Số tiền' ? <FiCheck className="text-green-600" /> : <FiCopy />}
                            <span>{copiedField === 'Số tiền' ? 'Đã chép' : 'Sao chép'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                        <p className="text-xs text-slate-500">Nội dung chuyển khoản</p>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="font-mono font-bold text-slate-800 text-sm">
                            UMI {order.orderNumber}
                          </p>
                          <button
                            onClick={() => copyToClipboard(`UMI ${order.orderNumber}`, 'Nội dung')}
                            className="text-xs text-slate-500 hover:text-primary-600 p-1.5 hover:bg-slate-50 rounded flex items-center gap-1"
                          >
                            {copiedField === 'Nội dung' ? <FiCheck className="text-green-600" /> : <FiCopy />}
                            <span>{copiedField === 'Nội dung' ? 'Đã chép' : 'Sao chép'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-slate-500">Mã đơn PayOS</p>
                            <p className="font-mono text-sm font-semibold text-slate-700">
                              #{payosData?.orderCode || order.payosOrderCode || '---'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-500">Thời gian hiệu lực</p>
                            <p className={`font-mono text-sm font-bold ${timeLeft < 180 ? 'text-red-600' : 'text-slate-700'}`}>
                              {formatTimer(timeLeft)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Fallback */}
                  <div className="mt-5 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>Hệ thống tự động kích hoạt khóa học khi nhận được chuyển khoản</span>
                    </div>

                    {payosData?.checkoutUrl && !payosData.checkoutUrl.includes('mock=true') && (
                      <a
                        href={payosData.checkoutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5 shrink-0"
                      >
                        <FiExternalLink size={13} />
                        <span>Mở cổng PayOS</span>
                      </a>
                    )}
                  </div>

                  {/* Sandbox / Demo Simulation Helper */}
                  <div className="mt-4 p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="text-xs text-amber-800">
                      <p className="font-semibold flex items-center gap-1.5">
                        <span>🧪</span>
                        <span>Môi trường Thử nghiệm / Sandbox (VietQR)</span>
                      </p>
                      <p className="text-amber-700 mt-0.5">
                        Bạn có thể quét mã QR giả lập hoặc bấm nút bên cạnh để mô phỏng quét mã & hoàn tất đơn hàng ngay lập tức.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSimulatePayosPayment}
                      disabled={simulating}
                      className="btn-primary text-xs py-2 px-3.5 bg-emerald-600 hover:bg-emerald-700 border-none shrink-0 flex items-center gap-1.5 text-white rounded-lg font-medium transition-colors shadow-sm"
                    >
                      {simulating ? <FiRefreshCw className="animate-spin" size={13} /> : <FiCheck size={14} />}
                      <span>{simulating ? 'Đang kích hoạt...' : '⚡ Giả lập thanh toán thành công'}</span>
                    </button>
                  </div>
                </div>

                <div className="text-xs text-slate-500 space-y-1">
                  <p>• Vui lòng chuyển <strong>đúng số tiền</strong> và <strong>nội dung chuyển khoản</strong> để hệ thống khớp lệnh tự động.</p>
                  <p>• Khóa học sẽ được cấp quyền ngay vào tài khoản sau khi giao dịch thành công (thông thường dưới 30 giây).</p>
                </div>
              </div>
            )}

            {/* Stripe Card Content */}
            {activeMethod === 'stripe' && (
              <div className="space-y-6 pt-2">
                {paymentIntent?.clientSecret ? (
                  <StripePaymentForm
                    orderId={order.id}
                    orderNumber={order.orderNumber}
                    amount={order.totalPrice}
                    clientSecret={paymentIntent.clientSecret}
                    stripePaymentIntentId={paymentIntent.stripePaymentIntentId || ''}
                    onSuccess={handlePaymentSuccess}
                    onPending={handlePaymentPending}
                    onError={handlePaymentError}
                  />
                ) : (
                  <div className="flex items-center space-x-2 text-yellow-700 bg-yellow-50 p-4 rounded-xl border border-yellow-200">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-700 shrink-0"></div>
                    <span className="text-sm">Đang khởi tạo cổng thanh toán Stripe...</span>
                  </div>
                )}

                {/* Development test cards helper */}
                <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-cyan-900 mb-1.5">🧪 Thông tin thẻ kiểm thử (Test Mode):</p>
                  <div className="text-xs text-cyan-800 space-y-0.5 font-mono">
                    <p>Số thẻ: 4242 4242 4242 4242</p>
                    <p>Hạn dùng: 12/30 • CVC: 123</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center space-x-2 text-xs text-slate-500">
            <FiShield size={14} className="text-emerald-600" />
            <span>Thanh toán mã hóa bảo mật 256-bit chuẩn ngân hàng và PCI-DSS</span>
          </div>
        </div>

        {/* Order Summary Aside */}
        <div className="lg:col-span-5 space-y-6">
          <div className="card">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 className="text-lg font-bold text-slate-900">Chi tiết đơn hàng</h2>
              <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-md bg-slate-100 text-slate-700">
                #{order.orderNumber}
              </span>
            </div>

            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto mb-4 pr-1">
              {order.items.map((item, index) => (
                <div key={index} className="py-3 flex justify-between gap-3 text-sm">
                  <div className="flex-1">
                    <p className="font-medium text-slate-800 line-clamp-2">{item.courseTitle}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Số lượng: 1</p>
                  </div>
                  <span className="font-semibold text-slate-900 shrink-0">
                    {formatVND(item.finalPrice)}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 pt-4 space-y-2.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Tạm tính</span>
                <span>{formatVND(order.subtotal)}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Giảm giá</span>
                  <span>-{formatVND(order.discount)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline font-bold text-base pt-3 border-t border-slate-200">
                <span className="text-slate-900">Tổng thanh toán</span>
                <span className="text-xl text-primary-600">{formatVND(order.totalPrice)}</span>
              </div>
            </div>

            <div className="mt-5 p-3.5 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-600 space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-slate-800">
                <FiCheck className="text-emerald-600" />
                <span>Cam kết học tập tại UMI</span>
              </div>
              <p>• Truy cập trọn đời sau khi thanh toán</p>
              <p>• Cấp chứng chỉ hoàn thành khóa học</p>
              <p>• Hỗ trợ kỹ thuật 24/7</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
