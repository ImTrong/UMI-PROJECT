import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiTarget, FiClock, FiAward, FiCheckCircle, FiArrowRight,
  FiZap, FiTrendingUp, FiBookOpen, FiStar, FiChevronRight,
  FiRefreshCw, FiMapPin, FiMoon, FiSun
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { aiService, CareerPathRecommendation, CareerPathCourse } from '../services/ai.service';

// ==================== Quick Suggestion Chips ====================
const CAREER_SUGGESTIONS = [
  { label: 'Backend Developer', icon: '🖥️' },
  { label: 'Fullstack Developer', icon: '🌐' },
  { label: 'Frontend React Developer', icon: '⚛️' },
  { label: 'DevOps Engineer', icon: '🔧' },
  { label: 'Data Scientist', icon: '📊' },
  { label: 'Mobile App Developer', icon: '📱' },
  { label: 'Kỹ sư Hệ thống', icon: '⚙️' },
  { label: 'UI/UX Designer', icon: '🎨' },
];

// ==================== Circular Progress Component ====================
function CircularProgress({ score, size = 80, strokeWidth = 6 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} className="stroke-slate-200 dark:stroke-gray-800" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <span className="absolute text-lg font-bold dark:text-white text-slate-800" style={{ color }}>{score}%</span>
    </div>
  );
}

// ==================== Skeleton Loading ====================
function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-8 max-w-4xl mx-auto">
      {/* Header skeleton */}
      <div className="bg-white/60 dark:bg-gray-800/60 rounded-2xl p-8 backdrop-blur-sm border border-slate-200/50 dark:border-gray-700/50">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-20 h-20 rounded-full bg-slate-200 dark:bg-gray-700/80" />
          <div className="space-y-3 flex-1">
            <div className="h-6 w-64 bg-slate-200 dark:bg-gray-700/80 rounded-lg" />
            <div className="h-4 w-96 bg-slate-200/60 dark:bg-gray-700/60 rounded-lg" />
          </div>
        </div>
        <div className="h-4 w-full bg-slate-200/40 dark:bg-gray-700/40 rounded-lg mt-4" />
        <div className="h-4 w-3/4 bg-slate-200/40 dark:bg-gray-700/40 rounded-lg mt-2" />
      </div>

      {/* Timeline skeleton */}
      <div className="space-y-6 pl-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-gray-700/80 flex-shrink-0" />
            <div className="flex-1 bg-white/60 dark:bg-gray-800/60 rounded-xl p-6 border border-slate-200/50 dark:border-gray-700/50">
              <div className="h-5 w-48 bg-slate-200 dark:bg-gray-700/80 rounded-lg mb-3" />
              <div className="flex gap-2 mb-3">
                <div className="h-6 w-20 bg-slate-200/60 dark:bg-gray-700/60 rounded-full" />
                <div className="h-6 w-24 bg-slate-200/60 dark:bg-gray-700/60 rounded-full" />
              </div>
              <div className="h-4 w-32 bg-slate-200/40 dark:bg-gray-700/40 rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      {/* Glowing text */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 text-primary-500 dark:text-primary-400 animate-pulse">
          <FiZap className="animate-spin" />
          <span className="text-sm font-medium">AI đang phân tích và tạo lộ trình...</span>
        </div>
      </div>
    </div>
  );
}

