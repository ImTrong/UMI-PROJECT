import { useState, useEffect } from 'react';
import { FiSearch, FiFilter, FiX } from 'react-icons/fi';
import { PathFilters } from '../../services/recommendation.service';

interface Props {
  categories: string[];
  filters: PathFilters;
  onChange: (filters: PathFilters) => void;
}

const difficultyOptions = [
  { value: '', label: 'Tất cả cấp độ' },
  { value: 'BEGINNER', label: '🌱 Cơ bản' },
  { value: 'INTERMEDIATE', label: '⚡ Trung cấp' },
  { value: 'ADVANCED', label: '🔥 Nâng cao' },
  { value: 'ALL', label: 'Đa cấp độ' },
];

export default function PathFilterBar({ categories, filters, onChange }: Props) {
  const [searchInput, setSearchInput] = useState(filters.search || '');
  const [showFilters, setShowFilters] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (filters.search || '')) {
        onChange({ ...filters, search: searchInput || undefined });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const hasActiveFilters = 
    (filters.categories && filters.categories.length > 0) || 
    (filters.difficulties && filters.difficulties.length > 0) || 
    filters.search || 
    (filters.sortBy && filters.sortBy !== 'newest');

  const clearAll = () => {
    setSearchInput('');
    onChange({});
  };

  const toggleCategory = (cat: string) => {
    const current = filters.categories || [];
    const newCategories = current.includes(cat)
      ? current.filter(c => c !== cat)
      : [...current, cat];
    onChange({ ...filters, categories: newCategories });
  };

  const toggleDifficulty = (diff: string) => {
    const current = filters.difficulties || [];
    const newDifficulties = current.includes(diff)
      ? current.filter(d => d !== diff)
      : [...current, diff];
    onChange({ ...filters, difficulties: newDifficulties });
  };

  return (
    <div className="space-y-3">
      {/* Search + Toggle */}
      <div className="flex items-center gap-3">
        {/* Search Bar */}
        <div className="relative flex-1">
          <FiSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm kiếm lộ trình..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); onChange({ ...filters, search: undefined }); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <FiX className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Sort Dropdown */}
        <div className="hidden sm:block">
          <select
            value={filters.sortBy || 'newest'}
            onChange={(e) => onChange({ ...filters, sortBy: e.target.value as any })}
            className="px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm font-medium text-slate-600 focus:outline-none focus:border-emerald-400 cursor-pointer"
          >
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
            <option value="name_asc">Tên A-Z</option>
            <option value="name_desc">Tên Z-A</option>
          </select>
        </div>

        {/* Filter Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all cursor-pointer ${
            showFilters || hasActiveFilters
              ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
              : 'bg-white border-slate-100 text-slate-600 hover:border-emerald-200'
          }`}
        >
          <FiFilter className="w-4 h-4" />
          Bộ lọc
          {hasActiveFilters && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </button>

        {/* Clear All */}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="text-xs font-bold text-slate-500 hover:text-rose-500 transition-colors cursor-pointer whitespace-nowrap"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      {/* Expandable Filters */}
      {showFilters && (
        <div className="flex flex-col gap-5 p-5 bg-white border border-slate-100 rounded-2xl animate-in fade-in duration-200 shadow-sm">
          
          {/* Mobile Sort */}
          <div className="sm:hidden block">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Sắp xếp theo
            </label>
            <select
              value={filters.sortBy || 'newest'}
              onChange={(e) => onChange({ ...filters, sortBy: e.target.value as any })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
              <option value="name_asc">Tên A-Z</option>
              <option value="name_desc">Tên Z-A</option>
            </select>
          </div>

          {/* Category Filter */}
          {categories.length > 0 && (
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
                Danh mục
              </label>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const isSelected = (filters.categories || []).includes(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Difficulty Filter */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
              Cấp độ
            </label>
            <div className="flex flex-wrap gap-2">
              {difficultyOptions.filter(opt => opt.value !== '').map((opt) => {
                const isSelected = (filters.difficulties || []).includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleDifficulty(opt.value)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
