import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { learningService } from '../services/learning.service';
import { courseService, Lesson } from '../services/course.service';
import { AssignmentPlayer } from '../components/learning/AssignmentPlayer';
import { useAuth } from '../hooks/useAuth';
import {
  FiArrowLeft,
  FiBookOpen,
  FiFileText,
  FiClock,
  FiAward,
  FiVideo,
  FiFile,
  FiChevronDown,
  FiChevronUp,
} from 'react-icons/fi';

export default function AssignmentPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [taskDetail, setTaskDetail] = useState<any>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const [showMaterials, setShowMaterials] = useState(true);

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
      const detail = await learningService.getTaskDetail(taskId!, 'ASSIGNMENT');
      setTaskDetail(detail);

      // Also fetch lesson data for materials (video/PDF/text)
      if (detail.courseId && detail.lessonId) {
        try {
          const lessons = await courseService.getCourseLessons(detail.courseId);
          const found = lessons.find((l: Lesson) => l.id === detail.lessonId);
          if (found) setLesson(found);
        } catch {
          // Silent — lesson materials are optional
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Không tìm thấy bài tập');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setCompleted(true);
    if (taskDetail?.courseId && taskDetail?.lessonId) {
      try {
        await learningService.markLessonComplete(taskDetail.courseId, taskDetail.lessonId, 0);
      } catch {
        // Silent
      }
    }
  };

  const getLessonVideoUrl = (): string | null => {
    if (!lesson) return null;
    if (lesson.videoUrl && !lesson.videoUrl.toLowerCase().endsWith('.pdf')) {
      return lesson.videoUrl;
    }
    return null;
  };

  const getLessonPdfUrl = (): string | null => {
    if (!lesson) return null;
    if (lesson.videoUrl && lesson.videoUrl.toLowerCase().endsWith('.pdf')) {
      return lesson.videoUrl;
    }
    // Check resources
    if (lesson.resources && Array.isArray(lesson.resources)) {
      const pdf = (lesson.resources as any[]).find((r: any) => {
        const ft = (r.fileType || r.type || '').toLowerCase();
        const link = (r.fileUrl || r.url || '').toLowerCase();
        return ft.includes('pdf') || link.endsWith('.pdf');
      });
      return pdf?.fileUrl || pdf?.url || null;
    }
    return null;
  };

  const dueDate = taskDetail?.dueDate ? new Date(taskDetail.dueDate) : null;
  const isOverdue = dueDate ? dueDate < new Date() : false;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="relative w-16 h-16">
          <div className="absolute top-0 left-0 w-full h-full border-4 border-amber-200 rounded-full animate-ping"></div>
          <div className="absolute top-0 left-0 w-full h-full border-4 border-amber-600 rounded-full border-t-transparent animate-spin"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <FiFileText size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Không tìm thấy</h2>
          <p className="text-gray-500 mb-6">{error}</p>
          <Link to="/tasks" className="btn-primary">
            <FiArrowLeft className="mr-2 inline" /> Quay lại danh sách
          </Link>
        </div>
      </div>
    );
  }

  const videoUrl = getLessonVideoUrl();
  const pdfUrl = getLessonPdfUrl();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Premium Header */}
      <div className="relative bg-gradient-to-br from-amber-600 via-orange-700 to-red-800 overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-amber-400/10 rounded-full translate-y-1/3 -translate-x-1/4 blur-2xl"></div>
        </div>
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link
            to="/tasks"
            className="inline-flex items-center gap-2 text-amber-200 hover:text-white mb-6 text-sm font-medium transition-colors group"
          >
            <FiArrowLeft className="group-hover:-translate-x-1 transition-transform" />
            Quay lại danh sách bài tập
          </Link>

          <div className="flex items-start gap-5">
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center flex-shrink-0">
              <FiFileText className="text-amber-200" size={28} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-amber-500/30 text-amber-200 border border-amber-400/30">
                  Bài tập
                </span>
                {completed && (
                  <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-green-500/30 text-green-200 border border-green-400/30">
                    ✓ Đã nộp
                  </span>
                )}
                {isOverdue && !completed && (
                  <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-red-500/30 text-red-200 border border-red-400/30">
                    ⚠ Quá hạn
                  </span>
                )}
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white mb-2 tracking-tight">
                {taskDetail?.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-amber-200">
                <span className="flex items-center gap-1.5">
                  <FiBookOpen size={14} />
                  {taskDetail?.courseTitle}
                </span>
                {dueDate && (
                  <span className={`flex items-center gap-1.5 ${isOverdue ? 'text-red-300' : ''}`}>
                    <FiClock size={14} />
                    Hạn nộp: {dueDate.toLocaleDateString('vi-VN')} {dueDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <FiAward size={14} />
                  Tối đa {taskDetail?.maxScore} điểm
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Lesson Materials Section — Solves the "bài học không hiển thị" bug */}
        {(videoUrl || pdfUrl || lesson?.description) && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button
              onClick={() => setShowMaterials(!showMaterials)}
              className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                  {videoUrl ? <FiVideo size={20} /> : pdfUrl ? <FiFile size={20} /> : <FiFileText size={20} />}
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-gray-900">Tài liệu bài học</h3>
                  <p className="text-sm text-gray-500">
                    {videoUrl ? 'Video bài giảng' : pdfUrl ? 'Tài liệu PDF' : 'Nội dung bài học'}
                    {' — Xem trước khi làm bài tập'}
                  </p>
                </div>
              </div>
              {showMaterials ? <FiChevronUp className="text-gray-400" /> : <FiChevronDown className="text-gray-400" />}
            </button>

            {showMaterials && (
              <div className="border-t border-gray-100">
                {videoUrl && (
                  <div className="p-4">
                    <video
                      src={videoUrl}
                      controls
                      controlsList="nodownload"
                      className="w-full rounded-xl aspect-video bg-black"
                    >
                      Trình duyệt không hỗ trợ video.
                    </video>
                  </div>
                )}
                {pdfUrl && (
                  <div className="p-4">
                    <iframe
                      src={pdfUrl}
                      title="Tài liệu bài học"
                      className="w-full rounded-xl border border-gray-200"
                      style={{ height: '500px' }}
                    />
                  </div>
                )}
                {lesson?.description && !videoUrl && !pdfUrl && (
                  <div className="p-6">
                    <p className="text-gray-700 whitespace-pre-wrap leading-7">{lesson.description}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Assignment Submission */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <AssignmentPlayer
            lessonId={taskDetail?.lessonId}
            courseId={taskDetail?.courseId}
            onComplete={handleComplete}
          />
        </div>

        {completed && (
          <div className="flex justify-center">
            <Link
              to="/tasks"
              className="px-8 py-3 bg-amber-600 text-white rounded-xl font-semibold hover:bg-amber-700 transition-colors shadow-lg shadow-amber-500/25 flex items-center gap-2"
            >
              <FiArrowLeft /> Về danh sách bài tập
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
