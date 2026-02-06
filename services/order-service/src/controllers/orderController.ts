import { Request, Response } from 'express';

export const healthCheck = async (req: Request, res: Response) => {
  res.status(200).json({
    service: 'order-service',
    status: 'active',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected',
  });
};

export const getAllOrders = async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const offset = parseInt(req.query.offset as string) || 0;
  const userId = req.query.userId as string;

  const orders = Array.from({ length: limit }, (_, i) => ({
    id: `order_${offset + i}`,
    userId: userId || `user_${i}`,
    courses: [`course_${i}`, `course_${i + 1}`],
    totalPrice: (i + 1) * 99.99,
    status: ['pending', 'completed', 'cancelled'][Math.floor(Math.random() * 3)],
    createdAt: new Date().toISOString(),
  }));

  res.status(200).json({
    service: 'order-service',
    action: 'getAllOrders',
    status: 'success',
    data: {
      total: 5000,
      limit,
      offset,
      orders,
    },
    timestamp: new Date().toISOString(),
  });
};

export const getOrderById = async (req: Request, res: Response) => {
  const { orderId } = req.params;

  res.status(200).json({
    service: 'order-service',
    action: 'getOrderById',
    status: 'success',
    data: {
      id: orderId,
      userId: 'user_123',
      courses: ['course_1', 'course_2'],
      totalPrice: 199.98,
      status: 'completed',
      paymentStatus: 'paid',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      completedAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
};

export const createOrder = async (req: Request, res: Response) => {
  const { userId, courseIds, totalPrice } = req.body;

  const orderId = `order_${Date.now()}`;

  res.status(201).json({
    service: 'order-service',
    action: 'createOrder',
    status: 'success',
    data: {
      id: orderId,
      userId,
      courseIds,
      totalPrice,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { status } = req.body;

  res.status(200).json({
    service: 'order-service',
    action: 'updateOrderStatus',
    status: 'success',
    data: {
      id: orderId,
      status,
      updatedAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
};
