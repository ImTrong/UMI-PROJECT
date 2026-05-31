import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { courseService, Course } from '../../services/course.service';
import { learningService, Assignment } from '../../services/learning.service';
import { FiChevronLeft, FiFileText, FiClock, FiEdit, FiCheckCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

interface AssignmentWithLesson extends Assignment {
  lessonTitle: string;
  lessonOrder: number;
}

export default function InstructorCourseAssignments() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [assignments, setAssignments] = useState<AssignmentWithLesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (courseId) {
      loadData();
    }
  }, [courseId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Get Course Info
      const courseData = await courseService.getCourseById(courseId!);
      setCourse(courseData);

      // 2. Get Lessons
      const lessons = await courseService.getCourseLessons(courseId!);
      
      // 3. Get Course Tasks Map { [lessonId]: Array<'QUIZ' | 'ASSIGNMENT'> }
      const tasksMap = await learningService.getCourseTasks(courseId!);

      // 4. Find lessons that have an ASSIGNMENT
      const assignmentLessons = lessons.filter(l => tasksMap[l.id]?.includes('ASSIGNMENT'));

      // 5. Fetch assignment details
      const assignmentsList: AssignmentWithLesson[] = [];
      for (const lesson of assignmentLessons) {
        try {
          const assignmentData = await learningService.getAssignmentByLesson(lesson.id);
          assignmentsList.push({
            ...assignmentData,
            lessonTitle: lesson.title,
            lessonOrder: lesson.order,
          });
        } catch (err) {
          console.error(`Failed to load assignment for lesson ${lesson.id}`, err);
        }
      }

      // Sort by lesson order
      assignmentsList.sort((a, b) => a.lessonOrder - b.lessonOrder);
      setAssignments(assignmentsList);

    } catch (error) {
      toast.error('Lỗi tải danh sách bài tập');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate('/dashboard')} className="p-2 bg-white border rounded-xl hover:bg-slate-50 transition-colors">
          <FiChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quản lý bài tập tự luận</h1>
          <p className="text-slate-500 text-sm mt-1">{course?.title || 'Khóa học'}</p>
        </div>
      </div>

      <div className="card overflow-hidden !p-0">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <h2 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
            <FiFileText className="text-primary-500" />
            Danh sách bài tập trong khóa học
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-1/2">Bài tập</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Thông tin</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Hành động</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-16 text-center">
                    <FiFileText size={48} className="mx-auto text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium">Khóa học này chưa có bài tập tự luận nào.</p>
                  </td>
                </tr>
              ) : (
                assignments.map((assignment) => (
                  <tr key={assignment.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-primary-50 text-primary-600 rounded-lg shrink-0 mt-1">
                          <FiEdit size={20} />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 text-base mb-1">{assignment.title}</p>
                          <p className="text-sm text-slate-500 flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                            Bài học {assignment.lessonOrder}: {assignment.lessonTitle}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="space-y-1 text-sm text-slate-600">
                        <p className="flex items-center gap-2">
                          <FiCheckCircle className="text-green-500" />
                          Điểm tối đa: <span className="font-medium text-slate-900">{assignment.maxScore}</span>
                        </p>
                        {assignment.dueDate && (
                          <p className="flex items-center gap-2">
                            <FiClock className="text-amber-500" />
                            Hạn nộp: <span className="font-medium text-slate-900">{new Date(assignment.dueDate).toLocaleDateString('vi-VN')}</span>
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <Link 
                        to={`/instructor/assignments/${assignment.id}/submissions`}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-50 text-primary-700 font-medium rounded-xl hover:bg-primary-600 hover:text-white transition-all duration-200 shadow-sm hover:shadow"
                      >
                        Chấm bài học viên
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
