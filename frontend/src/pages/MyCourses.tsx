import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CourseCard } from '../components/course/CourseCard';
import { courseService, Course } from '../services/course.service';
import { FiEdit2, FiTrash2, FiEye, FiEyeOff } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function MyCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false,
  });

  const loadCourses = async (page: number = 1) => {
    setLoading(true);
    try {
      const result = await courseService.getMyCourses(page, 10);
      setCourses(result.courses);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to load courses:', error);
      toast.error('Không thể tải danh sách khóa học của bạn');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCourses();
  }, []);

  const handleDelete = async (courseId: string, courseTitle: string) => {
    if (confirm(`Bạn có chắc chắn muốn xóa "${courseTitle}"? Thao tác này không thể hoàn tác.`)) {
      try {
        await courseService.deleteCourse(courseId);
        toast.success('Xóa khóa học thành công');
        loadCourses(pagination.page);
      } catch (error) {
        toast.error('Không thể xóa khóa học');
      }
    }
  };

  const handlePublish = async (courseId: string, isPublished: boolean) => {
    try {
      await courseService.publishCourse(courseId);
      if (isPublished) {
        toast.success('Đã ngừng xuất bản khóa học');
      } else {
        toast.success('Đã gửi khóa học để Admin xét duyệt!');
      }
      loadCourses(pagination.page);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Thao tác thất bại');
    }
  };

  if (loading && courses.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Khóa học của tôi</h1>
        <Link to="/courses/create" className="btn-primary">
          Tạo Khóa học mới
        </Link>
      </div>

      {courses.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-slate-500 mb-4">Bạn chưa tạo khóa học nào.</p>
          <Link to="/courses/create" className="btn-primary">
            Tạo khóa học đầu tiên của bạn
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => (
              <div key={course.id} className="relative group">
                <CourseCard course={course} />
                <div className="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    to={`/courses/${course.slug}/edit`}
                    className="p-2 bg-white rounded-full shadow hover:bg-slate-100"
                    title="Sửa Khóa học"
                  >
                    <FiEdit2 size={16} className="text-slate-600" />
                  </Link>
                  {(course as any).approvalStatus !== 'PENDING_REVIEW' && (
                    <button
                      onClick={() => handlePublish(course.id, course.published)}
                      className="p-2 bg-white rounded-full shadow hover:bg-slate-100"
                      title={course.published ? "Ngừng xuất bản" : "Gửi duyệt"}
                    >
                      {course.published ? (
                        <FiEyeOff size={16} className="text-slate-600" />
                      ) : (
                        <FiEye size={16} className="text-slate-600" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(course.id, course.title)}
                    className="p-2 bg-white rounded-full shadow hover:bg-red-100"
                    title="Xóa Khóa học"
                  >
                    <FiTrash2 size={16} className="text-red-600" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center space-x-2 mt-8">
              <button
                onClick={() => loadCourses(pagination.page - 1)}
                disabled={!pagination.hasPrevPage}
                className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Trước
              </button>
              <span className="px-3 py-1">
                Trang {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => loadCourses(pagination.page + 1)}
                disabled={!pagination.hasNextPage}
                className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Tiếp
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