// ==================== Roadmap Node ====================
function RoadmapNode({ course, isLast }: { course: CareerPathCourse; isLast: boolean }) {
  const statusConfig = {
    COMPLETED: {
      bg: 'bg-emerald-50/50 dark:bg-emerald-500/20',
      border: 'border-emerald-200 dark:border-emerald-500/50',
      dot: 'bg-emerald-500',
      line: 'bg-emerald-200 dark:bg-emerald-500/30',
      icon: <FiCheckCircle className="text-emerald-500 dark:text-emerald-400" />,
      label: 'Đã hoàn thành',
      labelClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10',
    },
    IN_PROGRESS: {
      bg: 'bg-blue-50/50 dark:bg-blue-500/20',
      border: 'border-blue-200 dark:border-blue-500/50',
      dot: 'bg-blue-500',
      line: 'bg-blue-200 dark:bg-blue-500/30',
      icon: <FiTrendingUp className="text-blue-500 dark:text-blue-400" />,
      label: 'Đang học',
      labelClass: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10',
    },
    NOT_STARTED: {
      bg: 'bg-slate-50 dark:bg-gray-700/40',
      border: 'border-slate-200 dark:border-gray-600/50',
      dot: 'bg-slate-400 dark:bg-gray-500',
      line: 'bg-slate-200 dark:bg-gray-600/30',
      icon: <FiBookOpen className="text-slate-500 dark:text-gray-400" />,
      label: 'Chưa bắt đầu',
      labelClass: 'text-slate-500 dark:text-gray-400 bg-slate-200 dark:bg-gray-600/20',
    },
  };

  const config = statusConfig[course.status] || statusConfig.NOT_STARTED;

  return (
    <div className="relative flex gap-4 sm:gap-6 group">
      {/* Timeline line */}
      {!isLast && (
        <div className={`absolute left-5 top-12 w-0.5 h-[calc(100%+1.5rem)] ${config.line}`} />
      )}

      {/* Timeline dot */}
      <div className="relative z-10 flex-shrink-0 mt-1">
        <div className={`w-10 h-10 rounded-full ${config.dot} flex items-center justify-center text-white shadow-lg 
          ${course.status === 'IN_PROGRESS' ? 'ring-4 ring-blue-500/20 dark:ring-blue-500/30 animate-pulse' : ''}
          ${course.status === 'COMPLETED' ? 'ring-4 ring-emerald-500/20 dark:ring-emerald-500/20' : ''}`}>
          <span className="text-sm font-bold">{course.order}</span>
        </div>
      </div>

      {/* Course Card */}
      <div className={`flex-1 mb-6 ${config.bg} border ${config.border} rounded-xl p-5 sm:p-6 backdrop-blur-sm 
        transition-all duration-300 hover:scale-[1.01] hover:shadow-xl hover:shadow-primary-500/5`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            {config.icon}
            <h3 className="text-base sm:text-lg font-semibold text-slate-800 dark:text-white">{course.courseTitle}</h3>
          </div>
          <span className={`text-xs px-3 py-1 rounded-full font-bold w-fit ${config.labelClass}`}>
            {config.label}
          </span>
        </div>

        {/* Progress bar for IN_PROGRESS */}
        {course.status === 'IN_PROGRESS' && course.currentProgress !== undefined && (
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-blue-600 dark:text-blue-300 font-semibold">Tiến độ</span>
              <span className="text-blue-600 dark:text-blue-400 font-bold">{course.currentProgress}%</span>
            </div>
            <div className="w-full h-2 bg-slate-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-400 to-cyan-400 dark:from-blue-500 dark:to-cyan-400 rounded-full transition-all duration-1000"
                style={{ width: `${course.currentProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Skills */}
        {course.skills && course.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {course.skills.map((skill, i) => (
              <span
                key={i}
                className="text-xs px-2.5 py-1 rounded-full bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-300 border border-primary-200 dark:border-primary-500/20 font-medium"
              >
                {skill}
              </span>
            ))}
          </div>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <FiClock size={12} />
            <span>~{course.estimatedHours}h</span>
          </div>
          {course.certificate && (
            <div className="flex items-center gap-1">
              <FiAward size={12} className="text-yellow-600 dark:text-yellow-500" />
              <span className="text-yellow-600 dark:text-yellow-500/80">{course.certificate}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== Main Page Component ====================
export default function CareerPathAdvisor() {
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [recommendation, setRecommendation] = useState<CareerPathRecommendation | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Theme state
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark' || 
      (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  // Apply theme
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const handleSubmit = async (selectedGoal?: string) => {
    const targetGoal = selectedGoal || goal;
    if (!targetGoal.trim()) {
      toast.error('Vui lòng nhập mục tiêu nghề nghiệp!');
      return;
    }

    setLoading(true);
    setRecommendation(null);

    try {
      const result = await aiService.getCareerPathRecommendation(targetGoal.trim());
      setRecommendation(result);

      if (result.error) {
        toast.error('AI không thể tạo lộ trình. Vui lòng thử lại!');
      } else {
        toast.success('Lộ trình học tập đã được tạo thành công!');
        // Scroll to results
        setTimeout(() => {
          resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
      }
    } catch (err: any) {
      console.error('Career path error:', err);
      toast.error(err?.response?.data?.error || 'Có lỗi xảy ra. Vui lòng thử lại!');
    } finally {
      setLoading(false);
    }
  };

  const handleViewPathDetails = (pathId: string) => {
    navigate('/learning-paths', { state: { selectedPathId: pathId } });
  };

  const completedCount = recommendation?.roadmap.filter(c => c.status === 'COMPLETED').length || 0;
  const totalCourses = recommendation?.roadmap.length || 0;

  return (
    <div className="min-h-screen relative bg-slate-50 dark:bg-gradient-to-b dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 transition-colors duration-300 font-sans">
      {/* Theme Toggle Button */}
      <div className="absolute top-8 right-6 z-40 mt-4 sm:top-12 sm:right-8 lg:right-12">
        <button
          onClick={() => setIsDarkMode(!isDarkMode)}
          className="p-2.5 rounded-full bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors shadow-sm"
          title={isDarkMode ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'}
        >
          {isDarkMode ? <FiSun size={20} /> : <FiMoon size={20} />}
        </button>
      </div>

      {/* ==================== Hero Section ==================== */}
      <section className="relative overflow-hidden pt-12 pb-12">
        {/* Background decorations */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-100 dark:bg-primary-500/10 rounded-full blur-3xl" />
          <div className="absolute top-20 -left-20 w-60 h-60 bg-blue-100 dark:bg-blue-500/8 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-purple-100 dark:bg-purple-500/8 rounded-full blur-2xl" />
        </div>

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 mt-4">
          {/* Heading */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 rounded-full text-primary-600 dark:text-primary-400 font-bold text-sm mb-4 shadow-sm">
              <FiZap size={14} />
              <span>AI Learning Coach</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white mb-4 tracking-tight">
              Lộ trình{' '}
              <span className="bg-gradient-to-r from-primary-500 via-cyan-500 to-blue-500 dark:from-primary-400 dark:via-cyan-400 dark:to-blue-400 bg-clip-text text-transparent">
                Học Tập Cá Nhân
              </span>
            </h1>
            <p className="text-slate-600 dark:text-gray-400 text-base sm:text-lg max-w-2xl mx-auto font-medium">
              Nhập mục tiêu nghề nghiệp của bạn, AI sẽ phân tích năng lực hiện tại và đề xuất lộ trình học tập tối ưu nhất
            </p>
          </div>

          {/* Input Section */}
          <div className="bg-white/80 dark:bg-gray-800/60 backdrop-blur-md rounded-3xl border border-slate-200 dark:border-gray-700/50 p-6 shadow-xl shadow-slate-200/50 dark:shadow-black/20">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <FiTarget className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-400" size={20} />
                <input
                  id="career-goal-input"
                  type="text"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !loading && handleSubmit()}
                  placeholder="VD: Tôi muốn trở thành Backend Developer..."
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-gray-900/80 border border-slate-200 dark:border-gray-600/50 rounded-2xl text-slate-900 dark:text-white 
                    placeholder-slate-400 dark:placeholder-gray-500 font-medium focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20
                    transition-all duration-300 text-base shadow-inner"
                  disabled={loading}
                />
              </div>
              <button
                id="generate-path-btn"
                onClick={() => handleSubmit()}
                disabled={loading || !goal.trim()}
                className="flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-primary-500 to-cyan-500 dark:from-primary-600 dark:to-cyan-600 
                  text-white font-bold rounded-2xl hover:from-primary-600 hover:to-cyan-600 dark:hover:from-primary-500 dark:hover:to-cyan-500 
                  disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 
                  shadow-lg shadow-primary-500/30 active:scale-95 min-w-[160px]"
              >
                {loading ? (
                  <>
                    <FiRefreshCw className="animate-spin" size={18} />
                    Phân tích...
                  </>
                ) : (
                  <>
                    <FiZap size={18} />
                    Tạo Lộ Trình
                  </>
                )}
              </button>
            </div>

            {/* Quick suggestions */}
            <div className="mt-5">
              <p className="text-xs font-bold text-slate-500 dark:text-gray-500 mb-3 uppercase tracking-wider">💡 Gợi ý nhanh:</p>
              <div className="flex flex-wrap gap-2.5">
                {CAREER_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    onClick={() => {
                      setGoal(`Tôi muốn trở thành ${suggestion.label}`);
                      handleSubmit(`Tôi muốn trở thành ${suggestion.label}`);
                    }}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-gray-700/50 text-slate-600 dark:text-gray-300 
                      rounded-full border border-slate-200 dark:border-gray-600/30 hover:bg-primary-50 dark:hover:bg-primary-500/15 hover:border-primary-200 dark:hover:border-primary-500/30 
                      hover:text-primary-600 dark:hover:text-primary-300 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span>{suggestion.icon}</span>
                    <span>{suggestion.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== Loading State ==================== */}
      {loading && (
        <section className="px-4 sm:px-6 pb-16">
          <LoadingSkeleton />
        </section>
      )}

      {/* ==================== Results Section ==================== */}
      {recommendation && !loading && (
        <section ref={resultRef} className="px-4 sm:px-6 pb-20 max-w-4xl mx-auto space-y-8">
          
          {/* ---- Matched Path Header ---- */}
          {recommendation.matchedPath && (
            <div className="bg-white dark:bg-gradient-to-br dark:from-gray-800/80 dark:via-gray-800/60 dark:to-gray-900/80 rounded-3xl border border-slate-200 dark:border-gray-700/50 p-6 sm:p-8 backdrop-blur-sm shadow-xl shadow-slate-200/50 dark:shadow-2xl">
              <div className="flex flex-col sm:flex-row items-start gap-6">
                {/* Match Score */}
                <div className="flex-shrink-0">
                  <CircularProgress score={recommendation.matchedPath.matchScore} size={90} strokeWidth={7} />
                  <p className="text-xs font-bold text-slate-500 dark:text-gray-400 text-center mt-2 uppercase tracking-wider">Độ phù hợp</p>
                </div>

                {/* Path Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <FiMapPin className="text-primary-500 dark:text-primary-400 flex-shrink-0" size={20} />
                    <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white truncate">
                      {recommendation.matchedPath.title}
                    </h2>
                  </div>
                  <p className="text-slate-600 dark:text-gray-400 text-sm mb-4 leading-relaxed font-medium">{recommendation.matchedPath.description}</p>
                  
                  <div className="bg-primary-50 dark:bg-transparent dark:border-l-2 dark:border-primary-500 p-3 rounded-lg dark:rounded-none">
                    <p className="text-primary-700 dark:text-primary-300 text-sm font-semibold italic">
                      "{recommendation.matchedPath.matchReason}"
                    </p>
                  </div>

                  {/* Stats row */}
                  <div className="flex flex-wrap items-center gap-5 mt-5 pt-5 border-t border-slate-100 dark:border-gray-700/50">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <FiBookOpen className="text-blue-500 dark:text-blue-400" size={18} />
                      <span className="text-slate-700 dark:text-gray-300">{totalCourses} khóa học</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <FiCheckCircle className="text-emerald-500 dark:text-emerald-400" size={18} />
                      <span className="text-slate-700 dark:text-gray-300">{completedCount} đã hoàn thành</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <FiClock className="text-amber-500 dark:text-yellow-400" size={18} />
                      <span className="text-slate-700 dark:text-gray-300">~{recommendation.totalEstimatedHours}h tổng</span>
                    </div>
                  </div>

                  {/* View Path Detail Button */}
                  <div className="mt-6 pt-5 border-t border-slate-100 dark:border-gray-700/50">
                    <button
                      onClick={() => handleViewPathDetails(recommendation.matchedPath!.pathId)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold rounded-xl transition-colors shadow-md shadow-primary-500/20 active:scale-95"
                    >
                      Xem chi tiết lộ trình <FiArrowRight />
                    </button>
                  </div>
                </div>
              </div>

              {/* AI Summary */}
              {recommendation.summary && (
                <div className="mt-6 p-5 bg-gradient-to-r from-primary-50 to-blue-50 dark:from-primary-500/5 dark:to-blue-500/5 border border-primary-100 dark:border-primary-500/15 rounded-2xl">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-100 dark:border-gray-700 flex-shrink-0">
                      <FiZap className="text-yellow-500" size={18} />
                    </div>
                    <p className="text-sm text-slate-700 dark:text-gray-300 leading-relaxed font-medium mt-1">{recommendation.summary}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Roadmap Timeline ---- */}
          {recommendation.roadmap.length > 0 && (
            <div className="bg-white dark:bg-transparent rounded-3xl p-6 sm:p-8 shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-200 dark:border-none">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center">
                  <FiTrendingUp className="text-primary-600 dark:text-primary-400" size={20} />
                </div>
                <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">Lộ Trình Chi Tiết</h2>
                <div className="flex-1 h-px bg-slate-200 dark:bg-gray-700/50 ml-4" />
              </div>

              <div className="pl-0 sm:pl-2">
                {recommendation.roadmap.map((course, index) => (
                  <RoadmapNode
                    key={course.courseId || index}
                    course={course}
                    isLast={index === recommendation.roadmap.length - 1}
                  />
                ))}
              </div>

              {/* Final certificate destination */}
              {recommendation.pathCertificate && (
                <div className="flex gap-4 sm:gap-6 mt-4 relative group">
                  <div className="absolute left-5 -top-6 w-0.5 h-6 bg-emerald-200 dark:bg-emerald-500/30" />
                  <div className="relative z-10 flex-shrink-0 mt-1">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-yellow-500/30 ring-4 ring-yellow-50 dark:ring-yellow-500/10">
                      <FiStar className="text-white" size={18} />
                    </div>
                  </div>
                  <div className="flex-1 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-yellow-500/10 dark:to-amber-500/10 border border-amber-200 dark:border-yellow-500/30 rounded-xl p-5 backdrop-blur-sm transition-transform group-hover:scale-[1.01]">
                    <div className="flex items-center gap-2 mb-2">
                      <FiAward className="text-amber-600 dark:text-yellow-400" size={20} />
                      <h3 className="text-lg font-bold text-amber-700 dark:text-yellow-300 uppercase tracking-wide">🎓 Chứng chỉ hoàn thành</h3>
                    </div>
                    <p className="text-amber-800 dark:text-yellow-200/80 font-semibold">{recommendation.pathCertificate}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Alternative Paths ---- */}
          {recommendation.alternativePaths && recommendation.alternativePaths.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center">
                  <FiArrowRight className="text-purple-600 dark:text-purple-400" size={20} />
                </div>
                <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">Lộ Trình Thay Thế</h2>
                <div className="flex-1 h-px bg-slate-200 dark:bg-gray-700/50 ml-4" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {recommendation.alternativePaths.map((alt, index) => (
                  <div
                    key={alt.pathId || index}
                    className="bg-white dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700/40 rounded-2xl p-6 backdrop-blur-sm 
                      hover:border-purple-300 dark:hover:border-purple-500/30 hover:bg-purple-50 dark:hover:bg-gray-800/70 transition-all duration-300 group cursor-pointer shadow-sm hover:shadow-md"
                    onClick={() => handleViewPathDetails(alt.pathId)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-300 transition-colors pr-2">
                        {alt.title}
                      </h3>
                      <div className="flex-shrink-0 ml-2">
                        <CircularProgress score={alt.matchScore} size={48} strokeWidth={4} />
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-gray-400 font-medium leading-relaxed mb-4">{alt.reason}</p>
                    <div className="flex items-center gap-1 mt-auto text-sm font-bold text-purple-600 dark:text-purple-400 group-hover:text-purple-700 dark:group-hover:text-purple-300">
                      <span>Xem lộ trình này</span>
                      <FiChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---- Action Buttons ---- */}
          <div className="flex flex-col sm:flex-row justify-center gap-4 pt-8">
            <button
              onClick={() => {
                setRecommendation(null);
                setGoal('');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-white dark:bg-gray-800 border-2 border-slate-200 dark:border-gray-600/50 
                text-slate-700 dark:text-gray-300 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-gray-700 transition-all active:scale-95 shadow-sm"
            >
              <FiRefreshCw size={18} />
              Thử mục tiêu khác
            </button>
            <button
              onClick={() => navigate('/learning-paths')}
              className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-gradient-to-r from-primary-500 to-cyan-500 dark:from-primary-600 dark:to-cyan-600 
                text-white font-bold rounded-xl hover:from-primary-600 hover:to-cyan-600 dark:hover:from-primary-500 dark:hover:to-cyan-500 transition-all active:scale-95
                shadow-lg shadow-primary-500/25"
            >
              <FiBookOpen size={18} />
              Xem tất cả lộ trình
            </button>
          </div>
        </section>
      )}

      {/* ==================== Empty State (no results yet, not loading) ==================== */}
      {!loading && !recommendation && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-16">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                icon: <FiTarget className="text-primary-500 dark:text-primary-400" size={28} />,
                title: 'Nhập Mục Tiêu',
                desc: 'Mô tả vai trò hoặc nghề nghiệp bạn mong muốn bằng ngôn ngữ tự nhiên',
              },
              {
                icon: <FiZap className="text-yellow-500 dark:text-yellow-400" size={28} />,
                title: 'AI Phân Tích',
                desc: 'Hệ thống đánh giá năng lực hiện tại, khóa đã học, điểm quiz, chứng nhận',
              },
              {
                icon: <FiTrendingUp className="text-emerald-500 dark:text-emerald-400" size={28} />,
                title: 'Nhận Lộ Trình',
                desc: 'Lộ trình cá nhân hóa với các khóa học theo thứ tự, thời gian và chứng chỉ',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="bg-white/80 dark:bg-gray-800/40 border border-slate-200 dark:border-gray-700/30 rounded-2xl p-8 text-center backdrop-blur-sm shadow-lg shadow-slate-200/50 dark:shadow-none transition-transform hover:-translate-y-1"
              >
                <div className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-gray-700/50 flex items-center justify-center mx-auto mb-5 border border-slate-100 dark:border-white/5 shadow-inner">
                  {item.icon}
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{item.title}</h3>
                <p className="text-sm font-medium text-slate-500 dark:text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
