import express, { Router } from 'express';
import * as userController from '../controllers/userController';

const router: Router = express.Router();

router.get('/health', userController.healthCheck);
router.get('/', userController.getAllUsers);
router.post('/', userController.createUser);
router.get('/:userId', userController.getUserById);
router.put('/:userId', userController.updateUser);
router.delete('/:userId', userController.deleteUser);

export default router;
