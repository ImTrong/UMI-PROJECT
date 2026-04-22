import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FiArrowLeft, FiUser, FiCheckCircle, FiClock, FiPlayCircle, FiCircle } from 'react-icons/fi';
import { courseService, InstructorStudentDetail } from '../../services/course.service';
import toast from 'react-hot-toast';

export default function CourseStudentDetail() {
  const { courseId, studentId } = useParams<{ courseId: string; studentId: string }>();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InstructorStudentDetail | null>(null);

  useEffect(() => {
    if (courseId && studentId) {
      loadDetail(courseId, studentId);
    }
  }, [courseId, studentId]);

  const loadDetail = async (cId: string, sId: string) => {
    try {
      setLoading(true);
      const data = await courseService.getCourseStudentDetail(cId, sId);
      setDetail(data);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Không thể tải chi tiết học viên');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return 'Chưa có dữ liệu';
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateString));
  };

  const getLessonStatusLabel = (status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED') => {
    if (status === 'COMPLETED') return 'Đã học';
    if (status === 'IN_PROGRESS') return 'Đang học';
    return 'Chưa học';
  };

  const getLessonStatusIcon = (status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED') => {
    if (status === 'COMPLETED') return <FiCheckCircle className="text-green-500" />;
    if (status === 'IN_PROGRESS') return <FiPlayCircle className="text-blue-500" />;
    return <FiCircle className="text-gray-300" />;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-gray-600">Không tìm thấy thông tin học viên.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Link to={`/instructor/course/${courseId}/students`} className="text-primary-600 hover:text-primary-800 flex items-center mb-4">
        <FiArrowLeft className="mr-2" /> Quay lại danh sách học viên
      </Link>

      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200 mb-6">
        <p className="text-sm text-gray-500 mb-1">Khóa học</p>
        <h1 className="text-2xl font-bold text-gray-900">{detail.course.title}</h1>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center">
          <div className="h-14 w-14 rounded-full overflow-hidden bg-primary-100 flex items-center justify-center">
            {detail.student.avatar ? (
              <img src={detail.student.avatar} alt={detail.student.fullName} className="h-full w-full object-cover" />
            ) : (
              <FiUser className="text-primary-700 text-2xl" />
            )}
          </div>
          <div className="ml-4">
            <p className="text-sm text-gray-500">Học viên</p>
            <h2 className="text-lg font-semibold text-gray-900">{detail.student.fullName}</h2>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium text-gray-800">Tiến độ hoàn thành</span>
            <span className="font-semibold text-primary-700">{Math.round(detail.progress.progressPercentage)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full ${detail.progress.progressPercentage >= 100 ? 'bg-green-500' : 'bg-primary-600'}`}
              style={{ width: `${Math.max(0, Math.min(100, detail.progress.progressPercentage))}%` }}
            />
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {detail.progress.completedLessons}/{detail.progress.totalLessons} bài học hoàn thành
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mt-5 text-sm">
          <div className="flex items-center text-gray-600">
            <FiClock className="mr-2" />
            Ngày tham gia: {formatDate(detail.progress.enrolledAt)}
          </div>
          <div className="flex items-center text-gray-600">
            <FiClock className="mr-2" />
            Lần học gần nhất: {formatDate(detail.progress.lastAccessedAt)}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="font-semibold text-gray-900">Chi tiết tiến độ từng bài học</h3>
        </div>

        <div className="divide-y">
          {detail.lessons.map((lesson) => (
            <div key={lesson.lessonId} className="p-4 flex items-start justify-between">
              <div className="flex items-start">
                <div className="mt-1 mr-3">{getLessonStatusIcon(lesson.status)}</div>
                <div>
                  <p className="font-medium text-gray-900">
                    Bài {lesson.order}: {lesson.title}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">{getLessonStatusLabel(lesson.status)}</p>
                </div>
              </div>
              <div className="text-sm text-gray-500">
                {lesson.lastWatchedAt ? `Học gần nhất: ${formatDate(lesson.lastWatchedAt)}` : 'Chưa học'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
