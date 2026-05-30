import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { learningService } from '../services/learning.service';
import { QuizPlayer } from '../components/learning/QuizPlayer';
import { useAuth } from '../hooks/useAuth';
import { FiArrowLeft, FiBookOpen, FiCheckSquare, FiClock, FiTarget } from 'react-icons/fi';

export default function QuizPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [taskDetail, setTaskDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (taskId) {
      loadTaskDetail();
    }
  }, [taskId, isAuthenticated]);

  const loadTaskDetail = async () => {
    setLoading(true);
    try {
      const detail = await learningService.getTaskDetail(taskId!, 'QUIZ');
      setTaskDetail(detail);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Không tìm thấy bài trắc nghiệm');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setCompleted(true);
    // Also mark lesson as complete
    if (taskDetail?.courseId && taskDetail?.lessonId) {
      try {
        await learningService.markLessonComplete(taskDetail.courseId, taskDetail.lessonId, 0);
      } catch {
        // Silent — lesson completion is secondary
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="relative w-16 h-16">
          <div className="absolute top-0 left-0 w-full h-full border-4 border-teal-200 rounded-full animate-ping"></div>
          <div className="absolute top-0 left-0 w-full h-full border-4 border-teal-600 rounded-full border-t-transparent animate-spin"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <FiCheckSquare size={32} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Không tìm thấy</h2>
          <p className="text-slate-500 mb-6">{error}</p>
          <Link to="/tasks" className="btn-primary">
            <FiArrowLeft className="mr-2 inline" /> Quay lại danh sách
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Premium Header */}
      <div className="relative bg-gradient-to-br from-teal-700 via-teal-800 to-emerald-900 overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-teal-400/10 rounded-full translate-y-1/3 -translate-x-1/4 blur-2xl"></div>
        </div>
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link
            to="/tasks"
            className="inline-flex items-center gap-2 text-teal-200 hover:text-white mb-6 text-sm font-medium transition-colors group"
          >
            <FiArrowLeft className="group-hover:-translate-x-1 transition-transform" />
            Quay lại danh sách bài tập
          </Link>

          <div className="flex items-start gap-5">
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center flex-shrink-0">
              <FiCheckSquare className="text-teal-200" size={28} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-teal-500/30 text-teal-200 border border-teal-400/30">
                  Trắc nghiệm
                </span>
                {completed && (
                  <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-green-500/30 text-green-200 border border-green-400/30">
                    ✓ Đã hoàn thành
                  </span>
                )}
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white mb-2 tracking-tight">
                {taskDetail?.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-teal-200">
                <span className="flex items-center gap-1.5">
                  <FiBookOpen size={14} />
                  {taskDetail?.courseTitle}
                </span>
                {taskDetail?.timeLimitMinutes && (
                  <span className="flex items-center gap-1.5">
                    <FiClock size={14} />
                    {taskDetail.timeLimitMinutes} phút
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <FiTarget size={14} />
                  Đạt {taskDetail?.passingScore}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quiz Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <QuizPlayer
            lessonId={taskDetail?.lessonId}
            onComplete={handleComplete}
          />
        </div>

        {completed && (
          <div className="mt-6 flex justify-center">
            <Link
              to="/tasks"
              className="px-8 py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-colors shadow-sm shadow-teal-500/25 flex items-center gap-2"
            >
              <FiArrowLeft /> Về danh sách bài tập
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
