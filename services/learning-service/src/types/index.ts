// types/index.ts

export interface UserDetails {
  id: string;
  email: string;
  fullName: string;
  role?: string;
}

export interface CourseDetails {
  id: string;
  title: string;
  description: string;
  instructorId: string;
  price: number;
  level: string;
  published: boolean;
  lessons?: LessonDetails[];
}

export interface LessonDetails {
  id: string;
  title: string;
  description?: string;
  videoUrl: string;
  duration: number;
  order: number;
  isPreview: boolean;
}

export interface CertificateMetadata {
  courseInstructor?: string;
  courseLevel?: string;
  completionDate?: Date;
  totalStudyTime?: number;
  grade?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  pathTitle?: string;
  finalProjectScore?: number;
  certificateConfig?: any;
  blockchain?: BlockchainMetadata;
  [key: string]: any;
}

// ==================== Blockchain Types ====================

export type BlockchainStatus = 'NOT_REGISTERED' | 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REVOKED' | 'REVOKE_PENDING' | 'REVOKE_FAILED';

export interface BlockchainMetadata {
  network: string;
  chainId: number;
  contractAddress: string;
  certificateIdHash: string;
  documentHash: string;
  transactionHash?: string;
  status: BlockchainStatus;
  registeredAt?: string;
  revokedAt?: string;
  revokeTransactionHash?: string;
  [key: string]: string | number | undefined;
}


