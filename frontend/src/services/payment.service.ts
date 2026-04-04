import { paymentApi } from './api';

export interface PaymentIntent {
  id: string;
  stripePaymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
}

export interface Payment {
  id: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  amount: number;
  currency: string;
  status: PaymentIntent['status'];
  stripePaymentIntentId?: string;
  paymentMethodId?: string;
  errorMessage?: string;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  refunds?: Refund[];
}

export interface Refund {
  id: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  amount: number;
  currency: string;
  reason?: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  stripeRefundId?: string;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface PaymentMethod {
  id: string;
  type: string;
  card: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  isDefault: boolean;
}

export interface CreatePaymentIntentData {
  orderId?: string;
  orderNumber?: string;
  amount: number;
  currency?: string;
  type?: string;
  metadata?: Record<string, any>;
}

export interface ConfirmPaymentData {
  paymentIntentId: string;
  paymentMethodId: string;
}

export interface PaymentFilters {
  page?: number;
  limit?: number;
  status?: Payment['status'];
  fromDate?: string;
  toDate?: string;
}

export interface PaginatedPayments {
  payments: Payment[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export const paymentService = {
  // Payment Intents
  async createPaymentIntent(data: CreatePaymentIntentData): Promise<PaymentIntent> {
    const response = await paymentApi.post('/api/payments/create-intent', data);
    return response.data.data;
  },

  async confirmPayment(data: ConfirmPaymentData): Promise<Payment> {
    const response = await paymentApi.post('/api/payments/confirm', data);
    return response.data.data;
  },

  async getPaymentById(paymentId: string): Promise<Payment> {
    const response = await paymentApi.get(`/api/payments/me/${paymentId}`);
    return response.data.data;
  },

  async getUserPayments(page: number = 1, limit: number = 10): Promise<PaginatedPayments> {
    const response = await paymentApi.get(`/api/payments/me?page=${page}&limit=${limit}`);
    return response.data;
  },

  async refundPayment(paymentId: string, amount?: number, reason?: string): Promise<Refund> {
    const response = await paymentApi.post(`/api/payments/${paymentId}/refund`, { amount, reason });
    return response.data.data;
  },

  async cancelPayment(paymentId: string): Promise<Payment> {
    const response = await paymentApi.post(`/api/payments/${paymentId}/cancel`);
    return response.data.data;
  },

  // Payment Methods
  async createSetupIntent(): Promise<{ clientSecret: string; customerId: string }> {
    const response = await paymentApi.post('/api/payments/setup-intent');
    return response.data.data;
  },

  async savePaymentMethod(paymentMethodId: string): Promise<{ success: boolean; customerId: string }> {
    const response = await paymentApi.post('/api/payments/save-method', { paymentMethodId });
    return response.data.data;
  },

  async getPaymentMethods(): Promise<{ paymentMethods: PaymentMethod[] }> {
    const response = await paymentApi.get('/api/payments/methods');
    return response.data.data;
  },

  // Admin endpoints
  async getAllPayments(filters?: PaymentFilters): Promise<PaginatedPayments> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value.toString());
        }
      });
    }
    const response = await paymentApi.get(`/api/payments?${params.toString()}`);
    return response.data;
  },

  async getPaymentStats(): Promise<{
    totalRevenue: number;
    totalTransactions: number;
    byStatus: Array<{ status: string; _count: number; _sum: { amount: number } }>;
  }> {
    const response = await paymentApi.get('/api/payments/stats');
    return response.data.data;
  },

  async getRefundStats(): Promise<{
    totalRefunded: number;
    totalRefunds: number;
    byStatus: Array<{ status: string; _count: number; _sum: { amount: number } }>;
  }> {
    const response = await paymentApi.get('/api/payments/refunds/stats');
    return response.data.data;
  },
};
