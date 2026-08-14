import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ProgressController } from './controllers/progress.controller';
import { CertificateController } from './controllers/certificate.controller';
import { BadgeController } from './controllers/badge.controller';
import { ActivityController } from './controllers/activity.controller';
import { QuizController } from './controllers/quiz.controller';
import { AssignmentController } from './controllers/assignment.controller';
import { TaskController } from './controllers/task.controller';
import { StreamController } from './controllers/stream.controller';
import { HLSController } from './controllers/hls.controller';
import { RecommendationController } from './controllers/recommendation.controller';
import { AdminPathController } from './controllers/admin-path.controller';
import { AnalyticsController } from './controllers/analytics.controller';
import { authenticateToken, authenticateOptional } from './middleware/auth.middleware';
import {
  validateLessonComplete,
  validateCourseId,
  validateUserId,
  validatePagination,
  handleValidationErrors,
} from './middleware/validation.middleware';
import logger from './utils/logger';
import { initializeVideosBucket, initializeCertificatesBucket } from './config/minio.config';
import { videoUpload } from './config/multer.config';
import { HLSQueueService } from './services/hls-queue.service';

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'], credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    const path = req.originalUrl || req.path;
    return path.includes('/internal') || path.includes('/health') || req.headers['x-internal-service'] === 'true';
  }
});
app.use('/api/learning', limiter);

app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

app.get('/api/learning/health', ProgressController.healthCheck);

// Progress routes
app.get('/api/learning/progress/me', authenticateToken, ProgressController.getUserProgress);
app.get('/api/learning/stats', authenticateToken, ProgressController.getLearningStats);
app.post('/api/learning/sync-enrollments', authenticateToken, ProgressController.syncEnrollments);
app.get('/api/learning/courses/enrolled', authenticateToken, validatePagination, handleValidationErrors, ProgressController.getEnrolledCourses);
app.get('/api/learning/progress/course/:courseId', authenticateToken, validateCourseId, handleValidationErrors, ProgressController.getCourseProgress);
app.get('/api/learning/progress/course/:courseId/students', validateCourseId, handleValidationErrors, ProgressController.getCourseStudents);
app.get('/api/learning/progress/course/:courseId/students/:userId', validateCourseId, validateUserId, handleValidationErrors, ProgressController.getStudentCourseProgress);
app.post('/api/learning/progress/:courseId/:lessonId/complete', authenticateToken, validateLessonComplete, handleValidationErrors, ProgressController.markLessonComplete);
app.post('/api/learning/courses/:courseId/enroll', authenticateToken, validateCourseId, handleValidationErrors, ProgressController.enrollInCourse);

// Internal routes (Service-to-service)
app.post('/api/learning/internal/courses/:courseId/enroll', validateCourseId, handleValidationErrors, ProgressController.enrollInCourseInternal);

// Certificate routes
app.post('/api/learning/certificates/:courseId/generate', authenticateToken, validateCourseId, handleValidationErrors, CertificateController.generateCertificate);
app.get('/api/learning/certificates/me', authenticateToken, validatePagination, handleValidationErrors, CertificateController.getUserCertificates);
app.get('/api/learning/certificates/verify/:certificateNumber', CertificateController.verifyCertificate);
app.get('/api/learning/certificates/:certificateId/detail', authenticateToken, CertificateController.getCertificateDetail);
app.get('/api/learning/certificates/:certificateId/download', authenticateToken, CertificateController.downloadCertificate);

// Badge routes
app.get('/api/learning/badges/me', authenticateToken, BadgeController.getUserBadges);

// Activity routes
app.post('/api/learning/activity', authenticateToken, ActivityController.logActivity);
app.get('/api/learning/activity/me', authenticateToken, validatePagination, handleValidationErrors, ActivityController.getUserActivities);

// ==================== Quiz Routes ====================
app.post('/api/learning/quiz/:lessonId', authenticateToken, QuizController.createQuiz);
app.get('/api/learning/quiz/lesson/:lessonId', authenticateToken, QuizController.getQuizByLesson);
app.put('/api/learning/quiz/:quizId', authenticateToken, QuizController.updateQuiz);
app.delete('/api/learning/quiz/:quizId', authenticateToken, QuizController.deleteQuiz);
app.post('/api/learning/quiz/:quizId/start', authenticateToken, QuizController.startAttempt);
app.post('/api/learning/quiz/attempt/:attemptId/submit', authenticateToken, QuizController.submitQuiz);
app.get('/api/learning/quiz/:quizId/attempts/me', authenticateToken, QuizController.getUserAttempts);
app.get('/api/learning/quiz/:quizId/attempts', authenticateToken, QuizController.getAllAttempts);

