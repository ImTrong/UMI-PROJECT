import { useAuth } from '../hooks/useAuth';
import StudentDashboard from './StudentDashboard';
import InstructorDashboard from './InstructorDashboard';

export default function Dashboard() {
  const { user } = useAuth();

  if (user?.role === 'ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center p-8 bg-white rounded-xl shadow-sm max-w-md">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Khu vực Quản trị</h2>
          <p className="text-gray-600">Giao diện Admin đã được tách ra một ứng dụng riêng biệt. Vui lòng truy cập trực tiếp vào hệ thống đường dẫn Admin để làm việc.</p>
        </div>
      </div>
    );
  }

  if (user?.role === 'INSTRUCTOR') {
    return <InstructorDashboard />;
  }

  return <StudentDashboard />;
}
