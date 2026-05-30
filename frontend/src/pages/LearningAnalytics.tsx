import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import {
  analyticsService,
  StudyPatterns,
  StudyReminder,
  HeatmapDay,
  WeeklyReport,
  OptimalSchedule,
  ContentRecommendation,
} from '../services/analytics.service';
import { learningService, LearningStats } from '../services/learning.service';
import { recommendationService, LearningInsights } from '../services/recommendation.service';
import StudyHeatmap from '../components/analytics/StudyHeatmap';
import StudyPatternChart from '../components/analytics/StudyPatternChart';
import StudyReminders from '../components/analytics/StudyReminders';
import WeeklyReportCard from '../components/analytics/WeeklyReportCard';
import OptimalScheduleView from '../components/analytics/OptimalScheduleView';
import ContentRecommendations from '../components/analytics/ContentRecommendations';
import SkillsChart from '../components/learning/SkillsChart';
import { FiBookOpen, FiClock, FiAward, FiTrendingUp, FiBarChart2, FiTarget, FiCalendar } from 'react-icons/fi';

type ActiveTab = 'overview' | 'patterns' | 'schedule';

export default function LearningAnalytics() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [loading, setLoading] = useState(true);

  // Data states
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [insights, setInsights] = useState<LearningInsights | null>(null);
  const [reminders, setReminders] = useState<StudyReminder[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([]);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport | null>(null);
  const [patterns, setPatterns] = useState<StudyPatterns | null>(null);
  const [schedule, setSchedule] = useState<OptimalSchedule | null>(null); // AI schedule
  const [mySchedule, setMySchedule] = useState<OptimalSchedule | null>(null); // Saved schedule
  const [isScheduleSaved, setIsScheduleSaved] = useState(false);
  const [contentRecs, setContentRecs] = useState<ContentRecommendation[]>([]);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        learningService.getLearningStats(),
        recommendationService.getLearningInsights(),
        analyticsService.getStudyReminders(),
        analyticsService.getStudyHeatmap(),
        analyticsService.getWeeklyReport(),
        analyticsService.getStudyPatterns(),
        analyticsService.getOptimalSchedule(),
        analyticsService.getContentRecommendations(),
        analyticsService.getMySchedule(),
      ]);

      if (results[0].status === 'fulfilled') setStats(results[0].value);
      if (results[1].status === 'fulfilled') setInsights(results[1].value);
      if (results[2].status === 'fulfilled') setReminders(results[2].value);
      if (results[3].status === 'fulfilled') setHeatmap(results[3].value);
      if (results[4].status === 'fulfilled') setWeeklyReport(results[4].value);
      if (results[5].status === 'fulfilled') setPatterns(results[5].value);
      if (results[6].status === 'fulfilled') setSchedule(results[6].value);
      if (results[7].status === 'fulfilled') setContentRecs(results[7].value);
      if (results[8].status === 'fulfilled' && results[8].value) {
        setMySchedule(results[8].value);
        setIsScheduleSaved(true);
      } else {
        setMySchedule(null);
        setIsScheduleSaved(false);
      }
    } catch (error) {
      console.error('Failed to load analytics data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSchedule = async (newSchedule: OptimalSchedule) => {
    try {
      await analyticsService.saveMySchedule(newSchedule);
      setMySchedule(newSchedule);
      setIsScheduleSaved(true);
      toast.success('Đã lưu lịch học thành công!');
    } catch (error) {
      toast.error('Lỗi khi lưu lịch học');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[500px]">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-emerald-200 border-t-indigo-600 mx-auto" />
            <div className="absolute inset-0 flex items-center justify-center">
              <FiBarChart2 className="w-6 h-6 text-emerald-600" />
            </div>
          </div>
          <p className="mt-4 text-sm text-slate-500 font-medium animate-pulse">Đang phân tích dữ liệu học tập...</p>
        </div>
      </div>
    );
  }

  const criticalReminders = reminders.filter((r) => r.urgency === 'CRITICAL' || r.urgency === 'HIGH');
  
  const displaySchedule = mySchedule || schedule;
  const today = new Date().getDay();
  const todaySlots = mySchedule ? mySchedule.slots.filter(s => s.dayOfWeek === today).sort((a,b) => a.startHour - b.startHour) : [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* ────────── Header Banner ────────── */}
      <div className="relative overflow-hidden rounded-3xl p-8 mb-8"
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #a855f7 100%)',
        }}
      >
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4" />
        <div className="absolute top-1/2 right-1/4 w-4 h-4 bg-white/20 rounded-full animate-ping" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center">
              <FiBarChart2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">
                Phân tích học tập
              </h1>
              <p className="text-emerald-200 text-sm">
                Xin chào {user?.fullName} — Đây là tổng quan hành trình học tập của bạn
              </p>
            </div>
          </div>

          {/* Quick Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <FiBookOpen className="w-4 h-4 text-emerald-200" />
                  <span className="text-emerald-200 text-[10px] font-bold uppercase tracking-wider">Khóa học</span>
                </div>
                <p className="text-2xl font-black text-white">{stats.overall.totalCoursesEnrolled}</p>
                <p className="text-emerald-200 text-[10px]">{stats.overall.totalCoursesCompleted} hoàn thành</p>
              </div>
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <FiClock className="w-4 h-4 text-emerald-200" />
                  <span className="text-emerald-200 text-[10px] font-bold uppercase tracking-wider">Giờ học</span>
                </div>
                <p className="text-2xl font-black text-white">{Math.round(stats.overall.totalStudyTimeHours * 10) / 10}</p>
                <p className="text-emerald-200 text-[10px]">tổng thời gian</p>
              </div>
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <FiAward className="w-4 h-4 text-emerald-200" />
                  <span className="text-emerald-200 text-[10px] font-bold uppercase tracking-wider">Bài học</span>
                </div>
                <p className="text-2xl font-black text-white">{stats.overall.totalLessonsCompleted}</p>
                <p className="text-emerald-200 text-[10px]">đã hoàn thành</p>
              </div>
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <FiTrendingUp className="w-4 h-4 text-emerald-200" />
                  <span className="text-emerald-200 text-[10px] font-bold uppercase tracking-wider">Streak</span>
                </div>
                <p className="text-2xl font-black text-white">{stats.overall.streakDays}</p>
                <p className="text-emerald-200 text-[10px]">ngày liên tục</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ────────── Today's Schedule Banner ────────── */}
      {mySchedule && todaySlots.length > 0 && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-2xl p-5 hover:shadow-sm transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-2xl shadow-sm">
              <FiCalendar className="text-emerald-500" />
            </div>
            <div>
              <h3 className="font-bold text-emerald-800 text-lg">Lịch học hôm nay ({todaySlots.length} khung giờ)</h3>
              <p className="text-sm text-emerald-700 mt-1">
                {todaySlots.map(s => `${s.startHour}:${String(s.startMinute || 0).padStart(2, '0')} - ${s.endHour}:${String(s.endMinute || 0).padStart(2, '0')} (${s.activityLabel})`).join(' • ')}
              </p>
            </div>
          </div>
          <Link 
            to="/my-learning" 
            className="flex items-center justify-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors whitespace-nowrap shadow-sm"
          >
            Vào học ngay <FiTarget className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* ────────── Critical Reminders (always visible) ────────── */}
      {criticalReminders.length > 0 && (
        <div className="mb-6 space-y-2">
          {criticalReminders.slice(0, 2).map((reminder) => (
            <Link
              key={reminder.id}
              to={reminder.actionUrl || '#'}
              className="block bg-gradient-to-r from-red-50 to-orange-50 border border-red-100 rounded-xl p-4 hover:shadow-sm transition-all duration-200 group"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl animate-bounce">{reminder.icon}</span>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-red-800 group-hover:text-red-600">{reminder.title}</h4>
                  <p className="text-xs text-red-600/70">{reminder.description}</p>
                </div>
                {reminder.actionLabel && (
                  <span className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1.5 rounded-xl flex-shrink-0">
                    {reminder.actionLabel} →
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ────────── Tab Navigation ────────── */}
      <div className="flex gap-1 bg-slate-100 rounded-2xl p-1.5 mb-8">
        {([
          { key: 'overview' as ActiveTab, label: 'Tổng quan', icon: FiBarChart2 },
          { key: 'patterns' as ActiveTab, label: 'Phân tích chi tiết', icon: FiTarget },
          { key: 'schedule' as ActiveTab, label: 'Lịch & Đề xuất', icon: FiCalendar },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer ${
              activeTab === tab.key
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ────────── Tab: Overview ────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          {/* Row 1: Weekly Report + Reminders */}
          <div className="grid lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3">
              {weeklyReport && <WeeklyReportCard report={weeklyReport} />}
            </div>
            <div className="lg:col-span-2">
              <StudyReminders reminders={reminders} />
            </div>
          </div>

          {/* Row 2: Heatmap */}
          <StudyHeatmap data={heatmap} />

          {/* Row 3: Skills */}
          {insights && (
            <SkillsChart
              skillStrengths={insights.skillStrengths}
              categoryDistribution={insights.categoryDistribution}
              weeklyProgress={insights.weeklyProgress}
            />
          )}
        </div>
      )}

      {/* ────────── Tab: Patterns ────────── */}
      {activeTab === 'patterns' && (
        <div className="space-y-8">
          {patterns && <StudyPatternChart patterns={patterns} />}
        </div>
      )}

      {/* ────────── Tab: Schedule & Recommendations ────────── */}
      {activeTab === 'schedule' && (
        <div className="space-y-8">
          <div className="grid lg:grid-cols-2 gap-6">
            <div>
              {displaySchedule && (
                <OptimalScheduleView 
                  schedule={displaySchedule} 
                  isSaved={isScheduleSaved} 
                  onSave={handleSaveSchedule} 
                />
              )}
            </div>
            <div>
              <ContentRecommendations recommendations={contentRecs} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
