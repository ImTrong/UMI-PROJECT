import express, { Router } from 'express';
import * as learningController from '../controllers/learningController';

const router: Router = express.Router();

router.get('/health', learningController.healthCheck);

// Progress routes
router.get('/progress/:userId', learningController.getUserProgress);
router.get('/progress/:userId/:courseId', learningController.getCourseProgress);
router.post('/progress/:userId/:courseId/:lessonId/complete', learningController.markLessonComplete);

// Certificate routes
router.post('/certificates/:userId/:courseId', learningController.generateCertificate);
router.get('/certificates/:userId', learningController.getUserCertificates);

// Activity tracking
router.post('/activity/:userId', learningController.trackActivity);

export default router;
