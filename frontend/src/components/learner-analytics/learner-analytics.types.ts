// ============================================================
// Learner Analytics Dashboard — Shared Types & Data Contracts
// ============================================================

// ── Generic metric type for KPI cards ──
export interface AnalyticsMetric {
  value: number | string;
  label: string;
  trend?: number;
  trendDirection?: 'up' | 'down' | 'stable';
  status?: 'positive' | 'neutral' | 'warning' | 'critical' | 'insufficient_data';
  description?: string;
}

// ── Learning Overview ──
export interface LearningOverviewData {
  progress: AnalyticsMetric;
  mastery: AnalyticsMetric;
  effectiveness: AnalyticsMetric;
  stage: AnalyticsMetric;
  status: AnalyticsMetric;
}

// ── Learning Stage ──
export type LearningStageType =
  | 'GETTING_STARTED'
  | 'FOUNDATION'
  | 'DEVELOPMENT'
  | 'APPLICATION'
  | 'FINAL_PROJECT'
  | 'ASSESSMENT'
  | 'MASTERY';

// ── Momentum Level ──
export type MomentumLevel = 'STRONG' | 'HEALTHY' | 'SLOWING' | 'LOW' | 'INACTIVE' | 'NEW_ACTIVITY' | 'INSUFFICIENT_DATA';

// ── Learning State ──
export type LearningStateType =
  | 'PROGRESSING'
  | 'STABLE'
  | 'STAGNATING'
  | 'REGRESSING'
  | 'RECOVERING'
  | 'AT_RISK'
  | 'PAUSED'
  | 'INSUFFICIENT_DATA';

export interface LearningStateEvidence {
  metric: string;
  value: string;
  direction: 'up' | 'down' | 'stable';
}

export interface LearningStateData {
  state: LearningStateType;
  description: string;
  evidence: LearningStateEvidence[];
  confidence: number;
  lastUpdated?: string;
}

// ── Timeline ──
export interface TimelineMilestone {
  id: string;
  date: string;
  stage: LearningStageType;
  stageLabel: string;
  title: string;
  type: 'COURSE_STARTED' | 'LESSON_COMPLETED' | 'QUIZ_SUBMITTED' | 'QUIZ_PASSED'
  | 'QUIZ_FAILED' | 'PROJECT_SUBMITTED' | 'PROJECT_EVALUATED' | 'SKILL_UPDATED'
  | 'CERTIFICATE_ISSUED' | 'LESSON_REVISITED' | 'LEARNING_PATH_ENROLLED';
  completion?: number;
  assessment?: number;
  skillGrowth?: number;
  insight?: string;
  insightDirection?: 'up' | 'down' | 'stable';
  status?: 'completed' | 'in_progress' | 'failed' | 'revisited';
}

// ── Trend Data Points ──
export interface TrendDataPoint {
  date: string;
  value: number;
  context?: string;
  previousValue?: number;
  change?: number;
  passed?: boolean;
}

export type TrendDirection = 'INCREASING' | 'STABLE' | 'SLOWING' | 'STAGNATING' | 'INSUFFICIENT_DATA';
export type PerformanceTrend = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'RECOVERING' | 'INSUFFICIENT_DATA';

export interface TrendChartData {
  status: 'READY' | 'INSUFFICIENT_DATA';
  currentProgress?: number;
  currentScore?: number;
  dataPoints: TrendDataPoint[];
  trend: TrendDirection | PerformanceTrend;
  trendLabel: string;
  confidence: number;
}

// ── Engagement / Activity ──
export interface DailyActivity {
  date: string;
  sessions: number;
  lessonsCompleted: number;
  quizSubmissions: number;
  minutesActive: number;
}

export interface EngagementData {
  status: 'READY' | 'INSUFFICIENT_DATA';
  dailyActivity: DailyActivity[];
  activeDays: number;
  totalSessions: number;
  currentStreak: number;
  longestStreak: number;
  averageSessionsPerWeek: number;
  activeDayRatio: number;
  momentum: {
    level: MomentumLevel;
    changePercent: number | null;
    description: string;
    confidence: number;
  };
}

