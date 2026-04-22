import { useState, useEffect } from 'react';
import { learningService, ActivityLog } from '../services/learning.service';
import { ActivityFeed } from '../components/learning/ActivityFeed';
import { useAuth } from '../hooks/useAuth';
import { FiActivity, FiBarChart2, FiClock, FiTarget, FiZap } from 'react-icons/fi';

export default function Activity() {
  const { isAuthenticated } = useAuth();
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 0,
    hasPrevPage: false,
    hasNextPage: false,
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    loadData();
    window.scrollTo(0, 0);
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
      <div className="flex justify-center items-center min-h-[500px]">
        <div className="relative w-16 h-16">
          <div className="absolute top-0 left-0 w-full h-full border-4 border-primary-200 rounded-full animate-ping"></div>
          <div className="absolute top-0 left-0 w-full h-full border-4 border-primary-600 rounded-full border-t-transparent animate-spin"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/30 pt-8 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header Hero Section */}
        <div className="relative mb-10 p-8 rounded-3xl overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-800 to-purple-900 shadow-xl overflow-hidden group">
          <div className="absolute top-0 right-0 -mr-10 -mt-20 w-80 h-80 rounded-full bg-white/5 blur-3xl group-hover:scale-150 transition-transform duration-1000"></div>
          <div className="absolute bottom-0 left-20 -mb-24 w-60 h-60 rounded-full bg-purple-500/20 blur-2xl group-hover:scale-150 transition-transform duration-1000"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-3 flex items-center">
                <FiZap className="mr-3 text-yellow-400" /> Hoạt động Học tập
              </h1>
              <p className="text-indigo-100 text-lg max-w-xl font-medium">
                Theo dõi tiến trình vươn đến tri thức của bạn. Mỗi hành động nhỏ hôm nay là thành công lớn ngày mai!
              </p>
            </div>
            
            {/* Quick Summary Badge */}
            {stats && (
              <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 flex items-center shrink-0">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-white font-bold text-xl mr-4 shadow-inner">
                  {stats.overall.streakDays}
                </div>
                <div>
                  <div className="text-white font-bold text-lg leading-tight">Ngày liên tiếp</div>
                  <div className="text-indigo-200 text-sm">Giữ vững phong độ!</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats Grid Cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            
            {/* Stat Card 1 */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-primary-50 rounded-full transition-transform duration-500 group-hover:scale-150 opacity-50"></div>
              <div className="relative z-10 flex items-start justify-between">
                <div>
                  <p className="text-gray-500 font-medium mb-1">Hành động tuần này</p>
                  <h3 className="text-3xl font-extrabold text-gray-900">
                    {stats.weeklyActivity.reduce((sum: number, a: any) => sum + a._count, 0)}
                  </h3>
                </div>
                <div className="w-12 h-12 bg-primary-100 text-primary-600 rounded-2xl flex items-center justify-center shadow-sm">
                  <FiTarget className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* Stat Card 2 */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-green-50 rounded-full transition-transform duration-500 group-hover:scale-150 opacity-50"></div>
              <div className="relative z-10 flex items-start justify-between">
                <div>
                  <p className="text-gray-500 font-medium mb-1">Tiến độ hoàn thành</p>
                  <h3 className="text-3xl font-extrabold text-gray-900">
                    {Math.round(stats.overall.completionRate || 0)}<span className="text-xl text-green-500 ml-1">%</span>
                  </h3>
                </div>
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center shadow-sm">
                  <FiBarChart2 className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* Stat Card 3 */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 relative overflow-hidden group sm:col-span-2 lg:col-span-1">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-yellow-50 rounded-full transition-transform duration-500 group-hover:scale-150 opacity-50"></div>
              <div className="relative z-10 flex items-start justify-between">
                <div>
                  <p className="text-gray-500 font-medium mb-1">Tổng thời gian học</p>
                  <h3 className="text-3xl font-extrabold text-gray-900">
                    {Math.round(stats.overall.totalStudyTimeHours)} <span className="text-lg font-semibold text-gray-500 ml-1">giờ</span>
                  </h3>
                </div>
                <div className="w-12 h-12 bg-yellow-100 text-yellow-600 rounded-2xl flex items-center justify-center shadow-sm">
                  <FiClock className="w-6 h-6" />
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Activity Feed Section */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <div className="flex items-center mb-8 pb-4 border-b border-gray-100">
            <div className="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center mr-4">
              <FiActivity className="text-primary-600 w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Dòng thời gian (Timeline)</h2>
          </div>
          
          <ActivityFeed activities={activities} />

          {/* Premium Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center items-center mt-12 bg-gray-50/50 p-4 rounded-2xl border border-gray-100 gap-4">
              <button
                onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                disabled={!pagination.hasPrevPage}
                className="px-6 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 hover:shadow-sm transition-all"
              >
                Trang Trước
              </button>
              <div className="flex bg-white px-5 py-2.5 rounded-xl border border-gray-200 shadow-sm font-semibold">
                <span className="text-primary-600">{pagination.page}</span>
                <span className="text-gray-400 mx-2">/</span>
                <span className="text-gray-600">{pagination.totalPages}</span>
              </div>
              <button
                onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                disabled={!pagination.hasNextPage}
                className="px-6 py-2.5 bg-primary-600 text-white font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-700 hover:shadow-sm transition-all"
              >
                Trang Tiếp
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
