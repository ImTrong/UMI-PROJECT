import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CourseForm } from '../components/course/CourseForm';
import { LessonManager } from '../components/course/LessonManager';
import { courseService, Course, CreateCourseData } from '../services/course.service';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import axios from 'axios';

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

  const handleSubmit = async (data: CreateCourseData, thumbnailFile?: File | null) => {
    if (!course) return;
    setUpdating(true);
    try {
      const { thumbnail, ...baseData } = data;
      let finalThumbnailUrl = thumbnail;

      if (thumbnailFile) {
        const { uploadUrl, fileUrl } = await courseService.getUploadUrl(course.id, thumbnailFile.name, thumbnailFile.type);
        await axios.put(uploadUrl, thumbnailFile, {
          headers: {
            'Content-Type': thumbnailFile.type,
          },
        });
        finalThumbnailUrl = fileUrl;
      }

      const updated = await courseService.updateCourse(course.id, {
        ...baseData,
        thumbnail: finalThumbnailUrl,
      });
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
        <h1 className="text-3xl font-bold text-slate-900">Sửa khóa học</h1>
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
                <span className="text-slate-600 font-medium">Trạng thái</span>
                <span className={`px-2 py-1 rounded text-sm font-bold ${
                  course.published ? 'bg-green-100 text-green-700' :
                  course.approvalStatus === 'PENDING_REVIEW' ? 'bg-cyan-100 text-cyan-700' :
                  course.approvalStatus === 'REJECTED' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {course.published ? 'Đã xuất bản' :
                   course.approvalStatus === 'PENDING_REVIEW' ? 'Đang chờ duyệt' :
                   course.approvalStatus === 'REJECTED' ? 'Bị từ chối' :
                   'Bản nháp'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 font-medium">Học viên</span>
                <span className="font-bold">{course.enrolledCount} học viên</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 font-medium">Đánh giá</span>
                <span className="font-bold">{course.rating.toFixed(1)} / 5.0</span>
              </div>

              {course.approvalStatus === 'REJECTED' && course.rejectionReason && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm font-semibold text-red-700 mb-1">Lý do từ chối:</p>
                  <p className="text-sm text-red-600">{course.rejectionReason}</p>
                </div>
              )}

              {course.approvalStatus === 'PENDING_REVIEW' && (
                <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-xl">
                  <p className="text-sm text-cyan-700">
                    ⏳ Khóa học đang chờ Admin xét duyệt. Bạn sẽ được thông báo khi có kết quả.
                  </p>
                </div>
              )}

              {course.published && (
                <div className="pt-4 border-t">
                  <button
                    onClick={async () => {
                      try {
                        await courseService.publishCourse(course.id);
                        toast.success('Đã ngừng xuất bản khóa học');
                        setCourse({ ...course, published: false, approvalStatus: 'DRAFT' });
                      } catch (error: any) {
                        toast.error(error.response?.data?.error || 'Thao tác thất bại');
                      }
                    }}
                    className="w-full btn-primary bg-orange-500 hover:bg-orange-600"
                  >
                    Ngừng xuất bản
                  </button>
                </div>
              )}

              {!course.published && course.approvalStatus !== 'PENDING_REVIEW' && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-slate-500 mb-3">
                    Khóa học cần có ít nhất một bài học và mô tả đủ dài. Sau khi gửi, Admin sẽ xét duyệt.
                  </p>
                  <button
                    onClick={async () => {
                      try {
                        await courseService.publishCourse(course.id);
                        toast.success('Đã gửi khóa học để Admin xét duyệt!');
                        setCourse({ ...course, approvalStatus: 'PENDING_REVIEW' });
                      } catch (error: any) {
                        toast.error(error.response?.data?.error || 'Gửi duyệt thất bại');
                      }
                    }}
                    className="w-full btn-primary bg-green-600 hover:bg-green-700"
                  >
                    Gửi yêu cầu xuất bản
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