export interface ActivityMetadata {
  lessonTitle?: string;
  courseTitle?: string;
  progressPercentage?: number;
  completedLessons?: number;
  totalLessons?: number;
  timeSpent?: number;
  certificateNumber?: string;
  badgeName?: string;
  [key: string]: any;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface HealthCheckResult {
  service: string;
  status: 'active' | 'degraded';
  timestamp: string;
  uptime?: number;
  database: 'connected' | 'disconnected';
}

// Enums
export enum ActivityAction {
  COURSE_ENROLL = 'COURSE_ENROLL',
  COURSE_COMPLETE = 'COURSE_COMPLETE',
  COURSE_RETAKE = 'COURSE_RETAKE',
  LESSON_START = 'LESSON_START',
  LESSON_COMPLETE = 'LESSON_COMPLETE',
  QUIZ_ATTEMPT = 'QUIZ_ATTEMPT',
  QUIZ_PASS = 'QUIZ_PASS',
  CERTIFICATE_GENERATED = 'CERTIFICATE_GENERATED',
  CERTIFICATE_REVOKED = 'CERTIFICATE_REVOKED',
  PATH_CERTIFICATE_GENERATED = 'PATH_CERTIFICATE_GENERATED',
  FINAL_PROJECT_SUBMITTED = 'FINAL_PROJECT_SUBMITTED',
  FINAL_PROJECT_GRADED = 'FINAL_PROJECT_GRADED',
  BADGE_EARNED = 'BADGE_EARNED',
  REVIEW_SUBMITTED = 'REVIEW_SUBMITTED',
}

export enum BadgeType {
  COURSE_COMPLETER = 'COURSE_COMPLETER',
  STREAK_MASTER = 'STREAK_MASTER',
  EARLY_BIRD = 'EARLY_BIRD',
  NIGHT_OWL = 'NIGHT_OWL',
  SPEED_LEARNER = 'SPEED_LEARNER',
  CONSISTENT_LEARNER = 'CONSISTENT_LEARNER',
  TOP_CONTRIBUTOR = 'TOP_CONTRIBUTOR',
  PERFECT_SCORE = 'PERFECT_SCORE',
}

export interface BadgeConfig {
  name: string;
  description: string;
  icon: string;
}

export const BADGE_CONFIG: Record<BadgeType, BadgeConfig> = {
  [BadgeType.COURSE_COMPLETER]: {
    name: 'Course Completer',
    description: 'Completed a full course',
    icon: '🏆',
  },
  [BadgeType.STREAK_MASTER]: {
    name: 'Streak Master',
    description: 'Studied for 7 days in a row',
    icon: '🔥',
  },
  [BadgeType.EARLY_BIRD]: {
    name: 'Early Bird',
    description: 'Completed a lesson before 8 AM',
    icon: '🌅',
  },
  [BadgeType.NIGHT_OWL]: {
    name: 'Night Owl',
    description: 'Completed a lesson after 10 PM',
    icon: '🦉',
  },
  [BadgeType.SPEED_LEARNER]: {
    name: 'Speed Learner',
    description: 'Completed a course in under 24 hours',
    icon: '⚡',
  },
  [BadgeType.CONSISTENT_LEARNER]: {
    name: 'Consistent Learner',
    description: 'Studied for 30 days in a row',
    icon: '📅',
  },
  [BadgeType.TOP_CONTRIBUTOR]: {
    name: 'Top Contributor',
    description: 'Active contributor to the community',
    icon: '⭐',
  },
  [BadgeType.PERFECT_SCORE]: {
    name: 'Perfect Score',
    description: 'Got 100% on a quiz',
    icon: '💯',
  },
};

// ==================== Course Exam Result ====================

export interface CourseExamResult {
  courseId: string;
  courseTitle: string;
  averageQuizScore: number | null;
  passingScore: number;
  passed: boolean;
  totalQuizzes: number;
  completedQuizzes: number;
  quizResults: {
    quizId: string;
    lessonId: string;
    lessonTitle: string;
    bestScore: number;
    passed: boolean;
    attempts: number;
  }[];
  allowRetake: boolean;
  retakeCount: number;
}

// ==================== Final Project Types ====================

export type SubmissionFieldType =
  | 'FILE'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'GITHUB_LINK'
  | 'DEMO_LINK'
  | 'FIGMA_LINK'
  | 'TEXT'
  | 'CUSTOM';

export interface SubmissionTypeConfig {
  type: SubmissionFieldType;
  label: string;
  description?: string;
  required: boolean;
  accept?: string;       // For FILE/IMAGE/VIDEO/AUDIO: e.g. ".pdf,.doc,.docx"
  maxSizeMB?: number;    // For file uploads
  placeholder?: string;  // For link/text types
}

export interface SubmissionDataItem {
  type: SubmissionFieldType;
  label: string;
  value: string;         // URL or text content
  fileName?: string;
  fileKey?: string;
  fileSize?: number;
}

export interface EvaluationStage {
  stageNumber: number;
  title: string;
  objective: string;
  criteria: string;
  maxScore: number;
  weight: number;
  passCriteria: string;
  expectedOutput?: string;  // Kết quả đầu ra mong muốn
  // === Optional hints cho Evidence Retriever (GĐ2) ===
  keywords?: string[];       // VD: ["controller", "route", "middleware"]
  directories?: string[];    // VD: ["controllers/", "routes/"]
  filePatterns?: string[];   // VD: ["*.controller.ts", "*.route.ts"]
  // === GĐ3: Skill mapping — criterion → skills ===
  skillMapping?: {
    skill: string;           // Canonical display name: "React", "Express.js"
    category: string;        // "Frontend", "Backend", "DevOps"
    weight?: number;         // 0-1, mức criterion phản ánh skill (default: 1.0)
  }[];
}

export interface StageResult {
  stageNumber: number;
  title: string;
  score: number;
  maxScore: number;
  weightedScore: number;
  passed: boolean;
  feedback: string;
  details: string[];
}

export interface EvaluationResult {
  stageResults: StageResult[];
  totalScore: number;
  passed: boolean;
  feedbackReport: string;
}

export interface FinalProjectData {
  learningPathId: string;
  title: string;
  description: string;
  instructions?: string;
  objectives?: string;
  references?: { title: string; url: string }[];
  maxScore?: number;
  passingScore?: number;
  allowedFileTypes?: string[];
  maxFileSizeMB?: number;
  maxAttempts?: number;
  deadline?: string;
  submissionTypes?: SubmissionTypeConfig[];
  evaluationPipeline?: EvaluationStage[];
}

// ==================== Phase 1: Project Analysis Types ====================

export enum ProcessingStatus {
  UPLOADED = 'UPLOADED',
  ANALYZING = 'ANALYZING',
  ANALYSIS_FAILED = 'ANALYSIS_FAILED',
  READY_FOR_EVALUATION = 'READY_FOR_EVALUATION',
  EVALUATING = 'EVALUATING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/** Cây thư mục dạng cây lồng nhau */
export interface DirectoryNode {
  name: string;
  type: 'file' | 'directory';
  language?: string;       // For files
  size?: number;           // For files (bytes)
  children?: DirectoryNode[];
}

/** Thông tin index cho từng file source — phân tích trực tiếp, KHÔNG dùng AI */
export interface SourceFileIndexEntry {
  path: string;            // Relative path from project root
  language: string;        // Detected language
  lineCount: number;
  imports: string[];       // Import statements / require()
  exports: string[];       // Export statements
  isEntryPoint: boolean;   // Main entry file?
  directory: string;       // Parent directory
}

/** Code chunk — đoạn code có thể truy xuất theo rubric */
export interface CodeChunk {
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;         // Actual code content
  language: string;
}

/** Thông tin GitHub repository */
export interface GitHubInfo {
  repoUrl: string;
  owner: string;
  repoName: string;
  stars?: number;
  commitCount?: number;
  branches?: string[];
  lastCommitDate?: string;
  contributors?: number;
  defaultBranch?: string;
}

/**
 * Project Context — lớp dữ liệu trung gian cho Evaluation Engine (GĐ2)
 * Cấu trúc:
 *   metadata → tech stack, project type
 *   structure → directory tree, file count
 *   artifacts → README, package info, config files
 *   sourceIndex → file index với imports/exports (không AI summarize)
 *   codeChunks → đoạn code có thể truy xuất theo rubric
 *   github → repo info (nếu có)
 */
export interface ProjectContext {
  metadata: {
    projectType: string;         // web-app, api, mobile, cli, library, fullstack
    primaryLanguage: string;
    techStack: {
      languages: string[];
      frameworks: string[];
      libraries: string[];
    };
  };
  structure: {
    totalFiles: number;
    totalLines: number;
    analyzedFiles: number;
    directoryTree: DirectoryNode;
    entryPoints: string[];
  };
  artifacts: {
    readme?: string;             // README content (truncated to max 5000 chars)
    packageInfo?: any;           // Parsed package.json / requirements.txt
    configFiles: {
      path: string;
      type: string;              // "eslint", "tsconfig", "docker", "env", etc.
      content: string;           // Content (truncated)
    }[];
  };
  sourceIndex: SourceFileIndexEntry[];
  codeChunks: CodeChunk[];
  github?: GitHubInfo;
}

/** Config giới hạn bảo mật khi xử lý ZIP */
export interface ZipSecurityConfig {
  maxZipSizeMB: number;           // Max ZIP file size (default: 100MB)
  maxExtractedSizeMB: number;     // Max total extracted size (default: 500MB)
  maxFileCount: number;           // Max number of files after extraction (default: 5000)
  maxSingleFileSizeMB: number;    // Max size of a single file (default: 50MB)
}

/** Kết quả phân tích project */
export interface ProjectAnalysisResult {
  projectType: string;
  primaryLanguage: string;
  languages: string[];
  frameworks: string[];
  libraries: string[];
  directoryStructure: DirectoryNode;
  totalFiles: number;
  totalLines: number;
  analyzedFiles: number;
  readmeContent?: string;
  packageInfo?: any;
  configFiles: { path: string; type: string; content: string }[];
  sourceFileIndex: SourceFileIndexEntry[];
  codeChunks: CodeChunk[];
  entryPoints: string[];
  githubInfo?: GitHubInfo;
}

// ==================== Phase 2: Evaluation Pipeline Types ====================

/** Reference tới 1 evidence chunk — dùng chunkId từ hệ thống, KHÔNG để AI tự tạo line numbers */
export interface EvidenceChunkRef {
  chunkId: string;          // ID duy nhất: "filePath::chunkIndex"
  filePath: string;
  startLine: number;
  endLine: number;
}

/** Evidence package gửi cho AI để đánh giá 1 criterion */
export interface EvidencePackage {
  overview: string;           // Project overview text (metadata + structure)
  chunks: {
    chunkId: string;          // "src/controllers/auth.controller.ts::0"
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
    content: string;          // Actual code
  }[];
  relevantConfigs: {
    path: string;
    type: string;
    content: string;
  }[];
  readme?: string;            // README excerpt if relevant
}

/**
 * Kết quả đánh giá 1 criterion
 * - criterionId = string (ID thực trong DB)
 * - passed được tính bởi BACKEND từ passCriteria, KHÔNG phải AI
 * - Bao gồm snapshot cấu hình criterion tại thời điểm đánh giá
 */
export interface CriterionResult {
  // Snapshot cấu hình criterion (bảo toàn khi rubric bị sửa sau này)
  criterionId: string;        // ID thực tế, không phải số thứ tự
  title: string;
  maxScore: number;
  weight: number;
  passCriteria: string;
  objective: string;
  criteria: string;

