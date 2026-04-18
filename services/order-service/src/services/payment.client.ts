import axios from 'axios';
import logger from '../utils/logger';

export interface CreatePaymentIntentRequest {
  orderId: string;
  orderNumber: string;
  userId: string;
  amount: number;
  currency: string;
  description: string;
}

export interface PaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
}

export class PaymentClient {
  private static baseUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3005';

  static async createPaymentIntent(data: CreatePaymentIntentRequest): Promise<PaymentIntent> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/internal/create-intent`, {
        orderId: data.orderId,
        orderNumber: data.orderNumber,
        userId: data.userId,
        amount: data.amount,
        currency: data.currency,
        description: data.description,
      });

      logger.info(`Payment intent created for order ${data.orderNumber}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to create payment intent:', error.response?.data || error.message);
      throw new Error('Payment service unavailable');
    }
  }

  static async confirmPayment(paymentIntentId: string, paymentMethodId: string) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/internal/confirm`, {
        paymentIntentId,
        paymentMethodId,
      });

      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to confirm payment:', error.response?.data || error.message);
      throw new Error('Payment confirmation failed');
    }
  }

  static async getPaymentStatus(paymentIntentId: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/payments/${paymentIntentId}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to get payment status:', error.response?.data || error.message);
      throw new Error('Payment status check failed');
    }
  }

  static async refundPayment(paymentIntentId: string, amount?: number, reason?: string) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/${paymentIntentId}/refund`, {
        amount,
        reason,
      });
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to refund payment:', error.response?.data || error.message);
      throw new Error('Payment refund failed');
    }
  }
}
