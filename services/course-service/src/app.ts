import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { CourseController } from './controllers/course.controller';
import { LessonController } from './controllers/lesson.controller';
import { ReviewController } from './controllers/review.controller';
import { CategoryController } from './controllers/category.controller';
import { authenticateToken, requireRole, requireInstructorOrAdmin, authenticateOptional } from './middleware/auth.middleware';
import {
  validateCreateCourse,
  validateUpdateCourse,
  validateCreateLesson,
  validateCreateReview,
  validateCreateCategory,
  validateCourseId,
  validateLessonId,
  validateReviewId,
  validateCategoryId,
  validatePagination,
  handleValidationErrors,
} from './middleware/validation.middleware';
import logger from './utils/logger';

const app = express();
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/courses', limiter);

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Health check (no authentication required)
app.get('/api/courses/health', CourseController.healthCheck);

// ==================== Category Routes ====================

app.get('/api/categories', CategoryController.getAllCategories);
app.get('/api/categories/stats', CategoryController.getCategoryStats);
app.get('/api/categories/:categoryId', validateCategoryId, handleValidationErrors, CategoryController.getCategoryById);
app.get('/api/categories/slug/:slug', CategoryController.getCategoryBySlug);

app.post(
  '/api/categories',
  authenticateToken,
  requireRole(['ADMIN']),
  validateCreateCategory,
  handleValidationErrors,
  CategoryController.createCategory
);

app.put(
  '/api/categories/:categoryId',
  authenticateToken,
  requireRole(['ADMIN']),
  validateCategoryId,
  validateCreateCategory,
  handleValidationErrors,
  CategoryController.updateCategory
);

app.delete(
  '/api/categories/:categoryId',
  authenticateToken,
  requireRole(['ADMIN']),
  validateCategoryId,
  handleValidationErrors,
  CategoryController.deleteCategory
);

// ==================== Course Routes ====================

// Public routes (static paths MUST come before dynamic :courseId)
app.get('/api/courses', validatePagination, handleValidationErrors, CourseController.getAllCourses);
app.get('/api/courses/analytics', authenticateToken, requireRole(['ADMIN']), CourseController.getAnalytics);

// Admin Approval routes
app.get('/api/courses/admin/pending', authenticateToken, requireRole(['ADMIN']), CourseController.getPendingCourses);
app.post('/api/courses/:courseId/approve', authenticateToken, requireRole(['ADMIN']), validateCourseId, handleValidationErrors, CourseController.approveCourse);
app.post('/api/courses/:courseId/reject', authenticateToken, requireRole(['ADMIN']), validateCourseId, handleValidationErrors, CourseController.rejectCourse);

// Instructor Dashboard routes
app.get('/api/courses/instructor/dashboard', authenticateToken, requireInstructorOrAdmin, CourseController.getInstructorDashboard);
app.get('/api/courses/instructor/:courseId/students', authenticateToken, requireInstructorOrAdmin, validateCourseId, handleValidationErrors, CourseController.getCourseStudents);
app.get('/api/courses/instructor/:courseId/students/:studentId', authenticateToken, requireInstructorOrAdmin, validateCourseId, handleValidationErrors, CourseController.getCourseStudentDetail);

app.get('/api/courses/slug/:slug', authenticateOptional, CourseController.getCourseBySlug);

// Protected routes - Instructor/Admin only
app.post(
  '/api/courses',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCreateCourse,
  handleValidationErrors,
  CourseController.createCourse
);

app.get(
  '/api/courses/me',
  authenticateToken,
  requireInstructorOrAdmin,
  CourseController.getMyCourses
);

app.post(
  '/api/courses/batch',
  authenticateToken,
  CourseController.getBatchCourses
);

// Internal route for recommendation engine (service-to-service)
app.post(
  '/api/courses/recommendations/batch',
  CourseController.getRecommendationBatch
);