  // Kết quả đánh giá
  score: number;              // AI chấm
  weightedScore: number;      // Backend tính: (score / maxScore) × weight × 100
  passed: boolean;            // Backend tính từ passCriteria, KHÔNG phải AI

  // Evidence references (chunkId-based)
  evidenceUsed: EvidenceChunkRef[];

  // AI analysis
  strengths: string[];
  weaknesses: string[];
  feedback: string;
  suggestions: string[];
}

/** Kết quả đánh giá tổng hợp toàn project */
export interface ProjectEvaluationResult {
  totalScore: number;         // Tổng weighted score
  passingScore: number;
  passed: boolean;            // Backend: totalScore >= passingScore
  criterionResults: CriterionResult[];
  passedCriteria: string[];   // Tên criterion đã đạt
  failedCriteria: string[];   // Tên criterion chưa đạt
  overallStrengths: string[];
  overallWeaknesses: string[];
  feedbackReport: string;     // AI comprehensive report
}

/** Score aggregation output */
export interface AggregatedScore {
  totalScore: number;
  passed: boolean;
  criterionScores: {
    criterionId: string;
    title: string;
    score: number;
    maxScore: number;
    weightedScore: number;
    passed: boolean;
  }[];
}

/** Raw AI response for a single criterion (before backend processing) */
export interface AICriterionResponse {
  score: number;
  evidenceUsed: { chunkId: string; filePath: string }[];
  strengths: string[];
  weaknesses: string[];
  feedback: string;
  suggestions: string[];
}

// ==================== Phase 3: Skill Profile Types ====================

/** Skill level — tính từ weighted evidence aggregate, KHÔNG từ score trực tiếp */
export type SkillLevel = 'NO_EVIDENCE' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

/** Evidence source — chỉ PROJECT_EVALUATION cho GĐ3A */
export type SkillEvidenceSource = 'PROJECT_EVALUATION' | 'QUIZ' | 'COURSE_COMPLETION' | 'CAREER_ASSESSMENT';

/** Evidence từ 1 lần đánh giá — lưu nguyên, KHÔNG convert */
export interface SkillEvidence {
  source: SkillEvidenceSource;
  sourceId: string;           // evaluationId
  detail: string;             // "Đạt 85% tiêu chí 'Áp dụng MVC Pattern'"
  scorePercentage: number;    // 0-100, raw score percentage
  weight: number;             // Trọng số evidence (PROJECT_EVALUATION = 1.0)
  date: string;               // ISO date
}

/** 1 skill entry trong UserSkillProfile */
export interface SkillEntry {
  canonicalName: string;      // Lowercase normalized: "react", "express.js"
  displayName: string;        // Human-readable: "React", "Express.js"
  category: string;           // "Frontend", "Backend", "DevOps"
  level: SkillLevel;          // Tính từ weighted aggregate, KHÔNG từ 1 score
  confidence: number;         // 0.0 - 1.0, dựa trên số lượng + chất lượng evidence
  evidences: SkillEvidence[]; // Toàn bộ lịch sử evidence
  lastUpdated: string;        // ISO date
}

/** Skill update từ 1 evaluation — chỉ mang evidence, chưa tính level */
export interface SkillUpdate {
  canonicalName: string;
  displayName: string;
  category: string;
  evidence: SkillEvidence;
}

/** Dashboard summary */
export interface SkillSummary {
  totalSkills: number;
  skillsByLevel: Record<string, number>; // { BEGINNER: 3, INTERMEDIATE: 2, ADVANCED: 1 }
  topSkills: { skill: string; level: SkillLevel; confidence: number }[];
  weakSkills: { skill: string; level: SkillLevel; confidence: number }[];
  strengths: string[];
  weaknesses: string[];
  overallLevel: string;
  profileCompleteness: number;
}

/** Skill gap analysis — current vs target */
export interface SkillGapResult {
  skill: string;
  currentLevel: SkillLevel;
  requiredLevel: SkillLevel;
  gap: 'MET' | 'NEEDS_IMPROVEMENT' | 'MISSING';
  confidence: number;
}
