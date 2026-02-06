import express, { Router } from 'express';
import * as courseController from '../controllers/courseController';

const router: Router = express.Router();

router.get('/health', courseController.healthCheck);
router.get('/', courseController.getAllCourses);
router.post('/', courseController.createCourse);
router.get('/:courseId', courseController.getCourseById);
router.put('/:courseId', courseController.updateCourse);
router.delete('/:courseId', courseController.deleteCourse);

export default router;
