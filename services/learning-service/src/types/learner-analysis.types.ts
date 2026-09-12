/**
 * Learner Analysis Types
 * 
 * Cấu trúc dữ liệu cho Learner Competency Profile — lớp phân tích trung gian
 * tổng hợp dữ liệu học tập và năng lực phục vụ Dashboard và AI Service.
 * 
 * Nguyên tắc:
 * - UserSkillProfile (từ ProjectEvaluation) = nguồn chính năng lực
 * - Quiz/Course = supporting data cho learning analysis
 * - Career Fit = weighted scoring với MET/NEEDS_IMPROVEMENT/MISSING
 * - Overall Level = multi-evidence rules, không phải weighted average đơn giản
 */

import { SkillLevel } from './index';

// ==================== Learner Competency Profile ====================

/**
 * Kết quả phân tích năng lực tổng hợp — output chính của LearnerAnalysisService
 */
export interface LearnerCompetencyProfile {
  userId: string;

  // 1. Tổng quan trình độ
  currentLevel: SkillLevel;           // Tính từ multi-evidence rules
  levelConfidence: number;            // 0-1
  levelReasoning: string;             // Giải thích vì sao xác định level này

  // 2. Tổng hợp tiến độ học tập (supporting data)
  learningProgress: LearningProgressSummary;

  // 3. Kỹ năng đã đạt (chủ yếu từ UserSkillProfile/ProjectEvaluation)
  acquiredSkills: SkillAssessment[];

  // 4. Điểm mạnh / Điểm yếu
  strengths: StrengthWeaknessItem[];
  weaknesses: StrengthWeaknessItem[];

  // 5. Career Fit — đối chiếu với mục tiêu nghề nghiệp
  careerFitAnalysis: CareerFitAnalysis[];

  // 6. Metadata
  analyzedAt: string;                 // ISO date
  dataCompleteness: number;           // 0-100, độ đầy đủ dữ liệu
  dataSources: DataSourceUsed[];      // Các nguồn dữ liệu đã dùng
}

// ==================== Learning Progress (Supporting Data) ====================

/**
 * Tổng hợp tiến độ học tập — KHÔNG phải năng lực,
 * chỉ là dữ liệu bổ trợ cho phân tích
 */
export interface LearningProgressSummary {
  // Course progress
  totalCourses: number;
  completedCourses: number;
  inProgressCourses: number;
  averageCourseProgress: number;      // 0-100
  completionRate: number;             // 0-100

  // Quiz performance (supporting, NOT skill evidence)
  quizPerformance: QuizPerformanceSummary;

  // Learning paths
  activeLearningPaths: number;
  completedPaths: number;

  // Time
  totalStudyHours: number;
  streakDays: number;

  // Certificates
  totalCertificates: number;
  courseCertificates: number;
  pathCertificates: number;

  // Final projects
  totalProjectSubmissions: number;
  evaluatedProjects: number;
  averageProjectScore: number;        // 0-100
}

/**
 * Quiz performance summary — dữ liệu bổ trợ, KHÔNG map sang skill
 */
export interface QuizPerformanceSummary {
  totalQuizAttempts: number;
  averageQuizScore: number;           // 0-100
  quizPassRate: number;               // 0-100
  coursesWithQuizData: number;        // Số khóa có quiz score
}

// ==================== Skill Assessment ====================

/**
 * Đánh giá một kỹ năng cụ thể
 * Nguồn chính: UserSkillProfile (evidence từ ProjectEvaluation)
 */
export interface SkillAssessment {
  skill: string;                      // Display name: "React", "Node.js"
  canonicalName: string;              // Lowercase: "react", "node.js"
  category: string;                   // "Frontend", "Backend", etc.
  level: SkillLevel;                  // Từ UserSkillProfile
  confidence: number;                 // 0-1
  score: number;                      // 0-100, weighted aggregate từ evidences
  evidenceCount: number;              // Số evidence từ evaluations
  sources: SkillEvidenceSourceType[]; // Loại evidence: ["PROJECT_EVALUATION"]
}

export type SkillEvidenceSourceType = 'PROJECT_EVALUATION' | 'QUIZ' | 'COURSE_COMPLETION' | 'CAREER_ASSESSMENT';

// ==================== Strengths / Weaknesses ====================

/**
 * Mục điểm mạnh hoặc điểm yếu
 */
export interface StrengthWeaknessItem {
  area: string;                       // Tên lĩnh vực: "React", "Code Structure"
  category: string;                   // "Frontend", "Software Design"
  detail: string;                     // Mô tả chi tiết
  source: StrengthWeaknessSource;     // Nguồn phát hiện
  confidence: number;                 // 0-1
}

export type StrengthWeaknessSource =
  | 'SKILL_PROFILE'                   // Từ UserSkillProfile strengths/weaknesses
  | 'PROJECT_EVALUATION'              // Từ ProjectEvaluation results
  | 'QUIZ_PERFORMANCE'               // Từ quiz scores (supporting)
  | 'LEARNING_PROGRESS';             // Từ course progress patterns

// ==================== Career Fit Analysis ====================

/**
 * Phân tích mức độ phù hợp với một mục tiêu nghề nghiệp
 */