// Internal route for other services
app.post(
  '/api/courses/:courseId/increment-enrollment',
  CourseController.incrementEnrollment
);
app.get(
  '/api/courses/internal/:courseId/lessons',
  validateCourseId,
  handleValidationErrors,
  LessonController.getCourseLessonsInternal
);
app.get(
  '/api/courses/internal/:courseId/lessons/:lessonId',
  validateCourseId,
  validateLessonId,
  handleValidationErrors,
  LessonController.getLessonByIdInternal
);

// ==================== File Routes ====================
import { FileController } from './controllers/file.controller';

app.get(
  '/api/courses/files/download',
  authenticateOptional,
  FileController.downloadFile
);

// Dynamic param route - MUST be after /slug/:slug, /me, /files/*
app.get('/api/courses/:courseId', authenticateOptional, validateCourseId, handleValidationErrors, CourseController.getCourseById);

app.put(
  '/api/courses/:courseId',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCourseId,
  validateUpdateCourse,
  handleValidationErrors,
  CourseController.updateCourse
);

app.delete(
  '/api/courses/:courseId',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCourseId,
  handleValidationErrors,
  CourseController.deleteCourse
);

app.post(
  '/api/courses/:courseId/publish',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCourseId,
  handleValidationErrors,
  CourseController.publishCourse
);


// ==================== Lesson Routes ====================

app.post(
  '/api/courses/:courseId/upload-url',
  authenticateToken,
  requireInstructorOrAdmin,
  handleValidationErrors,
  LessonController.getUploadUrl
);

app.get(
  '/api/courses/:courseId/lessons',
  authenticateOptional,
  validateCourseId,
  handleValidationErrors,
  LessonController.getCourseLessons
);

app.get(
  '/api/courses/:courseId/lessons/:lessonId',
  authenticateOptional,
  validateCourseId,
  validateLessonId,
  handleValidationErrors,
  LessonController.getLessonById
);

// Protected lesson routes - Instructor/Admin only
app.post(
  '/api/courses/:courseId/lessons',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCourseId,
  validateCreateLesson,
  handleValidationErrors,
  LessonController.createLesson
);

app.put(
  '/api/courses/:courseId/lessons/:lessonId',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCourseId,
  validateLessonId,
  validateCreateLesson,
  handleValidationErrors,
  LessonController.updateLesson
);

app.delete(
  '/api/courses/:courseId/lessons/:lessonId',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCourseId,
  validateLessonId,
  handleValidationErrors,
  LessonController.deleteLesson
);

app.post(
  '/api/courses/:courseId/lessons/reorder',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCourseId,
  handleValidationErrors,
  LessonController.reorderLessons
);

// ==================== Review Routes ====================

// Public routes - view reviews
app.get(
  '/api/courses/:courseId/reviews',
  validateCourseId,
  handleValidationErrors,
  ReviewController.getCourseReviews
);

app.get(
  '/api/courses/:courseId/reviews/distribution',
  validateCourseId,
  handleValidationErrors,
  ReviewController.getRatingDistribution
);

// Protected review routes - Authenticated users
app.post(
  '/api/courses/:courseId/reviews',
  authenticateToken,
  validateCourseId,
  validateCreateReview,
  handleValidationErrors,
  ReviewController.createReview
);

app.get(
  '/api/courses/:courseId/reviews/me',
  authenticateToken,
  validateCourseId,
  handleValidationErrors,
  ReviewController.getUserReview
);

app.put(
  '/api/reviews/:reviewId',
  authenticateToken,
  validateReviewId,
  validateCreateReview,
  handleValidationErrors,
  ReviewController.updateReview
);

app.delete(
  '/api/reviews/:reviewId',
  authenticateToken,
  validateReviewId,
  handleValidationErrors,
  ReviewController.deleteReview
);

// User's all reviews
app.get(
  '/api/users/me/reviews',
  authenticateToken,
  validatePagination,
  handleValidationErrors,
  ReviewController.getUserReviews
);

// ==================== Search Routes ====================

app.get(
  '/api/search/courses',
  validatePagination,
  handleValidationErrors,
  CourseController.getAllCourses
);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
