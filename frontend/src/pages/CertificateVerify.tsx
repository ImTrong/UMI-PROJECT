import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { learningService } from '../services/learning.service';
import { format } from 'date-fns';
import { FiSearch, FiCheckCircle, FiXCircle, FiAward, FiCalendar, FiUser, FiBookOpen, FiMap } from 'react-icons/fi';

interface VerificationResult {
  valid: boolean;
  message: string;
  certificate?: {
    certificateNumber: string;
    userName: string;
    courseTitle: string;
    issueDate: string;
    expiresAt?: string;
    type?: 'COURSE_COMPLETION' | 'PATH_CERTIFICATE';
    metadata?: any;
  };
}

export default function CertificateVerify() {
  const { certificateNumber: paramNumber } = useParams<{ certificateNumber: string }>();
  const [certNumber, setCertNumber] = useState(paramNumber || '');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Auto-verify if opened with param
  useState(() => {
    if (paramNumber) {
      handleVerify(paramNumber);
    }
  });

  async function handleVerify(number?: string) {
    const searchNumber = number || certNumber.trim();
    if (!searchNumber) return;

    setLoading(true);
    setSearched(true);
    try {
      const res = await learningService.verifyCertificate(searchNumber);
      setResult(res);
    } catch (error) {
      setResult({ valid: false, message: 'Không thể xác minh. Vui lòng kiểm tra lại mã.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[80vh] bg-gradient-to-b from-gray-50 to-white flex flex-col items-center justify-center px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary-500 to-cyan-600 rounded-2xl flex items-center justify-center shadow-sm shadow-primary-500/20 mb-5">
          <FiAward className="text-white" size={30} />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Xác minh Chứng nhận / Chứng chỉ</h1>
        <p className="text-slate-500 max-w-md mx-auto">Nhập mã để xác minh tính hợp lệ của chứng nhận khóa học hoặc chứng chỉ lộ trình</p>
      </div>

      {/* Search box */}
      <div className="w-full max-w-lg mb-8">
        <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} className="flex gap-3">
          <div className="flex-1 relative">
            <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              value={certNumber}
              onChange={(e) => setCertNumber(e.target.value)}
              placeholder="Nhập mã chứng nhận/chứng chỉ (VD: CERT-1234...)"
              className="w-full pl-11 pr-4 py-3.5 border border-slate-100 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all text-sm font-mono shadow-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !certNumber.trim()}
            className="px-6 py-3.5 bg-gradient-to-r from-primary-600 to-cyan-600 text-white font-semibold rounded-xl shadow-sm shadow-primary-500/25 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              'Xác minh'
            )}
          </button>
        </form>
      </div>

      {/* Result */}
      {searched && !loading && result && (
        <div className="w-full max-w-lg animate-in">
          {result.valid ? (
            <div className="bg-white rounded-2xl border border-green-200 shadow-sm shadow-green-500/10 overflow-hidden">
              {/* Valid header */}
              <div className="bg-gradient-to-r from-green-500 to-emerald-500 p-6 text-center text-white">
                <FiCheckCircle size={40} className="mx-auto mb-3" />
                <h2 className="text-xl font-bold">Hợp lệ ✓</h2>
                <p className="text-green-100 text-sm mt-1">Chứng nhận / chứng chỉ này đã được xác minh thành công</p>
              </div>

              {/* Certificate info */}
              <div className="p-6 space-y-4">
                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  <FiUser className="text-primary-500 mt-0.5 flex-shrink-0" size={18} />
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Người nhận</p>
                    <p className="font-semibold text-slate-900">{result.certificate?.userName}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  {result.certificate?.type === 'PATH_CERTIFICATE' ? (
                    <FiMap className="text-amber-500 mt-0.5 flex-shrink-0" size={18} />
                  ) : (
                    <FiBookOpen className="text-cyan-500 mt-0.5 flex-shrink-0" size={18} />
                  )}
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">
                      {result.certificate?.type === 'PATH_CERTIFICATE' ? 'Lộ trình' : 'Khóa học'}
                    </p>
                    <p className="font-semibold text-slate-900">
                      {result.certificate?.metadata?.certificateConfig?.title || result.certificate?.courseTitle}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1 flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                    <FiCalendar className="text-green-500 mt-0.5 flex-shrink-0" size={18} />
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Ngày cấp</p>
                      <p className="font-semibold text-slate-900 text-sm">
                        {result.certificate?.issueDate ? format(new Date(result.certificate.issueDate), 'dd/MM/yyyy') : '—'}
                      </p>
                    </div>
                  </div>
                  {result.certificate?.expiresAt && (
                    <div className="flex-1 flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                      <FiCalendar className="text-amber-500 mt-0.5 flex-shrink-0" size={18} />
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Hiệu lực đến</p>
                        <p className="font-semibold text-slate-900 text-sm">
                          {format(new Date(result.certificate.expiresAt), 'dd/MM/yyyy')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t">
                  <p className="text-xs text-slate-400 font-mono text-center">
                    Mã: {result.certificate?.certificateNumber}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-red-200 shadow-sm shadow-red-500/10 overflow-hidden">
              <div className="bg-gradient-to-r from-red-500 to-rose-500 p-6 text-center text-white">
                <FiXCircle size={40} className="mx-auto mb-3" />
                <h2 className="text-xl font-bold">Không hợp lệ</h2>
                <p className="text-red-100 text-sm mt-1">{result.message}</p>
              </div>
              <div className="p-6 text-center">
                <p className="text-slate-600 text-sm">
                  Mã "<span className="font-mono font-bold">{certNumber}</span>" không tồn tại, đã bị thu hồi hoặc đã hết hạn.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
