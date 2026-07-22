import { learningApi } from './api';

export interface UserProgress {
  id: string;
  userId: string;
  totalCoursesEnrolled: number;
  totalCoursesCompleted: number;
  totalLessonsCompleted: number;
  totalStudyTime: number;
  streakDays: number;
  lastActivityDate?: string;
  createdAt: string;
  updatedAt: string;
  courses: CourseProgress[];
  certificates: Certificate[];
  badges: Badge[];
}

export interface CourseProgress {
  id: string;
  userId: string;
  courseId: string;
  courseTitle: string;
  enrolledAt: string;
  completedAt?: string;
  progressPercentage: number;
  totalLessons: number;
  completedLessons: number;
  timeSpentSeconds: number;
  lastAccessedAt: string;
  lessons: LessonProgress[];
}

export interface LessonProgress {
  id: string;
  userId: string;
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  completed: boolean;
  completedAt?: string;
  timeSpentSeconds: number;
  lastWatchedAt: string;
  watchCount: number;
}

export interface Certificate {
  id: string;
  certificateNumber: string;
  userId: string;
  courseId?: string;
  learningPathId?: string;
  courseTitle: string;
  userName: string;
  type: 'COURSE_COMPLETION' | 'PATH_CERTIFICATE';
  averageScore?: number;
  issueDate: string;
  expiresAt?: string;
  certificateUrl?: string;
  verificationUrl: string;
  isVerified: boolean;
}

export interface Badge {
  id: string;
  userId: string;
  badgeName: string;
  badgeType: string;
  description?: string;
  iconUrl?: string;
  earnedAt: string;
}

export interface Question {
  id: string;
  text?: string;
  questionText?: string;
  type?: 'MULTIPLE_CHOICE' | 'MULTI_SELECT' | 'TRUE_FALSE';
  questionType?: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  options: Array<{ id: string; text: string }>;
  points: number;
}

export interface Quiz {
  id: string;
  courseId: string;
  lessonId: string;
  title: string;
  description: string;
  timeLimitMinutes: number;
  passingScore: number;
  maxAttempts: number;
  questions: Question[];
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  userId: string;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'TIMED_OUT';
  startedAt: string;
  submittedAt?: string;
  score?: number;
  passed?: boolean;
}

export interface Assignment {
  id: string;
  courseId: string;
  lessonId: string;
  title: string;
  description: string;
  instructions?: string;
  dueDate?: string;
  maxScore: number;
  allowLateSubmission: boolean;
  allowedFileTypes: string[];
  maxFileSizeMB?: number;
}

export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  userId: string;
  status: 'SUBMITTED' | 'GRADING' | 'GRADED' | 'RETURNED';
  content?: string;
  fileUrl?: string;
  fileName?: string;
  submittedAt?: string;
  score?: number;
  feedback?: string;
  gradedAt?: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  courseId?: string;
  lessonId?: string;
  action: string;
  durationSeconds: number;
  metadata: any;
  createdAt: string;
}

export interface TaskItem {
  id: string;
  type: 'QUIZ' | 'ASSIGNMENT';
  title: string;
  courseId: string;
  courseTitle?: string;
  lessonId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'LATE';
  score?: number;
  dueDate?: string;
  maxScore?: number;
  passingScore?: number;
}

export interface LearningStats {
  overall: {
    totalCoursesEnrolled: number;
    totalCoursesCompleted: number;
    totalLessonsCompleted: number;
    totalStudyTimeHours: number;
    streakDays: number;
    completionRate: number;
  };
  weeklyActivity: Array<{ action: string; _count: number }>;
  dailyActivity: Array<{ date: string; count: number; studyTime: number }>;
}

export interface StudyTimeAnalytics {
  dailyStudyTime: Record<string, number>;
  totalStudyTimeHours: number;
  averageDailyMinutes: number;
  topCourses: Array<{
    courseId: string;
    hoursSpent: number;
  }>;
}

export interface LearningPathRecommendations {
  completedCourses: number;
  inProgressCourses: number;
  recommendations: any[];
  nextSteps: Array<{
    type: string;
    message: string;
    priority: string;
    action?: string;
  }>;
}

