import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FiMail } from 'react-icons/fi';
import { authService } from '../services/auth.service';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const res = await authService.forgotPassword({ email });
      setMessage(res.message || 'Đường dẫn đặt lại mật khẩu đã được gửi đến email của bạn.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Gửi đường dẫn đặt lại mật khẩu thất bại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="py-8 max-w-md mx-auto">
      <div className="card">
        <h2 className="text-2xl font-bold text-center mb-6">Quên mật khẩu</h2>
        {message && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{message}</div>}
        {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Địa chỉ Email</label>
            <div className="relative">
              <FiMail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field pl-10"
                placeholder="you@example.com"
                required
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full btn-primary disabled:opacity-50">
            {loading ? 'Đang gửi...' : 'Gửi đường dẫn'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          Đã nhớ lại mật khẩu? <Link to="/login" className="text-primary-600 hover:underline">Đăng nhập tại đây</Link>
        </p>
      </div>
    </div>
  );
}
