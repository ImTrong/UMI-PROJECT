import { useState, useEffect } from 'react';
import { aiService, LearningInsights } from '../../services/ai.service';
import {
  FiBookOpen, FiAward, FiTrendingUp, FiClock,
  FiZap, FiTarget, FiLoader,
  FiStar, FiActivity, FiCompass, FiMessageCircle
} from 'react-icons/fi';

interface AIDashboardProps {
  onAskCoach: (prompt: string) => void;
}

export default function AIDashboard({ onAskCoach }: AIDashboardProps) {
  const [insights, setInsights] = useState<LearningInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadInsights();
  }, []);

  const loadInsights = async () => {
    try {
      setLoading(true);
      setError(false);
      const data = await aiService.getInsights();
      setInsights(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-xl shadow-slate-900/20 animate-pulse">
            <FiZap className="w-7 h-7 text-white" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FiLoader className="w-4 h-4 animate-spin text-slate-400" />
          <span className="text-sm text-slate-500 font-medium">Đang chuẩn bị trợ lý...</span>
        </div>
      </div>
    );
  }

  if (error || !insights) {
    return null;
  }

  const stats = insights.stats;
  const hasData = stats && (stats.totalCoursesEnrolled > 0 || insights.inProgressCourses.length > 0);
  const userName = insights.user?.name || '';
  
  // Default reminder if empty
  const displayReminders = insights.reminders.length > 0 
    ? insights.reminders 
    : [{ message: 'Hôm nay là một ngày tuyệt vời để bắt đầu bài học mới!' }];

  const quickPrompts = [
    {
      icon: <FiTarget className="w-5 h-5" />,
      title: 'Đánh giá tiến độ',
      desc: 'Phân tích chi tiết quá trình học tập',
      prompt: 'Hãy đánh giá tiến độ học tập của tôi',
      gradient: 'from-blue-500 to-blue-600',
      bg: 'bg-blue-50 hover:bg-blue-100/80',
    },
    {
      icon: <FiCompass className="w-5 h-5" />,
      title: 'Gợi ý khóa học',
      desc: 'Đề xuất khóa học phù hợp với bạn',
      prompt: 'Tôi nên học gì tiếp theo?',
      gradient: 'from-slate-600 to-slate-800',
      bg: 'bg-slate-50 hover:bg-slate-100/80',
    },
    {
      icon: <FiTrendingUp className="w-5 h-5" />,
      title: 'Lộ trình học tập',
      desc: 'Tư vấn lộ trình cá nhân hóa',
      prompt: 'Hãy tư vấn lộ trình học tập cho tôi',
      gradient: 'from-indigo-500 to-indigo-600',
      bg: 'bg-indigo-50 hover:bg-indigo-100/80',
    },
    {
      icon: <FiMessageCircle className="w-5 h-5" />,
      title: 'Learning Coach',
      desc: 'Động viên và đặt mục tiêu học tập',
      prompt: 'Hãy làm Learning Coach cho tôi, đánh giá và động viên tôi nhé!',
      gradient: 'from-cyan-500 to-cyan-600',
      bg: 'bg-cyan-50 hover:bg-cyan-100/80',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-8 px-4">
      {/* Hero Greeting */}
      <div className="text-center pt-4">
        <div className="relative inline-block mb-6">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-2xl shadow-slate-900/25 ai-logo-glow">
            <FiZap className="w-9 h-9 text-white" />
          </div>
          {/* Online indicator */}
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-500 border-[3px] border-white shadow-sm" />
        </div>
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 mb-2">
          {userName ? `Xin chào, ${userName}!` : 'Xin chào!'} 👋
        </h1>
        <p className="text-base text-slate-500 max-w-md mx-auto leading-relaxed">
          Mình là trợ lý học tập AI. Hãy hỏi bất cứ điều gì về lộ trình, tiến độ hoặc kiến thức nhé.
        </p>
      </div>

      {/* Stats Row */}
      {hasData && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={<FiBookOpen className="w-4 h-4" />}
            label="Đang học"
            value={`${stats.totalCoursesEnrolled - stats.totalCoursesCompleted}`}
            color="blue"
          />
          <StatCard
            icon={<FiAward className="w-4 h-4" />}
            label="Hoàn thành"
            value={`${stats.totalCoursesCompleted}`}
            color="emerald"
          />
          <StatCard
            icon={<FiActivity className="w-4 h-4" />}
            label="Streak"
            value={`${stats.currentStreak} ngày`}
            color="amber"
          />
          <StatCard
            icon={<FiClock className="w-4 h-4" />}
            label="Tổng giờ học"
            value={stats.totalStudyTime || '0h'}
            color="indigo"
          />
        </div>
      )}

      {/* In-Progress Courses */}
      {insights.inProgressCourses.length > 0 && (
        <div className="bg-white/80 backdrop-blur-sm border border-slate-200/80 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center">
              <FiTrendingUp className="w-3.5 h-3.5 text-blue-600" />
            </div>
            Khóa học đang học
          </h3>
          <div className="space-y-3">
            {insights.inProgressCourses.slice(0, 3).map((course, i) => (
              <div key={i} className="flex items-center gap-3 group">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center text-xs font-bold text-slate-400 border border-slate-100 shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 truncate font-medium">{course.title}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(course.progress, 100)}%`,
                          background: course.progress >= 80
                            ? 'linear-gradient(to right, #10b981, #059669)'
                            : course.progress >= 40
                            ? 'linear-gradient(to right, #3b82f6, #2563eb)'
                            : 'linear-gradient(to right, #64748b, #475569)',
                        }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 font-semibold tabular-nums w-10 text-right">
                      {Math.round(course.progress)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Prompts Grid */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-1">
          Bắt đầu nhanh
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {quickPrompts.map((item, i) => (
            <button
              key={i}
              onClick={() => onAskCoach(item.prompt)}
              className={`flex items-start gap-3.5 p-4 rounded-2xl text-left transition-all duration-200 group border border-transparent hover:border-slate-200 hover:shadow-sm ${item.bg}`}
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center text-white shadow-sm shrink-0 group-hover:scale-105 transition-transform`}>
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 mb-0.5">{item.title}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Reminders - Dark Premium Theme */}
      <div className="bg-slate-900 backdrop-blur-sm border border-slate-800 rounded-2xl p-5 shadow-xl shadow-slate-900/10 relative overflow-hidden">
        {/* Decorative background element */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        
        <h3 className="text-xs font-bold text-blue-400 mb-3 flex items-center gap-1.5 uppercase tracking-wider">
          <FiStar className="w-3.5 h-3.5" />
          Nhắc nhở từ hệ thống
        </h3>
        <ul className="space-y-2 relative z-10">
          {displayReminders.slice(0, 3).map((r, i) => (
            <li key={i} className="text-sm text-slate-300 leading-relaxed pl-5 relative before:content-[''] before:absolute before:left-1 before:top-2 before:w-1.5 before:h-1.5 before:bg-blue-500 before:rounded-full">
              {r.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ==================== Sub-components ====================

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const styles: Record<string, { bg: string; text: string; border: string }> = {
    blue: { bg: 'bg-blue-50/80', text: 'text-blue-600', border: 'border-blue-100/80' },
    emerald: { bg: 'bg-emerald-50/80', text: 'text-emerald-600', border: 'border-emerald-100/80' },
    amber: { bg: 'bg-amber-50/80', text: 'text-amber-600', border: 'border-amber-100/80' },
    indigo: { bg: 'bg-indigo-50/80', text: 'text-indigo-600', border: 'border-indigo-100/80' },
  };

  const s = styles[color] || styles.blue;

  return (
    <div className={`rounded-2xl border backdrop-blur-sm p-3.5 ${s.bg} ${s.border} transition-all hover:shadow-sm`}>
      <div className={`flex items-center gap-1.5 mb-1.5 ${s.text} opacity-80`}>
        {icon}
        <span className="text-[11px] font-semibold">{label}</span>
      </div>
      <p className={`text-xl font-black ${s.text}`}>{value}</p>
    </div>
  );
}
