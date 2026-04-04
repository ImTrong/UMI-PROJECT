import { useAuth } from '../hooks/useAuth';
import StudentDashboard from './StudentDashboard';
import InstructorDashboard from './InstructorDashboard';
import AdminDashboard from './AdminDashboard';

export default function Dashboard() {
  const { user } = useAuth();

  if (user?.role === 'ADMIN') {
    return <AdminDashboard />;
  }

  if (user?.role === 'INSTRUCTOR') {
    return <InstructorDashboard />;
  }

  return <StudentDashboard />;
}
