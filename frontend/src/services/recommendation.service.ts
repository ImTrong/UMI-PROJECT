import { learningApi } from './api';

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  shortDescription?: string;
  slug: string;
  category?: string;
  difficulty: string;
  imageUrl?: string;
  bannerUrl?: string;
  careerGoal?: string;
  skills?: string[];
  courseIds: string[];
  totalDurationMinutes: number;
  enrollmentCount: number;
  recommended: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserPathEnrollment {
  id: string;
  userId: string;
  learningPathId: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  enrolledAt: string;
  completedAt?: string;
  lastUpdatedAt: string;
}

export interface Milestone {
  courseId: string;
  title: string;
  slug: string;
  thumbnail?: string;
  description?: string;
  price: number;
  totalLessons: number;
  completedLessons: number;
  estimatedHours: number;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  progressPercentage: number;
  isLocked?: boolean;
  lockedReason?: string;
}

export interface PathSummary {
  totalEstimatedHours: number;
  totalPrice: number;
  totalLessons: number;
  totalMilestones: number;
}

export interface PathDetailResponse {
  path: LearningPath;
  milestones: Milestone[];
  enrollment: UserPathEnrollment | null;
  progress: {
    completedCourses: number;
    totalCourses: number;
    progressPercentage: number;
  };
  summary: PathSummary;
}

export interface CategoryInsight {
  categoryId: string;
  categoryName: string;
  courseCount: number;
  completedCount: number;
  totalTimeHours: number;
  averageProgress: number;
}

export interface SkillStrength {
  category: string;
  score: number;
  label: string;
}

export interface LearningInsights {
  categoryDistribution: CategoryInsight[];
  skillStrengths: SkillStrength[];
  suggestedFocusAreas: Array<{
    category: string;
    reason: string;
  }>;
  weeklyProgress: {
    lessonsThisWeek: number;
    lessonsLastWeek: number;
    trend: 'up' | 'down' | 'stable';
    trendPercentage: number;
  };
  totalStats: {
    totalCourses: number;
    completedCourses: number;
    totalHours: number;
    averageCompletionRate: number;
    activePaths: number;
  };
}

export interface SmartAction {
  id: string;
  type: 'RESUME_COURSE' | 'COMPLETE_PATH' | 'PENDING_TASK' | 'ABANDONED_COURSE' | 'NEW_PATH' | 'NEW_COURSE';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  icon: string;
  actionUrl: string;
  metadata?: {
    progressPercentage?: number;
    lastAccessedDaysAgo?: number;
    courseTitle?: string;
    pathTitle?: string;
    pathId?: string;
  };
}

export interface EnrolledPathSummary {
  pathId: string;
  pathTitle: string;
  pathDescription: string;
  pathCategory: string | null;
  pathDifficulty: string;
  pathImageUrl: string | null;
  enrolledAt: string;
  status: string;
  completedCourses: number;
  totalCourses: number;
  progressPercentage: number;
  lastActivityAt: string | null;
  nextMilestone: {
    courseId: string;
    courseTitle: string;
    progressPercentage: number;
  } | null;
}

export interface PathFilters {
  categories?: string[];
  difficulties?: string[];
  search?: string;
  sortBy?: 'newest' | 'oldest' | 'name_asc' | 'name_desc';
}

export const recommendationService = {
  async getPersonalizedRecommendations(limit: number = 4): Promise<any[]> {
    const response = await learningApi.get(`/api/learning/recommendations?limit=${limit}`);
    return response.data.data;
  },

  async getLearningInsights(): Promise<LearningInsights> {
    const response = await learningApi.get('/api/learning/recommendations/insights');
    return response.data.data;
  },

  async getSmartNextActions(): Promise<SmartAction[]> {
    const response = await learningApi.get('/api/learning/recommendations/next-actions');
    return response.data.data;
  },

  async getMyEnrolledPaths(): Promise<EnrolledPathSummary[]> {
    const response = await learningApi.get('/api/learning/paths/my-paths');
    return response.data.data;
  },

  async getLearningPaths(filters?: PathFilters): Promise<LearningPath[]> {
    let url = '/api/learning/paths';
    const params = new URLSearchParams();
    
    if (filters) {
      if (filters.categories && filters.categories.length > 0) params.append('categories', filters.categories.join(','));
      if (filters.difficulties && filters.difficulties.length > 0) params.append('difficulties', filters.difficulties.join(','));
      if (filters.search) params.append('search', filters.search);
      if (filters.sortBy) params.append('sortBy', filters.sortBy);
    }
    
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const response = await learningApi.get(url);
    return response.data.data;
  },

  async getPathCategories(): Promise<string[]> {
    const response = await learningApi.get('/api/learning/paths/categories');
    return response.data.data;
  },

  async getLearningPathDetail(pathId: string): Promise<PathDetailResponse> {
    const response = await learningApi.get(`/api/learning/paths/${pathId}`);
    return response.data.data;
  },

  async enrollInPath(pathId: string): Promise<UserPathEnrollment> {
    const response = await learningApi.post(`/api/learning/paths/${pathId}/enroll`);
    return response.data.data;
  },

  async unenrollFromPath(pathId: string): Promise<void> {
    await learningApi.delete(`/api/learning/paths/${pathId}/enroll`);
  },

  async getHomeRecommendations(): Promise<HomeRecommendations> {
    const response = await learningApi.get('/api/learning/recommendations/home');
    return response.data.data;
  },
};

// ─── Home Recommendations Types ──────────────────────────────────────────────

export interface RecommendedCourse {
  id: string;
  title: string;
  slug: string;
  thumbnail?: string;
  price: number;
  rating: number;
  totalReviews: number;
  enrolledCount: number;
  level: string;
  category?: { id: string; name: string };
  recommendationReason?: string;
  progressPercentage?: number;
  lastAccessedAt?: string;
  completedLessons?: number;
  totalLessons?: number;
}

export interface RecommendationSection {
  title: string;
  subtitle?: string;
  courses: RecommendedCourse[];
  type: string;
  viewedCourseTitle?: string;
}

export interface HomeRecommendations {
  continueLearning?: RecommendationSection | null;
  becauseYouViewed?: RecommendationSection[];
  forYou?: RecommendationSection | null;
  pathBased?: RecommendationSection | null;
  skillUpgrade?: RecommendationSection | null;
  trendingInField?: RecommendationSection | null;
  learnersLikeYou?: RecommendationSection | null;
  coldStart?: RecommendationSection[];
}
