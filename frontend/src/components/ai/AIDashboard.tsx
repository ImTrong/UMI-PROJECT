import { useState, useEffect } from 'react';
import { aiService, LearningInsights } from '../../services/ai.service';
import {
  FiBookOpen, FiAward, FiTrendingUp, FiClock,
  FiZap, FiTarget, FiAlertCircle, FiLoader,
  FiChevronRight, FiStar, FiActivity
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
      <div className="flex items-center justify-center py-12">
        <FiLoader className="w-6 h-6 animate-spin text-emerald-500" />
        <span className="ml-2 text-sm text-slate-500">Đang tải dữ liệu học tập...</span>
      </div>
    );
  }

  if (error || !insights) {
    return null; // Silent fail — don't block the chat interface
  }

  const stats = insights.stats;
  const hasData = stats && (stats.totalCoursesEnrolled > 0 || insights.inProgressCourses.length > 0);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Greeting */}
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20">
          <FiZap className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          Xin chào{insights.user?.name ? `, ${insights.user.name}` : ''}! 👋
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          AI Learning Coach sẵn sàng hỗ trợ bạn
        </p>
      </div>

      {/* Stats Cards */}
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
            color="orange"
          />
          <StatCard
            icon={<FiClock className="w-4 h-4" />}
            label="Tổng thời gian"
            value={stats.totalStudyTime || '0h'}
            color="purple"
          />
        </div>
      )}

      {/* In-Progress Courses */}
      {insights.inProgressCourses.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <FiTrendingUp className="w-4 h-4 text-blue-500" />
            Khóa học đang học
          </h3>
          <div className="space-y-2.5">
            {insights.inProgressCourses.slice(0, 3).map((course, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 truncate font-medium">{course.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full transition-all"
                        style={{ width: `${Math.min(course.progress, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 font-medium">{Math.round(course.progress)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reminders */}
      {insights.reminders.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-amber-800 mb-2 flex items-center gap-2">
            <FiAlertCircle className="w-4 h-4" />
            Nhắc nhở
          </h3>
          <ul className="space-y-1">
            {insights.reminders.slice(0, 3).map((r, i) => (
              <li key={i} className="text-xs text-amber-700">{r.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <QuickAction
          icon={<FiTarget className="w-4 h-4" />}
          title="Đánh giá tiến độ"
          desc="AI phân tích tiến độ học tập của bạn"
          onClick={() => onAskCoach('Hãy đánh giá tiến độ học tập của tôi')}
        />
        <QuickAction
          icon={<FiStar className="w-4 h-4" />}
          title="Gợi ý khóa học"
          desc="AI đề xuất khóa học phù hợp"
          onClick={() => onAskCoach('Tôi nên học gì tiếp theo?')}
        />
        <QuickAction
          icon={<FiTrendingUp className="w-4 h-4" />}
          title="Lộ trình học tập"
          desc="AI tư vấn lộ trình phù hợp"
          onClick={() => onAskCoach('Hãy tư vấn lộ trình học tập cho tôi')}
        />
        <QuickAction
          icon={<FiZap className="w-4 h-4" />}
          title="Hỏi Learning Coach"
          desc="AI động viên và đặt mục tiêu"
          onClick={() => onAskCoach('Hãy làm Learning Coach cho tôi, đánh giá và động viên tôi nhé!')}
        />
      </div>
    </div>
  );
}

// ==================== Sub-components ====================

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
  };

  return (
    <div className={`rounded-xl border p-3 ${colors[color] || colors.blue}`}>
      <div className="flex items-center gap-1.5 mb-1 opacity-75">{icon}<span className="text-[11px] font-medium">{label}</span></div>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function QuickAction({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl text-left hover:border-emerald-300 hover:bg-emerald-50/30 transition-all group"
    >
      <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-200 transition-colors">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-[11px] text-slate-500 truncate">{desc}</p>
      </div>
      <FiChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
    </button>
  );
}
