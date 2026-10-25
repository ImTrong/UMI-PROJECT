/**
 * ADMIN-DASHBOARD-01 - GET /api/orders/analytics/sales-performance, end to end through the REAL express app.
 *
 *   access       ADMIN only (401 without a token, 403 for a learner - and then nothing else is called)
 *   evidence     the payment-service is asked about the orders with ORDER_PAYMENT_TOKEN (never INTERNAL_SERVICE_TOKEN); an order that is
 *                only COMPLETED / PAID on the order side, with no successful payment, is not a sale; if the payments cannot be checked
 *                the answer is 502 and carries no figure
 *   display data course-service / user-service down: the sales figures stay, ratings and names are reported as unknown
 *   read-only    nothing is written to any model
 *
 * Orders and order items live in an in-memory database stand-in; the auth-, user-, course- and payment-services are one loopback
 * stub that records every call. Tokens are random per run.
 *
 * Run: node -r ts-node/register/transpile-only --test test/sales-performance-route.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, any>;
let orders: Row[] = [];
let items: Row[] = [];
const writes: string[] = [];
const findManyArgs: any[] = [];
const matchesCandidate = (o: Row, where: any) =>
  (where.OR as any[]).some((c) => (c.paymentStatus?.in ? c.paymentStatus.in.includes(o.paymentStatus) : c.paymentId?.not === null ? o.paymentId != null : false));
const recordingModel = (name: string) => new Proxy({}, { get: (_t, op: string) => async () => { writes.push(`${name}.${op}`); return null; } });
class FakePrismaClient {
  order = {
    findMany: async (args: any) => {
      findManyArgs.push(args);
      return orders.filter((o) => matchesCandidate(o, args.where)).map((o) => ({ ...o, orderItems: items.filter((i) => i.orderId === o.id).map((i) => ({ ...i })) }));
    },
    update: async () => { writes.push('order.update'); return null; },
    create: async () => { writes.push('order.create'); return null; },
    delete: async () => { writes.push('order.delete'); return null; },
  };
  constructor() {
    return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : typeof k === 'string' && !k.startsWith('$') ? recordingModel(k) : async () => undefined) });
  }
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: {
    PrismaClient: FakePrismaClient,
    OrderStatus: { PENDING: 'PENDING', PROCESSING: 'PROCESSING', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', FAILED: 'FAILED' },
    PaymentStatus: { UNPAID: 'UNPAID', PAID: 'PAID', REFUNDED: 'REFUNDED', FAILED: 'FAILED' },
    Prisma: {},
  },
} as any;

const ORDER_PAYMENT = randomBytes(32).toString('hex');
const SHARED = randomBytes(32).toString('hex');
const ADMIN_JWT = `admin.${randomBytes(8).toString('hex')}`;
const LEARNER_JWT = `learner.${randomBytes(8).toString('hex')}`;
const id = (c: string) => c.repeat(12);
const ADMIN = id('f1');
const LEARNER = id('f2');
const INS_A = id('a1');
const INS_B = id('a2');
const BUYER = id('e1');
const [C1, C2, C3] = [id('b1'), id('b2'), id('b3')];
const [O_REAL, O_MANUAL, O_REFUNDED, O_PENDING, O_DUP] = [id('01'), id('02'), id('03'), id('04'), id('05')];

const item = (orderId: string, courseId: string, finalPrice: number, over: Row = {}) =>
  ({ id: `${orderId.slice(0, 12)}${courseId.slice(0, 12)}`, orderId, courseId, courseTitle: `Title ${courseId.slice(0, 2)}`, instructorId: courseId === C3 ? INS_B : INS_A, price: finalPrice, finalPrice, status: 'FULFILLED', ...over });
const order = (idv: string, n: number, total: number, over: Row = {}) =>
  ({ id: idv, orderNumber: `ORD-${n}`, userId: BUYER, items: [], totalPrice: total, status: 'COMPLETED', paymentStatus: 'PAID', paymentId: id('c0'), refundedAmount: 0, createdAt: new Date(2026, 0, n), ...over });

describe('ADMIN-DASHBOARD-01 order-service: GET /api/orders/analytics/sales-performance', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  const calls: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  let payments: Row[] = [];
  let paymentAnswer = 200;
  let courseAnswer = 200;
  let userAnswer = 200;

  before(async () => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: any = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
        calls.push({ method: req.method || '', url: req.url || '', headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        const url = req.url || '';
        if (url === '/api/auth/verify-token') {
          const t = body?.token;
          if (t === ADMIN_JWT) return res.end(JSON.stringify({ valid: true, user: { userId: ADMIN, email: 'admin@example.test' } }));
          if (t === LEARNER_JWT) return res.end(JSON.stringify({ valid: true, user: { userId: LEARNER, email: 'learner@example.test' } }));
          return res.end(JSON.stringify({ valid: false }));
        }
        const role = url.match(/^\/api\/users\/([0-9a-f]{24})$/);
        if (role && req.method === 'GET') return res.end(JSON.stringify({ data: { role: role[1] === ADMIN ? 'ADMIN' : 'STUDENT' } }));
        if (url === '/api/payments/internal/payment-evidence') {
          if (req.headers['x-internal-service-token'] !== ORDER_PAYMENT) { res.statusCode = 403; return res.end('{}'); }
          if (paymentAnswer !== 200) { res.statusCode = paymentAnswer; return res.end('{}'); }
          const ids: string[] = body?.orderIds ?? [];
          return res.end(JSON.stringify({ data: payments.filter((p) => ids.includes(p.orderId)) }));
        }
        if (url === '/api/courses/batch') {
          if (courseAnswer !== 200) { res.statusCode = courseAnswer; return res.end('{}'); }
          return res.end(JSON.stringify({ data: [
            { id: C1, title: 'Live title C1', instructorId: INS_A, rating: 4.5, totalReviews: 8, enrolledCount: 12345 },
            { id: C2, title: 'Live title C2', instructorId: INS_A, rating: 0, totalReviews: 0, enrolledCount: 99999 },
            { id: C3, title: 'Live title C3', instructorId: INS_B, rating: 3, totalReviews: 2, enrolledCount: 1 },
          ] }));
        }
        if (url === '/api/users/batch') {
          if (userAnswer !== 200) { res.statusCode = userAnswer; return res.end('{}'); }
          return res.end(JSON.stringify({ data: [{ userId: INS_A, fullName: 'Nguyen Van A', avatar: null }, { userId: INS_B, fullName: 'Tran Thi B', avatar: null }] }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, {
      AUTH_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, PAYMENT_SERVICE_URL: stubBase,
      ORDER_PAYMENT_TOKEN: ORDER_PAYMENT, INTERNAL_SERVICE_TOKEN: SHARED, RATE_LIMIT_MAX_REQUESTS: '100000', NODE_ENV: 'test',
    });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
  });

  beforeEach(() => {
    calls.length = 0;
    writes.length = 0;
    findManyArgs.length = 0;
    paymentAnswer = 200; courseAnswer = 200; userAnswer = 200;
    process.env.ORDER_PAYMENT_TOKEN = ORDER_PAYMENT;
    orders = [
      order(O_REAL, 1, 800000),                                                    // really paid: C1 500k + C2 300k
      order(O_MANUAL, 2, 900000),                                                  // completed by hand: no payment
      order(O_REFUNDED, 3, 400000, { status: 'CANCELLED', paymentStatus: 'REFUNDED' }),
      order(O_PENDING, 4, 100000, { status: 'PENDING', paymentStatus: 'UNPAID' }), // payment never succeeded
      order(O_DUP, 5, 700000),                                                     // C3 400k fulfilled + C1 300k duplicate
    ];
    items = [
      item(O_REAL, C1, 500000), item(O_REAL, C2, 300000),
      item(O_MANUAL, C3, 900000),
      item(O_REFUNDED, C3, 400000, { status: 'REFUNDED' }),
      item(O_PENDING, C1, 100000, { status: 'PENDING' }),
      item(O_DUP, C3, 400000), item(O_DUP, C1, 300000, { status: 'ALREADY_OWNED_DUPLICATE' }),
    ];
    payments = [
      { id: id('90'), orderId: O_REAL, status: 'SUCCEEDED', amount: 800000, refundedTotal: 0 },
      { id: id('91'), orderId: O_MANUAL, status: 'PENDING', amount: 900000, refundedTotal: 0 },   // never paid
      { id: id('92'), orderId: O_REFUNDED, status: 'REFUNDED', amount: 400000, refundedTotal: 400000 },
      { id: id('93'), orderId: O_PENDING, status: 'PENDING', amount: 100000, refundedTotal: 0 },
      { id: id('94'), orderId: O_DUP, status: 'PARTIALLY_REFUNDED', amount: 700000, refundedTotal: 300000 },
    ];
  });

  const get = async (token?: string) => {
    const res = await fetch(`${base}/api/orders/analytics/sales-performance`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };

  it('401 without a token, 403 for a learner: no database read, no payment / course / user call', async () => {
    assert.equal((await get()).status, 401);
    assert.equal((await get(LEARNER_JWT)).status, 403);
    assert.equal(findManyArgs.length, 0);
    assert.deepEqual(calls.filter((c) => !c.url.startsWith('/api/auth/') && !/^\/api\/users\/[0-9a-f]{24}$/.test(c.url)), []);
  });

  it('counts only really paid orders: not the hand-completed, the pending nor the fully refunded one; duplicate lines are not sales', async () => {
    const r = await get(ADMIN_JWT);
    assert.equal(r.status, 200, r.text);
    const d = r.json.data;
    // paid orders: O_REAL (800k) and O_DUP (700k, partly refunded: stays at its gross amount)
    assert.deepEqual(d.kpis, { paidOrderAmount: 1500000, paidOrderCount: 2, soldCourseLineCount: 3, distinctSoldCourseCount: 3 });
    assert.deepEqual(d.dataQuality.fullyRefundedOrders, { count: 1, amount: 400000 });
    assert.deepEqual(d.dataQuality.partiallyRefundedOrders, { count: 1, refundedAmount: 300000 });
    assert.deepEqual(d.dataQuality.duplicateLines, { count: 1, amount: 300000 });
    assert.equal(d.dataQuality.ordersWithoutPaymentEvidence, 1);   // O_MANUAL
    const byId = Object.fromEntries(d.topCourses.map((c: any) => [c.courseId, c]));
    assert.equal(byId[C3].salesCount, 1);                           // only the O_DUP line; the hand-completed and refunded ones are out
    assert.equal(byId[C3].salesAmount, 400000);
    assert.equal(byId[C1].salesCount, 1);                           // the duplicate line of O_DUP is not a second sale
    assert.equal(byId[C1].salesAmount, 500000);
  });

  it('adds course title, instructor name and rating from the course- and user-service; the learner count never appears', async () => {
    const d = (await get(ADMIN_JWT)).json.data;
    const c1 = d.topCourses.find((c: any) => c.courseId === C1);
    assert.deepEqual([c1.courseTitle, c1.instructorName, c1.rating, c1.ratingCount, c1.ratingReliable], ['Live title C1', 'Nguyen Van A', 4.5, 8, true]);
    const c2 = d.topCourses.find((c: any) => c.courseId === C2);
    assert.deepEqual([c2.rating, c2.ratingCount], [null, 0]);
    const a = d.topInstructors.find((i: any) => i.instructorId === INS_A);
    assert.deepEqual([a.instructorName, a.soldCourseCount, a.salesCount, a.salesAmount, a.rating, a.ratingCount], ['Nguyen Van A', 2, 2, 800000, 4.5, 8]);
    assert.ok(!/12345|99999/.test(JSON.stringify(d)), 'enrolledCount must not be part of the answer');
  });

  it('asks the payment-service with ORDER_PAYMENT_TOKEN only, for the order ids; forwards the admin bearer only to the course batch route; writes nothing', async () => {
    await get(ADMIN_JWT);
    const pay = calls.filter((c) => c.url === '/api/payments/internal/payment-evidence');
    assert.equal(pay.length, 1);
    assert.equal(pay[0].headers['x-internal-service-token'], ORDER_PAYMENT);
    assert.ok(![...Object.values(pay[0].headers)].includes(SHARED));
    assert.deepEqual([...pay[0].body.orderIds].sort(), orders.map((o) => o.id).sort());
    assert.equal(pay[0].headers.authorization, undefined);          // no user JWT goes to the payment-service
    const course = calls.filter((c) => c.url === '/api/courses/batch');
    assert.equal(course.length, 1);                                  // one batch call, not one per course
    assert.equal(course[0].headers.authorization, `Bearer ${ADMIN_JWT}`);
    assert.equal(calls.filter((c) => c.url === '/api/users/batch').length, 1);
    assert.deepEqual(writes, []);
  });

  it('only orders that may have been paid are read (paid / refunded on the order, or a payment attached)', async () => {
    orders.push(order(id('06'), 6, 50000, { status: 'PENDING', paymentStatus: 'UNPAID', paymentId: null }));
    await get(ADMIN_JWT);
    const asked = calls.find((c) => c.url === '/api/payments/internal/payment-evidence')!.body.orderIds as string[];
    assert.ok(!asked.includes(id('06')));
  });

  it('payment-service down: 502 PAYMENT_EVIDENCE_UNAVAILABLE and no figure - it does NOT fall back to Order.status', async () => {
    for (const status of [503, 500, 403]) {
      paymentAnswer = status;
      const r = await get(ADMIN_JWT);
      assert.equal(r.status, 502);
      assert.equal(r.json.code, 'PAYMENT_EVIDENCE_UNAVAILABLE');
      assert.equal(r.json.data, undefined);
    }
  });

  it('no usable ORDER_PAYMENT_TOKEN: 502 and nothing is sent to the payment-service', async () => {
    delete process.env.ORDER_PAYMENT_TOKEN;
    const r = await get(ADMIN_JWT);
    assert.equal(r.status, 502);
    assert.equal(calls.filter((c) => c.url.startsWith('/api/payments/')).length, 0);
  });

  it('course-service down: sales stay, ratings and live titles are unknown (null), flagged; user-service down: names unknown', async () => {
    courseAnswer = 500;
    userAnswer = 500;
    const r = await get(ADMIN_JWT);
    assert.equal(r.status, 200);
    const d = r.json.data;
    assert.equal(d.kpis.paidOrderAmount, 1500000);
    assert.equal(d.dataQuality.courseInfoAvailable, false);
    assert.equal(d.dataQuality.instructorInfoAvailable, false);
    for (const c of d.topCourses) {
      assert.deepEqual([c.rating, c.ratingCount, c.instructorName], [null, null, null]);
      assert.match(c.courseTitle, /^Title /);                       // the order snapshot
    }
    assert.ok(d.topInstructors.every((i: any) => i.instructorName === null && i.rating === null));
  });

  it('with no order at all: an empty, successful answer and no payment call', async () => {
    orders = []; items = [];
    const r = await get(ADMIN_JWT);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.kpis, { paidOrderAmount: 0, paidOrderCount: 0, soldCourseLineCount: 0, distinctSoldCourseCount: 0 });
    assert.deepEqual(r.json.data.topCourses, []);
    assert.equal(calls.filter((c) => c.url.startsWith('/api/payments/')).length, 0);
  });
});
