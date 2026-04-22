import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { learningService, TaskItem } from '../services/learning.service';
import { useAuth } from '../hooks/useAuth';
import { FiCheckSquare, FiFileText, FiClock, FiCheckCircle, FiAlertCircle, FiArrowRight } from 'react-icons/fi';

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
    return task.status !== 'COMPLETED'; // PENDING includes NOT_STARTED, IN_PROGRESS, LATE
  });

  const getStatusBadge = (status: TaskItem['status']) => {
    switch (status) {
      case 'COMPLETED':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-md bg-green-100 text-green-700 flex items-center gap-1.5"><FiCheckCircle /> Đã hoàn thành</span>;
      case 'LATE':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-md bg-red-100 text-red-700 flex items-center gap-1.5"><FiAlertCircle /> Trễ hạn</span>;
      case 'IN_PROGRESS':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-md bg-blue-100 text-blue-700 flex items-center gap-1.5"><FiClock /> Đang làm</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-md bg-gray-100 text-gray-700 flex items-center gap-1.5"><FiClock /> Chưa làm</span>;
    }
  };

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
          
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center">
            <div>
              <h1 className="text-3xl font-extrabold text-white mb-2 flex items-center">
                <FiCheckSquare className="mr-3 text-amber-400" /> Bài tập & Trắc nghiệm
              </h1>
              <p className="text-primary-100 text-base max-w-xl font-medium">
                Quản lý tiến độ hoàn thành các nhiệm vụ khóa học. Đừng bỏ lỡ bất kỳ bài kiểm tra hay bài thực hành nào nhé!
              </p>
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
            Cần làm ({tasks.filter(t => t.status !== 'COMPLETED').length})
          </button>
          <button
            onClick={() => setFilter('COMPLETED')}
            className={`px-5 py-2 rounded-xl font-medium text-sm transition-all ${
              filter === 'COMPLETED' ? 'bg-primary-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Đã hoàn thành ({tasks.filter(t => t.status === 'COMPLETED').length})
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
              <div key={task.id} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row items-start md:items-center justify-between gap-5 group">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    task.type === 'QUIZ' ? 'bg-purple-100 text-purple-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    {task.type === 'QUIZ' ? <FiCheckSquare size={24} /> : <FiFileText size={24} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                        {task.courseTitle || 'Khóa học'}
                      </span>
                      {getStatusBadge(task.status)}
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 group-hover:text-primary-600 transition-colors">
                      {task.title}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500 font-medium">
                      <span className="flex items-center gap-1.5"><strong className="text-gray-700">Loại:</strong> {task.type === 'QUIZ' ? 'Trắc nghiệm' : 'Thực hành (Bài tập)'}</span>
                      {task.dueDate && (
                        <span className="flex items-center gap-1.5"><FiClock className={new Date(task.dueDate) < new Date() ? 'text-red-500' : ''} /> <strong className="text-gray-700">Hạn nộp:</strong> {new Date(task.dueDate).toLocaleString()}</span>
                      )}
                      {(task.score !== undefined && task.score !== null) && (
                        <span className="flex items-center gap-1.5">
                          <strong className="text-green-600">Điểm số:</strong> {task.score} / {task.passingScore || task.maxScore || 100}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <Link
                  to={`/learning/${task.courseId}?lessonId=${task.lessonId}`}
                  className={`flex-shrink-0 px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                    task.status === 'COMPLETED' 
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' 
                      : 'bg-primary-50 text-primary-600 hover:bg-primary-600 hover:text-white'
                  }`}
                >
                  {task.status === 'COMPLETED' ? 'Xem lại kết quả' : 'Làm bài ngay'}
                  <FiArrowRight />
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
