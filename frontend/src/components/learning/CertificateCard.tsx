import { Link } from 'react-router-dom';
import { Certificate } from '../../services/learning.service';
import { format } from 'date-fns';
import { FiDownload, FiShare2, FiCheckCircle, FiXCircle, FiEye, FiCalendar, FiBookOpen, FiMap } from 'react-icons/fi';

interface CertificateCardProps {
  certificate: Certificate;
  onDownload?: () => void;
  onShare?: () => void;
}

export const CertificateCard = ({ certificate, onDownload, onShare }: CertificateCardProps) => {
  const isExpired = certificate.expiresAt && new Date(certificate.expiresAt) < new Date();
  const isValid = certificate.isVerified && !isExpired;
  const isPathCert = certificate.type === 'PATH_CERTIFICATE';
  const typeLabel = isPathCert ? 'Chứng chỉ lộ trình' : 'Chứng nhận khóa học';

  return (
    <div className="group bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-sm hover:border-primary-200 transition-all duration-300 overflow-hidden">
      {/* Top gradient bar — gold for path, cyan for course */}
      <div className={`h-1.5 ${
        !isValid
          ? 'bg-gradient-to-r from-red-400 to-rose-500'
          : isPathCert
          ? 'bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500'
          : 'bg-gradient-to-r from-green-400 to-emerald-500'
      }`}></div>
      
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm ${
            !isValid
              ? 'bg-red-50 text-red-400 border border-red-100'
              : isPathCert
              ? 'bg-gradient-to-br from-amber-50 to-yellow-50 text-amber-600 border border-amber-200'
              : 'bg-gradient-to-br from-primary-50 to-cyan-50 text-primary-600 border border-primary-100'
          }`}>
            {isPathCert ? <FiMap size={24} /> : <FiBookOpen size={24} />}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                isPathCert
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-primary-100 text-primary-700'
              }`}>
                {typeLabel}
              </span>
            </div>

            <h3 className="font-bold text-slate-900 text-lg leading-tight group-hover:text-primary-700 transition-colors">
              {certificate.metadata?.certificateConfig?.title || certificate.courseTitle}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Cấp cho: <span className="font-medium text-slate-700">{certificate.userName}</span>
            </p>
            
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <span className="text-xs text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full">
                <FiCalendar className="inline mr-1" /> {format(new Date(certificate.issueDate), 'dd/MM/yyyy')}
              </span>

              {certificate.averageScore !== undefined && certificate.averageScore !== null && (
                <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                  Điểm: {certificate.averageScore.toFixed(1)}%
                </span>
              )}
              
              {isValid ? (
                <span className="text-xs font-semibold text-green-600 bg-green-50 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <FiCheckCircle size={12} /> Đã xác minh
                </span>
              ) : (
                <span className="text-xs font-semibold text-red-600 bg-red-50 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <FiXCircle size={12} /> {isExpired ? 'Hết hạn' : 'Đã thu hồi'}
                </span>
              )}

              {certificate.expiresAt && !isExpired && (
                <span className="text-xs text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full">
                  Đến: {format(new Date(certificate.expiresAt), 'dd/MM/yyyy')}
                </span>
              )}
            </div>

            <p className="text-[11px] text-slate-400 font-mono mt-2">
              {certificate.certificateNumber}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <Link
              to={`/certificates/${certificate.id}`}
              className="p-2.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-all"
              title="Xem chi tiết"
            >
              <FiEye size={18} />
            </Link>
            {onDownload && (
              <button
                onClick={onDownload}
                className="p-2.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-xl transition-all"
                title="Tải về PDF"
              >
                <FiDownload size={18} />
              </button>
            )}
            {onShare && (
              <button
                onClick={onShare}
                className="p-2.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-xl transition-all"
                title="Chia sẻ"
              >
                <FiShare2 size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
