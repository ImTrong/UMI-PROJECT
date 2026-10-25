/**
 * ADMIN-DASHBOARD-01 - sales and performance statistics for the admin dashboard (pure functions, no I/O).
 *
 * What counts as a SALE (every rule below is on purpose; nothing is guessed):
 *   1. an order is PAID only with evidence from the payment-service: a stored course-purchase payment of THAT order in a success
 *      state (SUCCEEDED / PARTIALLY_REFUNDED / REFUNDED) - and the order itself records the payment (paymentStatus PAID or REFUNDED).
 *      Order.status = COMPLETED proves nothing: an ADMIN can complete an order by hand (PATCH status) without any payment.
 *   2. an order that was refunded in full is not a sale any more (listed apart, not counted).
 *   3. a SOLD COURSE LINE is an order line of a paid order whose fulfilment status is FULFILLED. ALREADY_OWNED_DUPLICATE (money
 *      taken for a course the learner already owned, to be refunded), REFUNDED lines and lines with no / unknown status are not sales.
 *   4. the money of a course line is its finalPrice. The money of an order is its totalPrice. They differ on purpose: an order's
 *      total includes duplicate lines, a course's sales do not.
 *   5. refunds that are not allocated to one line (a partial refund lives on the order / payment) are NOT deducted: the figures are
 *      gross, and the result says how many orders carry such a refund so the label can say so.
 *   enrolledCount is never used.
 */

/** Payment states in which the provider really took the money (it may have been given back since). */
export const PAYMENT_SUCCESS_STATES = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

/** Below this many reviews an average rating is shown with its count but flagged as not reliable. */
export const MIN_RELIABLE_REVIEWS = 5;

export const DEFAULT_TOP_N = 5;

export interface SalesLineInput {
  courseId: string;
  courseTitle: string;
  /** snapshot of the instructor when the course was bought; null for old orders */
  instructorId: string | null;
  finalPrice: number;
  /** FULFILLED | ALREADY_OWNED_DUPLICATE | REFUNDED | PENDING | null ... as stored */
  status: string | null;
}

export interface SalesOrderInput {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  totalPrice: number;
  /** Order.refundedAmount (what the order-service recorded as given back) */
  refundedAmount: number;
  lines: SalesLineInput[];
}

/** One stored payment, as the payment-service reports it (POST /api/payments/internal/payment-evidence). */
export interface PaymentEvidence {
  id: string;
  orderId: string | null;
  status: string;
  amount: number;
  refundedTotal: number;
}

/** What the course-service knows about a course. rating / totalReviews are its stored aggregate over the Review rows. */
export interface CourseInfo {
  id: string;
  title: string;
  instructorId: string | null;
  rating: number;
  totalReviews: number;
}

export interface InstructorInfo {
  id: string;
  fullName: string;
}

export interface SalesPerformanceInput {
  orders: SalesOrderInput[];
  payments: PaymentEvidence[];
  /** null = the course-service could not be asked (ratings and current titles are then unknown, not zero) */
  courses: CourseInfo[] | null;
  /** null = the user-service could not be asked (instructor names are then unknown) */
  instructors: InstructorInfo[] | null;
  topN?: number;
}

export interface CourseSales {
  rank: number;
  courseId: string;
  courseTitle: string;
  instructorId: string | null;
  instructorName: string | null;
  salesCount: number;
  salesAmount: number;
  /** null = unknown (course-service unreachable / course not found) or no review yet */
  rating: number | null;
  /** null = unknown; 0 = known to have no review */
  ratingCount: number | null;
  ratingReliable: boolean;
}

export interface InstructorSales {
  rank: number;
  instructorId: string;
  instructorName: string | null;
  soldCourseCount: number;
  salesCount: number;
  salesAmount: number;
  rating: number | null;
  ratingCount: number | null;
  ratingReliable: boolean;
}

export interface SalesPerformance {
  kpis: {
    /** sum of totalPrice of the paid orders: BEFORE refunds that are not allocated to a line */
    paidOrderAmount: number;
    paidOrderCount: number;
    soldCourseLineCount: number;
    distinctSoldCourseCount: number;
  };
  topCourses: CourseSales[];
  topInstructors: InstructorSales[];
  totalCoursesWithSales: number;
  totalInstructorsWithSales: number;
  dataQuality: {
    ordersExamined: number;
    /** order-side says paid / completed-by-hand but the payment-service has no successful payment: not counted */
    ordersWithoutPaymentEvidence: number;
    /** the payment-service has a successful payment but the order does not record it yet: not counted */
    ordersPaymentNotRecordedByOrder: number;
    fullyRefundedOrders: { count: number; amount: number };
    /** counted orders that carry a (partial) refund: it is not allocated to a course, so the figures above stay gross */
    partiallyRefundedOrders: { count: number; refundedAmount: number };
    duplicateLines: { count: number; amount: number };
    refundedLines: { count: number; amount: number };
    /** lines of paid orders with no / unknown fulfilment status: not counted as sales */
    unclassifiedLines: { count: number; amount: number };
    /** sold lines with no instructor at all: counted in the course ranking, absent from the instructor ranking */
    soldLinesWithoutInstructor: number;
    courseInfoAvailable: boolean;
    instructorInfoAvailable: boolean;
    minReliableReviews: number;
  };
}

