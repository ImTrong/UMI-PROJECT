import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { userService } from '../services/user.service';
import { courseService } from '../services/course.service';
import { orderService } from '../services/order.service';
import { Link } from 'react-router-dom';
import {
  FiUsers,
  FiBookOpen,
  FiShoppingCart,
  FiDollarSign,
  FiUserCheck,
  FiUserX,
} from 'react-icons/fi';
import { 
  Chart as ChartJS, 
  ArcElement, 
  Tooltip, 
  Legend, 
  CategoryScale, 
  LinearScale, 
  BarElement, 
  Title, 
  PointElement, 
  LineElement 
} from 'chart.js';
import { Pie } from 'react-chartjs-2';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  PointElement,
  LineElement
);

interface DashboardStats {
  users: {
    total: number;
    students: number;
    instructors: number;
    admins: number;
    active: number;
    newThisMonth: number;
  };
  courses: {
    total: number;
    published: number;
    draft: number;
    newThisMonth: number;
  };
  orders: {
    total: number;
    pending: number;
    completed: number;
    revenue: number;
    monthlyRevenue: number;
  };
  payments: {
    total: number;
    succeeded: number;
    failed: number;
    totalAmount: number;
  };
  learning: {
    totalEnrollments: number;
    totalCompletions: number;
    averageProgress: number;
  };
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [recentUsers, setRecentUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'year'>('month');

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    loadDashboardData();
  }, [user, selectedPeriod]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // Parallel fetch analytics and recent data
      const [
        usersAnalytics,
        coursesAnalytics,
        ordersAnalytics,
        recentOrdersData,
        recentUsersData
      ] = await Promise.all([
        userService.getAnalytics(),
        courseService.getAnalytics(),
        orderService.getAnalytics(),
        orderService.getAllOrders({ limit: 5 }),
        userService.getAllUsers(1, 5)
      ]);

      // Note: Payment service doesn't have custom analytics yet, using generic order data as substitute if needed
      // but Orders Analytics gives revenue
      setStats({
        users: {
          total: usersAnalytics.total,
          students: usersAnalytics.students,
          instructors: usersAnalytics.instructors,
          admins: usersAnalytics.admins,
          active: usersAnalytics.active,
          newThisMonth: usersAnalytics.newThisMonth,
        },
        courses: {
          total: coursesAnalytics.total,
          published: coursesAnalytics.published,
          draft: coursesAnalytics.draft,
          newThisMonth: coursesAnalytics.newThisMonth,
        },
        orders: {
          total: ordersAnalytics.totalOrders,
          pending: ordersAnalytics.totalOrders - ordersAnalytics.completedOrders, // rough estimate or fetch from status
          completed: ordersAnalytics.completedOrders,
          revenue: ordersAnalytics.totalRevenue,
          monthlyRevenue: ordersAnalytics.thisMonthRevenue,
        },
        payments: {
          total: ordersAnalytics.totalOrders, // dummy since we map it to orders mostly
          succeeded: ordersAnalytics.completedOrders,
          failed: 0,
          totalAmount: ordersAnalytics.totalRevenue,
        },
        learning: {
          totalEnrollments: 0,
          totalCompletions: 0,
          averageProgress: 0,
        },
      });
      
      // Get recent orders
      setRecentOrders(recentOrdersData.orders);
      setRecentUsers(recentUsersData.users);
      
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const userChartData = {
    labels: ['Học viên', 'Giảng viên', 'Quản trị viên'],
    datasets: [
      {
        data: stats ? [stats.users.students, stats.users.instructors, stats.users.admins] : [0, 0, 0],
        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b'],
        borderWidth: 0,
      },
    ],
  };

  const courseStatusData = {
    labels: ['Đã xuất bản', 'Bản nháp'],
    datasets: [
      {
        data: stats ? [stats.courses.published, stats.courses.draft] : [0, 0],
        backgroundColor: ['#10b981', '#ef4444'],
        borderWidth: 0,
      },
    ],
  };