export const learningService = {
  // Progress
  async getUserProgress(): Promise<UserProgress> {
    const response = await learningApi.get('/api/learning/progress/me');
    return response.data.data;
  },

  async getCourseProgress(courseId: string): Promise<CourseProgress> {
    const response = await learningApi.get(`/api/learning/progress/course/${courseId}`);
    return response.data.data;
  },

  async markLessonComplete(
    courseId: string,
    lessonId: string,
    timeSpent?: number
  ): Promise<{ lessonProgress: LessonProgress; courseProgress: CourseProgress; isNewCompletion: boolean; courseCompleted: boolean; missingQuizzes: boolean }> {
    const response = await learningApi.post(`/api/learning/progress/${courseId}/${lessonId}/complete`, {
      timeSpent,
    });
    return response.data.data;
  },

  async enrollInCourse(courseId: string): Promise<CourseProgress> {
    const response = await learningApi.post(`/api/learning/courses/${courseId}/enroll`);
    return response.data.data;
  },

  async getEnrolledCourses(page: number = 1, limit: number = 10, filter?: string): Promise<{
    courses: CourseProgress[];
    pagination: any;
  }> {
    let url = `/api/learning/courses/enrolled?page=${page}&limit=${limit}`;
    if (filter) {
      url += `&filter=${filter}`;
    }
    const response = await learningApi.get(url);
    return response.data;
  },

  async getLearningStats(): Promise<LearningStats> {
    const response = await learningApi.get('/api/learning/stats');
    return response.data.data;
  },

  async getStudyTimeAnalytics(days: number = 30): Promise<StudyTimeAnalytics> {
    const response = await learningApi.get(`/api/learning/analytics/study-time?days=${days}`);
    return response.data.data;
  },

  async getRecommendations(): Promise<LearningPathRecommendations> {
    const response = await learningApi.get('/api/learning/recommendations');
    return response.data.data;
  },

  async syncEnrollments(): Promise<{ syncedCount: number }> {
    const response = await learningApi.post('/api/learning/sync-enrollments');
    return response.data.data;
  },

  async getRecentActivity(limit: number = 20): Promise<ActivityLog[]> {
    const response = await learningApi.get(`/api/learning/activity/recent?limit=${limit}`);
    return response.data.data;
  },

  async resetCourseProgress(courseId: string): Promise<void> {
    await learningApi.delete(`/api/learning/progress/${courseId}/reset`);
  },

  // Certificates
  async generateCertificate(courseId: string): Promise<Certificate> {
    const response = await learningApi.post(`/api/learning/certificates/${courseId}/generate`);
    return response.data.data;
  },

  async getUserCertificates(page: number = 1, limit: number = 10): Promise<{
    data: Certificate[];
    pagination: any;
  }> {
    const response = await learningApi.get(`/api/learning/certificates/me?page=${page}&limit=${limit}`);
    return response.data;
  },

  async verifyCertificate(certificateNumber: string): Promise<{
    valid: boolean;
    message: string;
    certificate?: Certificate;
  }> {
    const response = await learningApi.get(`/api/learning/certificates/verify/${certificateNumber}`);
    return response.data;
  },

  async revokeCertificate(certificateId: string): Promise<void> {
    await learningApi.delete(`/api/learning/certificates/${certificateId}`);
  },

  async getCertificateById(certificateId: string): Promise<Certificate> {
    const response = await learningApi.get(`/api/learning/certificates/${certificateId}/detail`);
    return response.data.data;
  },

  async downloadCertificate(certificateId: string): Promise<void> {
    const response = await learningApi.get(`/api/learning/certificates/${certificateId}/download`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `certificate-${certificateId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },

  // Badges
  async getUserBadges(): Promise<Badge[]> {
    const response = await learningApi.get('/api/learning/badges/me');
    return response.data.data;
  },

  // Activity
  async logActivity(data: {
    action: string;
    courseId?: string;
    lessonId?: string;
    durationSeconds?: number;
    metadata?: any;
  }): Promise<void> {
    await learningApi.post('/api/learning/activity', data);
  },

  async getUserActivities(page: number = 1, limit: number = 20): Promise<{
    data: ActivityLog[];
    pagination: any;
  }> {
    const response = await learningApi.get(`/api/learning/activity/me?page=${page}&limit=${limit}`);
    return response.data;
  },

  // Quizzes
  async getQuizByLesson(lessonId: string): Promise<Quiz> {
    const response = await learningApi.get(`/api/learning/quiz/lesson/${lessonId}`);
    return response.data.data;
  },

  async startQuiz(quizId: string): Promise<QuizAttempt> {
    const response = await learningApi.post(`/api/learning/quiz/${quizId}/start`);
    return response.data.data;
  },

  async submitQuiz(attemptId: string, answers: any[]): Promise<{ attempt: QuizAttempt; results: any; courseCompleted: boolean }> {
    const response = await learningApi.post(`/api/learning/quiz/attempt/${attemptId}/submit`, { answers });
    return response.data.data;
  },

  async getQuizAttempts(quizId: string): Promise<any[]> {
    const response = await learningApi.get(`/api/learning/quiz/${quizId}/attempts/me`);
    return response.data.data;
  },

  // Assignments
  async getAssignmentByLesson(lessonId: string): Promise<Assignment> {
    const response = await learningApi.get(`/api/learning/assignment/lesson/${lessonId}`);
    return response.data.data;
  },

  async getUploadUrl(assignmentId: string, fileName: string, contentType: string): Promise<{ uploadUrl: string; fileUrl: string }> {
    const response = await learningApi.post(`/api/learning/assignment/${assignmentId}/upload-url`, { fileName, contentType });
    return response.data.data;
  },

  async submitAssignment(assignmentId: string, data: { courseId: string; content?: string; fileUrl?: string; fileKey?: string; fileName?: string }): Promise<AssignmentSubmission> {
    const response = await learningApi.post(`/api/learning/assignment/${assignmentId}/submit`, data);
    return response.data.data;
  },

  async getMyAssignmentSubmission(assignmentId: string): Promise<AssignmentSubmission> {
    const response = await learningApi.get(`/api/learning/assignment/${assignmentId}/submission/me`);
    return response.data.data;
  },

  // Tasks
  async getCourseTasks(courseId: string): Promise<Record<string, Array<'QUIZ' | 'ASSIGNMENT'>>> {
    const response = await learningApi.get(`/api/learning/course/${courseId}/tasks`);
    return response.data.data;
  },

  async getPendingTasks(): Promise<TaskItem[]> {
    const response = await learningApi.get('/api/learning/tasks/pending');
    return response.data.data;
  },

  async getTaskDetail(taskId: string, type: 'QUIZ' | 'ASSIGNMENT'): Promise<any> {
    const response = await learningApi.get(`/api/learning/tasks/${taskId}/detail?type=${type}`);
    return response.data.data;
  },

  // ---------------------------------------------------------------------------
  // INSTRUCTOR TOOLS
  // ---------------------------------------------------------------------------
  
  // Instructor: Quizzes
  async createQuiz(data: Omit<Quiz, 'id'>): Promise<Quiz> {
    const response = await learningApi.post(`/api/learning/quiz/${data.lessonId}`, data);
    return response.data.data;
  },

  async updateQuiz(quizId: string, data: Partial<Quiz>): Promise<Quiz> {
    const response = await learningApi.put(`/api/learning/quiz/${quizId}`, data);
    return response.data.data;
  },

  async deleteQuiz(quizId: string): Promise<void> {
    await learningApi.delete(`/api/learning/quiz/${quizId}`);
  },

  // Instructor: Assignments
  async createAssignment(data: Omit<Assignment, 'id'>): Promise<Assignment> {
    const response = await learningApi.post(`/api/learning/assignment/${data.lessonId}`, data);
    return response.data.data;
  },

  async updateAssignment(assignmentId: string, data: Partial<Assignment>): Promise<Assignment> {
    const response = await learningApi.put(`/api/learning/assignment/${assignmentId}`, data);
    return response.data.data;
  },

  async deleteAssignment(assignmentId: string): Promise<void> {
    await learningApi.delete(`/api/learning/assignment/${assignmentId}`);
  },

  async getAssignmentSubmissions(assignmentId: string): Promise<AssignmentSubmission[]> {
    const response = await learningApi.get(`/api/learning/assignment/${assignmentId}/submissions`);
    return response.data.data;
  },

  async gradeSubmission(submissionId: string, data: { score: number; feedback?: string; status: 'GRADED' | 'RETURNED' }): Promise<AssignmentSubmission> {
    const response = await learningApi.put(`/api/learning/assignment/submission/${submissionId}/grade`, data);
    return response.data.data;
  },

  // ---------------------------------------------------------------------------
  // HLS VIDEO STREAMING
  // ---------------------------------------------------------------------------

  /** Get presigned URL for HLS master.m3u8 playlist (student) */
  async getHLSStream(lessonId: string): Promise<{
    streamUrl: string;
    expiresIn: number;
    lesson: { id: string; title: string; duration: number; order: number };
    hls: { ready: boolean; segmentCount?: number };
  }> {
    const response = await learningApi.get(`/api/learning/lessons/${lessonId}/hls`);
    return response.data;
  },

  /** Get signed .m3u8 playlist with presigned segment URLs (student) */
  async getSignedPlaylist(lessonId: string): Promise<string> {
    const response = await learningApi.get(`/api/learning/lessons/${lessonId}/hls/playlist`, {
      responseType: 'text',
    });
    return response.data;
  },

  /** Upload a video file for HLS processing (instructor) */
  async uploadVideo(
    lessonId: string,
    courseId: string,
    videoFile: File,
    onProgress?: (percent: number) => void
  ): Promise<{ message: string; jobId: string; status: string }> {
    const formData = new FormData();
    formData.append('video', videoFile);
    formData.append('courseId', courseId);

    const response = await learningApi.post(
      `/api/learning/lessons/${lessonId}/upload-video?courseId=${courseId}`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        },
      }
    );
    return response.data;
  },

  /** Check video processing job status (instructor) */
  async getVideoJobStatus(jobId: string): Promise<{
    jobId: string;
    status: string;
    hlsPath?: string;
    segmentCount?: number;
    durationSeconds?: number;
    error?: string;
    createdAt: string;
    updatedAt: string;
  }> {
    const response = await learningApi.get(`/api/learning/video-jobs/${jobId}/status`);
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // COURSE EXAM (Tổng kết khóa học)
  // ---------------------------------------------------------------------------

  async getCourseExamResult(courseId: string): Promise<CourseExamResult> {
    const response = await learningApi.get(`/api/learning/exam/course/${courseId}/result`);
    return response.data.data;
  },

  async retakeCourse(courseId: string): Promise<{ message: string; retakeCount: number }> {
    const response = await learningApi.post(`/api/learning/exam/course/${courseId}/retake`);
    return response.data.data;
  },

  // ---------------------------------------------------------------------------
  // FINAL PROJECTS (Project cuối lộ trình)
  // ---------------------------------------------------------------------------

  async getFinalProject(pathId: string): Promise<FinalProject | null> {
    try {
      const response = await learningApi.get(`/api/learning/final-project/${pathId}`);
      return response.data.data;
    } catch {
      return null;
    }
  },

  async submitFinalProject(projectId: string, data: { learningPathId: string; content?: string; githubUrl?: string; demoUrl?: string; fileUrl?: string; fileKey?: string; fileName?: string }): Promise<FinalProjectSubmission> {
    const response = await learningApi.post(`/api/learning/final-project/${projectId}/submit`, data);
    return response.data.data;
  },

  async getFinalProjectUploadUrl(projectId: string, fileName: string, contentType: string): Promise<{ uploadUrl: string; fileUrl: string; fileKey: string }> {
    const response = await learningApi.post(`/api/learning/final-project/${projectId}/upload-url`, { fileName, contentType });
    return response.data.data;
  },

  async getMyFinalProjectSubmission(projectId: string): Promise<FinalProjectSubmission | null> {
    try {
      const response = await learningApi.get(`/api/learning/final-project/${projectId}/submission/me`);
      return response.data.data;
    } catch {
      return null;
    }
  },

  async getMyAllFinalProjectSubmissions(projectId: string): Promise<FinalProjectSubmission[]> {
    const response = await learningApi.get(`/api/learning/final-project/${projectId}/submissions/me`);
    return response.data.data;
  },

  async evaluateSubmission(submissionId: string): Promise<any> {
    const response = await learningApi.post(`/api/learning/final-project/${submissionId}/evaluate`);
    return response.data.data;
  },

  async getFinalProjectUnlockStatus(pathId: string): Promise<{ unlocked: boolean; reasons: string[]; completedCourses: number; totalCourses: number }> {
    const response = await learningApi.get(`/api/learning/final-project/${pathId}/unlock-status`);
    return response.data.data;
  },

  async generatePathCertificate(pathId: string): Promise<Certificate> {
    const response = await learningApi.post(`/api/learning/certificates/path/${pathId}/generate`);
    return response.data.data;
  },
};

// ==================== Course Exam Types ====================

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

export interface EvaluationStage {
  stageNumber: number;
  title: string;
  objective: string;
  criteria: string;
  maxScore: number;
  weight: number;
  passCriteria: string;
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

export interface FinalProject {
  id: string;
  learningPathId: string;
  title: string;
  description: string;
  instructions?: string;
  objectives?: string;
  references?: { title: string; url: string }[];
  maxScore: number;
  passingScore: number;
  allowedFileTypes: string[];
  maxFileSizeMB: number;
  maxAttempts: number;
  deadline?: string;
  evaluationPipeline?: EvaluationStage[];
  createdBy: string;
  createdAt: string;
}

export interface FinalProjectSubmission {
  id: string;
  finalProjectId: string;
  userId: string;
  learningPathId: string;
  attemptNumber: number;
  content?: string;
  githubUrl?: string;
  demoUrl?: string;
  fileUrl?: string;
  fileName?: string;
  status: 'SUBMITTED' | 'GRADING' | 'GRADED' | 'RETURNED';
  score?: number;
  totalScore?: number;
  stageResults?: StageResult[];
  feedback?: string;
  aiFeedback?: string;
  gradedAt?: string;
  submittedAt: string;
}

