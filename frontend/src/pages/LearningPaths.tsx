import { useState, useEffect, useCallback } from 'react';
import {
  recommendationService,
  LearningPath,
  PathDetailResponse,
  LearningInsights,
  EnrolledPathSummary,
  PathFilters,
} from '../services/recommendation.service';
import { FiMap, FiArrowRight, FiBookOpen, FiAward, FiCompass, FiTarget, FiArrowLeft, FiLogOut, FiZap, FiClock, FiStar } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { Link, useLocation } from 'react-router-dom';
import LearningPathCard from '../components/learning/LearningPathCard';
import SkillsChart from '../components/learning/SkillsChart';

import PathFilterBar from '../components/learning/PathFilterBar';
import MilestoneTimeline from '../components/learning/MilestoneTimeline';
import PathCompletionCelebration from '../components/learning/PathCompletionCelebration';
import PathSummaryCard from '../components/learning/PathSummaryCard';
import { aiService } from '../services/ai.service';
import AIPathRecommendations from '../components/learning/AIPathRecommendations';

type ViewMode = 'dashboard' | 'path-detail';

export default function LearningPaths() {
  // Dashboard data
  const [enrolledPaths, setEnrolledPaths] = useState<EnrolledPathSummary[]>([]);
  const [insights, setInsights] = useState<LearningInsights | null>(null);

  const [allPaths, setAllPaths] = useState<LearningPath[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [filters, setFilters] = useState<PathFilters>({});
  const [aiRecommendations, setAiRecommendations] = useState<any[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  // Path detail data
  const [selectedPath, setSelectedPath] = useState<LearningPath | null>(null);
  const [detail, setDetail] = useState<PathDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [unenrolling, setUnenrolling] = useState(false);

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [loading, setLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState(false);

  const location = useLocation();

  useEffect(() => {
    loadDashboardData().then(() => {
      // Check if navigated from Career Advisor with a specific path
      if (location.state?.selectedPathId) {
        handleSelectPath(location.state.selectedPathId);
        // Clear state so it doesn't reopen if user goes back
        window.history.replaceState({}, document.title);
      }
    });
    loadAIRecommendations();
  }, [location.state?.selectedPathId]);

  // Reload paths when filters change
  useEffect(() => {
    loadFilteredPaths();
  }, [filters]);

  // Auto-refresh when returning to this page (e.g., from learning page)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && viewMode === 'dashboard') {
        loadDashboardData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [viewMode]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [pathsData, enrolledData, insightsData, categoriesData] = await Promise.all([
        recommendationService.getLearningPaths().catch(() => []),
        recommendationService.getMyEnrolledPaths().catch(() => []),
        recommendationService.getLearningInsights().catch(() => null),

        recommendationService.getPathCategories().catch(() => []),
      ]);

      setAllPaths(pathsData);
      setEnrolledPaths(enrolledData);
      setInsights(insightsData);

      setCategories(categoriesData);
    } catch {
      toast.error('Không thể tải dữ liệu lộ trình học tập');
    } finally {
      setLoading(false);
    }
  };

  const loadAIRecommendations = async () => {
    try {
      setAiLoading(true);
      const data = await aiService.getRecommendedPaths();
      setAiRecommendations(data);
    } catch (err: any) {
      console.error('Failed to load AI recommendations:', err.response?.data || err.message);
      // silently fail, AI might be down or user has no paths
    } finally {
      setAiLoading(false);
    }
  };

  const loadFilteredPaths = async () => {
    const hasCategory = filters.categories && filters.categories.length > 0;
    const hasDifficulty = filters.difficulties && filters.difficulties.length > 0;
    const hasSort = filters.sortBy && filters.sortBy !== 'newest';
    if (!hasCategory && !hasDifficulty && !filters.search && !hasSort) return;
    
    try {
      const pathsData = await recommendationService.getLearningPaths(filters);
      setAllPaths(pathsData);
    } catch {
      // silently fail, keep existing data
    }
  };

  const loadPathDetail = useCallback(async (pathId: string) => {
    try {
      setDetailLoading(true);
      const data = await recommendationService.getLearningPathDetail(pathId);
      setDetail(data);

      // Check if path was just completed (show celebration)
      if (data.enrollment?.status === 'COMPLETED' && data.progress.progressPercentage >= 100) {
        // Only celebrate if we haven't before (check enrollment completedAt is recent)
        const completedAt = data.enrollment.completedAt ? new Date(data.enrollment.completedAt) : null;
        if (completedAt) {
          const minutesSinceCompletion = (Date.now() - completedAt.getTime()) / (1000 * 60);
          if (minutesSinceCompletion < 5) {
            setShowCelebration(true);
          }
        }
      }
    } catch {
      toast.error('Không thể tải chi tiết lộ trình học tập');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleSelectPath = async (pathId: string) => {
    const path = allPaths.find((p) => p.id === pathId);
    if (path) {
      setSelectedPath(path);
      setViewMode('path-detail');
      loadPathDetail(pathId);
    } else {
      setViewMode('path-detail');
      setDetailLoading(true);
      try {
        const data = await recommendationService.getLearningPathDetail(pathId);
        setSelectedPath(data.path);
        setDetail(data);
      } catch {
        toast.error('Không thể tải chi tiết lộ trình học tập');
      } finally {
        setDetailLoading(false);
      }
    }
  };



  const handleEnroll = async () => {
    if (!selectedPath) return;
    try {
      setEnrolling(true);
      const res = await recommendationService.enrollInPath(selectedPath.id);
      
      if (res?.status === 'COMPLETED') {
        setShowCelebration(true);
        toast.success(`Đăng ký thành công! Bạn đã hoàn thành tất cả khóa học trong lộ trình!`);
      } else {
        toast.success(`Đăng ký lộ trình "${selectedPath.title}" thành công!`);
      }

      loadPathDetail(selectedPath.id);
      // Refresh enrolled paths
      const enrolled = await recommendationService.getMyEnrolledPaths().catch(() => []);
      setEnrolledPaths(enrolled);
    } catch {
      toast.error('Đăng ký lộ trình thất bại');
    } finally {
      setEnrolling(false);
    }
  };

  const handleUnenroll = async () => {
    if (!selectedPath) return;
    try {
      setUnenrolling(true);
      await recommendationService.unenrollFromPath(selectedPath.id);
      toast.success(`Đã hủy đăng ký lộ trình "${selectedPath.title}"`);
      loadPathDetail(selectedPath.id);
      // Refresh enrolled paths
      const enrolled = await recommendationService.getMyEnrolledPaths().catch(() => []);
      setEnrolledPaths(enrolled);
    } catch {
      toast.error('Hủy đăng ký lộ trình thất bại');
    } finally {
      setUnenrolling(false);
    }
  };

  const handleBackToDashboard = () => {
    setViewMode('dashboard');
    setSelectedPath(null);
    setDetail(null);
    loadDashboardData(); // Refresh data when going back
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  // Paths user has NOT enrolled in
  const unenrolledPaths = allPaths.filter(
    (p) => !enrolledPaths.find((ep) => ep.pathId === p.id)
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 select-none font-sans min-h-screen bg-slate-50/50">
      {viewMode === 'dashboard' ? (
        <DashboardView
          enrolledPaths={enrolledPaths}
          unenrolledPaths={unenrolledPaths}
          insights={insights}
          categories={categories}
          filters={filters}
          onFiltersChange={setFilters}
          onSelectPath={handleSelectPath}
          aiRecommendations={aiRecommendations}
          aiLoading={aiLoading}
        />
      ) : (
        <PathDetailView
          selectedPath={selectedPath}
          detail={detail}
          detailLoading={detailLoading}
          enrolling={enrolling}
          unenrolling={unenrolling}
          allPaths={allPaths}
          onBack={handleBackToDashboard}
          onSelectPath={(p) => {
            setSelectedPath(p);
            loadPathDetail(p.id);
          }}
          onEnroll={handleEnroll}
          onUnenroll={handleUnenroll}
          onShowCelebration={() => setShowCelebration(true)}
        />
      )}

      {/* Celebration Modal */}
        <PathCompletionCelebration
          isOpen={showCelebration}
          pathId={selectedPath?.id || ''}
          pathTitle={selectedPath?.title || ''}
          onClose={() => setShowCelebration(false)}
        />
    </div>
  );
}

/* ============================================================================
   DASHBOARD VIEW — Main hub showing enrolled paths, insights, actions
   ============================================================================ */

interface DashboardViewProps {
  enrolledPaths: EnrolledPathSummary[];
  unenrolledPaths: LearningPath[];
  insights: LearningInsights | null;

  categories: string[];
  filters: PathFilters;
  onFiltersChange: (filters: PathFilters) => void;
  onSelectPath: (pathId: string) => void;

  aiRecommendations: any[];
  aiLoading: boolean;
}

function DashboardView({
  enrolledPaths, unenrolledPaths, insights,
  categories, filters, onFiltersChange, onSelectPath,
  aiRecommendations, aiLoading
}: DashboardViewProps) {
  return (
    <>
      {/* Hero Banner */}
      <div className="relative bg-gradient-to-br from-emerald-600 via-teal-600 to-teal-700 rounded-3xl p-8 md:p-10 text-white mb-8 overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute -left-8 -bottom-8 w-32 h-32 bg-emerald-400/20 rounded-full blur-2xl" />
        <div className="absolute right-8 bottom-8 w-20 h-20 bg-teal-300/10 rounded-full blur-xl" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight flex items-center gap-3">
              <FiMap className="w-8 h-8 animate-pulse" />
              Lộ trình học tập của bạn
            </h1>
            <p className="text-emerald-100 mt-2 max-w-xl text-sm leading-relaxed">
              Theo dõi tiến độ, khám phá kỹ năng và nhận gợi ý cá nhân hóa để đạt mục tiêu sự nghiệp nhanh hơn.
            </p>
          </div>

          {/* Quick Stats */}
          {insights && (
            <div className="flex gap-4 md:gap-6">
              <div className="text-center">
                <p className="text-3xl font-black">{insights.totalStats.totalCourses}</p>
                <p className="text-[11px] text-emerald-200 font-semibold mt-0.5">Khóa học</p>
              </div>
              <div className="w-px bg-white/20" />
              <div className="text-center">
                <p className="text-3xl font-black">{insights.totalStats.completedCourses}</p>
                <p className="text-[11px] text-emerald-200 font-semibold mt-0.5">Hoàn thành</p>
              </div>
              <div className="w-px bg-white/20" />
              <div className="text-center">
                <p className="text-3xl font-black">{insights.totalStats.totalHours}</p>
                <p className="text-[11px] text-emerald-200 font-semibold mt-0.5">Giờ học</p>
              </div>
              <div className="w-px bg-white/20" />
              <div className="text-center">
                <p className="text-3xl font-black">{insights.totalStats.activePaths}</p>
                <p className="text-[11px] text-emerald-200 font-semibold mt-0.5">Lộ trình</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Career Path Advisor Banner */}
      <div className="mb-8 bg-gradient-to-r from-indigo-900 via-purple-900 to-indigo-900 rounded-3xl p-6 md:p-8 text-white relative overflow-hidden shadow-lg border border-indigo-500/30">
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl -mr-20 -mt-20"></div>
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/20">
              <FiZap className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-bold mb-1.5 flex items-center gap-2">
                AI Gợi Ý Lộ Trình Học Tập <span className="bg-gradient-to-r from-yellow-400 to-amber-500 text-transparent bg-clip-text text-sm font-black uppercase tracking-wider">Mới</span>
              </h2>
              <p className="text-indigo-200 text-sm md:text-base max-w-xl">
                Bạn muốn trở thành chuyên gia trong lĩnh vực nào? Hãy để AI phân tích năng lực và xây dựng lộ trình học tập cá nhân hóa cho riêng bạn.
              </p>
            </div>
          </div>
          <Link
            to="/career-advisor"
            className="flex-shrink-0 inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white font-bold rounded-xl transition-all duration-300 shadow-[0_0_20px_rgba(168,85,247,0.3)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)] active:scale-95"
          >
            Tìm Lộ Trình Ngay <FiArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column — Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Enrolled Paths */}
          {enrolledPaths.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4">
                <FiTarget className="text-emerald-600" />
                Lộ trình đang theo đuổi
                <span className="text-xs bg-emerald-100 text-emerald-600 font-bold px-2 py-0.5 rounded-full">
                  {enrolledPaths.length}
                </span>
              </h2>
              <div className="grid gap-4">
                {enrolledPaths.map((path) => (
                  <LearningPathCard
                    key={path.pathId}
                    path={path}
                    onSelect={onSelectPath}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Smart Actions (Removed as requested) */}

          {/* AI Recommended Paths */}
          <AIPathRecommendations 
            paths={aiRecommendations} 
            loading={aiLoading} 
            onSelectPath={onSelectPath} 
          />

          {/* Filter Bar for Explore Section */}
          {(unenrolledPaths.length > 0 || filters.search || (filters.categories && filters.categories.length > 0) || (filters.difficulties && filters.difficulties.length > 0) || (filters.sortBy && filters.sortBy !== 'newest')) && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4">
                <FiCompass className="text-teal-600" />
                Khám phá lộ trình mới
              </h2>

              <PathFilterBar
                categories={categories}
                filters={filters}
                onChange={onFiltersChange}
              />

              {unenrolledPaths.length > 0 ? (
                <div className="grid sm:grid-cols-2 gap-4 mt-4">
                  {unenrolledPaths.map((path) => (
                    <button
                      key={path.id}
                      onClick={() => onSelectPath(path.id)}
                      className="text-left flex flex-col h-full bg-white rounded-2xl border border-slate-100 p-5 hover:border-emerald-200 hover:shadow-md transition-all duration-300 group cursor-pointer overflow-hidden relative"
                    >
                      {/* Status Badge (if any) */}
                      {path.recommended && (
                        <div className="absolute top-3 left-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm z-10">
                          Đề xuất
                        </div>
                      )}

                      {/* Path Image */}
                      {path.imageUrl ? (
                        <div className="w-full h-32 rounded-xl overflow-hidden mb-4 bg-slate-100 flex-shrink-0 relative">
                          <img
                            src={path.imageUrl}
                            alt={path.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <div className="w-full h-32 rounded-xl mb-4 bg-gradient-to-br from-slate-100 to-emerald-50 flex items-center justify-center flex-shrink-0">
                          <FiMap className="w-10 h-10 text-emerald-200" />
                        </div>
                      )}

                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-bold text-[15px] text-slate-900 group-hover:text-emerald-600 transition-colors leading-snug pr-2 line-clamp-2">
                          {path.title}
                        </h4>
                        <FiArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all flex-shrink-0 mt-0.5" />
                      </div>
                      
                      <p className="text-[13px] text-slate-500 line-clamp-2 leading-relaxed mb-4 flex-grow">
                        {path.shortDescription || path.description.replace(/<[^>]+>/g, '')}
                      </p>
                      
                      {/* Meta Info */}
                      <div className="flex items-center gap-4 mb-4 text-xs font-semibold text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <FiBookOpen className="w-3.5 h-3.5 text-emerald-500" />
                          {path.courseIds?.length || 0} khóa học
                        </span>
                        <span className="flex items-center gap-1.5">
                          <FiClock className="w-3.5 h-3.5 text-blue-500" />
                          {Math.round((path.totalDurationMinutes || 0) / 60)} giờ
                        </span>
                        <span className="flex items-center gap-1.5">
                          <FiTarget className="w-3.5 h-3.5 text-rose-500" />
                          {path.enrollmentCount || 0} học viên
                        </span>
                      </div>

                      <div className="flex gap-2 flex-wrap mt-auto pt-4 border-t border-slate-100/60 w-full">
                        {path.category && (
                          <span className="text-[11px] px-2.5 py-1 rounded-md font-bold bg-emerald-50 text-emerald-700">
                            {path.category}
                          </span>
                        )}
                        {path.difficulty && path.difficulty !== 'ALL' && (
                          <span className={`text-[11px] px-2.5 py-1 rounded-md font-bold ${
                            path.difficulty === 'BEGINNER' ? 'bg-emerald-50 text-emerald-600' :
                            path.difficulty === 'INTERMEDIATE' ? 'bg-amber-50 text-amber-600' :
                            'bg-rose-50 text-rose-600'
                          }`}>
                            {path.difficulty === 'BEGINNER' ? 'Cơ bản' : path.difficulty === 'INTERMEDIATE' ? 'Trung cấp' : 'Nâng cao'}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-sm font-medium">Không tìm thấy lộ trình phù hợp với bộ lọc</p>
                </div>
              )}
            </section>
          )}

          {/* Empty state — no paths at all */}
          {enrolledPaths.length === 0 && unenrolledPaths.length === 0 && !filters.search && !(filters.categories && filters.categories.length > 0) && (
            <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
              <FiMap className="w-12 h-12 text-emerald-200 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">Chưa có lộ trình nào</h3>
              <p className="text-sm text-slate-500 mb-6">
                Hệ thống chưa có lộ trình học tập nào. Hãy khám phá các khóa học có sẵn!
              </p>
              <Link
                to="/courses"
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-sm rounded-xl shadow-sm hover:shadow-sm transition"
              >
                Khám phá khóa học <FiArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>

        {/* Right Column — Sidebar Analytics */}
        <div className="space-y-6">
          {insights && (
            <SkillsChart
              skillStrengths={insights.skillStrengths}
              categoryDistribution={insights.categoryDistribution}
              weeklyProgress={insights.weeklyProgress}
            />
          )}

          {/* Focus Areas */}
          {insights && insights.suggestedFocusAreas.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <h4 className="text-sm font-bold text-slate-900 mb-3"><FiZap className="inline mr-1" /> Lĩnh vực cần tập trung</h4>
              <div className="space-y-2.5">
                {insights.suggestedFocusAreas.map((area, idx) => (
                  <div key={idx} className="p-3 bg-amber-50/50 border border-amber-100/50 rounded-xl">
                    <p className="text-xs font-bold text-amber-700">{area.category}</p>
                    <p className="text-[11px] text-amber-600 mt-0.5 leading-relaxed">{area.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ============================================================================
   PATH DETAIL VIEW — Subway map milestones with enriched data
   ============================================================================ */

interface PathDetailViewProps {
  selectedPath: LearningPath | null;
  detail: PathDetailResponse | null;
  detailLoading: boolean;
  enrolling: boolean;
  unenrolling: boolean;
  allPaths: LearningPath[];
  onBack: () => void;
  onSelectPath: (path: LearningPath) => void;
  onEnroll: () => void;
  onUnenroll: () => void;
  onShowCelebration: () => void;
}

function PathDetailView({
  selectedPath,
  detail,
  detailLoading,
  enrolling,
  unenrolling,
  allPaths,
  onBack,
  onSelectPath,
  onEnroll,
  onUnenroll,
  onShowCelebration,
}: PathDetailViewProps) {
  return (
    <>
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-emerald-600 transition-colors mb-6 cursor-pointer group"
      >
        <FiArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Quay lại Dashboard
      </button>

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Left Side: Path Selection & Info */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
            <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <FiBookOpen className="text-emerald-600" /> Chọn Lộ Trình
            </h3>
            
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
              {allPaths.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelectPath(p)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 cursor-pointer ${
                    selectedPath?.id === p.id
                      ? 'border-emerald-600 bg-emerald-50/40 shadow-sm ring-1 ring-emerald-500/20'
                      : 'border-slate-100 bg-white hover:bg-slate-50'
                  }`}
                >
                  <p className={`font-bold text-sm ${selectedPath?.id === p.id ? 'text-emerald-700' : 'text-slate-900'}`}>
                    {p.title}
                  </p>
                  <div className="flex gap-2.5 mt-2">
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-100/50 text-emerald-700">
                      📂 {p.category || 'Công nghệ'}
                    </span>
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600">
                      ⚡ {p.courseIds.length} Chặng
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedPath && (
            <div className="bg-gradient-to-br from-slate-900 to-emerald-950 rounded-3xl p-6 text-white shadow-sm relative overflow-hidden">
              <div className="absolute -right-16 -top-16 w-36 h-36 bg-emerald-500/20 rounded-full blur-2xl" />

              {/* Path Image */}
              {(selectedPath.bannerUrl || selectedPath.imageUrl) && (
                <div className="w-full h-40 rounded-2xl overflow-hidden mb-4 border border-white/10">
                  <img
                    src={selectedPath.bannerUrl || selectedPath.imageUrl}
                    alt={selectedPath.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              )}

              {selectedPath.careerGoal && (
                <div className="inline-block px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold rounded-lg mb-3">
                  🎯 Mục tiêu: {selectedPath.careerGoal}
                </div>
              )}

              <h3 className="font-extrabold text-xl mb-3 leading-snug relative z-10">{selectedPath.title}</h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-6 font-medium relative z-10">
                {selectedPath.description.replace(/<[^>]+>/g, '')}
              </p>

              {/* Skills */}
              {selectedPath.skills && selectedPath.skills.length > 0 && (
                <div className="mb-6 relative z-10">
                  <h4 className="text-xs font-bold text-emerald-200 mb-2">Kỹ năng đạt được:</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedPath.skills.map((skill, idx) => (
                      <span key={idx} className="bg-white/10 border border-white/10 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-200">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail && (
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/5 space-y-4 relative z-10">
                  <div>
                    <div className="flex justify-between items-center text-xs text-emerald-200 mb-1.5 font-bold">
                      <span>Tiến độ lộ trình</span>
                      <span>{Math.round(detail.progress.progressPercentage)}% hoàn thành</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 transition-all duration-500 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                        style={{ width: `${detail.progress.progressPercentage}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                    <span>Trạng thái:</span>
                    <span>
                      {detail.enrollment
                        ? detail.enrollment.status === 'COMPLETED'
                          ? '🎉 Đã tốt nghiệp'
                          : '🚀 Đang theo đuổi'
                        : 'Chưa đăng ký'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                    <span>Chặng đường:</span>
                    <span>{detail.progress.completedCourses}/{detail.progress.totalCourses} hoàn thành</span>
                  </div>

                  {/* Enrollment actions */}
                  {!detail.enrollment ? (
                    <button
                      onClick={onEnroll}
                      disabled={enrolling}
                      className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl text-xs shadow-sm transition duration-200 active:scale-[0.98] cursor-pointer disabled:opacity-60"
                    >
                      {enrolling ? 'Đang đăng ký...' : 'Đăng Ký Theo Dõi Lộ Trình'}
                    </button>
                  ) : detail.enrollment.status === 'COMPLETED' ? (
                    <button
                      onClick={onShowCelebration}
                      className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold border border-amber-500/20 shadow-sm transition duration-200 active:scale-[0.98] cursor-pointer"
                    >
                      🏆 Nhận Chứng Chỉ Lộ Trình
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-full py-2.5 text-center bg-emerald-500/20 text-emerald-300 rounded-xl text-xs font-bold border border-emerald-500/20">
                        ✓ Đã đăng ký theo dõi lộ trình
                      </div>
                      <button
                        onClick={onUnenroll}
                        disabled={unenrolling}
                        className="w-full py-2.5 bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-400/30 text-slate-400 hover:text-rose-300 font-bold rounded-xl text-xs transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-60"
                      >
                        <FiLogOut className="w-3 h-3" />
                        {unenrolling ? 'Đang hủy...' : 'Hủy đăng ký lộ trình'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Path Summary Card */}
          {detail && detail.summary && (
            <PathSummaryCard
              summary={detail.summary}
              difficulty={selectedPath?.difficulty || 'ALL'}
              category={selectedPath?.category}
            />
          )}
        </div>

        {/* Right Side: Milestone Timeline */}
        <div className="lg:col-span-8 bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8">
          <h3 className="text-lg font-bold text-slate-900 mb-8 flex items-center gap-2">
            <FiAward className="text-emerald-500" /> Sơ đồ chặng đường học tập (Milestones)
          </h3>

          <MilestoneTimeline
            milestones={detail?.milestones || []}
            isLoading={detailLoading}
          />

          {/* Final Project Preview */}
          {!detailLoading && detail?.finalProject && (
            <div className="mt-8 pt-8 border-t border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                <FiStar className="text-amber-500" /> Project Cuối Kỳ
              </h3>
              
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute right-0 top-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row gap-6 items-start">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 text-white shadow-sm">
                    <FiAward size={32} />
                  </div>
                  
                  <div className="flex-1">
                    <h4 className="text-xl font-bold text-slate-900 mb-2">{detail.finalProject.title}</h4>
                    <p className="text-sm text-slate-600 mb-4">{detail.finalProject.description}</p>
                    
                    <div className="flex flex-wrap gap-3 mb-6">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white rounded-lg border border-indigo-100 text-xs font-semibold text-indigo-700">
                        <FiTarget /> Ngưỡng qua môn: {detail.finalProject.passingScore}%
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white rounded-lg border border-indigo-100 text-xs font-semibold text-indigo-700">
                        <FiClock /> Số lần nộp: {detail.finalProject.maxAttempts}
                      </span>
                    </div>

                    <Link
                      to={`/learning-paths/${detail.path.id}/final-project`}
                      className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold rounded-xl shadow-sm transition-all duration-300 active:scale-95 text-sm"
                    >
                      Xem chi tiết & Làm bài <FiArrowRight />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
