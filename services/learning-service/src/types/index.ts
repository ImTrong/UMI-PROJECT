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
  [key: string]: any;
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
  averageQuizScore: number;
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


