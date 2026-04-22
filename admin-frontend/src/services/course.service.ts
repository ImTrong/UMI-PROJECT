import { courseApi } from './api';

export interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  instructorId: string;
  price: number;
  thumbnail?: string;
  categoryId?: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  language: string;
  whatYouWillLearn?: string;
  requirements: string[];
  targetAudience: string[];
  published: boolean;
  approvalStatus?: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  rating: number;
  totalReviews: number;
  enrolledCount: number;
  createdAt: string;
  updatedAt: string;
  category?: {
    id: string;
    name: string;
    slug: string;
  };
  lessons?: Lesson[];
  reviews?: Review[];
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  videoUrl: string;
  duration: number;
  order: number;
  isPreview: boolean;
  resources?: any[];
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  courseId: string;
  userId: string;
  rating: number;
  comment?: string;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    fullName: string;
    avatar?: string;
  };
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  _count?: {
    courses: number;
  };
}

export interface CreateCourseData {
  title: string;
  description: string;
  price: number;
  level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  categoryId?: string;
  whatYouWillLearn?: string;
  requirements?: string[];
  targetAudience?: string[];
  thumbnail?: string;
}

export interface UpdateCourseData extends Partial<CreateCourseData> {
  published?: boolean;
}

export interface CreateLessonData {
  title: string;
  description?: string;
  videoUrl: string;
  duration: number;
  order?: number;
  isPreview?: boolean;
}

export interface CreateReviewData {
  rating: number;
  comment?: string;
}

