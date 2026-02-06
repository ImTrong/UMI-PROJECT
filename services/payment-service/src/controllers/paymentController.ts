import { Request, Response } from 'express';

export const healthCheck = async (req: Request, res: Response) => {
  res.status(200).json({
    service: 'payment-service',
    status: 'active',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected',
    stripeStatus: 'configured', // STUB: Check actual Stripe connection
  });
};

/**
 * Create payment intent (STUB - Stripe sandbox stub)
 */
export const createPaymentIntent = async (req: Request, res: Response) => {
  const { orderId, amount, currency = 'usd' } = req.body;

  // STUB: No actual Stripe integration
  const paymentIntentId = `pi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  res.status(201).json({
    service: 'payment-service',
    action: 'createPaymentIntent',
    status: 'success',
    data: {
      paymentIntentId,
      orderId,
      amount,
      currency,
      status: 'requires_payment_method',
      clientSecret: `${paymentIntentId}_secret_${Math.random().toString(36).substr(2, 20)}`,
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Confirm payment (STUB)
 */
export const confirmPayment = async (req: Request, res: Response) => {
  const { paymentIntentId, paymentMethodId } = req.body;

  // STUB: Always return success
  res.status(200).json({
    service: 'payment-service',
    action: 'confirmPayment',
    status: 'success',
    data: {
      paymentIntentId,
      paymentStatus: 'succeeded',
      amount: 99.99,
      currency: 'usd',
      transactionId: `txn_${Date.now()}`,
      confirmedAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Get payment details (STUB)
 */
export const getPaymentDetails = async (req: Request, res: Response) => {
  const { paymentId } = req.params;

  res.status(200).json({
    service: 'payment-service',
    action: 'getPaymentDetails',
    status: 'success',
    data: {
      paymentId,
      orderId: 'order_123',
      amount: 99.99,
      currency: 'usd',
      status: 'succeeded',
      paymentMethod: 'card',
      transactionId: 'txn_123456',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Process refund (STUB)
 */
export const processRefund = async (req: Request, res: Response) => {
  const { paymentId } = req.params;
  const { reason } = req.body;

  const refundId = `re_${Date.now()}`;

  res.status(200).json({
    service: 'payment-service',
    action: 'processRefund',
    status: 'success',
    data: {
      refundId,
      paymentId,
      amount: 99.99,
      reason,
      status: 'succeeded',
      processedAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
};
