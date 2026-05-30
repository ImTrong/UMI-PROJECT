import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { authService } from '../services/auth.service';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const hasVerified = useRef(false);
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Đang xác thực email của bạn...');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Không có mã xác thực nào được cung cấp trong URL.');
      return;
    }

    if (hasVerified.current) return;
    hasVerified.current = true;

    const verify = async () => {
      try {
        await authService.verifyEmail({ token });
        setStatus('success');
        setMessage('Xác thực email thành công! Bạn có thể đăng nhập ngay bây giờ.');
        setTimeout(() => navigate('/login'), 3000);
      } catch (err: any) {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Xác thực thất bại. Đường link có thể đã hết hạn.');
      }
    };

    verify();
  }, [token, navigate]);

  return (
    <div className="flex items-center justify-center py-20 px-4">
      <div className="card max-w-md w-full text-center">
        {status === 'loading' && (
          <div>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-bold mb-2">Xác thực Email</h2>
            <p className="text-slate-600">{message}</p>
          </div>
        )}
        
        {status === 'success' && (
          <div>
            <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-green-700 mb-2">Thành công!</h2>
            <p className="text-slate-600 mb-4">{message}</p>
            <p className="text-sm text-slate-500">Đang chuyển hướng đến trang đăng nhập...</p>
          </div>
        )}

        {status === 'error' && (
          <div>
            <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-red-700 mb-2">Xác thực Thất bại</h2>
            <p className="text-slate-600 mb-6">{message}</p>
            <Link to="/login" className="btn-primary w-full inline-block">
              Quay lại Đăng nhập
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
