import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { learningService, Certificate } from '../services/learning.service';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { FiDownload, FiShare2, FiArrowLeft, FiCheckCircle, FiXCircle, FiClock, FiAward, FiExternalLink } from 'react-icons/fi';

export default function CertificateDetail() {
  const { certificateId } = useParams<{ certificateId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !certificateId) return;
    loadCertificate();
  }, [isAuthenticated, certificateId]);

  const loadCertificate = async () => {
    setLoading(true);
    try {
      const cert = await learningService.getCertificateById(certificateId!);
      setCertificate(cert);
    } catch (error: any) {
      console.error('Failed to load certificate:', error);
      toast.error('Không tìm thấy chứng chỉ');
      navigate('/certificates');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!certificateId) return;
    setDownloading(true);
    try {
      await learningService.downloadCertificate(certificateId);
      toast.success('Đã tải chứng chỉ thành công!');
    } catch (error) {
      toast.error('Tải chứng chỉ thất bại. Vui lòng thử lại.');
    } finally {
      setDownloading(false);
    }
  };

  const handleShare = () => {
    if (!certificate) return;
    const shareUrl = `${window.location.origin}/verify-certificate/${certificate.certificateNumber}`;
    navigator.clipboard.writeText(shareUrl);
    toast.success('Đã sao chép liên kết xác minh vào bộ nhớ tạm!');
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[500px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!certificate) return null;

  const isExpired = certificate.expiresAt && new Date(certificate.expiresAt) < new Date();
  const isValid = certificate.isVerified && !isExpired;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Back button */}
      <Link to="/certificates" className="inline-flex items-center gap-2 text-slate-600 hover:text-primary-600 mb-6 transition-colors font-medium text-sm">
        <FiArrowLeft /> Quay lại danh sách chứng chỉ
      </Link>

      {/* Certificate Visual */}
      <div className="relative bg-white rounded-3xl shadow-sm overflow-hidden border border-slate-100">
        {/* Decorative top border */}
        <div className="h-2 bg-gradient-to-r from-primary-500 via-cyan-500 to-teal-500"></div>
        
        {/* Certificate body */}
        <div className="relative px-8 md:px-16 py-12 md:py-16">
          {/* Background decorations */}
          <div className="absolute top-0 left-0 w-64 h-64 bg-primary-50 rounded-full -translate-x-1/2 -translate-y-1/2 opacity-50"></div>
          <div className="absolute bottom-0 right-0 w-48 h-48 bg-cyan-50 rounded-full translate-x-1/4 translate-y-1/4 opacity-50"></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] border border-primary-100/30 rounded-full pointer-events-none"></div>

          {/* Content */}
          <div className="relative z-10 text-center">
            {/* Badge icon */}
            <div className="mx-auto w-20 h-20 bg-gradient-to-br from-primary-500 to-cyan-600 rounded-full flex items-center justify-center shadow-sm shadow-primary-500/30 mb-6">
              <FiAward className="text-white" size={36} />
            </div>

            <p className="text-xs tracking-[0.4em] uppercase text-slate-400 font-bold mb-2">Chứng nhận hoàn thành</p>
            <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-gray-800 to-gray-600 mb-3">
              CERTIFICATE OF COMPLETION
            </h1>

            <div className="w-24 h-0.5 bg-gradient-to-r from-primary-400 to-cyan-400 mx-auto my-6"></div>

            <p className="text-slate-500 text-sm mb-2">Chứng nhận rằng</p>
            <h2 className="text-2xl md:text-3xl font-bold text-primary-600 mb-4">{certificate.userName}</h2>

            <p className="text-slate-500 text-sm mb-2">đã hoàn thành xuất sắc khóa học</p>
            <h3 className="text-xl md:text-2xl font-bold text-slate-800 mb-8 max-w-2xl mx-auto">{certificate.courseTitle}</h3>

            {/* Details grid */}
            <div className="flex flex-wrap justify-center gap-6 mb-8">
              <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 px-4 py-2 rounded-full">
                <FiClock size={14} className="text-slate-400" />
                <span>Ngày cấp: <strong>{format(new Date(certificate.issueDate), 'dd/MM/yyyy')}</strong></span>
              </div>
              {certificate.expiresAt && (
                <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-full ${isExpired ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                  {isExpired ? <FiXCircle size={14} /> : <FiCheckCircle size={14} />}
                  <span>{isExpired ? 'Hết hạn' : 'Có hiệu lực đến'}: <strong>{format(new Date(certificate.expiresAt), 'dd/MM/yyyy')}</strong></span>
                </div>
              )}
              <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-full ${isValid ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                {isValid ? <FiCheckCircle size={14} /> : <FiXCircle size={14} />}
                <span>{isValid ? 'Đã xác minh' : 'Đã thu hồi'}</span>
              </div>
            </div>

            <p className="text-xs text-slate-400 font-mono">Mã chứng chỉ: {certificate.certificateNumber}</p>
          </div>
        </div>

        {/* Bottom decorative border */}
        <div className="h-1 bg-gradient-to-r from-primary-500 via-cyan-500 to-teal-500"></div>
      </div>

      {/* Action buttons */}
      <div className="mt-8 flex flex-wrap gap-4 justify-center">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-primary-600 to-cyan-600 text-white font-semibold rounded-xl shadow-sm shadow-primary-500/30 hover:shadow-sm hover:shadow-primary-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FiDownload size={18} />
          {downloading ? 'Đang tải...' : 'Tải về PDF'}
        </button>

        <button
          onClick={handleShare}
          className="flex items-center gap-2 px-8 py-3 bg-white text-slate-700 font-semibold rounded-xl border border-slate-100 shadow-sm hover:bg-slate-50 hover:border-slate-200 transition-all"
        >
          <FiShare2 size={18} />
          Chia sẻ liên kết xác minh
        </button>

        <Link
          to={`/verify-certificate/${certificate.certificateNumber}`}
          className="flex items-center gap-2 px-8 py-3 bg-white text-primary-600 font-semibold rounded-xl border border-primary-200 shadow-sm hover:bg-primary-50 hover:border-primary-300 transition-all"
        >
          <FiExternalLink size={18} />
          Trang xác minh công khai
        </Link>
      </div>
    </div>
  );
}
