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
  LESSON_START = 'LESSON_START',
  LESSON_COMPLETE = 'LESSON_COMPLETE',
  QUIZ_ATTEMPT = 'QUIZ_ATTEMPT',
  QUIZ_PASS = 'QUIZ_PASS',
  CERTIFICATE_GENERATED = 'CERTIFICATE_GENERATED',
  CERTIFICATE_REVOKED = 'CERTIFICATE_REVOKED',
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
