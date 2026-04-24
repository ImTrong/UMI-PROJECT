import { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { courseService, Course, Lesson } from '../services/course.service';
import { learningService, CourseProgress } from '../services/learning.service';
import { CoursePlayer } from '../components/learning/CoursePlayer';
import { QuizPlayer } from '../components/learning/QuizPlayer';
import { AssignmentPlayer } from '../components/learning/AssignmentPlayer';
import { ProgressBar } from '../components/learning/ProgressBar';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiCheckCircle, FiClock, FiFileText, FiCheckSquare, FiVideo } from 'react-icons/fi';

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
  const [course, setCourse] = useState<Course | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [lessonType, setLessonType] = useState<'VIDEO' | 'QUIZ' | 'ASSIGNMENT' | 'PDF' | 'TEXT'>('VIDEO');
  const [tasks, setTasks] = useState<Record<string, 'QUIZ' | 'ASSIGNMENT'>>({});
  const [hasTaskAttached, setHasTaskAttached] = useState<'QUIZ' | 'ASSIGNMENT' | null>(null);

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
  };

  useEffect(() => {
    const detectLessonType = () => {
      if (!currentLesson) return;

      // Track task attachment separately
      const taskType = tasks[currentLesson.id] || null;
      setHasTaskAttached(taskType);

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
      if (taskType) {
        setLessonType(taskType);
        return;
      }

      setLessonType('VIDEO'); // fallback
    };

    detectLessonType();
  }, [currentLesson, tasks]);

  const handleLessonComplete = async () => {
    if (!currentLesson || !progress) return;
    
    try {
      const result = await learningService.markLessonComplete(
        courseId!,
        currentLesson.id,
        progress.lessons?.find(l => l.lessonId === currentLesson.id)?.timeSpentSeconds || 0
      );
      
      setProgress(result.courseProgress);
      
      if (result.courseCompleted) {
        try {
          await learningService.generateCertificate(courseId!);
          toast.success('🎉 Chúc mừng! Bạn đã hoàn thành khóa học và nhận chứng chỉ.');
        } catch {
          toast.success('🎉 Đã hoàn thành khóa học! Bạn có thể nhận chứng chỉ trong mục Chứng chỉ.');
        }
      } else {
        toast.success('Đã hoàn thành bài học!');
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

  if (!course) return null;

  return (
    <div className="flex h-screen bg-gray-100">
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
              <CoursePlayer
                key={currentLesson.id}
                lesson={currentLesson}
                progress={progress?.lessons?.find(l => l.lessonId === currentLesson.id)}
                onComplete={handleLessonComplete}
                onTimeUpdate={handleTimeUpdate}
              />
            ) : lessonType === 'PDF' ? (
              <div className="flex-1 bg-white p-4 overflow-hidden">
                <div className="h-full w-full border rounded-lg overflow-hidden">
                  <iframe
                    src={getLessonPdfUrl(currentLesson)!}
                    title={currentLesson.title}
                    className="w-full h-full"
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 bg-white p-6 overflow-y-auto">
                <div className="max-w-4xl mx-auto">
                  <div className="inline-flex items-center text-sm text-primary-700 bg-primary-50 px-3 py-1 rounded-full mb-4">
                    <FiFileText className="mr-2" />
                    Nội dung bài học
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">{currentLesson.title}</h2>
                  <p className="text-gray-700 whitespace-pre-wrap leading-7">
                    {getLessonTextContent(currentLesson) || 'Bài học này hiện chưa có video hoặc tài liệu bổ sung.'}
                  </p>
                </div>
              </div>
            )}
            
            {/* Task section — shows quiz/assignment link when lesson has both content + task */}
            {hasTaskAttached && lessonType !== 'QUIZ' && lessonType !== 'ASSIGNMENT' && currentLesson && (
              <div className="p-5 bg-gradient-to-r from-purple-50 to-indigo-50 border-t border-purple-100">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${hasTaskAttached === 'QUIZ' ? 'bg-purple-100 text-purple-600' : 'bg-amber-100 text-amber-600'}`}>
                      {hasTaskAttached === 'QUIZ' ? <FiCheckSquare size={20} /> : <FiFileText size={20} />}
                    </div>
                    <div>
                      <p className="font-bold text-gray-900">
                        {hasTaskAttached === 'QUIZ' ? 'Bài trắc nghiệm' : 'Bài tập cần nộp'}
                      </p>
                      <p className="text-sm text-gray-500">Bài học này có kèm {hasTaskAttached === 'QUIZ' ? 'bài kiểm tra' : 'bài tập nộp'}. Nhấn để làm bài.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setLessonType(hasTaskAttached)}
                      className={`px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all ${
                        hasTaskAttached === 'QUIZ'
                          ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-sm'
                          : 'bg-amber-600 text-white hover:bg-amber-700 shadow-sm'
                      }`}
                    >
                      {hasTaskAttached === 'QUIZ' ? 'Làm trắc nghiệm' : 'Nộp bài tập'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Back to content button when viewing task inline */}
            {hasTaskAttached && (lessonType === 'QUIZ' || lessonType === 'ASSIGNMENT') && currentLesson && (
              Boolean(currentLesson.videoUrl) || getLessonPdfUrl(currentLesson) || getLessonTextContent(currentLesson)
            ) && (
              <div className="p-3 bg-blue-50 border-t border-blue-100">
                <button
                  onClick={() => {
                    const hasVideo = Boolean(currentLesson.videoUrl) && !currentLesson.videoUrl.toLowerCase().endsWith('.pdf');
                    if (getLessonPdfUrl(currentLesson)) setLessonType('PDF');
                    else if (hasVideo) setLessonType('VIDEO');
                    else setLessonType('TEXT');
                  }}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1.5"
                >
                  ← Quay lại nội dung bài học
                </button>
              </div>
            )}

            <div className="p-6 bg-white border-t">
              <h3 className="font-semibold text-lg mb-2">Thông tin bài học</h3>
              <p className="text-gray-600">{currentLesson.description || 'Không có thông tin mô tả chi tiết.'}</p>
              
              {!progress?.lessons?.find(l => l.lessonId === currentLesson.id)?.completed && (
                <button
                  onClick={handleLessonComplete}
                  className="mt-4 btn-primary"
                >
                  Đánh dấu đã hoàn thành
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">Chọn một bài học để bắt đầu học</p>
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
              <p className="text-sm text-gray-500 mt-1">
                Đã hoàn thành {progress.completedLessons} / {progress.totalLessons} bài học
              </p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {lessonSections.map((section, sectionIndex) => (
            <div key={section.id} className="border-b border-gray-100 last:border-b-0">
              <div className="px-4 py-3 bg-gray-50">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Section {sectionIndex + 1}
                </p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{section.title}</p>
              </div>

              {section.lessons.map((lesson, lessonIndex) => {
                const lessonProgress = progress?.lessons?.find(l => l.lessonId === lesson.id);
                const isCompleted = lessonProgress?.completed;
                const isCurrent = selectedLessonId === lesson.id;

                return (
                  <button
                    key={lesson.id}
                    onClick={() => handleLessonSelect(lesson)}
                    className={`w-full text-left p-4 hover:bg-gray-50 transition border-t ${
                      isCurrent ? 'bg-primary-50 border-l-4 border-l-primary-500' : 'border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      {isCompleted ? (
                        <FiCheckCircle className="text-green-500 mt-1 flex-shrink-0" title="Đã hoàn thành" />
                      ) : (
                        <span className="text-gray-400 text-sm mt-1 flex-shrink-0 w-4 text-center">{lessonIndex + 1}</span>
                      )}
                      <div className="flex-1">
                        <div className="flex items-start space-x-2 mt-0.5">
                           {tasks[lesson.id] === 'QUIZ' ? (
                             <div className="p-1 bg-purple-100 rounded text-purple-600 flex-shrink-0 mt-0.5" title="Bài kiểm tra"><FiCheckSquare size={12}/></div>
                           ) : tasks[lesson.id] === 'ASSIGNMENT' ? (
                             <div className="p-1 bg-amber-100 rounded text-amber-600 flex-shrink-0 mt-0.5" title="Bài tập"><FiFileText size={12}/></div>
                           ) : (
                             <div className="p-1 bg-blue-100 rounded text-blue-500 flex-shrink-0 mt-0.5" title="Video bài giảng"><FiVideo size={12}/></div>
                           )}
                           <p className={`text-sm ${isCurrent ? 'font-bold text-primary-700' : 'text-gray-700 font-medium'}`}>
                             {lesson.title}
                           </p>
                        </div>
                        <div className="flex items-center space-x-2 mt-1.5 text-xs text-gray-500 pl-7">
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
