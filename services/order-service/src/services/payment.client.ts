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

export interface CreatePayosPaymentRequest {
  orderId: string;
  orderNumber: string;
  orderCode: number;
  userId: string;
  amount: number;
  description: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  regenerate?: boolean;
}

export interface PaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
}

export interface PayosPaymentResult {
  paymentId: string;
  checkoutUrl: string;
  qrCode: string;
  orderCode: number;
}

export class PaymentClient {
  private static baseUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3005';
  private static internalToken = process.env.INTERNAL_SERVICE_TOKEN || '';

  private static getInternalHeaders() {
    return {
      'X-Internal-Service-Token': this.internalToken,
    };
  }

  static async createPaymentIntent(data: CreatePaymentIntentRequest): Promise<PaymentIntent> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/payments/internal/create-intent`,
        {
          orderId: data.orderId,
          orderNumber: data.orderNumber,
          userId: data.userId,
          amount: data.amount,
          currency: data.currency,
          description: data.description,
          provider: 'stripe',
        },
        { headers: this.getInternalHeaders() }
      );

      logger.info(`Payment intent created for order ${data.orderNumber}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to create payment intent:', error.response?.data || error.message);
      throw new Error('Payment service unavailable');
    }
  }

  static async createPayosPayment(data: CreatePayosPaymentRequest): Promise<PayosPaymentResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/payments/internal/create-payos`,
        {
          orderId: data.orderId,
          orderNumber: data.orderNumber,
          orderCode: data.orderCode,
          userId: data.userId,
          amount: data.amount,
          description: data.description,
          items: data.items,
          regenerate: data.regenerate,
        },
        { headers: this.getInternalHeaders() }
      );

      logger.info(`PayOS payment created for order ${data.orderNumber}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to create payOS payment:', error.response?.data || error.message);
      throw new Error('PayOS payment service unavailable');
    }
  }

  static async cancelPayosPayment(orderCode: number | string, reason?: string) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/payments/internal/cancel-payos`,
        { orderCode: String(orderCode), reason },
        { headers: this.getInternalHeaders() }
      );
      return response.data.data;
    } catch (error: any) {
      logger.warn(`Failed to cancel payOS payment ${orderCode}:`, error.response?.data || error.message);
      return null;
    }
  }

  static async confirmPayment(paymentIntentId: string, paymentMethodId: string) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/payments/internal/confirm`,
        { paymentIntentId, paymentMethodId },
        { headers: this.getInternalHeaders() }
      );

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
