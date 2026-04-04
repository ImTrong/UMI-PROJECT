import { orderApi } from './api';

export interface CartItem {
  courseId: string;
  title: string;
  price: number;
  thumbnail?: string;
}

export interface Cart {
  id: string;
  userId: string;
  items: CartItem[];
  totalPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  courseId: string;
  courseTitle: string;
  price: number;
  discount: number;
  finalPrice: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  totalPrice: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED';
  paymentId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelledReason?: string;
}

export interface CreateOrderData {
  items: {
    courseId: string;
    courseTitle: string;
    price: number;
    discount?: number;
  }[];
  notes?: string;
}

export interface OrderFilters {
  page?: number;
  limit?: number;
  status?: Order['status'];
  paymentStatus?: Order['paymentStatus'];
  fromDate?: string;
  toDate?: string;
}

export interface PaginatedOrders {
  orders: Order[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export const orderService = {
  // Cart
  async getCart(): Promise<Cart> {
    const response = await orderApi.get('/api/cart');
    return response.data.data;
  },

  async addToCart(courseId: string): Promise<Cart> {
    const response = await orderApi.post('/api/cart', { courseId });
    return response.data.data;
  },

  async removeFromCart(courseId: string): Promise<Cart> {
    const response = await orderApi.delete(`/api/cart/${courseId}`);
    return response.data.data;
  },

  async clearCart(): Promise<Cart> {
    const response = await orderApi.delete('/api/cart');
    return response.data.data;
  },

  async getCartTotal(): Promise<{ totalItems: number; totalPrice: number }> {
    const response = await orderApi.get('/api/cart/total');
    return response.data.data;
  },

  // Orders
  async createOrder(data: CreateOrderData): Promise<Order> {
    const response = await orderApi.post('/api/orders', data);
    return response.data.data;
  },

  async getMyOrders(page: number = 1, limit: number = 10, status?: Order['status']): Promise<PaginatedOrders> {
    let url = `/api/orders/me?page=${page}&limit=${limit}`;
    if (status) {
      url += `&status=${status}`;
    }
    const response = await orderApi.get(url);
    return response.data;
  },

  async getOrderById(orderId: string): Promise<Order> {
    const response = await orderApi.get(`/api/orders/me/${orderId}`);
    return response.data.data;
  },

  async getOrderByNumber(orderNumber: string): Promise<Order> {
    const response = await orderApi.get(`/api/orders/me/number/${orderNumber}`);
    return response.data.data;
  },

  async cancelOrder(orderId: string, reason?: string): Promise<Order> {
    const response = await orderApi.post(`/api/orders/${orderId}/cancel`, { reason });
    return response.data.data;
  },

  // Admin endpoints
  async getAllOrders(filters?: OrderFilters): Promise<PaginatedOrders> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value.toString());
        }
      });
    }
    const response = await orderApi.get(`/api/orders?${params.toString()}`);
    return response.data;
  },

  async updateOrderStatus(orderId: string, status: Order['status'], reason?: string): Promise<Order> {
    const response = await orderApi.put(`/api/orders/${orderId}/status`, { status, reason });
    return response.data.data;
  },

  async getOrderStats(): Promise<{
    byStatus: Array<{ status: string; _count: number; _sum: { totalPrice: number } }>;
    totalOrders: number;
    totalRevenue: number;
  }> {
    const response = await orderApi.get('/api/orders/stats');
    return response.data.data;
  },

  async getAnalytics(): Promise<any> {
    const response = await orderApi.get('/api/orders/analytics');
    return response.data.data;
  },
};
