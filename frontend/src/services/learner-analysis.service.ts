import { learningApi } from './api';

// ==================== Interfaces ====================

/**
 * Learner Competency Profile — kết quả phân tích năng lực tổng hợp
 */
export interface LearnerCompetencyProfile {
  userId: string;
  currentLevel: 'NO_EVIDENCE' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  levelConfidence: number;
  levelReasoning: string;
  learningProgress: LearningProgressSummary;
  acquiredSkills: SkillAssessment[];
  strengths: StrengthWeaknessItem[];
  weaknesses: StrengthWeaknessItem[];
  careerFitAnalysis: CareerFitAnalysis[];
  analyzedAt: string;
  dataCompleteness: number;
  dataSources: DataSourceUsed[];
}

export interface LearningProgressSummary {
  totalCourses: number;
  completedCourses: number;
  inProgressCourses: number;
  averageCourseProgress: number;
  completionRate: number;
  quizPerformance: {
    totalQuizAttempts: number;
    averageQuizScore: number;
    quizPassRate: number;
    coursesWithQuizData: number;
  };
  activeLearningPaths: number;
  completedPaths: number;
  totalStudyHours: number;
  streakDays: number;
  totalCertificates: number;
  courseCertificates: number;
  pathCertificates: number;
  totalProjectSubmissions: number;
  evaluatedProjects: number;
  averageProjectScore: number;
}

export interface SkillAssessment {
  skill: string;
  canonicalName: string;
  category: string;
  level: 'NO_EVIDENCE' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  confidence: number;
  score: number;
  evidenceCount: number;
  sources: string[];
}

export interface StrengthWeaknessItem {
  area: string;
  category: string;
  detail: string;
  source: string;
  confidence: number;
}

export interface CareerFitAnalysis {
  careerGoal: string;
  pathId: string;
  pathTitle: string;
  fitScore: number;
  fitLevel: 'EXCELLENT' | 'GOOD' | 'DEVELOPING' | 'EARLY_STAGE';
  totalRequiredSkills: number;
  matchedSkills: SkillGapItem[];
  improvableSkills: SkillGapItem[];
  missingSkills: SkillGapItem[];
  recommendation: string;
}

export interface SkillGapItem {
  skill: string;
  currentLevel: string;
  requiredLevel: string;
  gap: 'MET' | 'NEEDS_IMPROVEMENT' | 'MISSING';
  currentScore: number;
}

export interface DataSourceUsed {
  source: string;
  recordCount: number;
  hasData: boolean;
}

/**
 * Extended skills summary response
 */
export interface ExtendedSkillsSummary {
  acquiredSkills: SkillAssessment[];
  currentLevel: string;
  levelConfidence: number;
  strengths: StrengthWeaknessItem[];
  weaknesses: StrengthWeaknessItem[];
  learningProgress: LearningProgressSummary;
}

// ==================== Service ====================

export const learnerAnalysisService = {
  /**
   * Get full Learner Competency Profile
   */
  async getProfile(): Promise<LearnerCompetencyProfile> {
    const response = await learningApi.get('/api/learning/learner-analysis/me');
    return response.data.data;
  },

  /**
   * Get Career Fit Analysis only
   */
  async getCareerFit(): Promise<CareerFitAnalysis[]> {
    const response = await learningApi.get('/api/learning/learner-analysis/me/career-fit');
    return response.data.data;
  },

  /**
   * Get extended skills summary
   */
  async getSkillsSummary(): Promise<ExtendedSkillsSummary> {
    const response = await learningApi.get('/api/learning/learner-analysis/me/skills');
    return response.data.data;
  },

  /**
   * Force refresh — invalidate cache and rebuild profile
   */
  async refreshProfile(): Promise<LearnerCompetencyProfile> {
    const response = await learningApi.post('/api/learning/learner-analysis/me/refresh');
    return response.data.data;
  },
};
