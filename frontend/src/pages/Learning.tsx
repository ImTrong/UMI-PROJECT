import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { courseService, Course, Lesson } from '../services/course.service';
import { learningService, CourseProgress } from '../services/learning.service';
import { CoursePlayer } from '../components/learning/CoursePlayer';
import { QuizPlayer } from '../components/learning/QuizPlayer';
import { AssignmentPlayer } from '../components/learning/AssignmentPlayer';
import { ProgressBar } from '../components/learning/ProgressBar';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiCheckCircle, FiClock } from 'react-icons/fi';

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
      const [courseData, progressData, lessonsData] = await Promise.all([
        courseService.getCourseById(courseId!),
        learningService.getCourseProgress(courseId!).catch(() => null),
        courseService.getCourseLessons(courseId!),
      ]);
      
      setCourse(courseData);
      setProgress(progressData);
      setLessons(lessonsData);
      
      // Find first incomplete lesson or first lesson
      let firstIncomplete = lessonsData.find(l => {
        const lessonProgress = progressData?.lessons?.find(lp => lp.lessonId === l.id);
        return !lessonProgress?.completed;
      });
      
      if (!firstIncomplete && lessonsData.length > 0) {
        firstIncomplete = lessonsData[0];
      }
      
      if (firstIncomplete) {
        setCurrentLesson(firstIncomplete);
        setSelectedLessonId(firstIncomplete.id);
      }
    } catch (error) {
      console.error('Failed to load course:', error);
      toast.error('Không tìm thấy khóa học');
      navigate('/my-learning');
    } finally {
      setLoading(false);
    }
  };

  const handleLessonSelect = (lesson: Lesson) => {
    setCurrentLesson(lesson);
    setSelectedLessonId(lesson.id);
  };

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
        toast.success('🎉 Đã hoàn thành khóa học! Hãy kiểm tra chứng chỉ của bạn.');
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
      {/* Sidebar - Lesson List */}
      <div className="w-80 bg-white border-r flex flex-col">
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
          {lessons.map((lesson, index) => {
            const lessonProgress = progress?.lessons?.find(l => l.lessonId === lesson.id);
            const isCompleted = lessonProgress?.completed;
            const isCurrent = selectedLessonId === lesson.id;
            
            return (
              <button
                key={lesson.id}
                onClick={() => handleLessonSelect(lesson)}
                className={`w-full text-left p-4 hover:bg-gray-50 transition border-b ${
                  isCurrent ? 'bg-primary-50 border-l-4 border-l-primary-500' : ''
                }`}
              >
                <div className="flex items-start space-x-3">
                  {isCompleted ? (
                    <FiCheckCircle className="text-green-500 mt-1 flex-shrink-0" />
                  ) : (
                    <span className="text-gray-400 text-sm mt-1 flex-shrink-0">{index + 1}</span>
                  )}
                  <div className="flex-1">
                    <p className={`text-sm ${isCurrent ? 'font-semibold text-primary-700' : 'text-gray-700'}`}>
                      {lesson.title}
                    </p>
                    <div className="flex items-center space-x-2 mt-1 text-xs text-gray-500">
                      <FiClock size={12} />
                      <span>{Math.floor(lesson.duration / 60)} phút</span>
                      {lesson.isPreview && (
                        <span className="text-primary-500">Học thử</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Main Content - Video Player */}
      <div className="flex-1 flex flex-col">
        {currentLesson ? (
          <>
            {currentLesson.title.toLowerCase().includes('quiz') || currentLesson.videoUrl?.includes('QUIZ') ? (
              <div className="flex-1 overflow-y-auto">
                <QuizPlayer
                  lessonId={currentLesson.id}
                  onComplete={handleLessonComplete}
                />
              </div>
            ) : currentLesson.title.toLowerCase().includes('assignment') || currentLesson.videoUrl?.includes('ASSIGNMENT') ? (
              <div className="flex-1 overflow-y-auto">
                <AssignmentPlayer
                  lessonId={currentLesson.id}
                  onComplete={handleLessonComplete}
                />
              </div>
            ) : (
              <CoursePlayer
                lesson={currentLesson}
                progress={progress?.lessons?.find(l => l.lessonId === currentLesson.id)}
                onComplete={handleLessonComplete}
                onTimeUpdate={handleTimeUpdate}
              />
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
    </div>
  );
}
