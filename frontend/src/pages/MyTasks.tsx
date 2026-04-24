import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { learningService, TaskItem } from '../services/learning.service';
import { useAuth } from '../hooks/useAuth';
import {
  FiCheckSquare,
  FiFileText,
  FiClock,
  FiCheckCircle,
  FiAlertCircle,
  FiArrowRight,
  FiTarget,
  FiAward,
  FiBookOpen,
} from 'react-icons/fi';

export default function MyTasks() {
  const { isAuthenticated } = useAuth();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'COMPLETED'>('ALL');

  useEffect(() => {
    if (!isAuthenticated) return;
    loadTasks();
    window.scrollTo(0, 0);
  }, [isAuthenticated, filter]);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await learningService.getPendingTasks();
      setTasks(data);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTasks = tasks.filter((task) => {
    if (filter === 'ALL') return true;
    if (filter === 'COMPLETED') return task.status === 'COMPLETED';
    return task.status !== 'COMPLETED';
  });

  const getStatusBadge = (status: TaskItem['status']) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700 flex items-center gap-1.5">
            <FiCheckCircle size={12} /> Đã hoàn thành
          </span>
        );
      case 'LATE':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-700 flex items-center gap-1.5">
            <FiAlertCircle size={12} /> Trễ hạn
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 flex items-center gap-1.5">
            <FiClock size={12} /> Đang làm
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600 flex items-center gap-1.5">
            <FiClock size={12} /> Chưa làm
          </span>
        );
    }
  };

  const getTaskLink = (task: TaskItem) => {
    if (task.type === 'QUIZ') {
      return `/tasks/${task.id}/quiz`;
    }
    return `/tasks/${task.id}/assignment`;
  };

  const getActionLabel = (task: TaskItem) => {
    if (task.status === 'COMPLETED') {
      return task.type === 'QUIZ' ? 'Xem kết quả' : 'Xem bài nộp';
    }
    if (task.status === 'IN_PROGRESS') {
      return 'Tiếp tục làm';
    }
    return task.type === 'QUIZ' ? 'Làm bài ngay' : 'Nộp bài ngay';
  };

  const pendingCount = tasks.filter((t) => t.status !== 'COMPLETED').length;
  const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;

  if (loading && tasks.length === 0) {
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
    <div className="min-h-screen bg-gray-50/50 pt-8 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header Hero */}
        <div className="relative mb-10 p-8 rounded-3xl overflow-hidden bg-gradient-to-br from-primary-700 to-indigo-900 shadow-xl group">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-white/10 blur-3xl group-hover:scale-110 transition-transform duration-1000"></div>
          <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-48 h-48 rounded-full bg-purple-400/10 blur-2xl"></div>

          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-white mb-2 flex items-center">
                <FiCheckSquare className="mr-3 text-amber-400" /> Bài tập & Trắc nghiệm
              </h1>
              <p className="text-primary-100 text-base max-w-xl font-medium">
                Quản lý tiến độ hoàn thành các nhiệm vụ khóa học. Nhấn vào nút để làm bài trực tiếp!
              </p>
            </div>

            {/* Quick stats */}
            <div className="flex gap-4">
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl px-5 py-3 text-center">
                <p className="text-2xl font-bold text-white">{pendingCount}</p>
                <p className="text-xs text-primary-200 font-medium">Cần làm</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl px-5 py-3 text-center">
                <p className="text-2xl font-bold text-green-300">{completedCount}</p>
                <p className="text-xs text-primary-200 font-medium">Hoàn thành</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-8 bg-white p-2 rounded-2xl border border-gray-100 shadow-sm max-w-fit">
          <button
            onClick={() => setFilter('ALL')}
            className={`px-5 py-2 rounded-xl font-medium text-sm transition-all ${
              filter === 'ALL' ? 'bg-primary-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Tất cả ({tasks.length})
          </button>
          <button
            onClick={() => setFilter('PENDING')}
            className={`px-5 py-2 rounded-xl font-medium text-sm transition-all ${
              filter === 'PENDING' ? 'bg-primary-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Cần làm ({pendingCount})
          </button>
          <button
            onClick={() => setFilter('COMPLETED')}
            className={`px-5 py-2 rounded-xl font-medium text-sm transition-all ${
              filter === 'COMPLETED' ? 'bg-primary-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Đã hoàn thành ({completedCount})
          </button>
        </div>

        {/* Task List */}
        <div className="space-y-4">
          {filteredTasks.length === 0 ? (
            <div className="bg-white rounded-3xl p-16 text-center border border-gray-100">
              <div className="w-20 h-20 bg-gray-50 text-gray-300 rounded-full flex items-center justify-center mx-auto mb-5">
                <FiCheckCircle className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Tuyệt vời!</h2>
              <p className="text-gray-500">Danh sách hiện tại trống. Bạn không có bài tập hoặc trắc nghiệm nào thỏa điều kiện lọc.</p>
            </div>
          ) : (
            filteredTasks.map((task) => (
              <div
                key={task.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-200 group overflow-hidden"
              >
                <div className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    {/* Icon */}
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 ${
                        task.type === 'QUIZ'
                          ? 'bg-purple-100 text-purple-600'
                          : 'bg-amber-100 text-amber-600'
                      }`}
                    >
                      {task.type === 'QUIZ' ? <FiCheckSquare size={24} /> : <FiFileText size={24} />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-gray-400">
                          <FiBookOpen size={11} />
                          {task.courseTitle || 'Khóa học'}
                        </span>
                        {getStatusBadge(task.status)}
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 group-hover:text-primary-600 transition-colors truncate">
                        {task.title}
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-gray-500">
                        <span className="flex items-center gap-1.5">
                          {task.type === 'QUIZ' ? (
                            <FiTarget size={13} className="text-purple-500" />
                          ) : (
                            <FiAward size={13} className="text-amber-500" />
                          )}
                          <span className="font-medium text-gray-600">
                            {task.type === 'QUIZ' ? 'Trắc nghiệm' : 'Bài tập nộp'}
                          </span>
                        </span>
                        {task.dueDate && (
                          <span
                            className={`flex items-center gap-1.5 ${
                              new Date(task.dueDate) < new Date() ? 'text-red-500 font-semibold' : ''
                            }`}
                          >
                            <FiClock size={13} />
                            Hạn nộp: {new Date(task.dueDate).toLocaleDateString('vi-VN')}{' '}
                            {new Date(task.dueDate).toLocaleTimeString('vi-VN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                        {task.score !== undefined && task.score !== null && (
                          <span className="flex items-center gap-1.5">
                            <FiAward size={13} className="text-green-500" />
                            <span className="font-semibold text-green-600">
                              Điểm: {task.score} / {task.passingScore || task.maxScore || 100}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Button — Links to standalone pages */}
                  <Link
                    to={getTaskLink(task)}
                    className={`flex-shrink-0 px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all text-sm ${
                      task.status === 'COMPLETED'
                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        : task.type === 'QUIZ'
                        ? 'bg-purple-50 text-purple-600 hover:bg-purple-600 hover:text-white shadow-sm hover:shadow-md hover:shadow-purple-500/20'
                        : 'bg-amber-50 text-amber-600 hover:bg-amber-600 hover:text-white shadow-sm hover:shadow-md hover:shadow-amber-500/20'
                    }`}
                  >
                    {getActionLabel(task)}
                    <FiArrowRight className="group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
