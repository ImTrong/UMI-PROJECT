import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CourseCard } from '../components/course/CourseCard';
import { CourseFilters } from '../components/course/CourseFilters';
import { courseService, Course, CourseFilters as Filters } from '../services/course.service';
import { useAuth } from '../hooks/useAuth';

export default function Courses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 12,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [filters, setFilters] = useState<Filters>({
    page: 1,
    limit: 12,
    sortBy: 'newest',
  });
  const { isAuthenticated, user } = useAuth();

  const loadCourses = async () => {
    setLoading(true);
    try {
      const result = await courseService.getCourses(filters);
      setCourses(result.courses);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to load courses:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCourses();
  }, [filters]);

  const handleFilterChange = (newFilters: any) => {
    setFilters({ ...newFilters, page: 1, limit: 12 });
  };

  const handlePageChange = (newPage: number) => {
    setFilters({ ...filters, page: newPage });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Tất cả khóa học</h1>
        {isAuthenticated && user?.role === 'INSTRUCTOR' && (
          <Link to="/courses/create" className="btn-primary">
            Tạo khóa học
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Sidebar Filters */}
        <div className="md:col-span-1">
          <CourseFilters onFilterChange={handleFilterChange} initialFilters={filters} />
        </div>

        {/* Course Grid */}
        <div className="md:col-span-3">
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
          ) : courses.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-gray-500">Không tìm thấy khóa học nào phù hợp với tiêu chí của bạn.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {courses.map((course) => (
                  <CourseCard key={course.id} course={course} />
                ))}
              </div>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="flex justify-center space-x-2 mt-8">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={!pagination.hasPrevPage}
                    className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Trước
                  </button>
                  <span className="px-3 py-1">
                    Trang {pagination.page} / {pagination.totalPages}
                  </span>
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={!pagination.hasNextPage}
                    className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Tiếp
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
