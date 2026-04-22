import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  FiSearch,
  FiX,
  FiFilter,
  FiChevronDown,
  FiChevronUp,
  FiGrid,
  FiList,
  FiStar,
  FiUsers,
  FiClock,
  FiBookOpen,
  FiTrendingUp,
  FiArrowLeft,
  FiArrowRight,
  FiSliders,
} from 'react-icons/fi';
import { courseService, Course, Category, CourseFilters } from '../services/course.service';
import { useDebounce } from '../hooks/useDebounce';
import { formatVND } from '../utils/currency';

// ─── View mode ───
type ViewMode = 'grid' | 'list';

// ─── Sort options ───
const SORT_OPTIONS = [
  { value: 'newest', label: 'Mới nhất', icon: FiClock },
  { value: 'rating', label: 'Đánh giá cao', icon: FiStar },
  { value: 'enrolledCount', label: 'Phổ biến nhất', icon: FiTrendingUp },
  { value: 'price_asc', label: 'Giá: Thấp → Cao', icon: FiArrowRight },
  { value: 'price_desc', label: 'Giá: Cao → Thấp', icon: FiArrowLeft },
];

const LEVEL_OPTIONS = [
  { value: '', label: 'Tất cả cấp độ' },
  { value: 'BEGINNER', label: 'Người mới', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { value: 'INTERMEDIATE', label: 'Trung cấp', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'ADVANCED', label: 'Nâng cao', color: 'bg-rose-100 text-rose-700 border-rose-200' },
];

// ─── Price Range Presets ───
const PRICE_PRESETS = [
  { label: 'Tất cả', min: '', max: '' },
  { label: 'Miễn phí', min: '0', max: '0' },
  { label: '< 25.000 VNĐ', min: '', max: '25000' },
  { label: '25.000 - 50.000 VNĐ', min: '25000', max: '50000' },
  { label: '50.000 - 100.000 VNĐ', min: '50000', max: '100000' },
  { label: '> 100.000 VNĐ', min: '100000', max: '' },
];

export default function SearchCourses() {
  const [searchParams, setSearchParams] = useSearchParams();


  // ── Extracted initial values from URL ──
  const initialSearch = searchParams.get('q') || '';
  const initialCategory = searchParams.get('category') || '';
  const initialLevel = searchParams.get('level') || '';
  const initialSort = searchParams.get('sort') || 'newest';
  const initialPage = parseInt(searchParams.get('page') || '1');
  const initialMinPrice = searchParams.get('minPrice') || '';
  const initialMaxPrice = searchParams.get('maxPrice') || '';

  // ── State ──
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [courses, setCourses] = useState<Course[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showFilters, setShowFilters] = useState(true);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    category: true,
    level: true,
    price: true,
  });
  const [pagination, setPagination] = useState({
    page: initialPage,
    limit: 12,
    total: 0,
    totalPages: 0,
  });
  const [filters, setFilters] = useState({
    categoryId: initialCategory,
    level: initialLevel,
    sortBy: initialSort,
    minPrice: initialMinPrice,
    maxPrice: initialMaxPrice,
  });

  const debouncedSearch = useDebounce(searchQuery, 400);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isFirstRender = useRef(true);

  // ── Load categories ──
  useEffect(() => {
    courseService.getCategories(true).then(setCategories).catch(console.error);
  }, []);

  // ── Sync URL params when filters/search change ──
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      // Don't update URL on first render, just load data
      loadCourses();
      return;
    }

    const params = new URLSearchParams();
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (filters.categoryId) params.set('category', filters.categoryId);
    if (filters.level) params.set('level', filters.level);
    if (filters.sortBy && filters.sortBy !== 'newest') params.set('sort', filters.sortBy);
    if (pagination.page > 1) params.set('page', pagination.page.toString());
    if (filters.minPrice) params.set('minPrice', filters.minPrice);
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);

    setSearchParams(params, { replace: true });
    loadCourses();
  }, [debouncedSearch, filters, pagination.page]);

  const loadCourses = async () => {
    setLoading(true);
    try {
      const apiFilters: CourseFilters = {
        page: pagination.page,
        limit: pagination.limit,
        search: debouncedSearch || undefined,
        categoryId: filters.categoryId || undefined,
        level: filters.level || undefined,
        sortBy: parseSortBy(filters.sortBy),
        sortOrder: parseSortOrder(filters.sortBy),
        minPrice: filters.minPrice ? parseFloat(filters.minPrice) : undefined,
        maxPrice: filters.maxPrice ? parseFloat(filters.maxPrice) : undefined,
      };

      const result = await courseService.getCourses(apiFilters);
      setCourses(result.courses);
      setPagination((prev) => ({
        ...prev,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
      }));
    } catch (error) {
      console.error('Failed to search courses:', error);
      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  const parseSortBy = (sort: string) => {
    if (sort === 'price_asc' || sort === 'price_desc') return 'price' as any;
    return sort as any;
  };

  const parseSortOrder = (sort: string): 'asc' | 'desc' | undefined => {
    if (sort === 'price_asc') return 'asc';
    if (sort === 'price_desc') return 'desc';
    return undefined;
  };

  const updateFilter = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setFilters({
      categoryId: '',
      level: '',
      sortBy: 'newest',
      minPrice: '',
      maxPrice: '',
    });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const hasActiveFilters =
    filters.categoryId ||
    filters.level ||
    filters.minPrice ||
    filters.maxPrice ||
    debouncedSearch;

  const activeFilterCount = [
    filters.categoryId,
    filters.level,
    filters.minPrice || filters.maxPrice,
    debouncedSearch,
  ].filter(Boolean).length;

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };



  const getCategoryName = (id: string) => {
    return categories.find((c) => c.id === id)?.name || '';
  };

  // ─── Render: Filter Sidebar Content ───
  const FilterContent = () => (
    <div className="space-y-1">
      {/* Active Filters Summary */}
      {hasActiveFilters && (
        <div className="bg-primary-50 border border-primary-100 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-primary-700">
              Bộ lọc đang áp dụng ({activeFilterCount})
            </span>
            <button
              onClick={clearAllFilters}
              className="text-xs text-primary-600 hover:text-primary-800 font-medium transition"
            >
              Xóa tất cả
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {debouncedSearch && (
              <FilterTag label={`"${debouncedSearch}"`} onRemove={() => setSearchQuery('')} />
            )}
            {filters.categoryId && (
              <FilterTag
                label={getCategoryName(filters.categoryId)}
                onRemove={() => updateFilter('categoryId', '')}
              />
            )}
            {filters.level && (
              <FilterTag
                label={LEVEL_OPTIONS.find((l) => l.value === filters.level)?.label || filters.level}
                onRemove={() => updateFilter('level', '')}
              />
            )}
            {(filters.minPrice || filters.maxPrice) && (
              <FilterTag
                label={`${filters.minPrice || '0'} VNĐ - ${filters.maxPrice || '∞'} VNĐ`}
                onRemove={() => {
                  updateFilter('minPrice', '');
                  updateFilter('maxPrice', '');
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Category Section */}
      <FilterSection
        title="Danh mục"
        icon={<FiBookOpen className="w-4 h-4" />}
        isExpanded={expandedSections.category}
        toggle={() => toggleSection('category')}
      >
        <div className="space-y-1">
          <button
            onClick={() => updateFilter('categoryId', '')}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
              !filters.categoryId
                ? 'bg-primary-50 text-primary-700 font-medium'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Tất cả danh mục
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => updateFilter('categoryId', cat.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 flex items-center justify-between ${
                filters.categoryId === cat.id
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>{cat.name}</span>
              {cat._count?.courses !== undefined && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    filters.categoryId === cat.id
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {cat._count.courses}
                </span>
              )}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* Level Section */}
      <FilterSection
        title="Cấp độ"
        icon={<FiTrendingUp className="w-4 h-4" />}
        isExpanded={expandedSections.level}
        toggle={() => toggleSection('level')}
      >
        <div className="space-y-1.5">
          {LEVEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateFilter('level', opt.value)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                filters.level === opt.value
                  ? opt.color || 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* Price Section */}
      <FilterSection
        title="Mức giá"
        icon={<span className="text-sm font-bold">$</span>}
        isExpanded={expandedSections.price}
        toggle={() => toggleSection('price')}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {PRICE_PRESETS.map((preset) => {
              const isActive =
                filters.minPrice === preset.min && filters.maxPrice === preset.max;
              return (
                <button
                  key={preset.label}
                  onClick={() => {
                    setFilters((prev) => ({
                      ...prev,
                      minPrice: preset.min,
                      maxPrice: preset.max,
                    }));
                    setPagination((prev) => ({ ...prev, page: 1 }));
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 ${
                    isActive
                      ? 'bg-primary-50 border-primary-300 text-primary-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-primary-200 hover:bg-primary-50/50'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Min"
              value={filters.minPrice}
              onChange={(e) => updateFilter('minPrice', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
            <span className="text-gray-400">—</span>
            <input
              type="number"
              placeholder="Max"
              value={filters.maxPrice}
              onChange={(e) => updateFilter('maxPrice', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>
        </div>
      </FilterSection>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ═══ Search Hero Area ═══ */}
      <div className="bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute inset-0">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-primary-400/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-500/5 rounded-full" />
        </div>

        <div className="relative max-w-5xl mx-auto px-4 pt-12 pb-16">
          <h1 className="text-3xl md:text-4xl font-bold text-white text-center mb-3">
            Tìm kiếm khóa học
          </h1>
          <p className="text-primary-200 text-center mb-8 text-lg">
            Khám phá hàng trăm khóa học chất lượng từ các giảng viên hàng đầu
          </p>

          {/* Search Input */}
          <div className="relative max-w-3xl mx-auto">
            <div className="relative group">
              <FiSearch className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-primary-500 transition-colors" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                placeholder="Nhập tên khóa học, từ khóa, hoặc chủ đề bạn muốn tìm..."
                className="w-full pl-14 pr-14 py-4 md:py-5 text-base md:text-lg bg-white/95 backdrop-blur-sm rounded-2xl border-2 border-transparent shadow-xl shadow-primary-900/20 focus:outline-none focus:border-primary-300 focus:bg-white focus:shadow-2xl focus:shadow-primary-900/30 transition-all duration-300 placeholder:text-gray-400"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-all"
                >
                  <FiX className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Quick category chips */}
            {categories.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mt-5">
                {categories.slice(0, 6).map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => updateFilter('categoryId', cat.id)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all duration-200 ${
                      filters.categoryId === cat.id
                        ? 'bg-white text-primary-700 border-white shadow-md'
                        : 'bg-white/10 text-white/90 border-white/20 hover:bg-white/20 hover:border-white/30'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Results Area ═══ */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Toolbar */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMobileFilters(!showMobileFilters)}
              className="md:hidden flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-primary-300 hover:bg-primary-50/50 transition-all shadow-sm"
            >
              <FiSliders className="w-4 h-4" />
              Bộ lọc
              {activeFilterCount > 0 && (
                <span className="bg-primary-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="hidden md:flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-primary-300 hover:bg-primary-50/50 transition-all shadow-sm"
            >
              <FiFilter className="w-4 h-4" />
              {showFilters ? 'Ẩn' : 'Hiện'} bộ lọc
            </button>
            <p className="text-sm text-gray-500">
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                  Đang tìm kiếm...
                </span>
              ) : (
                <>
                  Tìm thấy{' '}
                  <span className="font-semibold text-gray-900">{pagination.total}</span> khóa học
                  {debouncedSearch && (
                    <>
                      {' '}
                      cho "<span className="font-semibold text-primary-600">{debouncedSearch}</span>"
                    </>
                  )}
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Sort Dropdown */}
            <select
              value={filters.sortBy}
              onChange={(e) => updateFilter('sortBy', e.target.value)}
              className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent shadow-sm cursor-pointer"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* View Mode Toggle */}
            <div className="hidden md:flex items-center bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2.5 transition-all ${
                  viewMode === 'grid'
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                <FiGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2.5 transition-all ${
                  viewMode === 'list'
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                <FiList className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Filters Overlay */}
        {showMobileFilters && (
          <div className="md:hidden fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowMobileFilters(false)}
            />
            <div className="absolute right-0 top-0 bottom-0 w-80 bg-white shadow-2xl overflow-y-auto animate-slideIn">
              <div className="sticky top-0 bg-white z-10 px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-lg">Bộ lọc</h2>
                <button
                  onClick={() => setShowMobileFilters(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <FiX className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5">
                <FilterContent />
              </div>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="flex gap-8">
          {/* Desktop Filter Sidebar */}
          {showFilters && (
            <aside className="hidden md:block w-72 flex-shrink-0">
              <div className="sticky top-24 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 max-h-[calc(100vh-120px)] overflow-y-auto">
                <FilterContent />
              </div>
            </aside>
          )}

          {/* Course Results */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <LoadingSkeleton viewMode={viewMode} />
            ) : courses.length === 0 ? (
              <EmptyState
                search={debouncedSearch}
                hasFilters={!!hasActiveFilters}
                onClear={clearAllFilters}
              />
            ) : viewMode === 'grid' ? (
              <div
                className={`grid gap-6 ${
                  showFilters
                    ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
                    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                }`}
              >
                {courses.map((course) => (
                  <CourseGridCard key={course.id} course={course} search={debouncedSearch} />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {courses.map((course) => (
                  <CourseListCard key={course.id} course={course} search={debouncedSearch} />
                ))}
              </div>
            )}

            {/* Pagination */}
            {!loading && pagination.totalPages > 1 && (
              <div className="mt-10 flex justify-center">
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={(page) => {
                    setPagination((prev) => ({ ...prev, page }));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════
//  Sub Components
// ═══════════════════════════════════

function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-primary-200 text-primary-700 rounded-full text-xs font-medium shadow-sm">
      {label}
      <button onClick={onRemove} className="hover:text-primary-900 transition">
        <FiX className="w-3 h-3" />
      </button>
    </span>
  );
}

function FilterSection({
  title,
  icon,
  isExpanded,
  toggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  toggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-100 pb-4 mb-4 last:border-0 last:pb-0 last:mb-0">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-800 hover:text-primary-600 transition"
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        {isExpanded ? <FiChevronUp className="w-4 h-4" /> : <FiChevronDown className="w-4 h-4" />}
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ${
          isExpanded ? 'max-h-[500px] opacity-100 mt-2' : 'max-h-0 opacity-0'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function highlightText(text: string, search: string) {
  if (!search) return text;
  const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function CourseGridCard({ course, search }: { course: Course; search: string }) {
  const getLevelColor = (level: string) => {
    switch (level) {
      case 'BEGINNER':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'INTERMEDIATE':
        return 'bg-amber-50 text-amber-700 border border-amber-200';
      case 'ADVANCED':
        return 'bg-rose-50 text-rose-700 border border-rose-200';
      default:
        return 'bg-gray-50 text-gray-700';
    }
  };

  return (
    <Link to={`/courses/${course.slug}`} className="group block">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-lg hover:border-primary-100 hover:-translate-y-1 transition-all duration-300">
        {/* Thumbnail */}
        <div className="relative h-44 bg-gradient-to-br from-primary-100 to-primary-50 overflow-hidden">
          {course.thumbnail ? (
            <img
              src={course.thumbnail}
              alt={course.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FiBookOpen className="w-12 h-12 text-primary-300" />
            </div>
          )}
          {/* Price Badge */}
          <div className="absolute top-3 right-3">
            <span className="bg-white/95 backdrop-blur-sm text-primary-700 font-bold px-3 py-1.5 rounded-full text-sm shadow-lg">
              {course.price === 0 ? 'Miễn phí' : formatVND(course.price)}
            </span>
          </div>
          {!course.published && (
            <span className="absolute top-3 left-3 bg-amber-500 text-white text-xs px-2.5 py-1 rounded-full font-medium">
              Bản nháp
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getLevelColor(course.level)}`}>
              {course.level === 'BEGINNER'
                ? 'Người mới'
                : course.level === 'INTERMEDIATE'
                ? 'Trung cấp'
                : 'Nâng cao'}
            </span>
            {course.category && (
              <span className="text-xs text-gray-500 bg-gray-50 px-2.5 py-1 rounded-full">
                {course.category.name}
              </span>
            )}
          </div>

          <h3 className="font-semibold text-gray-900 line-clamp-2 group-hover:text-primary-600 transition-colors mb-2 leading-snug">
            {highlightText(course.title, search)}
          </h3>

          <p className="text-sm text-gray-500 line-clamp-2 mb-4 leading-relaxed">
            {highlightText(course.description, search)}
          </p>

          <div className="flex items-center justify-between text-sm pt-3 border-t border-gray-50">
            <div className="flex items-center gap-1 text-amber-500">
              <FiStar className="w-4 h-4 fill-current" />
              <span className="font-semibold text-gray-700">{course.rating.toFixed(1)}</span>
              <span className="text-gray-400 text-xs">({course.totalReviews})</span>
            </div>
            <div className="flex items-center gap-1 text-gray-400">
              <FiUsers className="w-4 h-4" />
              <span className="text-xs">{course.enrolledCount}</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function CourseListCard({ course, search }: { course: Course; search: string }) {
  const getLevelColor = (level: string) => {
    switch (level) {
      case 'BEGINNER':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'INTERMEDIATE':
        return 'bg-amber-50 text-amber-700 border border-amber-200';
      case 'ADVANCED':
        return 'bg-rose-50 text-rose-700 border border-rose-200';
      default:
        return 'bg-gray-50 text-gray-700';
    }
  };

  return (
    <Link to={`/courses/${course.slug}`} className="group block">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-lg hover:border-primary-100 transition-all duration-300 flex">
        {/* Thumbnail */}
        <div className="relative w-64 flex-shrink-0 bg-gradient-to-br from-primary-100 to-primary-50">
          {course.thumbnail ? (
            <img
              src={course.thumbnail}
              alt={course.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center min-h-[180px]">
              <FiBookOpen className="w-12 h-12 text-primary-300" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getLevelColor(course.level)}`}>
                {course.level === 'BEGINNER'
                  ? 'Người mới'
                  : course.level === 'INTERMEDIATE'
                  ? 'Trung cấp'
                  : 'Nâng cao'}
              </span>
              {course.category && (
                <span className="text-xs text-gray-500 bg-gray-50 px-2.5 py-1 rounded-full">
                  {course.category.name}
                </span>
              )}
            </div>

            <h3 className="font-semibold text-lg text-gray-900 group-hover:text-primary-600 transition-colors mb-2">
              {highlightText(course.title, search)}
            </h3>

            <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed">
              {highlightText(course.description, search)}
            </p>
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-50">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 text-amber-500">
                <FiStar className="w-4 h-4 fill-current" />
                <span className="font-semibold text-gray-700">{course.rating.toFixed(1)}</span>
                <span className="text-gray-400 text-xs">({course.totalReviews} đánh giá)</span>
              </div>
              <div className="flex items-center gap-1 text-gray-400">
                <FiUsers className="w-4 h-4" />
                <span className="text-sm">{course.enrolledCount} học viên</span>
              </div>
            </div>
            <span className="text-xl font-bold text-primary-600">
              {course.price === 0 ? 'Miễn phí' : formatVND(course.price)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({
  search,
  hasFilters,
  onClear,
}: {
  search: string;
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="text-center py-20">
      <div className="w-24 h-24 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-6">
        <FiSearch className="w-10 h-10 text-primary-300" />
      </div>
      <h3 className="text-xl font-semibold text-gray-900 mb-2">Không tìm thấy khóa học</h3>
      <p className="text-gray-500 max-w-md mx-auto mb-6">
        {search
          ? `Không có khóa học nào phù hợp với từ khóa "${search}". Hãy thử tìm kiếm với từ khóa khác.`
          : 'Không có khóa học nào phù hợp với bộ lọc hiện tại.'}
      </p>
      {hasFilters && (
        <button onClick={onClear} className="btn-primary inline-flex items-center gap-2">
          <FiX className="w-4 h-4" />
          Xóa bộ lọc
        </button>
      )}
    </div>
  );
}

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'list') {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex animate-pulse">
            <div className="w-64 bg-gray-200" />
            <div className="flex-1 p-6 space-y-3">
              <div className="flex gap-2">
                <div className="w-16 h-6 bg-gray-200 rounded-full" />
                <div className="w-20 h-6 bg-gray-200 rounded-full" />
              </div>
              <div className="h-5 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-200 rounded w-full" />
              <div className="h-4 bg-gray-200 rounded w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse">
          <div className="h-44 bg-gray-200" />
          <div className="p-5 space-y-3">
            <div className="flex gap-2">
              <div className="w-16 h-6 bg-gray-200 rounded-full" />
              <div className="w-20 h-6 bg-gray-200 rounded-full" />
            </div>
            <div className="h-5 bg-gray-200 rounded w-3/4" />
            <div className="h-4 bg-gray-200 rounded w-full" />
            <div className="flex justify-between mt-4 pt-3 border-t border-gray-50">
              <div className="w-20 h-4 bg-gray-200 rounded" />
              <div className="w-16 h-4 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const getVisiblePages = () => {
    const delta = 2;
    const range: (number | '...')[] = [];

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
        range.push(i);
      } else if (range[range.length - 1] !== '...') {
        range.push('...');
      }
    }

    return range;
  };

  return (
    <nav className="inline-flex items-center gap-1 bg-white rounded-2xl shadow-sm border border-gray-100 p-1.5">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="p-2.5 rounded-xl text-gray-500 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <FiArrowLeft className="w-4 h-4" />
      </button>

      {getVisiblePages().map((p, idx) =>
        p === '...' ? (
          <span key={`dots-${idx}`} className="px-2 text-gray-400">
            ···
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p as number)}
            className={`min-w-[40px] h-10 rounded-xl text-sm font-medium transition-all ${
              page === p
                ? 'bg-primary-600 text-white shadow-md shadow-primary-600/30'
                : 'text-gray-600 hover:bg-primary-50 hover:text-primary-600'
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="p-2.5 rounded-xl text-gray-500 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <FiArrowRight className="w-4 h-4" />
      </button>
    </nav>
  );
}
