import { useState, useEffect } from 'react';
import { FiSearch, FiFilter } from 'react-icons/fi';
import { courseService, Category } from '../../services/course.service';

interface CourseFiltersProps {
  onFilterChange: (filters: any) => void;
  initialFilters?: any;
}

export const CourseFilters = ({ onFilterChange, initialFilters = {} }: CourseFiltersProps) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState({
    search: initialFilters.search || '',
    categoryId: initialFilters.categoryId || '',
    level: initialFilters.level || '',
    minPrice: initialFilters.minPrice || '',
    maxPrice: initialFilters.maxPrice || '',
    sortBy: initialFilters.sortBy || 'newest',
  });

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const data = await courseService.getCategories(true);
        setCategories(data);
      } catch (error) {
        console.error('Failed to load categories:', error);
      }
    };
    loadCategories();
  }, []);

  const handleChange = (key: string, value: any) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleClear = () => {
    const resetFilters = {
      search: '',
      categoryId: '',
      level: '',
      minPrice: '',
      maxPrice: '',
      sortBy: 'newest',
    };
    setFilters(resetFilters);
    onFilterChange(resetFilters);
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Tìm kiếm khóa học..."
          value={filters.search}
          onChange={(e) => handleChange('search', e.target.value)}
          className="input-field pl-10"
        />
      </div>

      {/* Mobile Filter Toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden w-full btn-secondary flex items-center justify-center space-x-2"
      >
        <FiFilter />
        <span>Bộ lọc</span>
      </button>

      {/* Filter Panel */}
      <div className={`${isOpen ? 'block' : 'hidden'} md:block space-y-4`}>
        <div className="card p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold">Bộ lọc</h3>
            <button
              onClick={handleClear}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              Xóa tất cả
            </button>
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Danh mục
            </label>
            <select
              value={filters.categoryId}
              onChange={(e) => handleChange('categoryId', e.target.value)}
              className="input-field"
            >
              <option value="">Tất cả danh mục</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name} ({cat._count?.courses || 0})
                </option>
              ))}
            </select>
          </div>

          {/* Level Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Trình độ
            </label>
            <select
              value={filters.level}
              onChange={(e) => handleChange('level', e.target.value)}
              className="input-field"
            >
              <option value="">Tất cả trình độ</option>
              <option value="BEGINNER">Cơ bản</option>
              <option value="INTERMEDIATE">Trung bình</option>
              <option value="ADVANCED">Nâng cao</option>
            </select>
          </div>

          {/* Price Range */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Khoảng giá
            </label>
            <div className="flex space-x-2">
              <input
                type="number"
                placeholder="Tối thiểu"
                value={filters.minPrice}
                onChange={(e) => handleChange('minPrice', e.target.value)}
                className="input-field"
              />
              <input
                type="number"
                placeholder="Tối đa"
                value={filters.maxPrice}
                onChange={(e) => handleChange('maxPrice', e.target.value)}
                className="input-field"
              />
            </div>
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sắp xếp theo
            </label>
            <select
              value={filters.sortBy}
              onChange={(e) => handleChange('sortBy', e.target.value)}
              className="input-field"
            >
              <option value="newest">Mới nhất</option>
              <option value="price_asc">Giá: Thấp đến Cao</option>
              <option value="price_desc">Giá: Cao đến Thấp</option>
              <option value="rating">Đánh giá cao nhất</option>
              <option value="enrolledCount">Phổ biến nhất</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