  const orderStatusData = {
    labels: ['Chờ xử lý', 'Hoàn thành', 'Thất bại'],
    datasets: [
      {
        data: stats ? [stats.orders.pending, stats.orders.completed, 0] : [0, 0, 0],
        backgroundColor: ['#f59e0b', '#10b981', '#ef4444'],
        borderWidth: 0,
      },
    ],
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Bảng điều khiển Quản trị viên</h1>
        <div className="flex space-x-2">
          <button
            onClick={() => setSelectedPeriod('week')}
            className={`px-3 py-1 rounded ${selectedPeriod === 'week' ? 'bg-primary-600 text-white' : 'bg-gray-200'}`}
          >
            Tuần
          </button>
          <button
            onClick={() => setSelectedPeriod('month')}
            className={`px-3 py-1 rounded ${selectedPeriod === 'month' ? 'bg-primary-600 text-white' : 'bg-gray-200'}`}
          >
            Tháng
          </button>
          <button
            onClick={() => setSelectedPeriod('year')}
            className={`px-3 py-1 rounded ${selectedPeriod === 'year' ? 'bg-primary-600 text-white' : 'bg-gray-200'}`}
          >
            Năm
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tổng số Người dùng</p>
              <p className="text-2xl font-bold">{stats?.users.total || 0}</p>
              <p className="text-xs text-green-600 mt-1">+{stats?.users.newThisMonth || 0} trong tháng này</p>
            </div>
            <FiUsers className="text-3xl text-primary-500" />
          </div>
          <div className="mt-2 flex space-x-2 text-xs">
            <span className="text-blue-600">{stats?.users.students || 0} Học viên</span>
            <span className="text-green-600">{stats?.users.instructors || 0} Giảng viên</span>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tổng số Khóa học</p>
              <p className="text-2xl font-bold">{stats?.courses.total || 0}</p>
              <p className="text-xs text-green-600 mt-1">+{stats?.courses.newThisMonth || 0} trong tháng này</p>
            </div>
            <FiBookOpen className="text-3xl text-primary-500" />
          </div>
          <div className="mt-2 flex space-x-2 text-xs">
            <span className="text-green-600">{stats?.courses.published || 0} Đã xuất bản</span>
            <span className="text-red-600">{stats?.courses.draft || 0} Bản nháp</span>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tổng số Đơn hàng</p>
              <p className="text-2xl font-bold">{stats?.orders.total || 0}</p>
              <p className="text-xs text-green-600 mt-1">${stats?.orders.monthlyRevenue?.toFixed(2)} trong tháng này</p>
            </div>
            <FiShoppingCart className="text-3xl text-primary-500" />
          </div>
          <div className="mt-2 flex space-x-2 text-xs">
            <span className="text-yellow-600">{stats?.orders.pending || 0} Chờ xử lý</span>
            <span className="text-green-600">{stats?.orders.completed || 0} Hoàn thành</span>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tổng Doanh thu</p>
              <p className="text-2xl font-bold">${stats?.orders.revenue?.toFixed(2) || 0}</p>
              <p className="text-xs text-green-600 mt-1">Từ {stats?.payments.succeeded || 0} khoản thanh toán</p>
            </div>
            <FiDollarSign className="text-3xl text-primary-500" />
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="card">
          <h3 className="font-semibold mb-4">Phân bố Người dùng</h3>
          <div className="h-64">
            <Pie data={userChartData} options={{ maintainAspectRatio: false }} />
          </div>
        </div>
        
        <div className="card">
          <h3 className="font-semibold mb-4">Trạng thái Khóa học</h3>
          <div className="h-64">
            <Pie data={courseStatusData} options={{ maintainAspectRatio: false }} />
          </div>
        </div>
        
        <div className="card">
          <h3 className="font-semibold mb-4">Trạng thái Đơn hàng</h3>
          <div className="h-64">
            <Pie data={orderStatusData} options={{ maintainAspectRatio: false }} />
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="card mb-8">
        <h3 className="font-semibold mb-4">Đơn hàng Gần đây</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4">Mã ĐH</th>
                <th className="text-left py-3 px-4">Người dùng</th>
                <th className="text-left py-3 px-4">Số tiền</th>
                <th className="text-left py-3 px-4">Trạng thái</th>
                <th className="text-left py-3 px-4">Ngày</th>
               </tr>
            </thead>
            <tbody>
              {recentOrders.map((order) => (
                <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4">{order.orderNumber}</td>
                  <td className="py-3 px-4">{order.userId.slice(-8)}</td>
                  <td className="py-3 px-4">${order.totalPrice.toFixed(2)}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      order.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                      order.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-500">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 text-right">
          <Link to="/admin/orders" className="text-primary-600 hover:underline text-sm">
            Xem Tất cả Đơn hàng →
          </Link>
        </div>
      </div>

      {/* Recent Users */}
      <div className="card">
        <h3 className="font-semibold mb-4">Người dùng Gần đây</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4">Tên</th>
                <th className="text-left py-3 px-4">Email</th>
                <th className="text-left py-3 px-4">Vai trò</th>
                <th className="text-left py-3 px-4">Trạng thái</th>
                <th className="text-left py-3 px-4">Ngày tham gia</th>
               </tr>
            </thead>
            <tbody>
              {recentUsers.map((user) => (
                <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4">{user.fullName}</td>
                  <td className="py-3 px-4">{user.email}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                      user.role === 'INSTRUCTOR' ? 'bg-blue-100 text-blue-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {user.isActive ? (
                      <FiUserCheck className="text-green-500" />
                    ) : (
                      <FiUserX className="text-red-500" />
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-500">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 text-right">
          <Link to="/admin/users" className="text-primary-600 hover:underline text-sm">
            Xem Tất cả Người dùng →
          </Link>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <Link to="/admin/courses" className="card hover:shadow-md transition text-center py-4">
          <FiBookOpen className="mx-auto text-2xl text-primary-500 mb-2" />
          <span className="font-medium">Quản lý Khóa học</span>
        </Link>
        <Link to="/admin/users" className="card hover:shadow-md transition text-center py-4">
          <FiUsers className="mx-auto text-2xl text-primary-500 mb-2" />
          <span className="font-medium">Quản lý Người dùng</span>
        </Link>
        <Link to="/admin/payments" className="card hover:shadow-md transition text-center py-4">
          <FiDollarSign className="mx-auto text-2xl text-primary-500 mb-2" />
          <span className="font-medium">Xem Thanh toán</span>
        </Link>
      </div>
    </div>
  );
}
