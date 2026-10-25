import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { PaymentClient } from './payment.client';
import {
  buildSalesPerformance,
  CourseInfo,
  InstructorInfo,
  SalesLineInput,
  SalesOrderInput,
  SalesPerformance,
} from '../utils/sales-performance';
import logger from '../utils/logger';

const prisma = new PrismaClient();

const BATCH = 200;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** Lines of one stored order: the OrderItem rows, or (orders written before they existed) the items JSON. */
function linesOf(order: any): SalesLineInput[] {
  const rows: any[] = Array.isArray(order.orderItems) && order.orderItems.length > 0
    ? order.orderItems
    : (Array.isArray(order.items) ? order.items : []);
  return rows.map((row) => ({
    courseId: String(row.courseId ?? ''),
    courseTitle: String(row.courseTitle ?? ''),
    instructorId: row.instructorId ? String(row.instructorId) : null,
    finalPrice: row.finalPrice ?? row.price,
    status: row.status ?? row.fulfillmentStatus ?? null,
  }));
}

export class SalesPerformanceService {
  /**
   * Admin dashboard sales statistics. Orders come from this service's database; whether an order was really paid is asked of the
   * payment-service (no answer = no figures: it never falls back to Order.status). Course titles / ratings and instructor names are
   * display data: if the course-service or user-service cannot answer, the figures stay and those fields are reported as unknown.
   * `bearer` is the admin's own Authorization header, forwarded read-only to the course-service batch route that needs a signed-in user.
   */
  static async getSalesPerformance(bearer?: string): Promise<SalesPerformance> {
    const stored = await prisma.order.findMany({
      where: { OR: [{ paymentStatus: { in: ['PAID', 'REFUNDED'] } }, { paymentId: { not: null } }] },
      include: { orderItems: true },
      orderBy: { createdAt: 'asc' },
    });
    const orders: SalesOrderInput[] = stored.map((o: any) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalPrice: o.totalPrice,
      refundedAmount: o.refundedAmount ?? 0,
      lines: linesOf(o),
    }));

    const payments = orders.length > 0 ? await PaymentClient.getPaymentEvidence(orders.map((o) => o.id)) : [];

    const courseIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.courseId)).filter((id) => OBJECT_ID.test(id)))];
    const courses = courseIds.length > 0 ? await this.fetchCourses(courseIds, bearer) : [];

    const instructorIds = new Set<string>();
    orders.forEach((o) => o.lines.forEach((l) => l.instructorId && instructorIds.add(l.instructorId)));
    (courses ?? []).forEach((c) => c.instructorId && instructorIds.add(c.instructorId));
    const instructors = instructorIds.size > 0 ? await this.fetchInstructors([...instructorIds]) : [];

    return buildSalesPerformance({ orders, payments, courses, instructors });
  }

  /** null = could not be asked (a field the caller shows as unknown), never an empty list standing in for it */
  private static async fetchCourses(ids: string[], bearer?: string): Promise<CourseInfo[] | null> {
    if (!bearer) return null;
    const url = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
    try {
      const found: CourseInfo[] = [];
      for (const part of chunks(ids, BATCH)) {
        const response = await axios.post(`${url}/api/courses/batch`, { ids: part }, { headers: { Authorization: bearer } });
        for (const c of response.data?.data ?? []) {
          found.push({ id: String(c.id), title: String(c.title ?? ''), instructorId: c.instructorId ? String(c.instructorId) : null, rating: c.rating, totalReviews: c.totalReviews });
        }
      }
      return found;
    } catch (error: any) {
      logger.warn(`Sales statistics: course details unavailable (${error.response?.status ? `HTTP ${error.response.status}` : error.code || error.message})`);
      return null;
    }
  }

  private static async fetchInstructors(ids: string[]): Promise<InstructorInfo[] | null> {
    const url = process.env.USER_SERVICE_URL || 'http://localhost:3002';
    try {
      const found: InstructorInfo[] = [];
      for (const part of chunks(ids.filter((id) => OBJECT_ID.test(id)), 1000)) {
        const response = await axios.post(`${url}/api/users/batch`, { ids: part });
        for (const u of response.data?.data ?? []) {
          if (u.userId && typeof u.fullName === 'string' && u.fullName.trim()) found.push({ id: String(u.userId), fullName: u.fullName.trim() });
        }
      }
      return found;
    } catch (error: any) {
      logger.warn(`Sales statistics: instructor names unavailable (${error.response?.status ? `HTTP ${error.response.status}` : error.code || error.message})`);
      return null;
    }
  }
}
