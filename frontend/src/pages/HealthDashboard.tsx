import { useEffect, useState } from 'react';
import { healthService, HealthStatus } from '../services/health.service';
import { FiCheckCircle, FiXCircle, FiActivity } from 'react-icons/fi';

export default function HealthDashboard() {
  const [services, setServices] = useState<Record<string, HealthStatus>>({});
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const status = await healthService.checkAllServices();
      setServices(status);
    } catch (error) {
      console.error('Failed to fetch health status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Bảng điều khiển Tình trạng Dịch vụ
        </h1>
        <p className="text-gray-600">
          Giám sát thời gian thực tất cả các microservices
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(services).map(([name, status]) => (
          <div key={name} className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold capitalize">{name}</h3>
              {status.status === 'active' ? (
                <FiCheckCircle className="text-green-500 text-2xl" />
              ) : (
                <FiXCircle className="text-red-500 text-2xl" />
              )}
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Trạng thái:</span>
                <span
                  className={`font-medium ${
                    status.status === 'active'
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}
                >
                  {status.status.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Cơ sở dữ liệu:</span>
                <span
                  className={`font-medium ${
                    status.database === 'connected'
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}
                >
                  {status.database}
                </span>
              </div>
              {status.uptime && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Thời gian hoạt động:</span>
                  <span className="text-gray-700">
                    {Math.floor(status.uptime / 3600)}h{' '}
                    {Math.floor((status.uptime % 3600) / 60)}m
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Kiểm tra cuối:</span>
                <span className="text-gray-700">
                  {new Date(status.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card bg-primary-50">
        <div className="flex items-center space-x-3">
          <FiActivity className="text-primary-600 text-xl" />
          <div>
            <p className="text-sm text-gray-600">
              Các dịch vụ được kiểm tra tự động mỗi 10 giây
            </p>
            <p className="text-xs text-gray-500 mt-1">
              API Gateway: http://localhost:8080
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