// ── Skill Analytics ──
export interface SkillMetric {
  name: string;
  category?: string;
  currentMastery: number;
  previousMastery?: number;
  growth: number;
  trend: 'up' | 'down' | 'stable';
  expectedMastery?: number;
  masteryGap?: number;
  evidences?: { detail: string; type: string }[];
}

export interface SkillAnalyticsData {
  status: 'READY' | 'INSUFFICIENT_DATA';
  skills: SkillMetric[];
  strengths: SkillMetric[];
  improvementAreas: SkillMetric[];
  overallMastery: number | null;
  completionVsMastery: {
    completion: number;
    mastery: number;
    gap: number;
  } | null;
  confidence: number;
}

// ── Knowledge Gap ──
export interface KnowledgeGapItem {
  skill: string;
  expected: number;
  current: number;
  gap: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  hasExpectedData: boolean;
  evidence: string[];
}

export interface KnowledgeGapAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  gaps: KnowledgeGapItem[];
  confidence: number;
}

// ── Bottleneck Detection ──
export interface PotentialBottleneck {
  contentTitle: string;
  contentId?: string;
  type?: string;
  moduleName?: string;
  revisitCount: number;
  failedAttempts: number;
  assessmentScore?: number;
  skillMastery?: number;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  bottleneckScore?: number;
  confidence: number;
  evidence?: string[];
}

export interface BottleneckAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  bottlenecks: PotentialBottleneck[];
  confidence: number;
}

// ── Revisit / Recovery ──
export interface RevisitItem {
  contentTitle: string;
  revisitCount: number;
  beforeScore: number;
  afterScore: number;
  observedImprovement?: number;
}

export interface RecoveryDetection {
  detected: boolean;
  description?: string;
  scoreHistory: number[];
  confidence: number;
  evidence?: string[];
}

export interface RecoveryAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  revisits: RevisitItem[];
  recovery: RecoveryDetection;
  confidence: number;
}

export interface LearningEffectivenessAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  completionRate: number | null;
  assessmentAverage: number | null;
  projectAverage: number | null;
  skillEvidenceAvailable: boolean;
  insight: string;
  confidence: number;
}

// ── Next Recommended Action ──
export interface RecommendedAction {
  type: 'SKILL_GAP' | 'BOTTLENECK' | 'MOMENTUM' | 'REVIEW' | 'CONTINUE' | 'PRACTICE';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  target: string;
  problem: string;
  evidence: string[];
  reason: string;
  action: string;
  actionUrl?: string;
  actionLabel?: string;
  confidence: number;
}

// ── Data Quality ──
export interface AnalyticsDataQuality {
  status: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT';
  available: string[];
  unavailable: string[];
  totalDataPoints: number;
  oldestDataDate?: string;
}

export interface AILearningSummaryData {
  summary: string;
  generatedAt: string;
  basedOn?: string[];
}

export interface TimelineAnalytics {
  milestones: TimelineMilestone[];
  totalMilestones: number;
}

// ── Full Dashboard Data (what the API will return) ──
export interface LearnerAnalyticsDashboardData {
  overview: LearningOverviewData | null;
  timeline: TimelineAnalytics | null;
  progressTrend: TrendChartData | null;
  performanceTrend: TrendChartData | null;
  engagement: EngagementData | null;
  skills: SkillAnalyticsData | null;
  knowledgeGaps: KnowledgeGapAnalytics | null;
  bottlenecks: BottleneckAnalytics | null;
  recovery: RecoveryAnalytics | null;
  learningState: LearningStateData | null;
  effectiveness: LearningEffectivenessAnalytics | null;
  recommendations: RecommendedAction[];
  aiSummary: AILearningSummaryData | null;
  dataQuality: AnalyticsDataQuality | null;
}

// ── Section State (every section uses this) ──
export type SectionStatus = 'loading' | 'empty' | 'error' | 'ready';
