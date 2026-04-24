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
import { authenticateToken } from './middleware/auth.middleware';
import {
  validateLessonComplete,
  validateCourseId,
  validateUserId,
  validatePagination,
  handleValidationErrors,
} from './middleware/validation.middleware';
import logger from './utils/logger';

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

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;

