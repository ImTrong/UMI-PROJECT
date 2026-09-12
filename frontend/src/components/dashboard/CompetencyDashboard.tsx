import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LearnerCompetencyProfile, SkillAssessment, CareerFitAnalysis, SkillGapItem } from '../../services/learner-analysis.service';
import { learnerAnalysisService } from '../../services/learner-analysis.service';
import { aiService, AILearnerAnalysis } from '../../services/ai.service';
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
} from 'recharts';
import {
  FiTrendingUp, FiTarget, FiAlertCircle, FiCheckCircle,
  FiBookOpen, FiStar, FiRefreshCw, FiChevronDown, FiChevronUp,
  FiZap, FiAward, FiArrowRight, FiCpu, FiBarChart2, FiCompass,
  FiShield, FiInfo,
} from 'react-icons/fi';

// ==================== Constants ====================

const LEVEL_CONFIG: Record<string, { bg: string; text: string; label: string; color: string; border: string }> = {
  NO_EVIDENCE: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Chưa có dữ liệu', color: '#94a3b8', border: 'border-slate-200' },
  BEGINNER:    { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'Beginner',         color: '#3b82f6', border: 'border-blue-200' },
  INTERMEDIATE:{ bg: 'bg-yellow-100',text: 'text-yellow-700',label: 'Intermediate',     color: '#eab308', border: 'border-yellow-200' },
  ADVANCED:    { bg: 'bg-green-100', text: 'text-green-700', label: 'Advanced',          color: '#22c55e', border: 'border-green-200' },
};

const PIE_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#94a3b8'];

const CONFIDENCE_MAP: { min: number; label: string; color: string; bg: string; text: string }[] = [
  { min: 0.7, label: 'High',   color: '#22c55e', bg: 'bg-green-50',  text: 'text-green-700' },
  { min: 0.4, label: 'Medium', color: '#eab308', bg: 'bg-yellow-50', text: 'text-yellow-700' },
  { min: 0,   label: 'Low',    color: '#ef4444', bg: 'bg-red-50',    text: 'text-red-700' },
];

const GAP_CONFIG: Record<string, { color: string; bg: string; text: string; label: string }> = {
  MET:               { color: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700',  label: 'Đạt' },
  NEEDS_IMPROVEMENT: { color: 'bg-yellow-500', bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Cần cải thiện' },
  MISSING:           { color: 'bg-red-400',    bg: 'bg-red-50',    text: 'text-red-700',    label: 'Thiếu' },
};

// ==================== Props ====================

interface CompetencyDashboardProps {
  view?: 'competency' | 'career' | 'all';
  profile: LearnerCompetencyProfile | null;
  aiAnalysis: AILearnerAnalysis | null;
  onAiAnalysisChange?: (analysis: AILearnerAnalysis | null) => void;
  onProfileChange?: (profile: LearnerCompetencyProfile | null) => void;
}

// ==================== Sub-Components ====================

function LevelBadge({ level, size = 'md' }: { level: string; size?: 'sm' | 'md' | 'lg' }) {
  const c = LEVEL_CONFIG[level] || LEVEL_CONFIG.NO_EVIDENCE;
  const sizeClasses = size === 'lg' ? 'px-5 py-2.5 text-base' : size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return <span className={`${c.bg} ${c.text} ${sizeClasses} rounded-full font-bold inline-block`}>{c.label}</span>;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const cfg = CONFIDENCE_MAP.find(c => confidence >= c.min) || CONFIDENCE_MAP[2];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <FiShield size={11} />
      {cfg.label} ({pct}%)
    </span>
  );
}

function FitScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : score >= 40 ? 'bg-orange-500' : 'bg-red-400';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-600 truncate mr-2">{label}</span>
        <span className="font-semibold">{Math.round(score)}/100</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2.5">
        <div className={`${color} h-2.5 rounded-full transition-all duration-700`} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
    </div>
  );
}

