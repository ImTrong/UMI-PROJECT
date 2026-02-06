import express, { Router } from 'express';
import * as paymentController from '../controllers/paymentController';

const router: Router = express.Router();

router.get('/health', paymentController.healthCheck);
router.post('/intents', paymentController.createPaymentIntent);
router.post('/confirm', paymentController.confirmPayment);
router.get('/:paymentId', paymentController.getPaymentDetails);
router.post('/:paymentId/refund', paymentController.processRefund);

export default router;