// ==================== Assignment Routes ====================
app.post('/api/learning/assignment/:lessonId', authenticateToken, AssignmentController.createAssignment);
app.get('/api/learning/assignment/lesson/:lessonId', authenticateToken, AssignmentController.getAssignmentByLesson);
app.put('/api/learning/assignment/:assignmentId', authenticateToken, AssignmentController.updateAssignment);
app.delete('/api/learning/assignment/:assignmentId', authenticateToken, AssignmentController.deleteAssignment);
app.post('/api/learning/assignment/:assignmentId/submit', authenticateToken, AssignmentController.submitAssignment);
app.post('/api/learning/assignment/:assignmentId/upload-url', authenticateToken, AssignmentController.getUploadUrl);
app.get('/api/learning/assignment/:assignmentId/submissions', authenticateToken, AssignmentController.getSubmissions);
app.get('/api/learning/assignment/:assignmentId/submission/me', authenticateToken, AssignmentController.getUserSubmission);
app.put('/api/learning/assignment/submission/:submissionId/grade', authenticateToken, AssignmentController.gradeSubmission);

// ==================== Task Routes ====================
app.get('/api/learning/course/:courseId/tasks', authenticateToken, TaskController.getCourseTasks);
app.get('/api/learning/tasks/pending', authenticateToken, TaskController.getUserTasks);
app.get('/api/learning/tasks/:taskId/detail', authenticateToken, TaskController.getTaskDetail);

// ==================== Learning Analytics Routes ====================
app.get('/api/learning/analytics/study-patterns', authenticateToken, AnalyticsController.getStudyPatterns);
app.get('/api/learning/analytics/reminders', authenticateToken, AnalyticsController.getStudyReminders);
app.get('/api/learning/analytics/heatmap', authenticateToken, AnalyticsController.getStudyHeatmap);
app.get('/api/learning/analytics/weekly-report', authenticateToken, AnalyticsController.getWeeklyReport);
app.get('/api/learning/analytics/optimal-schedule', authenticateToken, AnalyticsController.getOptimalSchedule);
app.get('/api/learning/analytics/my-schedule', authenticateToken, AnalyticsController.getMySchedule);
app.post('/api/learning/analytics/my-schedule', authenticateToken, AnalyticsController.saveMySchedule);
app.get('/api/learning/analytics/content-recommendations', authenticateToken, AnalyticsController.getContentRecommendations);

// ==================== Recommendation & Learning Paths Routes ====================
app.get('/api/learning/recommendations/home', authenticateOptional, RecommendationController.getHomeRecommendations);
app.get('/api/learning/recommendations', authenticateToken, RecommendationController.getPersonalizedRecommendations);
app.get('/api/learning/recommendations/insights', authenticateToken, RecommendationController.getLearningInsights);
app.get('/api/learning/recommendations/next-actions', authenticateToken, RecommendationController.getSmartNextActions);
app.get('/api/learning/paths/my-paths', authenticateToken, RecommendationController.getMyEnrolledPaths);
app.get('/api/learning/paths/categories', authenticateToken, RecommendationController.getPathCategories);
app.get('/api/learning/paths', authenticateToken, RecommendationController.getLearningPaths);
app.get('/api/learning/paths/:pathId', authenticateToken, RecommendationController.getLearningPathDetail);
app.post('/api/learning/paths/:pathId/enroll', authenticateToken, RecommendationController.enrollInPath);
app.delete('/api/learning/paths/:pathId/enroll', authenticateToken, RecommendationController.unenrollFromPath);

// ==================== Admin Learning Paths Routes ====================
// Note: In a real app we'd add requireRole('ADMIN') middleware, but authenticateToken is used for simplicity/current system constraints
app.get('/api/learning/admin/paths', authenticateToken, AdminPathController.getPaths);
app.get('/api/learning/admin/paths/:id', authenticateToken, AdminPathController.getPathById);
app.post('/api/learning/admin/paths', authenticateToken, AdminPathController.createPath);
app.put('/api/learning/admin/paths/:id', authenticateToken, AdminPathController.updatePath);
app.delete('/api/learning/admin/paths/:id', authenticateToken, AdminPathController.deletePath);
app.put('/api/learning/admin/paths/:id/status', authenticateToken, AdminPathController.updateStatus);
app.post('/api/learning/admin/paths/:id/duplicate', authenticateToken, AdminPathController.duplicatePath);

