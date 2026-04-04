import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { FiLock } from 'react-icons/fi';
import { authService } from '../services/auth.service';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('Mã đặt lại không hợp lệ hoặc bị thiếu.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu không khớp.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await authService.resetPassword({ token, newPassword: password });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Đặt lại mật khẩu thất bại.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="py-8 max-w-md mx-auto">
        <div className="card text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Lỗi</h2>
          <p>Không có mã đặt lại. Vui lòng sử dụng đường link từ email của bạn.</p>
          <Link to="/forgot-password" className="mt-4 inline-block text-primary-600 hover:underline">
            Yêu cầu đường link mới
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="py-8 max-w-md mx-auto">
      <div className="card">
        <h2 className="text-2xl font-bold text-center mb-6">Đặt lại Mật khẩu</h2>
        
        {success ? (
          <div className="text-center">
            <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">
              Mật khẩu đã được đặt lại thành công!
            </div>
            <p className="text-sm text-gray-600">Đang chuyển hướng đến trang đăng nhập...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="p-3 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu mới</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pl-10"
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Xác nhận Mật khẩu mới</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-field pl-10"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
            <button type="submit" disabled={loading} className="w-full btn-primary disabled:opacity-50">
              {loading ? 'Đang đặt lại...' : 'Đặt lại Mật khẩu'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
