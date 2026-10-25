import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { CourseController } from './controllers/course.controller';
import { LessonController } from './controllers/lesson.controller';
import { ReviewController } from './controllers/review.controller';
import { CategoryController } from './controllers/category.controller';
import { CourseService } from './services/course.service';
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
  validateReorderLessons,
  validateUploadUrl,
  validateRecommendationBatch,
  allowOnlyFields,
  handleValidationErrors,
} from './middleware/validation.middleware';
import { COURSE_WRITABLE_FIELDS, LESSON_WRITABLE_FIELDS, UPLOAD_URL_FIELDS } from './utils/course-fields';
import { requireServiceToken } from './middleware/service-token.middleware';
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
  skip: (req) => {
    const path = req.originalUrl || req.path;
    // Skip internal paths and health checks
    if (path.includes('/internal') || path.includes('/health')) return true;
    // Skip requests marked as internal service calls
    if (req.headers['x-internal-service'] === 'true') return true;
    // Skip service-to-service calls (no Origin/Referer = not from browser)
    if (!req.headers.origin && !req.headers.referer) return true;
    return false;
  }
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

// Instructor Public Profile routes (no auth required - marketplace style)
app.get('/api/courses/instructor/:instructorId/stats', ReviewController.getInstructorStats);
app.get('/api/courses/instructor/:instructorId/reviews', ReviewController.getInstructorReviews);
app.get('/api/courses/instructor/:instructorId/rating-distribution', ReviewController.getInstructorRatingDistribution);
app.get('/api/courses/instructor/:instructorId/public-courses', async (req, res) => {
  try {
    const { instructorId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await CourseService.getAllCourses(page, limit, { instructorId });
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get instructor courses' });
  }
});

app.get('/api/courses/slug/:slug', authenticateOptional, CourseController.getCourseBySlug);

// Protected routes - Instructor/Admin only
// Content fields only (FIX-INS-02): instructorId / published / approvalStatus / rating / enrolledCount... are refused with 400.
app.post(
  '/api/courses',
  authenticateToken,
  requireInstructorOrAdmin,
  allowOnlyFields(COURSE_WRITABLE_FIELDS),
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
// Called ONLY by the learning-service (home recommendations). FIX-INS-06: only the Course <-> Learning credential
// COURSE_LEARNING_TOKEN in X-Internal-Service-Token (no INTERNAL_SERVICE_TOKEN, no default; fail-closed), and a bounded,
// validated body - it can no longer be used to dump the catalogue or pass operators to the database.
app.post(
  '/api/courses/recommendations/batch',
  requireServiceToken('COURSE_LEARNING_TOKEN'),
  allowOnlyFields(['categoryIds', 'excludeIds', 'levels', 'sortBy', 'limit']),
  validateRecommendationBatch,
  handleValidationErrors,
  CourseController.getRecommendationBatch
);

// Internal route for other services
// Called ONLY by the order-service once an order is fulfilled. It accepts only the Order -> Course credential ORDER_COURSE_TOKEN
// in X-Internal-Service-Token (FIX-INS-03): a browser cannot inflate enrolledCount. No INTERNAL_SERVICE_TOKEN or default; fail-closed.
app.post(
  '/api/courses/:courseId/increment-enrollment',
  requireServiceToken('ORDER_COURSE_TOKEN'),
  validateCourseId,
  handleValidationErrors,
  CourseController.incrementEnrollment
);
// Every lesson of a course WITH its videoUrl - paid content (FIX-INS-06). Called ONLY by the learning-service, which applies the
// learner rules itself (enrolled / owner / preview) before it streams or counts anything. Only COURSE_LEARNING_TOKEN is accepted:
// a browser - or anyone reaching port 3003 directly - gets nothing. Users read lessons through /api/courses/:courseId/lessons*.
// Who owns a lesson (FIX-INS-10): { lessonId, courseId, instructorId } and nothing else, whatever the course status (draft,
// pending, unpublished...). The learning-service uses it to decide who may create / edit / grade an assignment, instead of the
// public course GET that hides unpublished courses. Only COURSE_LEARNING_TOKEN is accepted; fail-closed, no other token.
app.get(
  '/api/courses/internal/lessons/:lessonId/owner',
  requireServiceToken('COURSE_LEARNING_TOKEN'),
  validateLessonId,
  handleValidationErrors,
  LessonController.getLessonOwnerInternal
);
app.get(
  '/api/courses/internal/:courseId/lessons',
  requireServiceToken('COURSE_LEARNING_TOKEN'),
  validateCourseId,
  handleValidationErrors,
  LessonController.getCourseLessonsInternal
);
app.get(
  '/api/courses/internal/:courseId/lessons/:lessonId',
  requireServiceToken('COURSE_LEARNING_TOKEN'),
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
  allowOnlyFields(COURSE_WRITABLE_FIELDS),
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

// Owner of the course only - checked in the controller before any upload URL is created (FIX-INS-02).
app.post(
  '/api/courses/:courseId/upload-url',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCourseId,
  allowOnlyFields(UPLOAD_URL_FIELDS),
  validateUploadUrl,
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

// Protected lesson routes - the course's instructor only (ownership checked in LessonService, FIX-INS-02)
app.post(
  '/api/courses/:courseId/lessons',
  authenticateToken,
  requireInstructorOrAdmin,
  validateCourseId,
  allowOnlyFields(LESSON_WRITABLE_FIELDS),
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
  allowOnlyFields(LESSON_WRITABLE_FIELDS),
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
  validateReorderLessons,
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
  // A body the JSON parser refuses (malformed JSON, a bare string / number, too large) is the client's fault, not a 500.
  const clientStatus = err?.status ?? err?.statusCode;
  if (clientStatus >= 400 && clientStatus < 500) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