const money = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isSuccessState = (s: unknown) => (PAYMENT_SUCCESS_STATES as readonly string[]).includes(String(s));

/** Rating as shown: 2 decimals, only when the stored value is a plausible 0-5 average over at least one review. */
function plausibleRating(rating: unknown, reviews: unknown): { rating: number | null; count: number } {
  const count = typeof reviews === 'number' && Number.isInteger(reviews) && reviews > 0 ? reviews : 0;
  if (count === 0) return { rating: null, count: 0 };
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 0 || rating > 5) return { rating: null, count };
  return { rating: Math.round(rating * 100) / 100, count };
}

interface CourseAcc {
  courseId: string;
  title: string;
  instructorId: string | null;
  salesCount: number;
  salesAmount: number;
}

export function buildSalesPerformance(input: SalesPerformanceInput): SalesPerformance {
  const topN = input.topN ?? DEFAULT_TOP_N;
  const courseInfo = new Map((input.courses ?? []).map((c) => [c.id, c]));
  const instructorName = new Map((input.instructors ?? []).map((i) => [i.id, i.fullName]));

  const paymentsByOrder = new Map<string, PaymentEvidence[]>();
  for (const p of input.payments) {
    if (!p.orderId) continue;
    const list = paymentsByOrder.get(p.orderId) ?? [];
    list.push(p);
    paymentsByOrder.set(p.orderId, list);
  }

  const dq: SalesPerformance['dataQuality'] = {
    ordersExamined: input.orders.length,
    ordersWithoutPaymentEvidence: 0,
    ordersPaymentNotRecordedByOrder: 0,
    fullyRefundedOrders: { count: 0, amount: 0 },
    partiallyRefundedOrders: { count: 0, refundedAmount: 0 },
    duplicateLines: { count: 0, amount: 0 },
    refundedLines: { count: 0, amount: 0 },
    unclassifiedLines: { count: 0, amount: 0 },
    soldLinesWithoutInstructor: 0,
    courseInfoAvailable: input.courses !== null,
    instructorInfoAvailable: input.instructors !== null,
    minReliableReviews: MIN_RELIABLE_REVIEWS,
  };

  let paidOrderAmount = 0;
  let paidOrderCount = 0;
  let soldCourseLineCount = 0;
  const courses = new Map<string, CourseAcc>();
  // instructorId -> { sold lines, amount, sold course ids }
  const instructors = new Map<string, { salesCount: number; salesAmount: number; courseIds: Set<string> }>();

  for (const order of input.orders) {
    const evidence = (paymentsByOrder.get(order.id) ?? []).filter((p) => isSuccessState(p.status));
    const orderRecordsPayment = order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUNDED';

    if (evidence.length === 0) {
      if (orderRecordsPayment) dq.ordersWithoutPaymentEvidence++;
      continue;                                       // an unpaid order is simply not a sale
    }
    if (!orderRecordsPayment) {
      dq.ordersPaymentNotRecordedByOrder++;
      continue;
    }

    const refundedByPayment = evidence.reduce((sum, p) => sum + num(p.refundedTotal), 0);
    const refunded = Math.max(refundedByPayment, num(order.refundedAmount));
    const total = num(order.totalPrice);
    const fullyRefunded = order.paymentStatus === 'REFUNDED'
      || evidence.every((p) => p.status === 'REFUNDED')
      || (total > 0 && refunded >= total);
    if (fullyRefunded) {
      dq.fullyRefundedOrders.count++;
      dq.fullyRefundedOrders.amount += total;
      continue;
    }

    paidOrderCount++;
    paidOrderAmount += total;
    if (refunded > 0 || evidence.some((p) => p.status === 'PARTIALLY_REFUNDED')) {
      dq.partiallyRefundedOrders.count++;
      dq.partiallyRefundedOrders.refundedAmount += refunded;
    }

    for (const line of order.lines) {
      const status = typeof line.status === 'string' ? line.status.toUpperCase() : null;
      const amount = num(line.finalPrice);
      if (status === 'ALREADY_OWNED_DUPLICATE') {
        dq.duplicateLines.count++;
        dq.duplicateLines.amount += amount;
        continue;
      }
      if (status === 'REFUNDED') {
        dq.refundedLines.count++;
        dq.refundedLines.amount += amount;
        continue;
      }
      if (status !== 'FULFILLED' || !line.courseId || typeof line.finalPrice !== 'number' || !Number.isFinite(line.finalPrice)) {
        dq.unclassifiedLines.count++;
        dq.unclassifiedLines.amount += amount;
        continue;
      }

      soldCourseLineCount++;
      const info = courseInfo.get(line.courseId);
      const instructorId = line.instructorId || info?.instructorId || null;
      const acc = courses.get(line.courseId) ?? { courseId: line.courseId, title: '', instructorId: null, salesCount: 0, salesAmount: 0 };
      acc.salesCount++;
      acc.salesAmount += amount;
      if (line.courseTitle) acc.title = line.courseTitle;      // orders arrive oldest first: the latest snapshot wins
      acc.instructorId = acc.instructorId ?? instructorId;
      courses.set(line.courseId, acc);

      if (instructorId) {
        const ins = instructors.get(instructorId) ?? { salesCount: 0, salesAmount: 0, courseIds: new Set<string>() };
        ins.salesCount++;
        ins.salesAmount += amount;
        ins.courseIds.add(line.courseId);
        instructors.set(instructorId, ins);
      } else {
        dq.soldLinesWithoutInstructor++;
      }
    }
  }

  dq.fullyRefundedOrders.amount = money(dq.fullyRefundedOrders.amount);
  dq.partiallyRefundedOrders.refundedAmount = money(dq.partiallyRefundedOrders.refundedAmount);
  dq.duplicateLines.amount = money(dq.duplicateLines.amount);
  dq.refundedLines.amount = money(dq.refundedLines.amount);
  dq.unclassifiedLines.amount = money(dq.unclassifiedLines.amount);

  const byPerformance = <T extends { salesCount: number; salesAmount: number }>(a: T, b: T) =>
    b.salesCount - a.salesCount || b.salesAmount - a.salesAmount;

  const courseRows = [...courses.values()].map((acc) => {
    const info = courseInfo.get(acc.courseId);
    const r = info ? plausibleRating(info.rating, info.totalReviews) : { rating: null, count: null as number | null };
    return {
      courseId: acc.courseId,
      courseTitle: info?.title || acc.title,
      instructorId: acc.instructorId,
      instructorName: acc.instructorId ? instructorName.get(acc.instructorId) ?? null : null,
      salesCount: acc.salesCount,
      salesAmount: money(acc.salesAmount),
      rating: r.rating,
      ratingCount: r.count,
      ratingReliable: r.rating !== null && (r.count ?? 0) >= MIN_RELIABLE_REVIEWS,
    };
  }).sort((a, b) => byPerformance(a, b) || a.courseTitle.localeCompare(b.courseTitle) || a.courseId.localeCompare(b.courseId));

  const instructorRows = [...instructors.entries()].map(([instructorId, ins]) => {
    let reviews = 0;
    let weighted = 0;
    for (const courseId of ins.courseIds) {
      const info = courseInfo.get(courseId);
      if (!info) continue;
      const r = plausibleRating(info.rating, info.totalReviews);
      if (r.rating !== null) { reviews += r.count; weighted += r.rating * r.count; }
    }
    return {
      instructorId,
      instructorName: instructorName.get(instructorId) ?? null,
      soldCourseCount: ins.courseIds.size,
      salesCount: ins.salesCount,
      salesAmount: money(ins.salesAmount),
      // the average over the reviews of the courses that sold, weighted by each course's review count
      rating: reviews > 0 ? Math.round((weighted / reviews) * 100) / 100 : null,
      ratingCount: input.courses === null ? null : reviews,
      ratingReliable: reviews >= MIN_RELIABLE_REVIEWS,
    };
  }).sort((a, b) => byPerformance(a, b) || (a.instructorName ?? '').localeCompare(b.instructorName ?? '') || a.instructorId.localeCompare(b.instructorId));

  return {
    kpis: {
      paidOrderAmount: money(paidOrderAmount),
      paidOrderCount,
      soldCourseLineCount,
      distinctSoldCourseCount: courses.size,
    },
    topCourses: courseRows.slice(0, topN).map((row, i) => ({ rank: i + 1, ...row })),
    topInstructors: instructorRows.slice(0, topN).map((row, i) => ({ rank: i + 1, ...row })),
    totalCoursesWithSales: courseRows.length,
    totalInstructorsWithSales: instructorRows.length,
    dataQuality: dq,
  };
}
