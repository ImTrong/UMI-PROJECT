import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CourseForm } from '../components/course/CourseForm';
import { LessonManager } from '../components/course/LessonManager';
import { courseService, Course, CreateCourseData } from '../services/course.service';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

export default function EditCourse() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const loadCourse = async () => {
      if (!slug) return;
      try {
        const data = await courseService.getCourseBySlug(slug);
        
        // Authorization check
        if (data.instructorId !== user?.id && user?.role !== 'ADMIN') {
          toast.error('Bạn không có quyền chỉnh sửa khóa học này');
          navigate('/my-courses');
          return;
        }
        
        setCourse(data);
      } catch (error) {
        toast.error('Không tìm thấy khóa học');
        navigate('/my-courses');
      } finally {
        setLoading(false);
      }
    };

    if (isAuthenticated) {
      loadCourse();
    } else if (!loading) {
      navigate('/login');
    }
  }, [slug, user, isAuthenticated, navigate, loading]);

  const handleSubmit = async (data: CreateCourseData) => {
    if (!course) return;
    setUpdating(true);
    try {
      const updated = await courseService.updateCourse(course.id, data);
      toast.success('Cập nhật khóa học thành công!');
      if (updated.slug !== course.slug) {
        navigate(`/courses/${updated.slug}/edit`);
      } else {
        setCourse(updated);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Cập nhật khóa học thất bại');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!course) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-12">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Sửa khóa học</h1>
        <button
          onClick={() => navigate(`/courses/${course.slug}`)}
          className="btn-secondary"
        >
          Xem khóa học
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="card">
            <h2 className="text-xl font-semibold mb-6">Thông tin Khóa học</h2>
            <CourseForm
              initialData={{
                title: course.title,
                description: course.description,
                price: course.price,
                level: course.level,
                categoryId: course.categoryId,
                whatYouWillLearn: course.whatYouWillLearn,
                requirements: course.requirements,
                targetAudience: course.targetAudience,
                thumbnail: course.thumbnail,
              }}
              onSubmit={handleSubmit}
              isLoading={updating}
            />
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="card sticky top-24">
            <h2 className="text-xl font-semibold mb-4">Trạng thái Khóa học</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Trạng thái</span>
                <span className={`px-2 py-1 rounded text-sm font-bold ${course.published ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {course.published ? 'Đã xuất bản' : 'Bản nháp'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Học viên</span>
                <span className="font-bold">{course.enrolledCount} học viên</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Đánh giá</span>
                <span className="font-bold">{course.rating.toFixed(1)} / 5.0</span>
              </div>
              
              {!course.published && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-gray-500 mb-3">
                    Khóa học của bạn phải có ít nhất một bài học trước khi xuất bản.
                  </p>
                  <button
                    onClick={async () => {
                      try {
                        await courseService.publishCourse(course.id);
                        toast.success('Đã xuất bản khóa học!');
                        setCourse({ ...course, published: true });
                      } catch (error: any) {
                        toast.error(error.response?.data?.error || 'Xuất bản thất bại');
                      }
                    }}
                    className="w-full btn-primary bg-green-600 hover:bg-green-700"
                  >
                    Xuất bản Khóa học
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <LessonManager
          courseId={course.id}
          initialLessons={course.lessons || []}
        />
      </div>
    </div>
  );
}