/** Skill detail row: name + score bar + confidence + evidence count */
function SkillDetailRow({ skill }: { skill: SkillAssessment }) {
  const lc = LEVEL_CONFIG[skill.level] || LEVEL_CONFIG.NO_EVIDENCE;
  const cfg = CONFIDENCE_MAP.find(c => skill.confidence >= c.min) || CONFIDENCE_MAP[2];
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 transition group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-slate-800">{skill.skill}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${lc.bg} ${lc.text}`}>{lc.label}</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-1.5">
          <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${Math.min(skill.score, 100)}%`, backgroundColor: lc.color }} />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 text-xs">
        <span className="font-bold text-slate-700">{Math.round(skill.score)}/100</span>
        <span className={`px-1.5 py-0.5 rounded-md font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
        <span className="text-slate-400 flex items-center gap-0.5" title="Evidence count">
          <FiInfo size={10} />{skill.evidenceCount}
        </span>
      </div>
    </div>
  );
}

/** Donut chart for skill level distribution */
function SkillLevelDonut({ skills }: { skills: SkillAssessment[] }) {
  if (skills.length === 0) return null;
  const counts = { ADVANCED: 0, INTERMEDIATE: 0, BEGINNER: 0, NO_EVIDENCE: 0 };
  skills.forEach(s => { counts[s.level as keyof typeof counts] = (counts[s.level as keyof typeof counts] || 0) + 1; });
  const data = [
    { name: 'Advanced', value: counts.ADVANCED },
    { name: 'Intermediate', value: counts.INTERMEDIATE },
    { name: 'Beginner', value: counts.BEGINNER },
    { name: 'Chưa có', value: counts.NO_EVIDENCE },
  ].filter(d => d.value > 0);

  return (
    <div className="flex items-center gap-4">
      <div className="w-32 h-32">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} innerRadius={30} outerRadius={55} paddingAngle={3} dataKey="value">
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="text-slate-600">{d.name}: <strong>{d.value}</strong></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Radar chart for top 5-7 skills, prioritizing career-relevant skills */
function SkillRadar({ skills, careerFit }: { skills: SkillAssessment[]; careerFit?: CareerFitAnalysis[] }) {
  let selectedSkills: SkillAssessment[];

  if (careerFit && careerFit.length > 0) {
    const primary = careerFit[0];
    const requiredNames = new Set([
      ...primary.matchedSkills.map(s => s.skill.toLowerCase()),
      ...primary.improvableSkills.map(s => s.skill.toLowerCase()),
      ...primary.missingSkills.map(s => s.skill.toLowerCase()),
    ]);
    const careerSkills = skills.filter(s =>
      requiredNames.has(s.skill.toLowerCase()) && s.level !== 'NO_EVIDENCE'
    );
    selectedSkills = careerSkills.length >= 3
      ? careerSkills.sort((a, b) => b.score - a.score).slice(0, 7)
      : skills.filter(s => s.level !== 'NO_EVIDENCE').sort((a, b) => b.score - a.score).slice(0, 7);
  } else {
    selectedSkills = skills.filter(s => s.level !== 'NO_EVIDENCE').sort((a, b) => b.score - a.score).slice(0, 7);
  }

  if (selectedSkills.length < 3) return null;
  const data = selectedSkills.map(s => ({ skill: s.skill.length > 14 ? s.skill.slice(0, 14) + '…' : s.skill, score: s.score, fullMark: 100 }));

  return (
    <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11, fill: '#64748b' }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
          <Radar name="Điểm" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bar chart showing skill gap status using currentScore + gap status color */
function SkillGapBarChart({ items }: { items: SkillGapItem[] }) {
  if (items.length === 0) return null;

  const sorted = [...items].sort((a, b) => {
    const order: Record<string, number> = { MISSING: 0, NEEDS_IMPROVEMENT: 1, MET: 2 };
    return (order[a.gap] ?? 1) - (order[b.gap] ?? 1);
  });

  return (
    <div className="space-y-3">
      {sorted.map((item, i) => {
        const gc = GAP_CONFIG[item.gap] || GAP_CONFIG.NEEDS_IMPROVEMENT;
        return (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="font-medium text-sm text-slate-700">{item.skill}</span>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${gc.bg} ${gc.text}`}>{gc.label}</span>
                <span className="text-[11px] text-slate-400">{item.currentLevel} → {item.requiredLevel}</span>
              </div>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5">
              <div className={`${gc.color} h-2.5 rounded-full transition-all duration-700`} style={{ width: `${Math.min(item.currentScore, 100)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Điểm hiện tại: {Math.round(item.currentScore)}/100</span>
              <span>Yêu cầu: {item.requiredLevel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Donut chart for career fit — shows fitScore/100 with matched/improvable/missing breakdown */
function CareerFitDonut({ fit }: { fit: CareerFitAnalysis }) {
  const data = [
    { name: 'Fit', value: fit.fitScore },
    { name: 'Gap', value: Math.max(0, 100 - fit.fitScore) },
  ];
  const fitColor = fit.fitScore >= 70 ? '#22c55e' : fit.fitScore >= 50 ? '#eab308' : '#ef4444';

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative w-44 h-44 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} innerRadius={55} outerRadius={75} startAngle={90} endAngle={-270} dataKey="value" stroke="none">
              <Cell fill={fitColor} />
              <Cell fill="#f1f5f9" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-black" style={{ color: fitColor }}>{Math.round(fit.fitScore)}</span>
          <span className="text-xs text-slate-400 font-bold -mt-0.5">/100</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-bold text-lg text-slate-800">Career Fit</h4>
        <p className="text-sm text-slate-500 mt-0.5">{fit.pathTitle}</p>
        {fit.careerGoal && <p className="text-xs text-slate-400 mt-0.5">{fit.careerGoal}</p>}
        <div className="grid grid-cols-3 gap-2 mt-4 text-center text-xs">
          <div className="bg-green-50 rounded-xl p-2.5 border border-green-100">
            <p className="text-green-700 font-bold text-lg">{fit.matchedSkills.length}</p>
            <p className="text-green-600 font-medium">Đạt</p>
          </div>
          <div className="bg-yellow-50 rounded-xl p-2.5 border border-yellow-100">
            <p className="text-yellow-700 font-bold text-lg">{fit.improvableSkills.length}</p>
            <p className="text-yellow-600 font-medium">Cần cải thiện</p>
          </div>
          <div className="bg-red-50 rounded-xl p-2.5 border border-red-100">
            <p className="text-red-700 font-bold text-lg">{fit.missingSkills.length}</p>
            <p className="text-red-600 font-medium">Thiếu</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-3 flex items-center gap-1">
          <FiInfo size={11} />
          {fit.matchedSkills.length}/{fit.totalRequiredSkills} kỹ năng đáp ứng yêu cầu
        </p>
      </div>
    </div>
  );
}

/** Bar chart for career fit comparison */
function CareerFitChart({ fits }: { fits: CareerFitAnalysis[] }) {
  if (fits.length === 0) return null;
  const data = fits.map(f => ({ name: f.pathTitle.length > 20 ? f.pathTitle.slice(0, 20) + '…' : f.pathTitle, 'Phù hợp': Math.round(f.fitScore), fullTitle: f.pathTitle }));

  return (
    <div className="w-full h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#475569' }} />
          <Tooltip formatter={(value: any) => [`${value}/100`, 'Career Fit']} />
          <Bar dataKey="Phù hợp" radius={[0, 6, 6, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d['Phù hợp'] >= 70 ? '#22c55e' : d['Phù hợp'] >= 50 ? '#eab308' : d['Phù hợp'] >= 30 ? '#f97316' : '#ef4444'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ==================== Section Wrapper ====================

function CollapsibleSection({ id, title, icon: Icon, iconColor, isExpanded, onToggle, children }: {
  id: string; title: string; icon: any; iconColor: string; isExpanded: boolean; onToggle: (id: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button onClick={() => onToggle(id)} className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition cursor-pointer">
        <h3 className="font-semibold flex items-center gap-2">
          <Icon className={iconColor} />{title}
        </h3>
        {isExpanded ? <FiChevronUp className="text-slate-400" /> : <FiChevronDown className="text-slate-400" />}
      </button>
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-5">
          {children}
        </div>
      )}
    </div>
  );
}

// ==================== Main Component ====================

export default function CompetencyDashboard({ view = 'all', profile, aiAnalysis, onAiAnalysisChange, onProfileChange }: CompetencyDashboardProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview', 'skills', 'gap', 'career', 'plan']));

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      return next;
    });
  }, []);

  const isExpanded = (s: string) => expandedSections.has(s);

  const generateAIAnalysis = async () => {
    setAiLoading(true);
    try {
      const result = await aiService.generateLearnerAnalysis();
      onAiAnalysisChange?.(result);
    } catch (err) { console.error('AI analysis failed:', err); }
    finally { setAiLoading(false); }
  };

  const refreshAll = async () => {
    try {
      const refreshedProfile = await learnerAnalysisService.refreshProfile();
      onProfileChange?.(refreshedProfile);
      onAiAnalysisChange?.(null);
    } catch (err) { console.error('Refresh failed:', err); }
  };

  // ── Empty state ──
  if (!profile) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 text-center py-12 px-6">
        <FiBarChart2 className="mx-auto text-4xl text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Chưa có dữ liệu phân tích</h3>
        <p className="text-slate-500 mb-6 max-w-md mx-auto">
          Hãy hoàn thành một vài khóa học hoặc đồ án để hệ thống có thể phân tích năng lực của bạn.
        </p>
        <Link to="/courses" className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-indigo-700 transition">
          <FiBookOpen size={16} /> Khám phá Khóa học
        </Link>
      </div>
    );
  }

  const ca = aiAnalysis?.competencyAnalysis;
  const lp = aiAnalysis?.learningPlan;
  const ac = aiAnalysis?.alternativeCareers;

  // Collect all gap items from primary career fit
  const primaryFit = profile.careerFitAnalysis[0] ?? null;
  const allGapItems: SkillGapItem[] = primaryFit
    ? [...primaryFit.matchedSkills, ...primaryFit.improvableSkills, ...primaryFit.missingSkills]
    : [];

  // ════════════════════ COMPETENCY VIEW ════════════════════
  const renderCompetencyView = () => (
    <div className="space-y-6">
      {/* ── 1. Current Level Hero ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            {/* Level + Confidence */}
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                <FiTrendingUp className="text-2xl text-white" />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-1.5">Trình độ hiện tại</p>
                <div className="flex items-center gap-3">
                  <LevelBadge level={profile.currentLevel} size="lg" />
                  <ConfidenceBadge confidence={profile.levelConfidence} />
                </div>
              </div>
            </div>

            {/* Quick stats */}
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Khóa hoàn thành', value: profile.learningProgress.completedCourses, total: profile.learningProgress.totalCourses, icon: FiAward, color: 'text-green-600' },
                { label: 'Đồ án đánh giá', value: profile.learningProgress.evaluatedProjects, total: profile.learningProgress.totalProjectSubmissions, icon: FiTarget, color: 'text-purple-600' },
                { label: 'Giờ học', value: Math.round(profile.learningProgress.totalStudyHours), total: null, icon: FiBookOpen, color: 'text-blue-600' },
                { label: 'Chứng nhận', value: profile.learningProgress.totalCertificates, total: null, icon: FiStar, color: 'text-yellow-600' },
              ].map((item, i) => (
                <div key={i} className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                  <item.icon className={`mx-auto text-base ${item.color} mb-1`} />
                  <p className="text-xl font-bold">{item.value}{item.total != null ? <span className="text-xs font-normal text-slate-400">/{item.total}</span> : ''}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Reasoning */}
          <div className="mt-5 bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-sm text-slate-600"><strong>Hệ thống đánh giá:</strong> {profile.levelReasoning}</p>
          </div>

          {/* AI interpretation */}
          {ca && !ca.error && (
            <div className="mt-3 bg-indigo-50 rounded-xl p-4 border border-indigo-100">
              <div className="flex items-start gap-2">
                <FiCpu className="text-indigo-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-indigo-800">AI nhận xét</p>
                  <p className="text-sm text-indigo-700 mt-1">{ca.levelInterpretation}</p>
                  {ca.oneLiner && <p className="text-xs text-indigo-500 mt-2 italic">"{ca.oneLiner}"</p>}
                </div>
              </div>
            </div>
          )}

          {/* Data completeness + sources */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-500">
            <div className="flex items-center gap-2">
              <FiBarChart2 size={14} />
              <span>Dữ liệu: {Math.round(profile.dataCompleteness)}%</span>
              <div className="bg-slate-200 rounded-full h-1.5 w-24">
                <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${profile.dataCompleteness}%` }} />
              </div>
            </div>
            {profile.dataSources && (
              <span className="text-xs text-slate-400">
                Dựa trên {profile.dataSources.filter(d => d.hasData).length} nguồn dữ liệu
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── 2. Skill Radar + Skill Details ── */}
      <CollapsibleSection id="skills" title={`Kỹ năng (${profile.acquiredSkills.length})`} icon={FiZap} iconColor="text-yellow-500" isExpanded={isExpanded('skills')} onToggle={toggleSection}>
        {profile.acquiredSkills.length > 0 ? (
          <>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm font-medium text-slate-700 mb-3">Biểu đồ Radar kỹ năng</p>
                <SkillRadar skills={profile.acquiredSkills} careerFit={profile.careerFitAnalysis} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-slate-700">Chi tiết kỹ năng</p>
                  <SkillLevelDonut skills={profile.acquiredSkills} />
                </div>
                <div className="max-h-80 overflow-y-auto space-y-0.5 border border-slate-100 rounded-xl">
                  {profile.acquiredSkills
                    .filter(s => s.level !== 'NO_EVIDENCE')
                    .sort((a, b) => b.score - a.score)
                    .map((skill, i) => (
                      <SkillDetailRow key={i} skill={skill} />
                    ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">Chưa có kỹ năng nào được ghi nhận.</p>
        )}
      </CollapsibleSection>

      {/* ── 3. Strengths & Weaknesses ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-green-200 p-5">
          <h4 className="font-semibold text-green-800 mb-3 flex items-center gap-1.5">
            <FiCheckCircle /> Điểm mạnh
          </h4>
          {profile.strengths.length > 0 ? (
            <ul className="space-y-2">
              {profile.strengths.slice(0, 5).map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-green-700 bg-green-50 rounded-lg p-2.5 border border-green-100">
                  <FiCheckCircle className="flex-shrink-0 mt-0.5" size={14} />
                  <div>
                    <strong>{s.area}</strong>
                    <span className="text-green-600 ml-1">— {s.detail}</span>
                    <span className="block text-[10px] text-green-500 mt-0.5">Nguồn: {s.source}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-green-600 opacity-70">Chưa xác định</p>}
        </div>
        <div className="bg-white rounded-2xl border border-orange-200 p-5">
          <h4 className="font-semibold text-orange-800 mb-3 flex items-center gap-1.5">
            <FiAlertCircle /> Cần cải thiện
          </h4>
          {profile.weaknesses.length > 0 ? (
            <ul className="space-y-2">
              {profile.weaknesses.slice(0, 5).map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-orange-700 bg-orange-50 rounded-lg p-2.5 border border-orange-100">
                  <FiAlertCircle className="flex-shrink-0 mt-0.5" size={14} />
                  <div>
                    <strong>{w.area}</strong>
                    <span className="text-orange-600 ml-1">— {w.detail}</span>
                    <span className="block text-[10px] text-orange-500 mt-0.5">Nguồn: {w.source}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-orange-600 opacity-70">Chưa xác định</p>}
        </div>
      </div>

      {/* AI strengths/weaknesses analysis */}
      {ca && !ca.error && (ca.strengthsAnalysis || ca.weaknessesAnalysis) && (
        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
          <p className="text-sm font-medium text-indigo-800 mb-2 flex items-center gap-1.5"><FiCpu /> AI phân tích chi tiết</p>
          {ca.strengthsAnalysis && <div className="text-sm text-indigo-700 mb-3 whitespace-pre-line">{ca.strengthsAnalysis}</div>}
          {ca.weaknessesAnalysis && <div className="text-sm text-indigo-700 whitespace-pre-line">{ca.weaknessesAnalysis}</div>}
        </div>
      )}

      {/* ── 4. Skill Gap ── */}
      {allGapItems.length > 0 && (
        <CollapsibleSection id="gap" title="Skill Gap — So sánh với mục tiêu nghề nghiệp" icon={FiTarget} iconColor="text-indigo-500" isExpanded={isExpanded('gap')} onToggle={toggleSection}>
          {primaryFit && (
            <p className="text-sm text-slate-500 mb-4">
              So sánh năng lực hiện tại với yêu cầu của <strong className="text-slate-700">{primaryFit.pathTitle}</strong>
              <span className="text-slate-400 ml-1">({primaryFit.careerGoal})</span>
            </p>
          )}
          <SkillGapBarChart items={allGapItems} />
        </CollapsibleSection>
      )}

      {/* ── 5. AI Recommendations ── */}
      {renderAIRecommendations()}
    </div>
  );

  // ════════════════════ CAREER VIEW ════════════════════
  const renderCareerView = () => (
    <div className="space-y-6">
      {/* ── 1. Career Goal + Donut ── */}
      {profile.careerFitAnalysis.length > 0 && (
        <>
          {/* Primary Career Fit Donut */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <CareerFitDonut fit={profile.careerFitAnalysis[0]} />
          </div>

          {/* Detail: matched / improvable / missing skills lists */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            {(() => {
              const pf = profile.careerFitAnalysis[0];
              return (
                <div className="space-y-4">
                  {pf.matchedSkills.length > 0 && (
                    <div>
                      <h5 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1"><FiCheckCircle size={14} /> Kỹ năng đạt yêu cầu</h5>
                      <div className="flex flex-wrap gap-1.5">
                        {pf.matchedSkills.map((s, j) => (
                          <span key={j} className="px-2.5 py-1 bg-green-50 text-green-700 text-xs rounded-lg border border-green-200 font-medium">{s.skill}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {pf.improvableSkills.length > 0 && (
                    <div>
                      <h5 className="text-sm font-semibold text-yellow-700 mb-2 flex items-center gap-1"><FiAlertCircle size={14} /> Cần cải thiện</h5>
                      <div className="flex flex-wrap gap-1.5">
                        {pf.improvableSkills.map((s, j) => (
                          <span key={j} className="px-2.5 py-1 bg-yellow-50 text-yellow-700 text-xs rounded-lg border border-yellow-200 font-medium">
                            {s.skill} <span className="text-yellow-500">({s.currentLevel} → {s.requiredLevel})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {pf.missingSkills.length > 0 && (
                    <div>
                      <h5 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1"><FiAlertCircle size={14} /> Thiếu</h5>
                      <div className="flex flex-wrap gap-1.5">
                        {pf.missingSkills.map((s, j) => (
                          <span key={j} className="px-2.5 py-1 bg-red-50 text-red-600 text-xs rounded-lg border border-red-200 font-medium">{s.skill}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {pf.recommendation && (
                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 mt-3">
                      <p className="text-sm text-slate-600"><FiInfo className="inline mr-1" size={13} />{pf.recommendation}</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* ── 2. Career Comparison ── */}
      {profile.careerFitAnalysis.length > 1 && (
        <CollapsibleSection id="career-compare" title="So sánh các hướng nghề nghiệp" icon={FiCompass} iconColor="text-teal-500" isExpanded={isExpanded('career-compare')} onToggle={toggleSection}>
          <CareerFitChart fits={profile.careerFitAnalysis} />
          {/* Individual career detail cards */}
          {profile.careerFitAnalysis.slice(1).map((cf, i) => (
            <div key={i} className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="font-semibold">{cf.pathTitle}</h4>
                  <p className="text-sm text-slate-500">{cf.careerGoal}</p>
                </div>
                <div className="text-right">
                  <span className={`text-2xl font-bold ${cf.fitScore >= 70 ? 'text-green-600' : cf.fitScore >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                    {Math.round(cf.fitScore)}
                  </span>
                  <span className="text-sm text-slate-400">/100</span>
                  <p className="text-xs text-slate-500">{cf.fitLevel}</p>
                </div>
              </div>
              <FitScoreBar score={cf.fitScore} label="Mức độ phù hợp" />
              <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                <div className="bg-green-50 rounded-lg p-2"><p className="text-green-700 font-semibold text-base">{cf.matchedSkills.length}</p><p className="text-green-600">Đạt</p></div>
                <div className="bg-yellow-50 rounded-lg p-2"><p className="text-yellow-700 font-semibold text-base">{cf.improvableSkills.length}</p><p className="text-yellow-600">Cần cải thiện</p></div>
                <div className="bg-red-50 rounded-lg p-2"><p className="text-red-700 font-semibold text-base">{cf.missingSkills.length}</p><p className="text-red-600">Thiếu</p></div>
              </div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── 3. AI Career Analysis ── */}
      {ac && !ac.error && (
        <div className="space-y-4">
          {/* Current career assessment */}
          {ac.currentCareerAssessment && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><FiCpu className="text-indigo-500" /> Phân tích AI</h4>
              {ac.currentCareerAssessment.whyStay && (
                <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 mb-3">
                  <p className="text-sm text-emerald-700"><strong>🎯 Đánh giá hướng hiện tại:</strong> {ac.currentCareerAssessment.whyStay}</p>
                </div>
              )}
              {ac.currentCareerAssessment.assessment && (
                <p className="text-sm text-slate-600">{ac.currentCareerAssessment.assessment}</p>
              )}
            </div>
          )}

          {/* Alternative careers */}
          {ac.shouldSuggest && ac.alternativeCareers && ac.alternativeCareers.length > 0 && (
            <div className="bg-indigo-50 rounded-2xl p-5 border border-indigo-200">
              <h4 className="font-semibold text-indigo-800 mb-4 flex items-center gap-2"><FiCompass /> Hướng nghề nghiệp gợi ý (AI)</h4>
              <div className="space-y-3">
                {ac.alternativeCareers.map((alt, i) => (
                  <div key={i} className="bg-white rounded-xl p-4 border border-indigo-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-indigo-800">{alt.career}</span>
                      <span className="text-sm font-bold text-indigo-600">{alt.fitScore}/100</span>
                    </div>
                    <p className="text-sm text-indigo-700 mb-2">{alt.fitReason}</p>
                    {alt.leveragedSkills.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs text-slate-500 font-medium">Thế mạnh được tận dụng: </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {alt.leveragedSkills.map((s, j) => (
                            <span key={j} className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-md font-medium">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {alt.skillsToLearn.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs text-slate-500 font-medium">Cần bổ sung: </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {alt.skillsToLearn.map((s, j) => (
                            <span key={j} className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-md font-medium">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {alt.pathId && (
                      <Link to="/learning-paths" className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1 mt-1">
                        Xem lộ trình <FiArrowRight size={10} />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
              {ac.encouragement && <p className="text-sm text-indigo-600 mt-3 italic">💪 {ac.encouragement}</p>}
            </div>
          )}
        </div>
      )}

      {/* ── 4. AI Learning Plan / Roadmap ── */}
      {renderAIRecommendations()}
    </div>
  );

  // ════════════════════ AI RECOMMENDATIONS (shared) ════════════════════
  const renderAIRecommendations = () => (
    <CollapsibleSection id="plan" title="Đề xuất học tập (AI)" icon={FiTarget} iconColor="text-indigo-500" isExpanded={isExpanded('plan')} onToggle={toggleSection}>
      {!aiAnalysis ? (
        <div className="text-center py-8 bg-slate-50 rounded-xl">
          <FiCpu className="mx-auto text-3xl text-slate-400 mb-3" />
          <p className="text-sm text-slate-600 mb-4">AI sẽ phân tích năng lực và đề xuất khóa học phù hợp.</p>
          <button
            onClick={generateAIAnalysis}
            disabled={aiLoading}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-indigo-700 transition disabled:opacity-60 cursor-pointer"
          >
            {aiLoading ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /><span>Đang phân tích...</span></>
            ) : (
              <><FiCpu size={14} /><span>Phân tích năng lực bằng AI</span></>
            )}
          </button>
        </div>
      ) : lp && !lp.error ? (
        <>
          {lp.summary && (
            <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
              <p className="text-sm text-indigo-700">{lp.summary}</p>
            </div>
          )}

          {/* Priority Skills */}
          {lp.prioritySkills && lp.prioritySkills.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-3">⚡ Kỹ năng ưu tiên cải thiện</h4>
              <div className="space-y-2">
                {lp.prioritySkills.map((s, i) => (
                  <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <div>
                      <span className="font-medium text-sm">{s.skill}</span>
                      <span className="text-xs text-slate-500 ml-2">{s.currentLevel} → {s.targetLevel}</span>
                    </div>
                    <span className="text-xs text-slate-500 bg-white px-2 py-0.5 rounded border">{s.estimatedEffort}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Courses — guard: only render link if courseId exists */}
          {lp.recommendedCourses && lp.recommendedCourses.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-3">📚 Khóa học đề xuất</h4>
              <div className="space-y-2">
                {lp.recommendedCourses.map((c, i) => {
                  const content = (
                    <div className="flex items-center justify-between bg-white rounded-lg p-3 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition group">
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="font-medium text-sm truncate group-hover:text-indigo-700">{c.courseTitle}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{c.reason}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          c.priority === 'HIGH' ? 'bg-red-100 text-red-700' :
                          c.priority === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {c.priority === 'HIGH' ? '🔥 Ưu tiên' : c.priority === 'MEDIUM' ? 'Nên học' : 'Tùy chọn'}
                        </span>
                        <FiArrowRight className="text-slate-400 group-hover:text-indigo-600" size={14} />
                      </div>
                    </div>
                  );
                  // Guard: only render as Link if courseId is valid
                  return c.courseId ? (
                    <Link key={i} to={`/courses/id/${c.courseId}`}>{content}</Link>
                  ) : (
                    <div key={i}>{content}</div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Next Actions */}
          {lp.nextActions && lp.nextActions.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-3">🎯 Hành động tiếp theo</h4>
              <div className="space-y-2">
                {lp.nextActions.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                    <div className="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0 mt-0.5">
                      {a.order}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{a.action}</p>
                      {a.resourceId && a.resourceTitle && (
                        <Link
                          to={a.type === 'COURSE' ? `/courses/id/${a.resourceId}` : '/learning-paths'}
                          className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1 mt-1"
                        >
                          {a.resourceTitle} <FiArrowRight size={10} />
                        </Link>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs flex-shrink-0 ${
                      a.type === 'COURSE' ? 'bg-blue-100 text-blue-700' :
                      a.type === 'PROJECT' ? 'bg-purple-100 text-purple-700' :
                      a.type === 'PRACTICE' ? 'bg-green-100 text-green-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {a.type === 'COURSE' ? 'Khóa học' : a.type === 'PROJECT' ? 'Đồ án' : a.type === 'PRACTICE' ? 'Thực hành' : 'Ôn tập'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          {lp.estimatedTimeline && (
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <p className="text-sm text-amber-700 flex items-center gap-1.5"><FiCpu className="flex-shrink-0" /><em>{lp.estimatedTimeline}</em></p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button onClick={generateAIAnalysis} disabled={aiLoading} className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 cursor-pointer">
              {aiLoading ? <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-indigo-600" /> : <FiRefreshCw size={12} />}
              <span>Phân tích lại</span>
            </button>
            {aiAnalysis?.generatedAt && (
              <p className="text-xs text-slate-400">Phân tích lúc: {new Date(aiAnalysis.generatedAt).toLocaleString('vi-VN')}</p>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-6">
          <p className="text-sm text-slate-500 mb-2">Không thể tạo đề xuất. Vui lòng thử lại.</p>
          <button onClick={generateAIAnalysis} className="text-sm text-indigo-600 hover:underline cursor-pointer">Thử lại</button>
        </div>
      )}
    </CollapsibleSection>
  );

  // ════════════════════ RENDER ════════════════════
  return (
    <div className="space-y-6">
      {(view === 'all' || view === 'competency') && renderCompetencyView()}
      {(view === 'all' || view === 'career') && renderCareerView()}

      {/* Refresh button */}
      <div className="text-center">
        <button onClick={refreshAll} className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1.5 mx-auto transition cursor-pointer">
          <FiRefreshCw size={14} />
          <span>Cập nhật toàn bộ dữ liệu</span>
        </button>
      </div>
    </div>
  );
}