// ==================== Video Streaming Routes ====================
// Secure video streaming via presigned URLs (Udemy-style protection)
// JWT auth required → verifies course purchase → generates short-lived presigned URL
app.get('/api/learning/lessons/:lessonId/stream', authenticateToken, StreamController.getLessonStream);

// ==================== HLS Streaming Routes ====================
// HLS video processing and streaming (Udemy-style adaptive streaming)

// Instructor: upload video for HLS processing
app.post('/api/learning/lessons/:lessonId/upload-video', authenticateToken, videoUpload.single('video'), HLSController.uploadVideo);

// Check video processing job status
app.get('/api/learning/video-jobs/:jobId/status', authenticateToken, HLSController.getJobStatus);

// Student: get presigned URL for HLS master.m3u8 playlist
app.get('/api/learning/lessons/:lessonId/hls', authenticateToken, HLSController.getHLSStream);

// Student: get signed .m3u8 playlist with presigned .ts segment URLs
app.get('/api/learning/lessons/:lessonId/hls/playlist', HLSController.getSignedPlaylist);

import { hlsRateLimiter, fileRateLimiter } from './middleware/rate-limit.middleware';

// Student: get a specific .ts segment from the signed proxy
app.get('/api/learning/lessons/:lessonId/hls/segment/:segmentFile', hlsRateLimiter, HLSController.getSegmentStream);

// Student: get the AES-128 key to decrypt segments
app.get('/api/learning/lessons/:lessonId/hls/key', hlsRateLimiter, HLSController.getKeyStream);

// ==================== File Routes ====================
import { FileController } from './controllers/file.controller';
app.get('/api/learning/files/download', authenticateToken, fileRateLimiter, FileController.downloadFile);

// ==================== Course Exam Routes ====================
import { CourseExamController } from './controllers/course-exam.controller';
app.get('/api/learning/exam/course/:courseId/result', authenticateToken, CourseExamController.getCourseExamResult);
app.post('/api/learning/exam/course/:courseId/retake', authenticateToken, CourseExamController.retakeCourse);

// ==================== Final Project Routes ====================
import { FinalProjectController } from './controllers/final-project.controller';
app.post('/api/learning/final-project/:pathId', authenticateToken, FinalProjectController.createFinalProject);
app.get('/api/learning/final-project/:pathId', authenticateToken, FinalProjectController.getFinalProject);
app.put('/api/learning/final-project/:projectId', authenticateToken, FinalProjectController.updateFinalProject);
app.post('/api/learning/final-project/:projectId/submit', authenticateToken, FinalProjectController.submitFinalProject);
app.post('/api/learning/final-project/:projectId/upload-url', authenticateToken, FinalProjectController.getUploadUrl);
app.get('/api/learning/final-project/:projectId/submissions', authenticateToken, FinalProjectController.getSubmissions);
app.get('/api/learning/final-project/:projectId/submission/me', authenticateToken, FinalProjectController.getUserSubmission);
app.get('/api/learning/final-project/:projectId/submissions/me', authenticateToken, FinalProjectController.getUserSubmissions);
app.put('/api/learning/final-project/submission/:submissionId/grade', authenticateToken, FinalProjectController.gradeSubmission);
app.post('/api/learning/final-project/:submissionId/evaluate', authenticateToken, FinalProjectController.evaluateSubmission);
app.get('/api/learning/final-project/:pathId/unlock-status', authenticateToken, FinalProjectController.getUnlockStatus);

// ==================== Path Certificate Route ====================
app.post('/api/learning/certificates/path/:pathId/generate', authenticateToken, CertificateController.generatePathCertificate);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize MinIO private video bucket on startup
initializeVideosBucket().catch((err) => {
  logger.error('Failed to initialize MinIO video bucket:', err);
});

// Initialize MinIO public certificates bucket on startup
initializeCertificatesBucket().catch((err) => {
  logger.error('Failed to initialize MinIO certificates bucket:', err);
});

// Resume any pending HLS processing jobs from last run
HLSQueueService.resumePendingJobs().catch((err) => {
  logger.error('Failed to resume HLS processing jobs:', err);
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;

