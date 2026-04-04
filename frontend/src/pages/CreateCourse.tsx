import { useNavigate } from 'react-router-dom';
import { CourseForm } from '../components/course/CourseForm';
import { courseService, CreateCourseData } from '../services/course.service';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { useEffect } from 'react';

export default function CreateCourse() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== 'INSTRUCTOR' && user?.role !== 'ADMIN')) {
      toast.error('Bạn cần có quyền Giảng viên để tạo khóa học');
      navigate('/courses');
    }
  }, [isAuthenticated, user, navigate]);

  const handleSubmit = async (data: CreateCourseData) => {
    try {
      const course = await courseService.createCourse(data);
      toast.success('Tạo khóa học thành công!');
      navigate(`/courses/${course.slug}`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Không thể tạo khóa học');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Tạo Khóa học mới</h1>
      <div className="card">
        <CourseForm onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
