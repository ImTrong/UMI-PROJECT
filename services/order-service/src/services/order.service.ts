import { PrismaClient, OrderStatus, PaymentStatus } from '@prisma/client';
import axios from 'axios';
import { ERROR_MESSAGES } from '../utils/constants';
import { PaymentClient } from './payment.client';
import logger from '../utils/logger';
import crypto from 'crypto';

const prisma = new PrismaClient();

interface CourseFromService {
  id: string;
  title: string;
  price: number;
  published: boolean;
  approvalStatus: string;
  instructorId: string;
  thumbnail?: string;
}

interface OrderItemInput {
  courseId: string;
}

interface CreateOrderData {
  userId: string;
  items: OrderItemInput[];
  notes?: string;
  paymentMethod?: 'stripe' | 'payos';
  idempotencyKey?: string;
}

export class OrderService {
  /**
   * Tạo mã đơn hàng dạng ORD-YYYYMMDD-XXXX với XXXX là random hex.
   * Dùng crypto.randomBytes để tránh trùng lặp.
   */
  static async generateOrderNumber(): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `ORD-${year}${month}${day}-${random}`;
  }

  /**
   * Tạo orderCode số nguyên duy nhất cho payOS.
   * Dùng timestamp + random để đảm bảo tính duy nhất, lưu vào DB và kiểm tra trùng.
   */
  static async generateUniqueOrderCode(): Promise<string> {
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      // Timestamp phần cuối (9 digits) + random 4 digits = max 13 digits
      // payOS max: 9007199254740991 (15 digits, safe integer)
      const timestamp = Date.now() % 1_000_000_000; // 9 digits
      const random = Math.floor(Math.random() * 10000); // 4 digits
      const orderCode = timestamp * 10000 + random;

      // Validate safe integer for payOS API
      if (!Number.isSafeInteger(orderCode) || orderCode <= 0) continue;

      const orderCodeStr = String(orderCode);

      // Check uniqueness
      const existing = await prisma.order.findFirst({
        where: { payosOrderCode: orderCodeStr },
      });
      if (!existing) return orderCodeStr;
    }
    throw new Error('Failed to generate unique orderCode after maximum attempts');
  }

  /**
   * Fetch và xác minh giá khóa học từ course-service.
   * KHÔNG tin cậy giá từ frontend.
   */
  private static async fetchAndVerifyCourses(
    courseIds: string[],
    userId: string
  ): Promise<CourseFromService[]> {
    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    const courses: CourseFromService[] = [];

    for (const courseId of courseIds) {
      try {
        const response = await axios.get(`${courseServiceUrl}/api/courses/${courseId}`);
        const course = response.data.data;

        if (!course) {
          throw new Error(`Course ${courseId} not found`);
        }
        if (!course.published) {
          throw new Error(`Course ${courseId} is not published`);
        }
        if (course.approvalStatus !== 'APPROVED') {
          throw new Error(`Course ${courseId} is not approved for sale`);
        }

        courses.push({
          id: course.id,
          title: course.title,
          price: course.price,
          published: course.published,
          approvalStatus: course.approvalStatus,
          instructorId: course.instructorId,
          thumbnail: course.thumbnail,
        });
      } catch (error: any) {
        if (error.response?.status === 404) {
          throw new Error(`Course ${courseId} not found`);
        }
        throw error;
      }
    }

    return courses;
  }

  /**
   * Kiểm tra người dùng đã sở hữu khóa học chưa
   * (đơn COMPLETED hoặc PROCESSING có chứa courseId)
   */
  private static async checkAlreadyPurchased(userId: string, courseIds: string[]): Promise<string[]> {
    const purchased: string[] = [];
    for (const courseId of courseIds) {
      const existingOrderItem = await prisma.orderItem.findFirst({
        where: {
          courseId,
          order: {
            userId,
            status: { in: ['COMPLETED', 'PROCESSING'] },
          },
        },
      });
      if (existingOrderItem) {
        purchased.push(courseId);
      }
    }
    return purchased;
  }

  /**
   * Kiểm tra khóa học đã nằm trong đơn PENDING khác chưa.
   * Ngăn tạo giao dịch trùng cho cùng khóa học.
   */
  private static async checkInPendingOrders(userId: string, courseIds: string[]): Promise<string[]> {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    // 1. Tự động chuyển các đơn PENDING quá 30 phút sang CANCELLED (hết hạn) và hủy link payOS
    const expiredOrders = await prisma.order.findMany({
      where: {
        userId,
        status: 'PENDING',
        createdAt: { lt: thirtyMinutesAgo },
      },
    });

    for (const expOrder of expiredOrders) {
      await prisma.order.update({
        where: { id: expOrder.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledReason: 'Order expired after 30 minutes of inactivity',
        },
      });

      if (expOrder.payosOrderCode) {
        try {
          await PaymentClient.cancelPayosPayment(expOrder.payosOrderCode, 'Order expired after 30 minutes');
        } catch (err: any) {
          logger.warn(`Could not cancel payOS link for expired order ${expOrder.orderNumber}: ${err.message}`);
        }
      }
      logger.info(`Explicitly expired pending order ${expOrder.orderNumber} for user ${userId}`);
    }

    // 2. Kiểm tra các đơn PENDING còn hiệu lực (< 30 phút)
    const inPending: string[] = [];
    for (const courseId of courseIds) {
      const existingOrderItem = await prisma.orderItem.findFirst({
        where: {
          courseId,
          order: {
            userId,
            status: 'PENDING',
            createdAt: {
              gte: thirtyMinutesAgo,
            },
          },
        },
        include: { order: true },
      });
      if (existingOrderItem) {
        inPending.push(courseId);
      }
    }
    return inPending;
  }

  static async createOrder(data: CreateOrderData) {
    const { userId, items, notes, paymentMethod = 'stripe', idempotencyKey } = data;

    if (!items || items.length === 0) {
      throw new Error('Order must have at least one item');
    }

    const courseIds = items.map((item) => item.courseId);

    // Idempotency: nếu có idempotencyKey, kiểm tra đơn đã tạo
    if (idempotencyKey) {
      const existingOrder = await prisma.order.findFirst({
        where: { idempotencyKey, userId },
        include: { orderItems: true },
      });
      if (existingOrder) {
        logger.info(`Idempotent hit: returning existing order ${existingOrder.orderNumber}`);
        return {
          order: existingOrder,
          paymentIntent: null,
          payosPaymentUrl: null,
        };
      }
    }

    // 1. Fetch giá thật từ course-service (KHÔNG tin cậy frontend)
    const courses = await this.fetchAndVerifyCourses(courseIds, userId);

    // 2. Kiểm tra đã sở hữu
    const alreadyPurchased = await this.checkAlreadyPurchased(userId, courseIds);
    if (alreadyPurchased.length > 0) {
      throw new Error(ERROR_MESSAGES.COURSE_ALREADY_PURCHASED);
    }

    // 3. Kiểm tra khóa trong đơn PENDING (tránh tạo giao dịch trùng)
    const inPending = await this.checkInPendingOrders(userId, courseIds);
    if (inPending.length > 0) {
      throw new Error(
        `Courses already in a pending order: ${inPending.join(', ')}. Please complete or cancel the existing order first.`
      );
    }

    // 4. Tính giá từ server (KHÔNG dùng giá frontend)
    let subtotal = 0;
    const validatedItems = courses.map((course) => {
      const discount = 0; // Giảm giá tính trên server khi có chức năng coupon
      const finalPrice = course.price - discount;
      subtotal += finalPrice;
      return {
        courseId: course.id,
        courseTitle: course.title,
        price: course.price,
        discount,
        finalPrice,
        instructorId: course.instructorId,
        thumbnail: course.thumbnail,
      };
    });

    const totalDiscount = 0;
    const totalPrice = subtotal - totalDiscount;

    // 5. Tạo order number và orderCode cho payOS
    const orderNumber = await this.generateOrderNumber();
    const payosOrderCode = await this.generateUniqueOrderCode();

    // 6. Tạo đơn hàng
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId,
        items: validatedItems as any,
        subtotal,
        discount: totalDiscount,
        totalPrice,
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.UNPAID,
        paymentMethod,
        payosOrderCode,
        notes,
        idempotencyKey: idempotencyKey || undefined,
      },
    });

    // 7. Tạo order items (snapshot tại thời điểm mua)
    for (const item of validatedItems) {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          courseId: item.courseId,
          courseTitle: item.courseTitle,
          instructorId: item.instructorId,
          price: item.price,
          discount: item.discount,
          finalPrice: item.finalPrice,
        },
      });
    }

    // 8. KHÔNG xóa giỏ hàng ở đây - chỉ xóa khi thanh toán thành công

    // 9. Tạo payment intent với provider phù hợp
    let paymentIntent = null;
    let payosPaymentUrl = null;
    let payosQrCode = null;

    try {
      if (paymentMethod === 'payos') {
        // Tạo payment link qua payOS
        const payosResult = await PaymentClient.createPayosPayment({
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderCode: Number(payosOrderCode),
          userId: order.userId,
          amount: Math.round(totalPrice), // VND, số nguyên
          description: `UMI ${orderNumber}`.substring(0, 25), // payOS max 25 chars
          items: validatedItems.map((item) => ({
            name: item.courseTitle.substring(0, 256),
            quantity: 1,
            price: Math.round(item.finalPrice),
          })),
        });

        payosPaymentUrl = payosResult.checkoutUrl;
        payosQrCode = payosResult.qrCode;

        // Cập nhật order với payment reference
        await prisma.order.update({
          where: { id: order.id },
          data: {
            paymentId: payosResult.paymentId,
            paymentProvider: 'payos',
          },
        });
      } else {
        // Stripe payment intent
        paymentIntent = await PaymentClient.createPaymentIntent({
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: order.userId,
          amount: totalPrice,
          currency: 'vnd',
          description: `Order ${order.orderNumber} - ${validatedItems.length} course(s)`,
        });

        // Cập nhật order với payment intent ID
        await prisma.order.update({
          where: { id: order.id },
          data: {
            paymentId: paymentIntent.id,
            paymentProvider: 'stripe',
          },
        });
      }
    } catch (error) {
      logger.error('Failed to create payment:', error);
      // Order vẫn được tạo nhưng chưa có payment
    }

    logger.info(`Order created: ${orderNumber} for user ${userId}, method: ${paymentMethod}`);

    // Refetch order with orderItems
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { orderItems: true },
    });

    return {
      order: fullOrder || order,
      paymentIntent,
      payosPaymentUrl,
      payosQrCode,
      payosOrderCode: paymentMethod === 'payos' ? payosOrderCode : undefined,
    };
  }

  /**
   * Tạo payment link payOS cho một đơn hàng PENDING đã tồn tại.
   * Dùng khi học viên chọn hoặc đổi phương thức thanh toán sang QR ngân hàng.
   */
  static async initiatePayosPayment(orderId: string, userId: string, regenerate: boolean = false) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!order) {
      throw new Error(ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    if (order.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    if (order.status !== 'PENDING') {
      throw new Error('Order is not in pending state');
    }

    let payosOrderCode = order.payosOrderCode;
    if (!payosOrderCode || regenerate) {
      payosOrderCode = await this.generateUniqueOrderCode();
      await prisma.order.update({
        where: { id: orderId },
        data: { payosOrderCode },
      });
    }

    const payosResult = await PaymentClient.createPayosPayment({
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderCode: Number(payosOrderCode),
      userId: order.userId,
      amount: Math.round(order.totalPrice),
      description: `UMI ${order.orderNumber}`.substring(0, 25),
      items: (order.orderItems || []).map((item) => ({
        name: item.courseTitle.substring(0, 256),
        quantity: 1,
        price: Math.round(item.finalPrice),
      })),
      regenerate,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentId: payosResult.paymentId,
        paymentProvider: 'payos',
        paymentMethod: 'payos',
      },
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderCode: Number(payosOrderCode),
      amount: order.totalPrice,
      checkoutUrl: payosResult.checkoutUrl,
      qrCode: payosResult.qrCode,
    };
  }

  static async processPayment(orderId: string, paymentMethodId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error(ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    if (!order.paymentId) {
      throw new Error('No payment intent found for this order');
    }

    // Confirm payment with Stripe
    const payment = await PaymentClient.confirmPayment(order.paymentId, paymentMethodId);

    if (payment.status === 'succeeded') {
      await this.updatePaymentStatus(order.id, PaymentStatus.PAID);
      await this.updateOrderStatus(order.id, OrderStatus.PROCESSING, order.userId, true);
      return { success: true, payment };
    }

    return { success: false, payment };
  }

  static async getOrderById(orderId: string, userId: string, isAdmin: boolean = false) {
    const where: any = { id: orderId };
    if (!isAdmin) {
      where.userId = userId;
    }

    const order = await prisma.order.findUnique({
      where,
      include: {
        orderItems: true,
      },
    });

    if (!order) {
      throw new Error(ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    return order;
  }

  static async getOrderByNumber(orderNumber: string, userId: string, isAdmin: boolean = false) {
    const where: any = { orderNumber };
    if (!isAdmin) {
      where.userId = userId;
    }

    const order = await prisma.order.findFirst({
      where,
      include: {
        orderItems: true,
      },
    });

    if (!order) {
      throw new Error(ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    return order;
  }

  static async getUserOrders(
    userId: string,
    page: number = 1,
    limit: number = 10,
    status?: OrderStatus
  ) {
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (status) {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          orderItems: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getAllOrders(
    page: number = 1,
    limit: number = 10,
    filters?: {
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
      userId?: string;
      fromDate?: Date;
      toDate?: Date;
      reconciliationOnly?: boolean;
    }
  ) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.fromDate) where.createdAt = { gte: filters.fromDate };
    if (filters?.toDate) {
      where.createdAt = { ...where.createdAt, lte: filters.toDate };
    }
    if (filters?.reconciliationOnly) {
      where.OR = [
        { status: 'CANCELLED', paymentStatus: 'PAID' },
        { status: 'PENDING', paymentStatus: 'PAID' },
        { reconciliationStatus: { in: ['RECONCILIATION_REQUIRED', 'PARTIAL_DUPLICATE_PAYMENT', 'FULL_DUPLICATE_PAYMENT'] } },
        { refundableAmount: { gt: 0 } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          orderItems: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    userId: string,
    isAdmin: boolean = false,
    reason?: string
  ) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error(ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    if (!isAdmin && order.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    // Validate status transition
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      PENDING: ['PROCESSING', 'CANCELLED', 'FAILED'],
      PROCESSING: ['COMPLETED', 'CANCELLED', 'FAILED'],
      COMPLETED: [],
      CANCELLED: [],
      FAILED: ['PENDING'], // Cho phép thử lại từ FAILED
    };

    if (!validTransitions[order.status].includes(status)) {
      throw new Error(ERROR_MESSAGES.INVALID_ORDER_STATUS);
    }

    const updateData: any = { status };

    if (status === 'COMPLETED') {
      updateData.completedAt = new Date();
      updateData.paymentStatus = PaymentStatus.PAID;

      // Enroll user (idempotent - learning service kiểm tra trùng)
      await this.enrollUserInCourses(order.userId, (order.items as any) || []);

      // Xóa chỉ các khóa thuộc đơn hàng này khỏi giỏ
      await this.removeOrderItemsFromCart(order.userId, (order.items as any) || []);
    }

    if (status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
      updateData.cancelledReason = reason;
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });

    logger.info(`Order ${order.orderNumber} status updated to ${status}`);
    return updatedOrder;
  }

  static async cancelOrder(orderId: string, userId: string, reason?: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error(ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    if (order.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    if (order.status !== 'PENDING' && order.status !== 'PROCESSING') {
      throw new Error(ERROR_MESSAGES.ORDER_ALREADY_PROCESSED);
    }

    const cancelledOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledReason: reason,
      },
    });

    logger.info(`Order ${order.orderNumber} cancelled by user ${userId}`);
    return cancelledOrder;
  }

  static async updatePaymentStatus(orderId: string, paymentStatus: PaymentStatus, paymentId?: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error(ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus,
        paymentId,
        ...(paymentStatus === PaymentStatus.PAID && { status: OrderStatus.PROCESSING }),
      },
    });

    logger.info(`Order ${order.orderNumber} payment status updated to ${paymentStatus}`);
    return updatedOrder;
  }

  /**
   * Xóa chỉ các khóa đã thanh toán khỏi giỏ hàng, giữ nguyên các mục chưa mua.
   */
  private static async removeOrderItemsFromCart(userId: string, items: any[]) {
    try {
      const cart = await prisma.cart.findUnique({ where: { userId } });
      if (!cart) return;

      const cartItems = cart.items as unknown as any[];
      const purchasedCourseIds = new Set(items.map((item: any) => item.courseId));
      const remainingItems = cartItems.filter(
        (item: any) => !purchasedCourseIds.has(item.courseId)
      );
      const newTotal = remainingItems.reduce((sum: number, item: any) => sum + (item.price || 0), 0);

      await prisma.cart.update({
        where: { userId },
        data: {
          items: remainingItems as any,
          totalPrice: newTotal,
        },
      });

      logger.info(`Removed ${purchasedCourseIds.size} purchased items from cart for user ${userId}`);
    } catch (error) {
      logger.error('Failed to remove items from cart:', error);
      // Non-critical: cart cleanup failure should not block order completion
    }
  }

  private static async enrollUserInCourses(userId: string, items: any[]) {
    const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://learning-service:3006';
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN || '';

    for (const item of items) {
      try {
        await axios.post(
          `${learningServiceUrl}/api/learning/internal/courses/${item.courseId}/enroll`,
          { userId },
          { headers: { 'X-Internal-Service-Token': internalToken } }
        );
        logger.info(`User ${userId} enrolled in course ${item.courseId}`);
      } catch (error) {
        logger.error(`Failed to enroll user in course ${item.courseId}:`, error);
        // TODO: Queue for retry/reconciliation
      }
    }
  }

  /**
   * Increment enrollment count trên course-service.
   */
  private static async incrementEnrollmentCount(courseId: string) {
    try {
      const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
      await axios.post(`${courseServiceUrl}/api/courses/${courseId}/increment-enrollment`);
    } catch (error) {
      logger.error(`Failed to increment enrollment for course ${courseId}:`, error);
    }
  }

  static async getOrderStats() {
    const stats = await prisma.order.groupBy({
      by: ['status'],
      _count: true,
      _sum: {
        totalPrice: true,
      },
    });

    const totalOrders = await prisma.order.count();

    // Doanh thu từ các đơn hàng COMPLETED bình thường
    const completedRevenueAgg = await prisma.order.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { totalPrice: true },
    });
    const completedRevenue = completedRevenueAgg._sum.totalPrice || 0;

    // Giao dịch thực tế ĐÃ THU TIỀN nhưng Order còn CANCELLED (VD: thanh toán muộn, thanh toán trùng 100%)
    // KHÔNG được để mất khỏi báo cáo tài chính của Admin!
    const cancelledPaidAgg = await prisma.order.aggregate({
      where: { status: 'CANCELLED', paymentStatus: 'PAID' },
      _sum: { totalPrice: true },
      _count: true,
    });
    const cancelledPaidRevenue = cancelledPaidAgg._sum.totalPrice || 0;
    const cancelledPaidCount = cancelledPaidAgg._count;

    // Giao dịch thực tế ĐÃ THU TIỀN nhưng Order còn PENDING/PROCESSING (chưa đồng bộ xong)
    const pendingPaidAgg = await prisma.order.aggregate({
      where: { status: { in: ['PENDING', 'PROCESSING'] }, paymentStatus: 'PAID' },
      _sum: { totalPrice: true },
      _count: true,
    });
    const pendingPaidRevenue = pendingPaidAgg._sum.totalPrice || 0;
    const pendingPaidCount = pendingPaidAgg._count;

    // Tổng số tiền thực nhận từ cổng thanh toán (bảo đảm không mất bất kỳ đồng nào đã thu)
    const totalCollectedRevenue = completedRevenue + cancelledPaidRevenue + pendingPaidRevenue;

    // Khoản tiền cần hoàn vs số tiền đã hoàn thực tế
    const refundablesAgg = await prisma.order.aggregate({
      _sum: {
        refundableAmount: true,
        refundedAmount: true,
      },
    });
    const totalRefundableAmount = refundablesAgg._sum.refundableAmount || 0;
    const totalRefundedAmount = refundablesAgg._sum.refundedAmount || 0;
    const netRealizedRevenue = totalCollectedRevenue - totalRefundedAmount;

    // Danh sách các đơn hàng cần đối soát cho Admin
    const reconciliationOrders = await prisma.order.findMany({
      where: {
        OR: [
          { status: 'CANCELLED', paymentStatus: 'PAID' },
          { status: 'PENDING', paymentStatus: 'PAID' },
          { reconciliationStatus: { in: ['RECONCILIATION_REQUIRED', 'PARTIAL_DUPLICATE_PAYMENT', 'FULL_DUPLICATE_PAYMENT'] } },
          { refundableAmount: { gt: 0 } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { orderItems: true },
    });

    return {
      byStatus: stats,
      totalOrders,
      totalRevenue: completedRevenue,           // Doanh thu từ đơn COMPLETED
      cancelledPaidRevenue,                     // Tiền đã thu nhưng đơn CANCELLED
      cancelledPaidCount,
      pendingPaidRevenue,                       // Tiền đã thu nhưng đơn PENDING
      pendingPaidCount,
      totalCollectedRevenue,                    // Tổng doanh thu thực tế thu được (KHÔNG BỊ MẤT)
      totalRefundableAmount,                    // Số tiền CẦN hoàn
      totalRefundedAmount,                      // Số tiền ĐÃ hoàn
      netRealizedRevenue,                       // Doanh thu thực nhận sau trừ tiền đã hoàn
      reconciliationRequiredCount: reconciliationOrders.length,
      reconciliationOrders,
    };
  }

  static async getOrderAnalytics() {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [
      totalOrders,
      completedOrders,
      thisMonthOrders,
      thisMonthRevenueAgg,
      totalRevenueAgg,
      cancelledPaidAgg,
      pendingPaidAgg,
      refundablesAgg,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: 'COMPLETED' } }),
      prisma.order.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.order.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: monthAgo } },
        _sum: { totalPrice: true },
      }),
      prisma.order.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { totalPrice: true },
      }),
      prisma.order.aggregate({
        where: { status: 'CANCELLED', paymentStatus: 'PAID' },
        _sum: { totalPrice: true },
      }),
      prisma.order.aggregate({
        where: { status: { in: ['PENDING', 'PROCESSING'] }, paymentStatus: 'PAID' },
        _sum: { totalPrice: true },
      }),
      prisma.order.aggregate({
        _sum: { refundableAmount: true, refundedAmount: true },
      }),
    ]);

    const completedRevenue = totalRevenueAgg._sum.totalPrice || 0;
    const cancelledPaidRevenue = cancelledPaidAgg._sum.totalPrice || 0;
    const pendingPaidRevenue = pendingPaidAgg._sum.totalPrice || 0;
    const totalCollectedRevenue = completedRevenue + cancelledPaidRevenue + pendingPaidRevenue;
    const totalRefundableAmount = refundablesAgg._sum.refundableAmount || 0;
    const totalRefundedAmount = refundablesAgg._sum.refundedAmount || 0;

    return {
      totalOrders,
      completedOrders,
      thisMonthOrders,
      thisMonthRevenue: thisMonthRevenueAgg._sum.totalPrice || 0,
      totalRevenue: completedRevenue,
      cancelledPaidRevenue,
      pendingPaidRevenue,
      totalCollectedRevenue,
      totalRefundableAmount,
      totalRefundedAmount,
      netRevenue: totalCollectedRevenue - totalRefundedAmount,
    };
  }

  // ==================== Payment Webhook Handler ====================

  /**
   * Xử lý webhook thanh toán từ payment-service.
   * IDEMPOTENT: kiểm tra trạng thái hiện tại trước khi cập nhật.
   * Xử lý đơn hàng có nhiều khóa học theo từng OrderItem.
   * Phân biệt rạch ròi số tiền CẦN hoàn (refundableAmount) với số tiền ĐÃ hoàn (refundedAmount).
   */
  static async handlePaymentWebhook(orderId: string, paymentStatus: string, providerRef?: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!order) {
      logger.error(`Webhook: Order not found: ${orderId}`);
      throw new Error(ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    // IDEMPOTENCY: nếu đơn đã COMPLETED và không có phát sinh đối soát, không xử lý lại
    if (order.status === 'COMPLETED' && paymentStatus === 'PAID' && (!order.refundableAmount || order.refundableAmount === 0)) {
      logger.info(`Webhook: Order ${orderId} already COMPLETED, skipping duplicate`);
      return order;
    }

    // Kiểm tra đơn đã kết thúc (trừ trường hợp thanh toán muộn cho đơn CANCELLED)
    if (order.status === 'CANCELLED' && paymentStatus !== 'PAID' && paymentStatus !== 'SUCCEEDED' && paymentStatus !== 'REFUNDED') {
      logger.warn(`Webhook: Order ${orderId} is CANCELLED, ignoring non-success payment status: ${paymentStatus}`);
      return order;
    }

    let newOrderStatus: OrderStatus;
    let newPaymentStatus: PaymentStatus;
    const updateData: any = {};

    switch (paymentStatus) {
      case 'PAID':
      case 'SUCCEEDED': {
        const allOrderItems = (order.orderItems && order.orderItems.length > 0)
          ? order.orderItems
          : ((order.items as any[]) || []);
        const allCourseIds = allOrderItems.map((item: any) => item.courseId);

        // Kiểm tra danh sách khóa học học viên đã sở hữu trước đó
        const alreadyPurchasedIds = new Set(await this.checkAlreadyPurchased(order.userId, allCourseIds));

        const coursesAlreadyOwned = allOrderItems.filter((item: any) => alreadyPurchasedIds.has(item.courseId));
        const coursesToFulfill = allOrderItems.filter((item: any) => !alreadyPurchasedIds.has(item.courseId));

        const fulfilledAmount = coursesToFulfill.reduce((sum: number, item: any) => sum + (item.finalPrice || item.price || 0), 0);
        const refundableAmount = coursesAlreadyOwned.reduce((sum: number, item: any) => sum + (item.finalPrice || item.price || 0), 0);

        // Chuẩn bị danh sách OrderItem đã làm giàu dữ liệu chi tiết
        const enrichedItems = allOrderItems.map((item: any) => {
          const isDuplicate = alreadyPurchasedIds.has(item.courseId);
          return {
            ...item,
            fulfillmentStatus: isDuplicate ? 'ALREADY_OWNED_DUPLICATE' : 'FULFILLED',
            refundableAmount: isDuplicate ? (item.finalPrice || item.price || 0) : 0,
            refundedAmount: 0,
          };
        });

        // Cập nhật trạng thái từng OrderItem trong CSDL
        for (const item of allOrderItems) {
          if (item.id) {
            const isDuplicate = alreadyPurchasedIds.has(item.courseId);
            await prisma.orderItem.update({
              where: { id: item.id },
              data: {
                status: isDuplicate ? 'ALREADY_OWNED_DUPLICATE' : 'FULFILLED',
                refundableAmount: isDuplicate ? (item.finalPrice || item.price || 0) : 0,
                refundedAmount: 0,
              },
            }).catch((err: any) => logger.warn(`[OrderItem] Could not update item ${item.id}: ${err.message}`));
          }
        }

        // Trường hợp 1: Học viên ĐÃ SỞ HỮU TOÀN BỘ khóa học trong đơn này (100% Duplicate Payment)
        if (coursesToFulfill.length === 0 && coursesAlreadyOwned.length > 0) {
          logger.error(
            `RECONCILIATION REQUIRED: Full refund of ${refundableAmount} VND needed for user ${order.userId} on order ${order.orderNumber}. User already owns all courses: ${coursesAlreadyOwned.map((c: any) => c.courseTitle).join(', ')}.`
          );
          // KHÔNG tuyên bố hoàn tiền thành công! paymentStatus = PAID, refundableAmount = refundableAmount, refundedAmount = 0
          const updated = await prisma.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.CANCELLED,
              paymentStatus: PaymentStatus.PAID,
              refundableAmount: refundableAmount,
              refundedAmount: 0,
              reconciliationStatus: 'FULL_DUPLICATE_PAYMENT',
              items: enrichedItems as any,
              notes: `${order.notes || ''} [LATE PAYMENT AUDIT: 100% duplicate payment. Học viên đã sở hữu toàn bộ khóa học (${coursesAlreadyOwned.map((c: any) => c.courseTitle).join(', ')}). Số tiền CẦN hoàn: ${refundableAmount} VND. Số tiền ĐÃ hoàn: 0 VND]`,
            },
          });
          return updated;
        }

        // Trường hợp 2: Có khóa học cần cấp quyền (Toàn bộ hoặc Một phần)
        for (const item of coursesToFulfill) {
          try {
            const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
            const internalToken = process.env.INTERNAL_SERVICE_TOKEN || '';
            await axios.post(
              `${learningServiceUrl}/api/learning/internal/courses/${item.courseId}/enroll`,
              { userId: order.userId },
              { headers: { 'X-Internal-Service-Token': internalToken } }
            );

            // Increment enrollment count
            await this.incrementEnrollmentCount(item.courseId);
            logger.info(`Enrolled user ${order.userId} in course ${item.courseId}`);
          } catch (error) {
            logger.error(`Failed to enroll user in course ${item.courseId}:`, error);
          }
        }

        // Xóa các khóa đã cấp quyền khỏi giỏ hàng
        await this.removeOrderItemsFromCart(order.userId, coursesToFulfill);

        let auditNote = order.notes || '';
        let reconciliationStatus = 'NONE';
        if (coursesAlreadyOwned.length > 0) {
          // Cấp quyền một phần, một phần bị trùng cần đối soát hoàn tiền
          reconciliationStatus = 'PARTIAL_DUPLICATE_PAYMENT';
          logger.warn(
            `RECONCILIATION REQUIRED: Partial refund of ${refundableAmount} VND needed for user ${order.userId} on order ${order.orderNumber}. Already owned: ${coursesAlreadyOwned.map((c: any) => c.courseTitle).join(', ')}.`
          );
          auditNote += ` [PARTIAL FULFILLMENT AUDIT: Đã cấp quyền ${coursesToFulfill.map((c: any) => c.courseTitle).join(', ')} (${fulfilledAmount} VND). Số tiền CẦN hoàn: ${refundableAmount} VND. Số tiền ĐÃ hoàn: 0 VND.]`;
        }

        const updated = await prisma.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.COMPLETED,
            paymentStatus: PaymentStatus.PAID,
            completedAt: new Date(),
            refundableAmount: refundableAmount,
            refundedAmount: 0,
            reconciliationStatus,
            items: enrichedItems as any,
            notes: auditNote,
          },
        });

        logger.info(`Order ${order.orderNumber} processed: fulfilled=${coursesToFulfill.length}, duplicate=${coursesAlreadyOwned.length}, refundable=${refundableAmount}`);
        return updated;
      }

      case 'FAILED':
        newOrderStatus = OrderStatus.FAILED;
        newPaymentStatus = PaymentStatus.FAILED;
        break;

      case 'REFUNDED': {
        newOrderStatus = OrderStatus.CANCELLED;
        newPaymentStatus = PaymentStatus.REFUNDED;
        updateData.cancelledAt = new Date();
        updateData.cancelledReason = 'Payment refunded';
        // Khi nhận được sự kiện REFUNDED thực sự từ cổng thanh toán:
        // Cập nhật số tiền đã hoàn thực tế bằng số tiền cần hoàn hoặc toàn bộ đơn
        const actualRefundAmount = order.refundableAmount && order.refundableAmount > 0 ? order.refundableAmount : order.totalPrice;
        updateData.refundedAmount = actualRefundAmount;
        updateData.reconciliationStatus = 'RECONCILED';
        break;
      }

      case 'CANCELLED':
        newOrderStatus = OrderStatus.CANCELLED;
        newPaymentStatus = PaymentStatus.FAILED;
        updateData.cancelledAt = new Date();
        updateData.cancelledReason = 'Payment cancelled';
        break;

      default:
        logger.warn(`Unknown payment status: ${paymentStatus}`);
        return order;
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: newOrderStatus,
        paymentStatus: newPaymentStatus,
        ...updateData,
      },
    });

    logger.info(`Order ${orderId} updated: status=${newOrderStatus}, payment=${newPaymentStatus}`);
    return updatedOrder;
  }

  /**
   * Ghi nhận đối soát khi quản trị viên hoặc cổng thanh toán hoàn tiền thành công.
   */
  static async recordOrderRefund(orderId: string, amount: number, reason?: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new Error(ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    const currentRefunded = order.refundedAmount || 0;
    const newRefunded = currentRefunded + amount;
    const targetRefund = order.refundableAmount && order.refundableAmount > 0 ? order.refundableAmount : order.totalPrice;
    const isFullyReconciled = newRefunded >= targetRefund;

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        refundedAmount: newRefunded,
        reconciliationStatus: isFullyReconciled ? 'RECONCILED' : 'PARTIALLY_REFUNDED',
        ...(isFullyReconciled && newRefunded >= order.totalPrice ? { paymentStatus: PaymentStatus.REFUNDED, status: OrderStatus.CANCELLED } : {}),
        notes: `${order.notes || ''} [REFUND CONFIRMED: Đã hoàn ${amount} VND. Tổng đã hoàn: ${newRefunded} VND. Lý do: ${reason || 'N/A'}]`,
      },
    });

    return updated;
  }

  /**
   * Tìm order theo payOS orderCode (dùng cho webhook payOS).
   */
  static async getOrderByPayosCode(orderCode: number | string) {
    const orderCodeStr = String(orderCode);
    const order = await prisma.order.findFirst({
      where: { payosOrderCode: orderCodeStr },
      include: { orderItems: true },
    });
    return order;
  }

  static async healthCheck() {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      return {
        service: 'order-service',
        status: 'active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
      };
    } catch (error) {
      return {
        service: 'order-service',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
      };
    }
  }
}
