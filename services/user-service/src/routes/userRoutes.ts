import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  addEducation,
  updateEducation,
  deleteEducation,
  addWorkExperience,
  updateWorkExperience,
  deleteWorkExperience,
  updatePreferences,
  addBadge,
  healthCheck
} from '../controllers/userController';
import { authenticate, authorize, requireOwnership } from '../middleware/auth';

const router = Router();

// Public routes
router.get('/health', healthCheck);
router.post('/', createUser); // Bỏ xác thực cho việc tạo user mới

// Protected routes
router.use(authenticate);

// User CRUD operations
router.get('/', authorize('ADMIN'), getAllUsers);
router.get('/:userId', requireOwnership('userId'), getUserById);
router.put('/:userId', requireOwnership('userId'), updateUser);
router.delete('/:userId', authorize('ADMIN'), deleteUser);

// Education management
router.post('/:userId/education', requireOwnership('userId'), addEducation);
router.put('/education/:educationId', requireOwnership('userId'), updateEducation);
router.delete('/education/:educationId', requireOwnership('userId'), deleteEducation);

// Work experience management
router.post('/:userId/work', requireOwnership('userId'), addWorkExperience);
router.put('/work/:workId', requireOwnership('userId'), updateWorkExperience);
router.delete('/work/:workId', requireOwnership('userId'), deleteWorkExperience);

// Preferences
router.put('/:userId/preferences', requireOwnership('userId'), updatePreferences);

// Badges
router.post('/:userId/badges', authorize('ADMIN'), addBadge);

export default router;
