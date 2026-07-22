import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { learningService, Certificate } from '../services/learning.service';
import { CertificateCard } from '../components/learning/CertificateCard';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiAward, FiBookOpen, FiMap } from 'react-icons/fi';

type TabType = 'all' | 'course' | 'path';

export default function Certificates() {
  const { isAuthenticated } = useAuth();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
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
      toast.error('Tải chứng nhận thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (certificate: Certificate) => {
    const label = certificate.type === 'PATH_CERTIFICATE' ? 'chứng chỉ' : 'chứng nhận';
    const toastId = toast.loading(`Đang chuẩn bị tải ${label}...`);
    try {
      await learningService.downloadCertificate(certificate.id);
      toast.success(`Đã tải ${label} thành công!`, { id: toastId });
    } catch (error) {
      console.error('Download failed:', error);
      toast.error(`Tải ${label} thất bại`, { id: toastId });
    }
  };

  const handleShare = (certificate: Certificate) => {
    navigator.clipboard.writeText(certificate.verificationUrl);
    toast.success('Đã sao chép liên kết xác minh vào bộ nhớ tạm');
  };

  const filteredCertificates = certificates.filter((cert) => {
    if (activeTab === 'course') return cert.type === 'COURSE_COMPLETION';
    if (activeTab === 'path') return cert.type === 'PATH_CERTIFICATE';
    return true;
  });

  const courseCertCount = certificates.filter((c) => c.type === 'COURSE_COMPLETION').length;
  const pathCertCount = certificates.filter((c) => c.type === 'PATH_CERTIFICATE').length;

  if (loading && certificates.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const tabs = [
    { key: 'all' as TabType, label: 'Tất cả', count: certificates.length, icon: FiAward },
    { key: 'course' as TabType, label: 'Chứng nhận khóa học', count: courseCertCount, icon: FiBookOpen },
    { key: 'path' as TabType, label: 'Chứng chỉ lộ trình', count: pathCertCount, icon: FiMap },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Chứng nhận & Chứng chỉ</h1>
      <p className="text-slate-500 mb-6">Quản lý chứng nhận hoàn thành khóa học và chứng chỉ lộ trình của bạn</p>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-primary-50 text-primary-700 border border-primary-200 shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-primary-200 hover:text-primary-600'
              }`}
            >
              <Icon size={16} />
              {tab.label}
              <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                activeTab === tab.key ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {filteredCertificates.length === 0 ? (
        <div className="card text-center py-12">
          <FiAward className="mx-auto text-4xl text-slate-400 mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">
            {activeTab === 'path' ? 'Chưa có chứng chỉ lộ trình nào' :
             activeTab === 'course' ? 'Chưa có chứng nhận nào' :
             'Chưa có chứng nhận hoặc chứng chỉ nào'}
          </h2>
          <p className="text-slate-600 mb-6">
            {activeTab === 'path'
              ? 'Hoàn thành lộ trình học và project cuối kỳ (≥80%) để nhận chứng chỉ'
              : 'Hoàn thành khóa học và đạt điểm quiz để nhận chứng nhận'}
          </p>
          <Link to={activeTab === 'path' ? '/learning-paths' : '/courses'} className="btn-primary">
            {activeTab === 'path' ? 'Khám phá lộ trình' : 'Khám phá khóa học'}
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {filteredCertificates.map((cert) => (
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