export interface CareerFitAnalysis {
  careerGoal: string;                 // Mục tiêu: "Full-stack Developer"
  pathId: string;                     // LearningPath ID
  pathTitle: string;
  fitScore: number;                   // 0-100, weighted scoring
  fitLevel: CareerFitLevel;           // Mức phù hợp

  // Chi tiết skill gap
  totalRequiredSkills: number;
  matchedSkills: SkillGapItem[];      // MET
  improvableSkills: SkillGapItem[];   // NEEDS_IMPROVEMENT
  missingSkills: SkillGapItem[];      // MISSING

  recommendation: string;             // Đề xuất ngắn gọn (deterministic, không AI)
}

export type CareerFitLevel =
  | 'EXCELLENT'                       // fitScore >= 80
  | 'GOOD'                            // fitScore >= 60
  | 'DEVELOPING'                      // fitScore >= 40
  | 'EARLY_STAGE';                    // fitScore < 40

/**
 * Skill gap item — so sánh kỹ năng hiện tại vs yêu cầu
 */
export interface SkillGapItem {
  skill: string;
  currentLevel: SkillLevel;
  requiredLevel: SkillLevel;          // Từ LearningPath config hoặc fallback INTERMEDIATE
  gap: SkillGapStatus;
  currentScore: number;               // 0-100
}

export type SkillGapStatus = 'MET' | 'NEEDS_IMPROVEMENT' | 'MISSING';

// ==================== Data Source Tracking ====================

/**
 * Theo dõi nguồn dữ liệu đã sử dụng trong phân tích
 */
export interface DataSourceUsed {
  source: string;                     // "CourseProgress", "UserSkillProfile", etc.
  recordCount: number;                // Số record đã dùng
  hasData: boolean;                   // Có dữ liệu hay không
}

// ==================== Cache Invalidation ====================

/**
 * Các event trigger invalidation cache LearnerAnalysis
 */
export type InvalidationEvent =
  | 'PROJECT_EVALUATION_COMPLETED'    // Đánh giá đồ án xong
  | 'SKILL_PROFILE_UPDATED'          // Skill profile cập nhật
  | 'COURSE_COMPLETED'               // Hoàn thành khóa học
  | 'QUIZ_COMPLETED'                 // Hoàn thành quiz
  | 'PATH_ENROLLMENT_CHANGED'        // Thay đổi lộ trình
  | 'CAREER_GOAL_CHANGED'            // Thay đổi mục tiêu nghề nghiệp
  | 'MANUAL_REFRESH';                // User yêu cầu refresh

// ==================== Overall Level Rules ====================

/**
 * Cấu hình rules cho xác định overall level
 * 
 * BEGINNER:
 *   - Mới có evidence cơ bản
 *   - < 3 skills có evidence HOẶC phần lớn BEGINNER
 * 
 * INTERMEDIATE:
 *   - Nhiều evidence + ít nhất 1 project evidence ở mức tương ứng
 *   - >= 3 skills có evidence, đa số INTERMEDIATE+
 * 
 * ADVANCED:
 *   - Evidence mạnh ở nhiều skill + project complexity phù hợp
 *   - >= 5 skills có evidence, đa số ADVANCED
 *   - Có ít nhất 2 project evaluations passed
 */
export interface LevelDeterminationCriteria {
  minimumSkillsWithEvidence: number;
  minimumProjectEvaluations: number;
  dominantLevelThreshold: number;     // % skills phải ở level này trở lên
}

export const LEVEL_RULES: Record<string, LevelDeterminationCriteria> = {
  ADVANCED: {
    minimumSkillsWithEvidence: 5,
    minimumProjectEvaluations: 2,
    dominantLevelThreshold: 0.5,      // >= 50% skills ở ADVANCED
  },
  INTERMEDIATE: {
    minimumSkillsWithEvidence: 3,
    minimumProjectEvaluations: 1,
    dominantLevelThreshold: 0.5,      // >= 50% skills ở INTERMEDIATE+
  },
  BEGINNER: {
    minimumSkillsWithEvidence: 0,
    minimumProjectEvaluations: 0,
    dominantLevelThreshold: 0,
  },
};

// ==================== Career Fit Score Weights ====================

/**
 * Trọng số khi tính Career Fit Score
 * MET đóng góp đầy đủ, NEEDS_IMPROVEMENT đóng góp một phần, MISSING = 0
 */
export const CAREER_FIT_WEIGHTS: Record<SkillGapStatus, number> = {
  MET: 1.0,
  NEEDS_IMPROVEMENT: 0.5,
  MISSING: 0,
};

/**
 * Ngưỡng Career Fit Level
 */
export const CAREER_FIT_THRESHOLDS: Record<CareerFitLevel, number> = {
  EXCELLENT: 80,
  GOOD: 60,
  DEVELOPING: 40,
  EARLY_STAGE: 0,
};

/**
 * Default required level khi LearningPath.skills không có level
 * Đây là FALLBACK TẠM THỜI, không phải dữ liệu nghề nghiệp chính thức
 */
export const DEFAULT_REQUIRED_LEVEL: SkillLevel = 'INTERMEDIATE';

/**
 * TTL cho cache LearnerAnalysis (safety fallback)
 * Primary invalidation = event-driven
 */
export const ANALYSIS_CACHE_TTL_HOURS = 6;
