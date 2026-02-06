import express, { Router } from 'express';
import * as authController from '../controllers/authController';

const router: Router = express.Router();

// Public routes
router.get('/health', authController.healthCheck);
router.post('/register', authController.register);
router.post('/login', authController.login);

// Protected routes (in production, use JWT middleware)
router.post('/verify-token', authController.verifyToken);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);

export default router;
