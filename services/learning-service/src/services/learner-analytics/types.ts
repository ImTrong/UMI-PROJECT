// ============================================================
// Learner Analytics Engine — Shared Types
// ============================================================
// Contract between all analyzer modules and the API response.
// Every insight MUST include evidence + confidence.
// INSUFFICIENT_DATA must be explicitly handled.
// ============================================================

// ── Data Quality ──
export interface AnalyticsDataQuality {
  status: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT';
  available: string[];
  unavailable: string[];
  totalDataPoints: number;
  oldestDataDate?: string;
}

// ── Generic metric with trend + evidence ──
export interface AnalyticsMetric {
  value: number | string;
  label: string;
  trend?: number;
  trendDirection?: 'up' | 'down' | 'stable';
  status?: 'positive' | 'neutral' | 'warning' | 'critical' | 'insufficient_data';
  description?: string;
  details?: {
    label: string;
    value: string;
    status?: 'positive' | 'neutral' | 'warning' | 'critical' | 'insufficient_data';
  }[];
}

// ── Overview ──
export interface OverviewAnalytics {
  progress: AnalyticsMetric;
  mastery: AnalyticsMetric;
  effectiveness: AnalyticsMetric; // Replaced health with effectiveness
  stage: AnalyticsMetric;
  status: AnalyticsMetric; // Replaced momentum with general learning status
}

// ── Progress ──
export interface ProgressDataPoint {
  date: string;
  value: number;
  context?: string; // e.g. "Completed ReactJS course"
}

export interface ProgressAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  currentProgress: number;
  dataPoints: ProgressDataPoint[];
  trend: 'INCREASING' | 'STABLE' | 'SLOWING' | 'STAGNATING' | 'INSUFFICIENT_DATA';
  trendLabel: string;
  confidence: number;
}

// ── Performance ──
export interface PerformanceDataPoint {
  date: string;
  value: number;
  context?: string;      // e.g. "Quiz Authentication #2"
  previousValue?: number;
  change?: number;
  passed?: boolean;
}

export interface PerformanceAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  currentScore: number;
  dataPoints: PerformanceDataPoint[];
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'RECOVERING' | 'INSUFFICIENT_DATA';
  trendLabel: string;
  confidence: number;
}

// ── Engagement ──
export type MomentumLevel = 'STRONG' | 'HEALTHY' | 'SLOWING' | 'LOW' | 'INACTIVE' | 'NEW_ACTIVITY' | 'INSUFFICIENT_DATA';

export interface EngagementAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  dailyActivity: {
    date: string;
    sessions: number;
    lessonsCompleted: number;
    quizSubmissions: number;
    minutesActive: number;
  }[];
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

// ── Activity Weight Config ──
export const ACTIVITY_WEIGHTS: Record<string, number> = {
  // High-value learning events
  LESSON_COMPLETE: 3,
  QUIZ_PASS: 4,
  QUIZ_ATTEMPT: 2,
  FINAL_PROJECT_SUBMITTED: 6,
  FINAL_PROJECT_GRADED: 5,
  CERTIFICATE_GENERATED: 5,
  PATH_CERTIFICATE_GENERATED: 7,
  COURSE_COMPLETE: 5,
  // Medium-value
  LESSON_START: 1,
  COURSE_ENROLL: 1,
  COURSE_RETAKE: 2,
  // Low-value
  BADGE_EARNED: 1,
  REVIEW_SUBMITTED: 1,
};

// ── Timeline ──
export type LearningStageType =
  | 'GETTING_STARTED'
  | 'FOUNDATION'
  | 'DEVELOPMENT'
  | 'APPLICATION'
  | 'FINAL_PROJECT'
  | 'ASSESSMENT'
  | 'MASTERY';

export interface TimelineMilestone {
  id: string;
  date: string;
  stage: LearningStageType;
  stageLabel: string;
  title: string;
  type: string;
  completion?: number;
  assessment?: number;
  skillGrowth?: number;
  insight?: string;
  insightDirection?: 'up' | 'down' | 'stable';
  status?: 'completed' | 'in_progress' | 'failed' | 'revisited';
}

export interface TimelineAnalytics {
  milestones: TimelineMilestone[];
  totalMilestones: number;
}

// ── Stage ──
export interface StageAnalytics {
  currentStage: LearningStageType;
  stageLabel: string;
  evidence: string[];
  confidence: number;
}

// ── Skill ──
export interface SkillEvidence {
  source: string;
  detail: string;
  scorePercentage?: number;
  date: string;
}

