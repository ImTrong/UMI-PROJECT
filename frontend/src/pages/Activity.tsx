import { useState, useEffect } from 'react';
import { learningService, ActivityLog } from '../services/learning.service';
import { ActivityFeed } from '../components/learning/ActivityFeed';
import { useAuth } from '../hooks/useAuth';
import { FiActivity, FiBarChart2 } from 'react-icons/fi';

export default function Activity() {
  const { isAuthenticated } = useAuth();
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
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
    loadData();
  }, [isAuthenticated, pagination.page]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [activitiesData, statsData] = await Promise.all([
        learningService.getUserActivities(pagination.page, pagination.limit),
        learningService.getLearningStats(),
      ]);
      setActivities(activitiesData.data);
      setPagination(activitiesData.pagination);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load activity:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading && activities.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Hoạt động Học tập</h1>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="card flex items-center space-x-3">
            <FiActivity className="text-2xl text-primary-500" />
            <div>
              <p className="text-2xl font-bold">{stats.weeklyActivity.reduce((sum: number, a: any) => sum + a._count, 0)}</p>
              <p className="text-sm text-gray-500">Hành động tuần này</p>
            </div>
          </div>
          <div className="card flex items-center space-x-3">
            <FiBarChart2 className="text-2xl text-green-500" />
            <div>
              <p className="text-2xl font-bold">{stats.overall.streakDays}</p>
              <p className="text-sm text-gray-500">Chuỗi ngày học</p>
            </div>
          </div>
          <div className="card flex items-center space-x-3">
            <FiActivity className="text-2xl text-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{Math.round(stats.overall.totalStudyTimeHours)}</p>
              <p className="text-sm text-gray-500">Tổng số giờ</p>
            </div>
          </div>
        </div>
      )}

      {/* Activity Feed */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Hoạt động gần đây</h2>
        <ActivityFeed activities={activities} />

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex justify-center space-x-2 mt-6 pt-4 border-t">
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
      </div>
    </div>
  );
}
