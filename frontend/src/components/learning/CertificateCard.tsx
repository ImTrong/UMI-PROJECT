import { Certificate } from '../../services/learning.service';
import { format } from 'date-fns';
import { FiAward, FiDownload, FiShare2, FiCheckCircle } from 'react-icons/fi';

interface CertificateCardProps {
  certificate: Certificate;
  onDownload?: () => void;
  onShare?: () => void;
}

export const CertificateCard = ({ certificate, onDownload, onShare }: CertificateCardProps) => {
  const isExpired = certificate.expiresAt && new Date(certificate.expiresAt) < new Date();

  return (
    <div className="card hover:shadow-lg transition-shadow">
      <div className="flex items-start space-x-4">
        <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
          <FiAward className="text-2xl text-primary-600" />
        </div>
        <div className="flex-1">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-lg">{certificate.courseTitle}</h3>
              <p className="text-sm text-gray-500">
                Issued: {format(new Date(certificate.issueDate), 'MMMM dd, yyyy')}
              </p>
              {certificate.expiresAt && (
                <p className={`text-xs mt-1 ${isExpired ? 'text-red-500' : 'text-gray-500'}`}>
                  {isExpired ? 'Expired' : `Valid until: ${format(new Date(certificate.expiresAt), 'MMMM dd, yyyy')}`}
                </p>
              )}
            </div>
            <div className="flex space-x-2">
              {onDownload && (
                <button
                  onClick={onDownload}
                  className="p-2 text-gray-500 hover:text-primary-600 transition"
                  title="Download Certificate"
                >
                  <FiDownload size={18} />
                </button>
              )}
              {onShare && (
                <button
                  onClick={onShare}
                  className="p-2 text-gray-500 hover:text-primary-600 transition"
                  title="Share Certificate"
                >
                  <FiShare2 size={18} />
                </button>
              )}
            </div>
          </div>
          
          <div className="mt-3 flex items-center space-x-4">
            <div className="flex items-center space-x-1 text-sm text-gray-500">
              <FiCheckCircle className={certificate.isVerified ? 'text-green-500' : 'text-gray-400'} />
              <span>{certificate.isVerified ? 'Verified' : 'Revoked'}</span>
            </div>
            <a
              href={certificate.verificationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary-600 hover:underline"
            >
              Verify Certificate
            </a>
          </div>
          
          <p className="text-xs text-gray-400 mt-2">
            Certificate ID: {certificate.certificateNumber}
          </p>
        </div>
      </div>
    </div>
  );
};
