import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { learningService, Certificate } from '../services/learning.service';
import { CertificateCard } from '../components/learning/CertificateCard';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiAward } from 'react-icons/fi';

export default function Certificates() {
  const { isAuthenticated } = useAuth();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasPrevPage: false,
    hasNextPage: false,
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    loadCertificates();
  }, [isAuthenticated, pagination.page]);

  const loadCertificates = async () => {
    setLoading(true);
    try {
      const result = await learningService.getUserCertificates(pagination.page, pagination.limit);
      setCertificates(result.data);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to load certificates:', error);
      toast.error('Tải chứng chỉ thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (certificate: Certificate) => {
    const toastId = toast.loading('Đang chuẩn bị tải chứng chỉ...');
    try {
      await learningService.downloadCertificate(certificate.id);
      toast.success('Đã tải chứng chỉ thành công!', { id: toastId });
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Tải chứng chỉ thất bại', { id: toastId });
    }
  };

  const handleShare = (certificate: Certificate) => {
    navigator.clipboard.writeText(certificate.verificationUrl);
    toast.success('Đã sao chép liên kết xác minh vào bộ nhớ tạm');
  };

  if (loading && certificates.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Chứng chỉ của tôi</h1>

      {certificates.length === 0 ? (
        <div className="card text-center py-12">
          <FiAward className="mx-auto text-4xl text-slate-400 mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Chưa có chứng chỉ nào</h2>
          <p className="text-slate-600 mb-6">Hoàn thành khóa học để nhận chứng chỉ</p>
          <Link to="/courses" className="btn-primary">
            Khám phá khóa học
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {certificates.map((cert) => (
              <CertificateCard
                key={cert.id}
                certificate={cert}
                onDownload={() => handleDownload(cert)}
                onShare={() => handleShare(cert)}
              />
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center space-x-2 mt-8">
              <button
                onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                disabled={!pagination.hasPrevPage}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Trước
              </button>
              <span className="px-3 py-1">
                Trang {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                disabled={!pagination.hasNextPage}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Tiếp
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
