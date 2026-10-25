/**
 * ADMIN-DASHBOARD-01 - the sales aggregation of the admin dashboard (pure function, no database, no network).
 *
 * Run: node -r ts-node/register/transpile-only --test test/sales-performance.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSalesPerformance,
  MIN_RELIABLE_REVIEWS,
  PaymentEvidence,
  SalesLineInput,
  SalesOrderInput,
} from '../src/utils/sales-performance';

const I1 = 'a1'.repeat(12);   // instructor ids
const I2 = 'a2'.repeat(12);
const I3 = 'a3'.repeat(12);
const C = (n: number) => `c${n}`.padEnd(24, '0');   // course ids

let seq = 0;
const line = (courseId: string, finalPrice: number, over: Partial<SalesLineInput> = {}): SalesLineInput =>
  ({ courseId, courseTitle: `Course ${courseId.slice(0, 2)}`, instructorId: I1, finalPrice, status: 'FULFILLED', ...over });
const order = (lines: SalesLineInput[], over: Partial<SalesOrderInput> = {}): SalesOrderInput => {
  const id = `${(++seq).toString(16).padStart(24, 'b')}`;
  return {
    id, orderNumber: `ORD-${seq}`, status: 'COMPLETED', paymentStatus: 'PAID',
    totalPrice: lines.reduce((s, l) => s + l.finalPrice, 0), refundedAmount: 0, lines, ...over,
  };
};
const paid = (o: SalesOrderInput, over: Partial<PaymentEvidence> = {}): PaymentEvidence =>
  ({ id: `p-${o.id}`, orderId: o.id, status: 'SUCCEEDED', amount: o.totalPrice, refundedTotal: 0, ...over });
const build = (orders: SalesOrderInput[], payments: PaymentEvidence[], extra: Partial<Parameters<typeof buildSalesPerformance>[0]> = {}) =>
  buildSalesPerformance({ orders, payments, courses: [], instructors: [], ...extra });

describe('ADMIN-DASHBOARD-01 buildSalesPerformance', () => {
  describe('what is a paid order', () => {
    it('counts an order only with a successful payment of that order; the amount is the order total, the count is orders (not lines)', () => {
      const o = order([line(C(1), 300000), line(C(2), 200000)]);
      const r = build([o], [paid(o)]);
      assert.equal(r.kpis.paidOrderCount, 1);                 // one order ...
      assert.equal(r.kpis.soldCourseLineCount, 2);            // ... two sold course lines
      assert.equal(r.kpis.distinctSoldCourseCount, 2);
      assert.equal(r.kpis.paidOrderAmount, 500000);
    });

    it('does not count an unpaid order (payment still PENDING / no payment at all)', () => {
      const a = order([line(C(1), 100000)], { status: 'PENDING', paymentStatus: 'UNPAID' });
      const b = order([line(C(2), 100000)], { status: 'PENDING', paymentStatus: 'UNPAID' });
      const r = build([a, b], [paid(a, { status: 'PENDING' })]);
      assert.deepEqual(r.kpis, { paidOrderAmount: 0, paidOrderCount: 0, soldCourseLineCount: 0, distinctSoldCourseCount: 0 });
      assert.equal(r.dataQuality.ordersWithoutPaymentEvidence, 0);   // unpaid is not an anomaly
      assert.equal(r.dataQuality.ordersPaymentNotRecordedByOrder, 0);  // a PENDING payment is no evidence either
    });

    it('does not count a failed / cancelled payment even if the order was marked paid', () => {
      const a = order([line(C(1), 100000)]);
      const b = order([line(C(2), 100000)]);
      const r = build([a, b], [paid(a, { status: 'FAILED' }), paid(b, { status: 'CANCELLED' })]);
      assert.equal(r.kpis.paidOrderCount, 0);
      assert.equal(r.dataQuality.ordersWithoutPaymentEvidence, 2);
    });

    it('does NOT trust Order.status = COMPLETED: an order completed by hand has no payment evidence and is left out', () => {
      const real = order([line(C(1), 100000)]);
      const manual = order([line(C(2), 900000)], { status: 'COMPLETED', paymentStatus: 'PAID' });   // admin PATCH status
      const r = build([real, manual], [paid(real)]);
      assert.equal(r.kpis.paidOrderCount, 1);
      assert.equal(r.kpis.paidOrderAmount, 100000);
      assert.equal(r.kpis.soldCourseLineCount, 1);
      assert.equal(r.dataQuality.ordersWithoutPaymentEvidence, 1);
      assert.deepEqual(r.topCourses.map((c) => c.courseId), [C(1)]);
    });

    it('does not count a payment that belongs to ANOTHER order', () => {
      const a = order([line(C(1), 100000)]);
      const b = order([line(C(2), 100000)]);
      const r = build([a], [paid(b)]);                        // evidence of b offered for a
      assert.equal(r.kpis.paidOrderCount, 0);
      assert.equal(r.dataQuality.ordersWithoutPaymentEvidence, 1);
    });

    it('leaves out (and reports) a successful payment the order does not record yet', () => {
      const o = order([line(C(1), 100000)], { status: 'PENDING', paymentStatus: 'UNPAID' });
      const r = build([o], [paid(o)]);
      assert.equal(r.kpis.paidOrderCount, 0);
      assert.equal(r.dataQuality.ordersPaymentNotRecordedByOrder, 1);
    });

    it('one successful payment among failed attempts of the same order is enough', () => {
      const o = order([line(C(1), 100000)]);
      const r = build([o], [paid(o, { id: 'p1', status: 'FAILED' }), paid(o, { id: 'p2' })]);
      assert.equal(r.kpis.paidOrderCount, 1);
    });
  });

  describe('refunds', () => {
    it('leaves out an order refunded in full (order side, payment side, or amounts) and lists it apart', () => {
      const a = order([line(C(1), 100000)], { status: 'CANCELLED', paymentStatus: 'REFUNDED' });
      const b = order([line(C(2), 200000)]);
      const c = order([line(C(3), 300000)], { refundedAmount: 300000 });
      const keep = order([line(C(4), 50000)]);
      const r = build([a, b, c, keep], [paid(a, { status: 'REFUNDED' }), paid(b, { status: 'REFUNDED' }), paid(c, { status: 'PARTIALLY_REFUNDED', refundedTotal: 300000 }), paid(keep)]);
      assert.equal(r.kpis.paidOrderCount, 1);
      assert.equal(r.kpis.paidOrderAmount, 50000);
      assert.equal(r.kpis.soldCourseLineCount, 1);
      assert.deepEqual(r.dataQuality.fullyRefundedOrders, { count: 3, amount: 600000 });
    });

    it('a partly refunded order stays in at its GROSS amount and is reported - the refund is not allocated to a course', () => {
      const o = order([line(C(1), 300000), line(C(2), 200000)]);
      const r = build([o], [paid(o, { status: 'PARTIALLY_REFUNDED', refundedTotal: 100000 })]);
      assert.equal(r.kpis.paidOrderAmount, 500000);           // not 400000: no guess about which course was refunded
      assert.equal(r.kpis.soldCourseLineCount, 2);
      assert.deepEqual(r.dataQuality.partiallyRefundedOrders, { count: 1, refundedAmount: 100000 });
      assert.deepEqual(r.topCourses.map((c) => c.salesAmount).sort(), [200000, 300000]);
    });

    it('a REFUNDED line is not a sale', () => {
      const o = order([line(C(1), 100000), line(C(2), 70000, { status: 'REFUNDED' })]);
      const r = build([o], [paid(o, { status: 'PARTIALLY_REFUNDED', refundedTotal: 70000 })]);
      assert.equal(r.kpis.soldCourseLineCount, 1);
      assert.deepEqual(r.dataQuality.refundedLines, { count: 1, amount: 70000 });
    });
  });

  describe('lines', () => {
    it('does not count an ALREADY_OWNED_DUPLICATE line as a sale, but the paid order still counts', () => {
      const o = order([line(C(1), 400000), line(C(2), 300000, { status: 'ALREADY_OWNED_DUPLICATE' })]);
      const r = build([o], [paid(o)]);
      assert.equal(r.kpis.paidOrderCount, 1);
      assert.equal(r.kpis.paidOrderAmount, 700000);           // money received for the order
      assert.equal(r.kpis.soldCourseLineCount, 1);            // sales only for the course really granted
      assert.equal(r.kpis.distinctSoldCourseCount, 1);
      assert.deepEqual(r.topCourses.map((c) => [c.courseId, c.salesAmount]), [[C(1), 400000]]);
      assert.deepEqual(r.dataQuality.duplicateLines, { count: 1, amount: 300000 });
    });

    it('a 100% duplicate order is a paid order with no sold line (and no course appears)', () => {
      const o = order([line(C(1), 400000, { status: 'ALREADY_OWNED_DUPLICATE' })], { status: 'CANCELLED' });
      const r = build([o], [paid(o)]);
      assert.equal(r.kpis.paidOrderCount, 1);
      assert.equal(r.kpis.soldCourseLineCount, 0);
      assert.deepEqual(r.topCourses, []);
    });

    it('lines with no or unknown fulfilment status are not guessed to be sales; they are reported', () => {
      const o = order([line(C(1), 100000), line(C(2), 50000, { status: 'PENDING' }), line(C(3), 25000, { status: null }), line(C(4), 10000, { status: 'WHATEVER' })]);
      const r = build([o], [paid(o)]);
      assert.equal(r.kpis.soldCourseLineCount, 1);
      assert.deepEqual(r.dataQuality.unclassifiedLines, { count: 3, amount: 85000 });
    });

    it('lines of an order that is not counted are not looked at', () => {
      const o = order([line(C(1), 100000), line(C(2), 1, { status: 'ALREADY_OWNED_DUPLICATE' })], { paymentStatus: 'UNPAID', status: 'PENDING' });
      const r = build([o], []);
      assert.equal(r.dataQuality.duplicateLines.count, 0);
    });

    it('the same course bought in several orders adds up; distinct courses are counted once', () => {
      const a = order([line(C(1), 100000), line(C(2), 50000)]);
      const b = order([line(C(1), 90000)]);
      const r = build([a, b], [paid(a), paid(b)]);
      assert.equal(r.kpis.paidOrderCount, 2);
      assert.equal(r.kpis.soldCourseLineCount, 3);
      assert.equal(r.kpis.distinctSoldCourseCount, 2);
      const c1 = r.topCourses.find((c) => c.courseId === C(1))!;
      assert.equal(c1.salesCount, 2);
      assert.equal(c1.salesAmount, 190000);
    });

    it('tolerates a non-numeric price: not a sale, reported as unclassified, never NaN', () => {
      const o = order([line(C(1), 100000), { ...line(C(2), 0), finalPrice: undefined as any }], { totalPrice: 100000 });
      const r = build([o], [paid(o)]);
      assert.equal(r.kpis.soldCourseLineCount, 1);
      assert.equal(r.dataQuality.unclassifiedLines.count, 1);
      assert.ok(Number.isFinite(r.kpis.paidOrderAmount));
    });
  });

  describe('ranking and grouping', () => {
    it('ranks courses by sales count, then by amount; only the top 5 are returned but the totals say how many exist', () => {
      const orders: SalesOrderInput[] = [];
      const add = (course: number, times: number, price: number) => { for (let i = 0; i < times; i++) orders.push(order([line(C(course), price)])); };
      add(1, 3, 100000);   // 3 sales, 300k
      add(2, 3, 200000);   // 3 sales, 600k  -> beats course 1 on amount
      add(3, 5, 10000);    // 5 sales, 50k   -> first: count wins over amount
      add(4, 1, 999000);   // 1 sale, biggest amount but few sales
      add(5, 2, 1000); add(6, 2, 2000); add(7, 1, 1000);
      const r = build(orders, orders.map((o) => paid(o)));
      assert.deepEqual(r.topCourses.map((c) => c.courseId), [C(3), C(2), C(1), C(6), C(5)]);
      assert.deepEqual(r.topCourses.map((c) => c.rank), [1, 2, 3, 4, 5]);
      assert.equal(r.totalCoursesWithSales, 7);
    });

    it('groups by instructor: sold courses, sold lines and amount; lines without a snapshot fall back to the course-service instructor', () => {
      const a = order([line(C(1), 100000), line(C(2), 100000, { instructorId: null })]);
      const b = order([line(C(3), 500000, { instructorId: I2 })]);
      const r = build([a, b], [paid(a), paid(b)], {
        courses: [
          { id: C(1), title: 'One', instructorId: I1, rating: 0, totalReviews: 0 },
          { id: C(2), title: 'Two', instructorId: I1, rating: 0, totalReviews: 0 },
          { id: C(3), title: 'Three', instructorId: I2, rating: 0, totalReviews: 0 },
        ],
        instructors: [{ id: I1, fullName: 'Nguyen A' }, { id: I2, fullName: 'Tran B' }],
      });
      const [first, second] = r.topInstructors;
      assert.deepEqual([first.instructorId, first.soldCourseCount, first.salesCount, first.salesAmount, first.instructorName], [I1, 2, 2, 200000, 'Nguyen A']);
      assert.deepEqual([second.instructorId, second.soldCourseCount, second.salesCount, second.salesAmount, second.instructorName], [I2, 1, 1, 500000, 'Tran B']);
      assert.equal(r.totalInstructorsWithSales, 2);
    });

    it('a sold line with no instructor anywhere stays in the course ranking, is absent from the instructor ranking, and is reported', () => {
      const o = order([line(C(1), 100000, { instructorId: null })]);
      const r = build([o], [paid(o)]);
      assert.equal(r.topCourses.length, 1);
      assert.equal(r.topCourses[0].instructorId, null);
      assert.equal(r.topCourses[0].instructorName, null);
      assert.deepEqual(r.topInstructors, []);
      assert.equal(r.dataQuality.soldLinesWithoutInstructor, 1);
    });

    it('instructor name is null (unknown) when the user-service has no name; not made up from the id', () => {
      const o = order([line(C(1), 100000)]);
      const r = build([o], [paid(o)], { instructors: [] });
      assert.equal(r.topInstructors[0].instructorName, null);
      assert.equal(r.topCourses[0].instructorName, null);
    });

    it('top lists are empty (not padded) when nothing was sold', () => {
      const r = build([], []);
      assert.deepEqual(r.topCourses, []);
      assert.deepEqual(r.topInstructors, []);
      assert.equal(r.kpis.paidOrderAmount, 0);
    });
  });

  describe('ratings', () => {
    const o = () => order([line(C(1), 100000), line(C(2), 100000), line(C(3), 100000, { instructorId: I2 })]);
    it('shows the stored average and review count; flags few reviews as not reliable', () => {
      const x = o();
      const r = build([x], [paid(x)], {
        courses: [
          { id: C(1), title: 'One', instructorId: I1, rating: 4.5, totalReviews: MIN_RELIABLE_REVIEWS },
          { id: C(2), title: 'Two', instructorId: I1, rating: 5, totalReviews: MIN_RELIABLE_REVIEWS - 1 },
          { id: C(3), title: 'Three', instructorId: I2, rating: 2, totalReviews: 1 },
        ],
      });
      const byId = Object.fromEntries(r.topCourses.map((c) => [c.courseId, c]));
      assert.deepEqual([byId[C(1)].rating, byId[C(1)].ratingCount, byId[C(1)].ratingReliable], [4.5, MIN_RELIABLE_REVIEWS, true]);
      assert.deepEqual([byId[C(2)].rating, byId[C(2)].ratingCount, byId[C(2)].ratingReliable], [5, MIN_RELIABLE_REVIEWS - 1, false]);
      assert.deepEqual([byId[C(3)].rating, byId[C(3)].ratingCount, byId[C(3)].ratingReliable], [2, 1, false]);
    });

    it('instructor rating = average of the sold courses weighted by their review counts', () => {
      const x = o();
      const r = build([x], [paid(x)], {
        courses: [
          { id: C(1), title: 'One', instructorId: I1, rating: 5, totalReviews: 3 },
          { id: C(2), title: 'Two', instructorId: I1, rating: 4, totalReviews: 1 },
          { id: C(3), title: 'Three', instructorId: I2, rating: 3, totalReviews: 0 },
        ],
      });
      const i1 = r.topInstructors.find((i) => i.instructorId === I1)!;
      assert.equal(i1.rating, 4.75);                          // (5*3 + 4*1) / 4, not the plain mean 4.5
      assert.equal(i1.ratingCount, 4);
      assert.equal(i1.ratingReliable, false);
    });

    it('a course without reviews has rating null and count 0 (known: none) - never a rating of 0', () => {
      const x = order([line(C(1), 100000)]);
      const r = build([x], [paid(x)], { courses: [{ id: C(1), title: 'One', instructorId: I1, rating: 0, totalReviews: 0 }] });
      assert.deepEqual([r.topCourses[0].rating, r.topCourses[0].ratingCount, r.topCourses[0].ratingReliable], [null, 0, false]);
      assert.deepEqual([r.topInstructors[0].rating, r.topInstructors[0].ratingCount], [null, 0]);
    });

    it('course-service unreachable: rating and count are null (unknown), titles fall back to the order snapshot, sales are unaffected', () => {
      const x = order([line(C(1), 100000, { courseTitle: 'Snapshot title' })]);
      const r = build([x], [paid(x)], { courses: null });
      assert.deepEqual([r.topCourses[0].rating, r.topCourses[0].ratingCount], [null, null]);
      assert.equal(r.topCourses[0].courseTitle, 'Snapshot title');
      assert.deepEqual([r.topInstructors[0].rating, r.topInstructors[0].ratingCount], [null, null]);
      assert.equal(r.dataQuality.courseInfoAvailable, false);
      assert.equal(r.kpis.paidOrderAmount, 100000);
    });

    it('a course the course-service no longer knows keeps its order snapshot title and has unknown rating', () => {
      const x = order([line(C(1), 100000, { courseTitle: 'Deleted course' })]);
      const r = build([x], [paid(x)], { courses: [] });
      assert.equal(r.topCourses[0].courseTitle, 'Deleted course');
      assert.deepEqual([r.topCourses[0].rating, r.topCourses[0].ratingCount], [null, null]);
    });

    it('an implausible stored rating (outside 0-5, NaN) is not shown', () => {
      const x = order([line(C(1), 100000), line(C(2), 100000)]);
      const r = build([x], [paid(x)], {
        courses: [
          { id: C(1), title: 'One', instructorId: I1, rating: 9, totalReviews: 10 },
          { id: C(2), title: 'Two', instructorId: I1, rating: NaN, totalReviews: 10 },
        ],
      });
      assert.ok(r.topCourses.every((c) => c.rating === null));
      assert.equal(r.topInstructors[0].rating, null);
    });
  });

  it('never reads the learner count: enrolledCount is not part of any input', () => {
    const x = order([line(C(1), 100000)]);
    const r = build([x], [paid(x)], { courses: [{ id: C(1), title: 'One', instructorId: I1, rating: 4, totalReviews: 2, enrolledCount: 9999 } as any] });
    assert.equal(r.kpis.soldCourseLineCount, 1);
    assert.equal(r.topCourses[0].salesCount, 1);
    assert.ok(!JSON.stringify(r).includes('9999'));
  });
});
