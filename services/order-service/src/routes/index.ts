import express, { Router } from 'express';
import * as orderController from '../controllers/orderController';

const router: Router = express.Router();

router.get('/health', orderController.healthCheck);
router.get('/', orderController.getAllOrders);
router.post('/', orderController.createOrder);
router.get('/:orderId', orderController.getOrderById);
router.patch('/:orderId/status', orderController.updateOrderStatus);

export default router;