export interface SkillMetricResult {
  name: string;
  category?: string;
  currentMastery: number | null;
  previousMastery?: number;
  growth: number | null;
  trend: 'up' | 'down' | 'stable' | 'insufficient_data';
  expectedMastery?: number | null;
  masteryGap?: number | null;
  evidences?: SkillEvidence[];
  hasEvidence: boolean;
}

export interface SkillAnalyticsResult {
  status: 'READY' | 'INSUFFICIENT_DATA';
  skills: SkillMetricResult[];
  strengths: SkillMetricResult[];
  improvementAreas: SkillMetricResult[];
  overallMastery: number | null;
  completionVsMastery: {
    completion: number;
    mastery: number | null;
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
  hasExpectedData: boolean; // true = from real requirements, false = estimated
  evidence: string[];
}

export interface KnowledgeGapAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  gaps: KnowledgeGapItem[];
  confidence: number;
}

// ── Bottleneck ──
export interface PotentialBottleneck {
  contentTitle: string;
  contentId?: string;
  revisitCount: number;
  failedAttempts: number;
  assessmentScore?: number;
  skillMastery?: number;
  bottleneckScore: number;  // composite score 0-100
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence: number;
  evidence: string[];
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
  observedImprovement: number; // "observed", not "caused by"
}

export interface RecoveryDetection {
  detected: boolean;
  description?: string;
  scoreHistory?: number[];
  confidence: number;
  evidence?: string[];
}

export interface RecoveryAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  revisits: RevisitItem[];
  recovery: RecoveryDetection;
}

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

// Priority order (higher = checked first)
export const LEARNING_STATE_PRIORITY: LearningStateType[] = [
  'AT_RISK',
  'PAUSED',
  'REGRESSING',
  'RECOVERING',
  'STAGNATING',
  'PROGRESSING',
  'STABLE',
  'INSUFFICIENT_DATA'
];

export interface LearningStateEvidence {
  metric: string;
  value: string;
  direction: 'up' | 'down' | 'stable';
}

export interface LearningStateAnalytics {
  state: LearningStateType;
  description: string;
  evidence: LearningStateEvidence[];
  confidence: number;
  lastUpdated: string;
}

// ── Learning Effectiveness ──
// Answers: "Is the learner actually learning?"
export interface LearningEffectivenessAnalytics {
  status: 'READY' | 'INSUFFICIENT_DATA';
  completionRate: number | null;
  assessmentAverage: number | null;
  projectAverage: number | null;
  skillEvidenceAvailable: boolean;
  insight: string;
  confidence: number;
}

// ── Recommendation ──
export interface RecommendedAction {
  type: 'SKILL_GAP' | 'BOTTLENECK' | 'MOMENTUM' | 'REVIEW' | 'CONTINUE' | 'PRACTICE';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  target: string; // The specific content/skill
  problem: string; // E.g., "Score is dropping"
  evidence: string[]; // E.g., "Quiz latest score 55%"
  reason: string; // E.g., "Mastery is lower than required"
  action: string; // E.g., "Review Authentication module"
  actionUrl?: string; // Link to the module
  actionLabel?: string;
  confidence: number;
}

// ── Full Dashboard Response ──
export interface LearnerAnalyticsDashboardData {
  overview: OverviewAnalytics;
  timeline: TimelineAnalytics;
  progressTrend: ProgressAnalytics; // Renamed from progress to match frontend
  performanceTrend: PerformanceAnalytics; // Renamed from performance to match frontend
  engagement: EngagementAnalytics;
  skills: SkillAnalyticsResult;
  knowledgeGaps: KnowledgeGapAnalytics; // Renamed to plural to match frontend
  bottlenecks: BottleneckAnalytics; // Actually BottleneckAnalytics object
  recovery: RecoveryAnalytics; // Now includes revisits array and recovery object
  learningState: LearningStateAnalytics;
  effectiveness: LearningEffectivenessAnalytics; // Replaces learningHealth
  recommendations: RecommendedAction[];
  aiSummary: { summary: string; generatedAt: string; basedOn: string[] } | null;
  dataQuality: AnalyticsDataQuality;
}

// ── Raw DB Data (fetched once, passed to all analyzers) ──
export interface RawLearnerData {
  userId: string;
  userProgress: any;
  courseProgresses: any[];
  lessonProgresses: any[];
  activityLogs: any[];
  quizAttempts: any[];
  skillProfile: any | null;
  projectSubmissions: any[];
  projectEvaluations: any[];
  pathEnrollments: any[];
  certificates: any[];
}
