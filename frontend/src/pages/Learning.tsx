import { useMemo, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { courseService, Course, Lesson } from '../services/course.service';
import { learningService, CourseProgress } from '../services/learning.service';
import { HLSPlayer } from '../components/learning/HLSPlayer';
import { QuizPlayer } from '../components/learning/QuizPlayer';
import { AssignmentPlayer } from '../components/learning/AssignmentPlayer';
import { ProgressBar } from '../components/learning/ProgressBar';
import { useAuth } from '../hooks/useAuth';
import { useFileProtection } from '../hooks/useFileProtection';
import { useSocket } from '../contexts/SocketContext';
import toast from 'react-hot-toast';
import { FiCheckCircle, FiClock, FiFileText, FiCheckSquare, FiVideo, FiMessageCircle } from 'react-icons/fi';
import { DynamicWatermark } from '../components/learning/DynamicWatermark';

interface LessonResource {
  title?: string;
  name?: string;
  type?: string;
  content?: string;
  url?: string;
  fileUrl?: string;
  fileType?: string;
}

interface LessonSection {
  id: string;
  title: string;
  lessons: Lesson[];
}

export default function Learning() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  
  // Activate frontend file protection for inspecting, keyboard shortcuts, copying, etc.
  const { isDevToolsOpen } = useFileProtection();
  const [course, setCourse] = useState<Course | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [lessonType, setLessonType] = useState<'VIDEO' | 'QUIZ' | 'ASSIGNMENT' | 'PDF' | 'TEXT'>('VIDEO');
  const [tasks, setTasks] = useState<Record<string, Array<'QUIZ' | 'ASSIGNMENT'>>>({});
  const [hasTaskAttached, setHasTaskAttached] = useState<Array<'QUIZ' | 'ASSIGNMENT'>>([]);
  const [pdfHeight, setPdfHeight] = useState(2500);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const { socket } = useSocket();
  const lessonStartTimeRef = useRef<number>(Date.now());

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const targetLessonId = queryParams.get('lessonId');

  const lessonSections = useMemo<LessonSection[]>(() => {
    if (lessons.length === 0) return [];

    const sections = new Map<string, LessonSection>();

    lessons.forEach((lesson) => {
      const rawTitle = lesson.title || '';
      const sectionPrefixMatch = rawTitle.match(/^(Section\s*\d+|Chương\s*\d+|Phần\s*\d+)\s*[:\-]\s*/i);
      const sectionTitle = sectionPrefixMatch?.[1]?.trim() || 'Nội dung khóa học';
      const sectionId = sectionTitle.toLowerCase().replace(/\s+/g, '-');

      if (!sections.has(sectionId)) {
        sections.set(sectionId, {
          id: sectionId,
          title: sectionTitle,
          lessons: [],
        });
      }

      sections.get(sectionId)!.lessons.push(lesson);
    });

    return Array.from(sections.values());
  }, [lessons]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (courseId) {
      loadData();
    }
  }, [courseId, isAuthenticated]);

  const loadData = async () => {
    try {
      const [courseData, progressData, lessonsData, tasksData] = await Promise.all([
        courseService.getCourseById(courseId!),
        learningService.getCourseProgress(courseId!).catch(() => null),
        courseService.getCourseLessons(courseId!),
        learningService.getCourseTasks(courseId!).catch(() => ({})),
      ]);
      
      setCourse(courseData);
      setProgress(progressData);
      setLessons(lessonsData);
      setTasks(tasksData);
      
      let initialLesson = null;
      if (targetLessonId) {
        initialLesson = lessonsData.find(l => l.id === targetLessonId);
      }
      
      if (!initialLesson) {
        // Find first incomplete lesson or first lesson
        initialLesson = lessonsData.find(l => {
          const lessonProgress = progressData?.lessons?.find(lp => lp.lessonId === l.id);
          return !lessonProgress?.completed;
        });
      }
      
      if (!initialLesson && lessonsData.length > 0) {
        initialLesson = lessonsData[0];
      }
      
      if (initialLesson) {
        setCurrentLesson(initialLesson);
        setSelectedLessonId(initialLesson.id);
        lessonStartTimeRef.current = Date.now();
      }
    } catch (error: any) {
      console.error('Failed to load course:', error);
      if (error.response?.status === 403) {
        toast.error('Bạn không có quyền truy cập khóa học này hoặc khóa học chưa được xuất bản');
      } else {
        toast.error('Không tìm thấy khóa học hoặc có lỗi xảy ra');
      }
      navigate('/my-learning');
    } finally {
      setLoading(false);
    }
  };

  const handleLessonSelect = (lesson: Lesson) => {
    setCurrentLesson(lesson);
    setSelectedLessonId(lesson.id);
    lessonStartTimeRef.current = Date.now();
  };

  useEffect(() => {
    const detectLessonType = () => {
      if (!currentLesson) return;

      // Track task attachment separately
      const taskTypes = tasks[currentLesson.id] || [];
      setHasTaskAttached(taskTypes);

      // Determine CONTENT type (video/pdf/text) — independent of task
      if (getLessonPdfUrl(currentLesson)) {
        setLessonType('PDF');
        return;
      }

      const hasVideo = Boolean(currentLesson.videoUrl) && !currentLesson.videoUrl.toLowerCase().endsWith('.pdf');
      if (hasVideo) {
        setLessonType('VIDEO');
        return;
      }

      const textInfo = getLessonTextContent(currentLesson);
      if (textInfo) {
        setLessonType('TEXT');
        return;
      }

      // No content — if there is a task, show that directly
      if (taskTypes.length > 0) {
        setLessonType(taskTypes[0]);
        return;
      }

      setLessonType('VIDEO'); // fallback
    };

    detectLessonType();
  }, [currentLesson, tasks]);

  useEffect(() => {
    if (lessonType === 'PDF' && currentLesson) {
      const url = getLessonPdfUrl(currentLesson);
      if (url) {
        setLoadingPdf(true);
        let fetchUrl = url;
        if (url.startsWith('/api/')) {
          fetchUrl = url.includes('?') 
            ? `${url}&token=${localStorage.getItem('accessToken')}`
            : `${url}?token=${localStorage.getItem('accessToken')}`;
        }
        
        fetch(fetchUrl)
          .then(res => res.blob())
          .then(blob => {
            const blobUrl = URL.createObjectURL(blob);
            setPdfBlobUrl(blobUrl);
            setLoadingPdf(false);
          })
          .catch(err => {
            console.error('Failed to load PDF as blob', err);
            // fallback to original url if blob fails
            setPdfBlobUrl(fetchUrl);
            setLoadingPdf(false);
          });
      }
    }

    return () => {
      if (pdfBlobUrl && pdfBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [currentLesson, lessonType]);

  const handleLessonComplete = async () => {
    if (!currentLesson || !progress) return;
    
    // Tính toán thời gian đã học thực tế (tính bằng giây)
    const sessionTimeSeconds = Math.max(0, Math.floor((Date.now() - lessonStartTimeRef.current) / 1000));

    try {
      const result = await learningService.markLessonComplete(
        courseId!,
        currentLesson.id,
        sessionTimeSeconds
      );
      
      setProgress(result.courseProgress);
      
      if (result.courseCompleted) {
        toast.success('🎉 Chúc mừng! Bạn đã hoàn thành khóa học. Xem kết quả tổng kết!');
        // Navigate to exam result page instead of auto-generating certificate
        setTimeout(() => {
          window.location.href = `/course-exam/${courseId}`;
        }, 2000);
      } else if (result.missingQuizzes) {
        toast.error('Bạn cần hoàn thành tất cả các bài kiểm tra (Quiz) để hoàn thành khóa học!', { duration: 5000 });
      } else {
        toast.success('Đã hoàn thành bài học!');
      }

      // Emit realtime progress event for instructors
      if (socket && course) {
        socket.emit('progress:lesson_completed', {
          courseId,
          courseTitle: course.title,
          lessonId: currentLesson.id,
          lessonTitle: currentLesson.title,
          progressPercentage: result.courseProgress.progressPercentage,
          completedLessons: result.courseProgress.completedLessons,
          totalLessons: result.courseProgress.totalLessons,
        });
      }
      
      // Find next lesson
      const currentIndex = lessons.findIndex(l => l.id === currentLesson.id);
      if (currentIndex < lessons.length - 1) {
        setCurrentLesson(lessons[currentIndex + 1]);
        setSelectedLessonId(lessons[currentIndex + 1].id);
      }
    } catch (error) {
      toast.error('Không thể đánh dấu hoàn thành bài học');
    }
  };

  const handleTimeUpdate = async (_seconds: number) => {
    // Update progress periodically
  };

  const parseLessonResources = (lesson: Lesson): LessonResource[] => {
    if (!lesson.resources) return [];

    if (Array.isArray(lesson.resources)) {
      return lesson.resources as LessonResource[];
    }

    if (typeof lesson.resources === 'string') {
      try {
        const parsed = JSON.parse(lesson.resources);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    return [];
  };

  const getLessonPdfUrl = (lesson: Lesson): string | null => {
    if (lesson.videoUrl && lesson.videoUrl.toLowerCase().endsWith('.pdf')) {
      return lesson.videoUrl;
    }

    const resources = parseLessonResources(lesson);
    const pdfResource = resources.find((res) => {
      const fileType = (res.fileType || res.type || '').toLowerCase();
      const link = (res.fileUrl || res.url || '').toLowerCase();
      return fileType.includes('pdf') || link.endsWith('.pdf');
    });

    return (pdfResource?.fileUrl || pdfResource?.url || null) as string | null;
  };

  const getLessonTextContent = (lesson: Lesson): string | null => {
    const resources = parseLessonResources(lesson);
    const textResource = resources.find((res) => {
      const fileType = (res.fileType || res.type || '').toLowerCase();
      return fileType.includes('text') || fileType.includes('note') || Boolean(res.content);
    });

    if (textResource?.content) {
      return textResource.content;
    }

    return lesson.description || null;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (isDevToolsOpen) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 select-none font-sans">
        <div className="max-w-md w-full bg-slate-900 border border-red-900/30 rounded-3xl p-8 text-center shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 via-orange-500 to-red-600"></div>
          <div className="w-16 h-16 bg-red-950/40 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-red-500/20 shadow-inner">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-3 tracking-tight">Hệ thống đã khóa nội dung</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-8">
            Để bảo vệ bản quyền tài liệu và bài giảng của giảng viên, bạn cần đóng công cụ kiểm tra phần tử (Developer Tools) trước khi tiếp tục học tập.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-3.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-2xl transition duration-200 shadow-sm shadow-red-600/20 active:scale-[0.98]"
          >
            Tải lại trang sau khi đóng
          </button>
        </div>
      </div>
    );
  }

  if (!course) return null;

  return (
    <div className="flex h-screen bg-slate-100 select-none">
      {/* Main Content - Left Side */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {currentLesson ? (
          <>
            {lessonType === 'QUIZ' ? (
              <div className="flex-1 overflow-y-auto">
                <QuizPlayer
                  lessonId={currentLesson.id}
                  onComplete={handleLessonComplete}
                />
              </div>
            ) : lessonType === 'ASSIGNMENT' ? (
              <div className="flex-1 overflow-y-auto">
                <AssignmentPlayer
                  lessonId={currentLesson.id}
                  courseId={courseId!}
                  onComplete={handleLessonComplete}
                />
              </div>
            ) : lessonType === 'VIDEO' ? (
              <HLSPlayer
                key={currentLesson.id}
                lesson={currentLesson}
                progress={progress?.lessons?.find(l => l.lessonId === currentLesson.id)}
                onComplete={handleLessonComplete}
                onTimeUpdate={handleTimeUpdate}
              />
            ) : lessonType === 'PDF' ? (
              <div className="flex-1 bg-white p-4 overflow-hidden flex flex-col" onContextMenu={(e) => e.preventDefault()}>
                <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border rounded-t-lg select-none">
                  <span className="text-xs text-slate-500 font-medium">Bảo mật tài liệu (Cuộn chuột để xem)</span>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setPdfHeight(Math.max(1000, pdfHeight - 1000))} 
                      disabled={pdfHeight <= 1000}
                      className="px-2 py-1 text-xs bg-white border border-slate-100 rounded hover:bg-slate-100 disabled:opacity-50 font-medium text-slate-700 transition"
                    >
                      Thu nhỏ
                    </button>
                    <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded">
                      Chiều cao: {pdfHeight}px
                    </span>
                    <button 
                      onClick={() => setPdfHeight(Math.min(8000, pdfHeight + 1000))}
                      disabled={pdfHeight >= 8000}
                      className="px-2 py-1 text-xs bg-white border border-slate-100 rounded hover:bg-slate-100 disabled:opacity-50 font-medium text-slate-700 transition"
                    >
                      Mở rộng
                    </button>
                  </div>
                </div>
                <div className="flex-1 border-x border-b rounded-b-lg overflow-y-auto bg-slate-100 relative">
                  <DynamicWatermark />
                  {loadingPdf ? (
                    <div className="flex items-center justify-center h-full min-h-[300px]">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
                    </div>
                  ) : pdfBlobUrl ? (
                    <iframe
                      src={`${pdfBlobUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                      title={currentLesson.title}
                      className="w-full block"
                      style={{ pointerEvents: 'none', height: `${pdfHeight}px`, border: 'none' }}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-500">
                      Không thể tải tài liệu
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 bg-white p-6 overflow-y-auto">
                <div className="max-w-4xl mx-auto">
                  <div className="inline-flex items-center text-sm text-primary-700 bg-primary-50 px-3 py-1 rounded-full mb-4">
                    <FiFileText className="mr-2" />
                    Nội dung bài học
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 mb-4">{currentLesson.title}</h2>
                  <p className="text-slate-700 whitespace-pre-wrap leading-7">
                    {getLessonTextContent(currentLesson) || 'Bài học này hiện chưa có video hoặc tài liệu bổ sung.'}
                  </p>
                </div>
              </div>
            )}
            
            {/* Task section — shows quiz/assignment link when lesson has both content + task */}
            {hasTaskAttached.length > 0 && lessonType !== 'QUIZ' && lessonType !== 'ASSIGNMENT' && currentLesson && (
              <div className="p-5 bg-gradient-to-r from-teal-50 to-emerald-50 border-t border-teal-100">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                       {hasTaskAttached.includes('QUIZ') && (
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-teal-100 text-teal-600 ring-2 ring-white z-10`}>
                             <FiCheckSquare size={20} />
                          </div>
                       )}
                       {hasTaskAttached.includes('ASSIGNMENT') && (
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-amber-100 text-amber-600 ring-2 ring-white z-0`}>
                             <FiFileText size={20} />
                          </div>
                       )}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">
                        {hasTaskAttached.length > 1 ? 'Bài tập và Trắc nghiệm' : hasTaskAttached[0] === 'QUIZ' ? 'Bài trắc nghiệm' : 'Bài tập cần nộp'}
                      </p>
                      <p className="text-sm text-slate-500">Bài học này có kèm {hasTaskAttached.length > 1 ? 'bài tập và trắc nghiệm' : hasTaskAttached[0] === 'QUIZ' ? 'bài kiểm tra' : 'bài tập nộp'}. Nhấn để làm bài.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {hasTaskAttached.includes('QUIZ') && (
                        <button
                          onClick={() => setLessonType('QUIZ')}
                          className="px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all bg-teal-600 text-white hover:bg-teal-700 shadow-sm"
                        >
                          Làm trắc nghiệm
                        </button>
                    )}
                    {hasTaskAttached.includes('ASSIGNMENT') && (
                        <button
                          onClick={() => setLessonType('ASSIGNMENT')}
                          className="px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all bg-amber-600 text-white hover:bg-amber-700 shadow-sm"
                        >
                          Nộp bài tập
                        </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Back to content button when viewing task inline */}
            {hasTaskAttached.length > 0 && (lessonType === 'QUIZ' || lessonType === 'ASSIGNMENT') && currentLesson && (
              Boolean(currentLesson.videoUrl) || getLessonPdfUrl(currentLesson) || getLessonTextContent(currentLesson)
            ) && (
              <div className="p-3 bg-cyan-50 border-t border-cyan-100 flex justify-between items-center">
                <button
                  onClick={() => {
                    const hasVideo = Boolean(currentLesson.videoUrl) && !currentLesson.videoUrl.toLowerCase().endsWith('.pdf');
                    if (getLessonPdfUrl(currentLesson)) setLessonType('PDF');
                    else if (hasVideo) setLessonType('VIDEO');
                    else setLessonType('TEXT');
                  }}
                  className="text-sm font-medium text-cyan-600 hover:text-cyan-800 flex items-center gap-1.5"
                >
                  ← Quay lại nội dung bài học
                </button>
                {hasTaskAttached.length > 1 && (
                  <button
                    onClick={() => setLessonType(lessonType === 'QUIZ' ? 'ASSIGNMENT' : 'QUIZ')}
                    className="text-sm font-medium text-primary-600 hover:text-primary-800 flex items-center gap-1.5"
                  >
                    Chuyển sang {lessonType === 'QUIZ' ? 'Bài tập nộp' : 'Bài trắc nghiệm'} →
                  </button>
                )}
              </div>
            )}

            <div className="p-6 bg-white border-t">
              <h3 className="font-semibold text-lg mb-2">Thông tin bài học</h3>
              <p className="text-slate-600">{currentLesson.description || 'Không có thông tin mô tả chi tiết.'}</p>
              
              <div className="flex flex-wrap items-center gap-3 mt-4">
                {!progress?.lessons?.find(l => l.lessonId === currentLesson.id)?.completed && (
                  <button
                    onClick={handleLessonComplete}
                    className="btn-primary font-medium"
                  >
                    Đánh dấu đã hoàn thành
                  </button>
                )}
                
                {course.instructorId && (
                  <button
                    onClick={() => {
                      const event = new CustomEvent('open-chat-session', {
                        detail: {
                          participantId: course.instructorId,
                          courseId: course.id,
                          courseTitle: course.title
                        }
                      });
                      window.dispatchEvent(event);
                    }}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-primary-600 text-primary-600 bg-white hover:bg-primary-50 rounded-xl font-semibold text-sm transition-all shadow-sm cursor-pointer"
                  >
                    <FiMessageCircle size={16} />
                    <span>Nhắn tin cho giảng viên</span>
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-500">Chọn một bài học để bắt đầu học</p>
          </div>
        )}
      </div>

      {/* Sidebar - Right Side */}
      <div className="w-96 bg-white border-l flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-lg">{course.title}</h2>
          {progress && (
            <div className="mt-3">
              <ProgressBar percentage={progress.progressPercentage} size="sm" />
              <p className="text-sm text-slate-500 mt-1">
                Đã hoàn thành {progress.completedLessons} / {progress.totalLessons} bài học
              </p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {lessonSections.map((section, sectionIndex) => (
            <div key={section.id} className="border-b border-slate-100 last:border-b-0">
              <div className="px-4 py-3 bg-slate-50">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Section {sectionIndex + 1}
                </p>
                <p className="text-sm font-semibold text-slate-800 mt-1">{section.title}</p>
              </div>

              {section.lessons.map((lesson, lessonIndex) => {
                const lessonProgress = progress?.lessons?.find(l => l.lessonId === lesson.id);
                const isCompleted = lessonProgress?.completed;
                const isCurrent = selectedLessonId === lesson.id;

                return (
                  <button
                    key={lesson.id}
                    onClick={() => handleLessonSelect(lesson)}
                    className={`w-full text-left p-4 hover:bg-slate-50 transition border-t ${
                      isCurrent ? 'bg-primary-50 border-l-4 border-l-primary-500' : 'border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      {isCompleted ? (
                        <FiCheckCircle className="text-green-500 mt-1 flex-shrink-0" title="Đã hoàn thành" />
                      ) : (
                        <span className="text-slate-400 text-sm mt-1 flex-shrink-0 w-4 text-center">{lessonIndex + 1}</span>
                      )}
                      <div className="flex-1">
                        <div className="flex items-start space-x-2 mt-0.5">
                           <div className="flex gap-1 flex-shrink-0 mt-0.5">
                              {(!tasks[lesson.id] || tasks[lesson.id].length === 0) && (
                                <div className="p-1 bg-cyan-100 rounded text-cyan-500" title="Video bài giảng"><FiVideo size={12}/></div>
                              )}
                              {tasks[lesson.id]?.includes('QUIZ') && (
                                <div className="p-1 bg-teal-100 rounded text-teal-600" title="Bài kiểm tra"><FiCheckSquare size={12}/></div>
                              )}
                              {tasks[lesson.id]?.includes('ASSIGNMENT') && (
                                <div className="p-1 bg-amber-100 rounded text-amber-600" title="Bài tập"><FiFileText size={12}/></div>
                              )}
                           </div>
                           <p className={`text-sm ${isCurrent ? 'font-bold text-primary-700' : 'text-slate-700 font-medium'}`}>
                             {lesson.title}
                           </p>
                        </div>
                        <div className="flex items-center space-x-2 mt-1.5 text-xs text-slate-500 pl-7">
                          <FiClock size={12} />
                          <span>{Math.floor(lesson.duration / 60)} phút</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
