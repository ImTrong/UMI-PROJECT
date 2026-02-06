import { useState, useEffect } from 'react';
import { healthService, ServiceHealth } from './services/api';

function App() {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchServiceStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const allServices = await healthService.checkAllServices();
      setServices(allServices);
      setLastUpdated(new Date());
    } catch (err) {
      setError('Failed to fetch service status');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServiceStatus();

    // Refresh every 5 seconds
    const interval = setInterval(fetchServiceStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 border-green-400';
      case 'down':
        return 'bg-red-100 text-red-800 border-red-400';
      default:
        return 'bg-yellow-100 text-yellow-800 border-yellow-400';
    }
  };

  const getStatusBadge = (status: string): string => {
    switch (status) {
      case 'active':
        return '✓ Active';
      case 'down':
        return '✗ Down';
      default:
        return '? Unknown';
    }
  };

  const activeServices = services.filter((s) => s.status === 'active').length;
  const totalServices = services.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <header className="bg-gradient-to-r from-blue-600 to-purple-600 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-4xl font-bold text-white mb-2">E-Learning Platform</h1>
          <p className="text-blue-100">Microservices Architecture Dashboard</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Status Summary Card */}
        <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-blue-500">
            <h3 className="text-gray-600 text-sm font-semibold mb-2">Total Services</h3>
            <p className="text-4xl font-bold text-blue-600">{totalServices}</p>
          </div>
          <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-green-500">
            <h3 className="text-gray-600 text-sm font-semibold mb-2">Active Services</h3>
            <p className="text-4xl font-bold text-green-600">{activeServices}</p>
          </div>
          <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-purple-500">
            <h3 className="text-gray-600 text-sm font-semibold mb-2">Last Updated</h3>
            <p className="text-lg font-mono text-purple-600">
              {lastUpdated.toLocaleTimeString()}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="mb-6 flex gap-4">
          <button
            onClick={fetchServiceStatus}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors font-semibold"
          >
            {loading ? 'Checking...' : 'Refresh Status'}
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Services Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service) => (
            <div
              key={service.service}
              className={`rounded-lg shadow-lg p-6 border-2 transition-all hover:shadow-xl ${getStatusColor(
                service.status
              )}`}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold capitalize">
                  {service.service.replace('-', ' ')}
                </h3>
                <span className="px-3 py-1 rounded-full text-sm font-semibold bg-current bg-opacity-20">
                  {getStatusBadge(service.status)}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="opacity-75">Status:</span>
                  <span className="font-mono capitalize">{service.status}</span>
                </div>

                {service.database && (
                  <div className="flex justify-between">
                    <span className="opacity-75">Database:</span>
                    <span className="font-mono">{service.database}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className="opacity-75">Uptime:</span>
                  <span className="font-mono">{service.uptime.toFixed(2)}s</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-75">Checked:</span>
                  <span className="font-mono text-xs">
                    {new Date(service.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Architecture Info */}
        <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Architecture Overview</h2>
            <ul className="space-y-2 text-gray-700">
              <li className="flex items-center">
                <span className="text-blue-500 mr-2">→</span>
                <strong>API Gateway:</strong> Nginx reverse proxy (Port 8080)
              </li>
              <li className="flex items-center">
                <span className="text-blue-500 mr-2">→</span>
                <strong>Database:</strong> MongoDB (Shared logical databases per service)
              </li>
              <li className="flex items-center">
                <span className="text-blue-500 mr-2">→</span>
                <strong>Services:</strong> 6 Node.js microservices
              </li>
              <li className="flex items-center">
                <span className="text-blue-500 mr-2">→</span>
                <strong>Frontend:</strong> React + Vite + Tailwind CSS
              </li>
              <li className="flex items-center">
                <span className="text-blue-500 mr-2">→</span>
                <strong>Pattern:</strong> Share-nothing microservices architecture
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Service Details</h2>
            <ul className="space-y-1 text-sm text-gray-700 font-mono">
              <li>• auth-service: 3001 - User authentication & JWT</li>
              <li>• user-service: 3002 - User profiles & management</li>
              <li>• course-service: 3003 - Course CRUD & catalog</li>
              <li>• order-service: 3004 - Orders & cart management</li>
              <li>• payment-service: 3005 - Payment processing (Stripe)</li>
              <li>• learning-service: 3006 - Progress & certificates</li>
            </ul>
          </div>
        </div>

        {/* Database Info */}
        <div className="mt-6 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-lg shadow-lg p-6 border-l-4 border-indigo-500">
          <h3 className="text-lg font-bold text-indigo-900 mb-2">Database Strategy</h3>
          <p className="text-indigo-800">
            Each service has its own logical MongoDB database (auth_db, user_db, course_db, order_db,
            payment_db, learning_db) running on the same MongoDB container. This implements the
            "database per service" pattern for true microservice isolation while optimizing resource
            usage with a shared MongoDB instance.
          </p>
        </div>
      </main>

      <footer className="bg-slate-800 text-slate-300 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm">
            Advanced Technologies in IT Application Development - Graduation Thesis
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