export interface CourseFilters {
  page?: number;
  limit?: number;
  categoryId?: string;
  level?: string;
  instructorId?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: 'price' | 'rating' | 'enrolledCount' | 'newest';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedCourses {
  courses: Course[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface InstructorStudentDetail {
  course: {
    id: string;
    title: string;
  };
  student: {
    userId: string;
    fullName: string;
    avatar?: string;
  };
  progress: {
    progressPercentage: number;
    completedLessons: number;
    totalLessons: number;
    enrolledAt?: string;
    lastAccessedAt?: string;
  };
  lessons: Array<{
    lessonId: string;
    title: string;
    order: number;
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
    lastWatchedAt?: string | null;
  }>;
}

export const courseService = {
  // Course CRUD
  async getCourses(filters?: CourseFilters): Promise<PaginatedCourses> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value.toString());
        }
      });
    }
    const response = await courseApi.get(`/api/courses?${params.toString()}`);
    return response.data;
  },

  async getCourseById(courseId: string): Promise<Course> {
    const response = await courseApi.get(`/api/courses/${courseId}`);
    return response.data.data;
  },

  async getCourseBySlug(slug: string): Promise<Course> {
    const response = await courseApi.get(`/api/courses/slug/${slug}`);
    return response.data.data;
  },

  async createCourse(data: CreateCourseData): Promise<Course> {
    const response = await courseApi.post('/api/courses', data);
    return response.data.data;
  },

  async updateCourse(courseId: string, data: UpdateCourseData): Promise<Course> {
    const response = await courseApi.put(`/api/courses/${courseId}`, data);
    return response.data.data;
  },

  async deleteCourse(courseId: string): Promise<void> {
    await courseApi.delete(`/api/courses/${courseId}`);
  },

  async publishCourse(courseId: string): Promise<Course> {
    const response = await courseApi.post(`/api/courses/${courseId}/publish`);
    return response.data.data;
  },

  async getMyCourses(page: number = 1, limit: number = 10): Promise<PaginatedCourses> {
    const response = await courseApi.get(`/api/courses/me?page=${page}&limit=${limit}`);
    return response.data;
  },

  async getBatchCourses(ids: string[]): Promise<Course[]> {
    if (!ids || ids.length === 0) return [];
    const response = await courseApi.post('/api/courses/batch', { ids });
    return response.data.data;
  },

  async getCourseStudents(courseId: string): Promise<any> {
    const response = await courseApi.get(`/api/courses/instructor/${courseId}/students`);
    return response.data.data;
  },

  async getCourseStudentDetail(courseId: string, studentId: string): Promise<InstructorStudentDetail> {
    const response = await courseApi.get(`/api/courses/instructor/${courseId}/students/${studentId}`);
    return response.data.data;
  },

  // Lessons
  async getCourseLessons(courseId: string): Promise<Lesson[]> {
    const response = await courseApi.get(`/api/courses/${courseId}/lessons`);
    return response.data.data;
  },

  async getUploadUrl(courseId: string, fileName: string, contentType: string): Promise<{ uploadUrl: string; fileUrl: string }> {
    const response = await courseApi.post(`/api/courses/${courseId}/upload-url`, { fileName, contentType });
    return response.data.data;
  },

  async createLesson(courseId: string, data: CreateLessonData): Promise<Lesson> {
    const response = await courseApi.post(`/api/courses/${courseId}/lessons`, data);
    return response.data.data;
  },

  async updateLesson(courseId: string, lessonId: string, data: Partial<CreateLessonData>): Promise<Lesson> {
    const response = await courseApi.put(`/api/courses/${courseId}/lessons/${lessonId}`, data);
    return response.data.data;
  },

  async deleteLesson(courseId: string, lessonId: string): Promise<void> {
    await courseApi.delete(`/api/courses/${courseId}/lessons/${lessonId}`);
  },

  async reorderLessons(courseId: string, lessonOrders: { id: string; order: number }[]): Promise<void> {
    await courseApi.post(`/api/courses/${courseId}/lessons/reorder`, { lessonOrders });
  },

  // Reviews
  async getCourseReviews(courseId: string, page: number = 1, limit: number = 10): Promise<{
    reviews: Review[];
    pagination: any;
  }> {
    const response = await courseApi.get(`/api/courses/${courseId}/reviews?page=${page}&limit=${limit}`);
    return response.data;
  },

  async createReview(courseId: string, data: CreateReviewData): Promise<Review> {
    const response = await courseApi.post(`/api/courses/${courseId}/reviews`, data);
    return response.data.data;
  },

  async updateReview(reviewId: string, data: CreateReviewData): Promise<Review> {
    const response = await courseApi.put(`/api/reviews/${reviewId}`, data);
    return response.data.data;
  },

  async deleteReview(reviewId: string): Promise<void> {
    await courseApi.delete(`/api/reviews/${reviewId}`);
  },

  async getUserReview(courseId: string): Promise<Review | null> {
    const response = await courseApi.get(`/api/courses/${courseId}/reviews/me`);
    return response.data.data;
  },

  async getRatingDistribution(courseId: string): Promise<Record<number, number>> {
    const response = await courseApi.get(`/api/courses/${courseId}/reviews/distribution`);
    return response.data.data;
  },

  // Categories
  async getCategories(includeCount: boolean = false): Promise<Category[]> {
    const response = await courseApi.get(`/api/categories?includeCount=${includeCount}`);
    return response.data.data;
  },

  async getCategoryById(categoryId: string, includeCourses: boolean = false): Promise<Category> {
    const response = await courseApi.get(`/api/categories/${categoryId}?includeCourses=${includeCourses}`);
    return response.data.data;
  },

  async getCategoryBySlug(slug: string, includeCourses: boolean = false): Promise<Category> {
    const response = await courseApi.get(`/api/categories/slug/${slug}?includeCourses=${includeCourses}`);
    return response.data.data;
  },

  // Admin category management
  async createCategory(data: { name: string; description?: string; icon?: string }): Promise<Category> {
    const response = await courseApi.post('/api/categories', data);
    return response.data.data;
  },

  async updateCategory(categoryId: string, data: { name?: string; description?: string; icon?: string }): Promise<Category> {
    const response = await courseApi.put(`/api/categories/${categoryId}`, data);
    return response.data.data;
  },

  async deleteCategory(categoryId: string): Promise<void> {
    await courseApi.delete(`/api/categories/${categoryId}`);
  },

  async getAnalytics(): Promise<any> {
    const response = await courseApi.get('/api/courses/analytics');
    return response.data.data;
  },

  // Admin approvals
  async getPendingCourses(page: number = 1, limit: number = 10, searchTerm?: string): Promise<{
    data: Course[];
    pagination: any;
  }> {
    let url = `/api/courses/admin/pending?page=${page}&limit=${limit}`;
    if (searchTerm) {
      url += `&search=${encodeURIComponent(searchTerm)}`;
    }
    const response = await courseApi.get(url);
    return response.data;
  },

  async approveCourse(courseId: string): Promise<Course> {
    const response = await courseApi.post(`/api/courses/${courseId}/approve`);
    return response.data.data;
  },

  async rejectCourse(courseId: string, reason?: string): Promise<Course> {
    const response = await courseApi.post(`/api/courses/${courseId}/reject`, { reason });
    return response.data.data;
  },
};
