/**
 * FIX 07B-1.2 end to end against a REAL MongoDB replica set: the order-service and the payment-service, both REAL express apps with
 * their own generated Prisma clients, run in this process against the same ISOLATED database (`<name>_paystat`, dropped at the end).
 *
 *   POST /api/orders/:orderId/payment (order-service, user JWT)
 *     -> POST /api/payments/internal/confirm (payment-service, service token)  -> Stripe (scripted getPaymentIntent)
 *        -> POST /api/orders/webhook/payment (order-service, service token)    -> enrollment (learning stub)
 *
 * PAY-STATUS-01: the answer `data.status` (payment-service enum, upper case) is classified by ONE function; only SUCCEEDED is a
 * success; the order is moved to COMPLETED and the course granted only by the payment webhook, exactly once, also on retries.
 * PAY-PROVIDER-01: a payOS order never reaches Stripe and nothing is marked FAILED; a Stripe error marks nothing FAILED.
 * Auth, learning, course and user services are one loopback stub that records every call.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" \
 *     node -r ts-node/register/transpile-only --test test/payment-status-contract.mongo.test.ts
 *
 * Without TEST_DATABASE_URL this file is skipped.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { classifyConfirmationStatus, PAYMENT_SERVICE_STATUSES } from '../src/utils/payment-status';

function resolveTestDb(suffix: string): { enabled: boolean; url?: string } {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return { enabled: false };
  const [base, query] = raw.split('?');
  const name = base.split('/').pop() || '';
  if (!/test/i.test(name) || !/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(base)) {
    console.error(`Refusing to run: "${name}" is not an isolated local test database.`);
    return { enabled: false };
  }
  return { enabled: true, url: `${base.slice(0, base.length - name.length)}${name}_${suffix}${query ? `?${query}` : ''}` };
}

const PS = path.resolve(__dirname, '..', '..', 'payment-service');
const target = resolveTestDb('paystat');
const USER_A = 'a1'.repeat(12);
const USER_B = 'b2'.repeat(12);
const COURSE_1 = 'e1'.repeat(12);
const COURSE_2 = 'e2'.repeat(12);
const SESSIONS: Record<string, any> = { 'session-a': { userId: USER_A, email: 'a@test.local' }, 'session-b': { userId: USER_B, email: 'b@test.local' } };
// FIX-INS-04: Order <-> Learning credential. The learning stub below behaves like the real learning-service: it requires this token
// and, before granting a course, asks the REAL order-service (GET /api/orders/internal/:orderId/entitlement) whether the order is PAID.
const ORDER_LEARNING = randomBytes(32).toString('hex');

describe('PAY-STATUS-01: the one classification of the payment-service answer', () => {
  it('only the exact upper-case SUCCEEDED is a success; pending / failed / everything else is not', () => {
    assert.equal(classifyConfirmationStatus('SUCCEEDED'), 'SUCCEEDED');
    for (const s of ['PENDING', 'PROCESSING']) assert.equal(classifyConfirmationStatus(s), 'PENDING');
    for (const s of ['FAILED', 'CANCELLED']) assert.equal(classifyConfirmationStatus(s), 'FAILED');
    for (const s of ['REFUNDED', 'PARTIALLY_REFUNDED']) assert.equal(classifyConfirmationStatus(s), 'UNKNOWN');
    for (const s of ['succeeded', 'Succeeded', ' SUCCEEDED', 'SUCCEEDED ', 'PAID', 'paid', 'success', 'true', '', undefined, null, 1, true, {}, ['SUCCEEDED'], { status: 'SUCCEEDED' }]) {
      assert.equal(classifyConfirmationStatus(s), 'UNKNOWN', JSON.stringify(s));
    }
  });

  it('the contract list matches the payment-service PaymentStatus enum in its Prisma schema', () => {
    const schema = require('fs').readFileSync(path.join(PS, 'prisma', 'schema.prisma'), 'utf8');
    const block = /enum PaymentStatus \{([^}]*)\}/.exec(schema)![1];
    assert.deepEqual(block.split(/\s+/).filter(Boolean), [...PAYMENT_SERVICE_STATUSES]);
  });
});

describe('REAL MongoDB end to end: order-service <-> payment-service status contract and provider isolation (FIX 07B-1.2)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let orderDb: any;
  let paymentDb: any;
  let orderServer: http.Server;
  let paymentServer: http.Server;
  let stub: http.Server;
  let orderBase = '';
  let PaymentStripe: any;
  const stubCalls: Array<{ url: string; body: any; token?: unknown; entitled?: boolean }> = [];
  const stripeAsked: string[] = [];
  let stripeScript: (id: string) => Promise<any> = async (id) => ({ id, status: 'succeeded' });
  const url = (s: http.Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

  before(async () => {
    assert.match(target.url as string, /test/i);
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: any = null;
        try { body = JSON.parse(raw); } catch { /* not JSON */ }
        res.setHeader('content-type', 'application/json');
        if (/\/api\/learning\/internal\/courses\/[0-9a-f]{24}\/enroll$/.test(req.url || '')) {
          const token = req.headers['x-internal-service-token'];
          const courseId = (req.url || '').split('/')[5];
          const call: { url: string; body: any; token?: unknown; entitled?: boolean } = { url: req.url || '', body, token };
          stubCalls.push(call);
          if (token !== ORDER_LEARNING) { res.statusCode = 403; return res.end('{}'); }
          fetch(`${orderBase}/api/orders/internal/${body?.orderId}/entitlement?userId=${body?.userId}&courseId=${courseId}`, { headers: { 'x-internal-service-token': ORDER_LEARNING } })
            .then((r) => r.json())
            .then((j: any) => { call.entitled = j?.data?.entitled === true; res.statusCode = call.entitled ? 201 : 403; res.end('{}'); })
            .catch(() => { res.statusCode = 503; res.end('{}'); });
          return;
        }
        stubCalls.push({ url: req.url || '', body });
        if (req.url === '/api/auth/verify-token') {
          const user = SESSIONS[body?.token];
          return res.end(JSON.stringify(user ? { valid: true, user } : { valid: false }));
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    stub.listen(0, '127.0.0.1');
    await new Promise((r) => stub.once('listening', r));
    const stubBase = url(stub);

    // two ports reserved first, because each service reads the other's URL when it is loaded
    const reserve = async () => { const s = http.createServer(); await new Promise<void>((r) => s.listen(0, '127.0.0.1', r)); const p = (s.address() as AddressInfo).port; await new Promise((r) => s.close(r)); return p; };
    const orderPort = await reserve();
    const paymentPort = await reserve();
    Object.assign(process.env, {
      DATABASE_URL: target.url, NODE_ENV: 'production', INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'), ORDER_PAYMENT_TOKEN: randomBytes(32).toString('hex'), PAYMENT_USER_TOKEN: randomBytes(32).toString('hex'), ORDER_LEARNING_TOKEN: ORDER_LEARNING,
      AUTH_SERVICE_URL: stubBase, LEARNING_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase,
      ORDER_SERVICE_URL: `http://127.0.0.1:${orderPort}`, PAYMENT_SERVICE_URL: `http://127.0.0.1:${paymentPort}`,
      STRIPE_SECRET_KEY: `sk_test_${randomBytes(12).toString('hex')}`, RATE_LIMIT_MAX_REQUESTS: '100000',
    });
    delete process.env.PAYMENT_MOCK_ENABLED;

    orderDb = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url: target.url } } });
    paymentDb = new (require(path.join(PS, 'node_modules', '@prisma/client')).PrismaClient)({ datasources: { db: { url: target.url } } });
    await orderDb.$runCommandRaw({ dropDatabase: 1 });

    for (const logger of [require('../src/utils/logger').default, require(path.join(PS, 'src', 'utils', 'logger')).default]) logger.transports.forEach((t: any) => { t.silent = true; });
    PaymentStripe = require(path.join(PS, 'src', 'services', 'stripe.service')).StripeService;
    PaymentStripe.getPaymentIntent = async (id: string) => { stripeAsked.push(id); return stripeScript(id); };
    const orderApp = require('../src/app').default;
    const paymentApp = require(path.join(PS, 'src', 'app')).default;
    orderServer = await new Promise<http.Server>((resolve) => { const s = orderApp.listen(orderPort, '127.0.0.1', () => resolve(s)); });
    paymentServer = await new Promise<http.Server>((resolve) => { const s = paymentApp.listen(paymentPort, '127.0.0.1', () => resolve(s)); });
    orderBase = url(orderServer);
  });

  after(async () => {
    try { await orderDb?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await orderDb?.$disconnect();
    await paymentDb?.$disconnect();
    for (const s of [orderServer, paymentServer, stub]) await new Promise((r) => s?.close(r));
  });

  // one order of user A with two courses, paid through `provider`
  const seedOrder = async (provider: 'stripe' | 'payos', pi = 'pi_3E2EStripeA') => {
    await orderDb.orderItem.deleteMany({});
    await orderDb.order.deleteMany({});
    await paymentDb.payment.deleteMany({});
    const order = await orderDb.order.create({
      data: { orderNumber: `ORD-STAT-${provider}-${Date.now()}`, userId: USER_A, items: [], subtotal: 300000, totalPrice: 300000, paymentProvider: provider, ...(provider === 'payos' && { payosOrderCode: '7999000001' }) },
    });
    for (const [courseId, title] of [[COURSE_1, 'Course 1'], [COURSE_2, 'Course 2']]) {
      await orderDb.orderItem.create({ data: { orderId: order.id, courseId, courseTitle: title, price: 150000, finalPrice: 150000 } });
    }
    const payment = await paymentDb.payment.create({
      data: {
        orderId: order.id, orderNumber: order.orderNumber, userId: USER_A, amount: 300000, currency: 'vnd', status: 'PENDING', type: 'COURSE_PURCHASE', provider, orderSynced: false,
        ...(provider === 'stripe' ? { stripePaymentIntentId: pi, metadata: {} } : { payosOrderCode: '7999000001', metadata: { orderCode: 7999000001, orderSynced: false } }),
      },
    });
    await orderDb.order.update({ where: { id: order.id }, data: { paymentId: payment.id } });
    stubCalls.length = 0;
    stripeAsked.length = 0;
    return { orderId: order.id, paymentId: payment.id };
  };
  const pay = async (session: string, orderId: string) => {
    const res = await fetch(`${orderBase}/api/orders/${orderId}/payment`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify({ paymentMethodId: 'pm_card_visa' }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const snapshot = async () => ({
    orders: (await orderDb.$runCommandRaw({ find: 'orders', filter: {} })).cursor.firstBatch,
    items: (await orderDb.$runCommandRaw({ find: 'order_items', filter: {} })).cursor.firstBatch,
    payments: (await paymentDb.$runCommandRaw({ find: 'payments', filter: {} })).cursor.firstBatch,
  });
  const enrollments = () => stubCalls.filter((c) => /\/api\/learning\/internal\/courses\/[0-9a-f]{24}\/enroll$/.test(c.url));
  const userCalls = () => stubCalls.filter((c) => c.url.startsWith('/api/users'));

  beforeEach(() => {
    stripeScript = async (id) => ({ id, status: 'succeeded' });
    process.env.NODE_ENV = 'production';
    delete process.env.PAYMENT_MOCK_ENABLED;
  });

  it('SUCCEEDED: the order service recognises the success; the webhook completes the order and grants each course ONCE', async () => {
    const { orderId, paymentId } = await seedOrder('stripe');
    const res = await pay('session-a', orderId);
    assert.equal(res.status, 200);
    assert.equal(res.json.message, 'Payment processed successfully');
    assert.equal(res.json.data.success, true);
    assert.equal(res.json.data.status, 'SUCCEEDED');
    assert.equal(res.json.data.payment.status, 'SUCCEEDED', 'the payment-service answers the upper-case enum');
    assert.deepEqual(stripeAsked, ['pi_3E2EStripeA']);
    const order = await orderDb.order.findUnique({ where: { id: orderId } });
    assert.equal(order.status, 'COMPLETED', 'not moved back to PROCESSING by the order service itself');
    assert.equal(order.paymentStatus, 'PAID');
    assert.equal(order.reconciliationStatus, 'NONE', 'its own courses were not taken for "already purchased"');
    assert.deepEqual(enrollments().map((c) => [c.url.split('/')[5], c.body.userId]).sort(), [[COURSE_1, USER_A], [COURSE_2, USER_A]]);
    // FIX-INS-04: each enrollment carried ORDER_LEARNING_TOKEN + this order id, and the REAL order-service confirmed the payment
    for (const c of enrollments()) {
      assert.equal(c.token, ORDER_LEARNING);
      assert.deepEqual(c.body, { userId: USER_A, orderId });
      assert.equal(c.entitled, true, 'the order was already stored as PAID when the learning-service checked it');
    }
    const payment = await paymentDb.payment.findUnique({ where: { id: paymentId } });
    assert.equal(payment.status, 'SUCCEEDED');
    assert.equal(payment.orderSynced, true);
  });

  it('retrying the successful payment (3x, also concurrently): still success, no second enrollment, nothing rewritten', async () => {
    const { orderId } = await seedOrder('stripe');
    assert.equal((await pay('session-a', orderId)).status, 200);
    const afterFirst = await snapshot();
    stubCalls.length = 0;
    stripeAsked.length = 0;
    const again = await Promise.all([pay('session-a', orderId), pay('session-a', orderId), pay('session-a', orderId)]);
    for (const a of again) { assert.equal(a.status, 200); assert.equal(a.json.data.success, true); }
    assert.deepEqual(await snapshot(), afterFirst, 'orders, items and payments byte-for-byte unchanged');
    assert.equal(enrollments().length, 0);
    assert.equal(stripeAsked.length, 0, 'an already SUCCEEDED payment is not sent to Stripe again');
  });

  it('PENDING (Stripe still processing): not PAID - order PENDING, payment PENDING, no enrollment, answer says so', async () => {
    const { orderId } = await seedOrder('stripe');
    stripeScript = async (id) => ({ id, status: 'processing' });
    const res = await pay('session-a', orderId);
    assert.equal(res.status, 200);
    assert.deepEqual([res.json.data.success, res.json.data.status, res.json.message], [false, 'PENDING', 'Payment is still being processed']);
    const order = await orderDb.order.findUnique({ where: { id: orderId } });
    assert.deepEqual([order.status, order.paymentStatus], ['PENDING', 'UNPAID']);
    assert.equal(enrollments().length, 0);
  });

  it('FAILED (Stripe: requires_payment_method): existing rule - payment FAILED, order not paid and not changed by the order service', async () => {
    const { orderId, paymentId } = await seedOrder('stripe');
    stripeScript = async (id) => ({ id, status: 'requires_payment_method' });
    const res = await pay('session-a', orderId);
    assert.deepEqual([res.status, res.json.data.success, res.json.data.status], [200, false, 'FAILED']);
    assert.equal((await paymentDb.payment.findUnique({ where: { id: paymentId } })).status, 'FAILED');
    const order = await orderDb.order.findUnique({ where: { id: orderId } });
    assert.deepEqual([order.status, order.paymentStatus], ['PENDING', 'UNPAID']);
    assert.equal(enrollments().length, 0);
  });

  it('PAY-PROVIDER-01: a payOS order while Stripe is configured - refused, Stripe never asked, payment and order unchanged (not FAILED)', async () => {
    const { orderId } = await seedOrder('payos');
    const before = await snapshot();
    const res = await pay('session-a', orderId);
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: 'Failed to process payment' });
    assert.deepEqual(await snapshot(), before);
    assert.equal(stripeAsked.length, 0);
    assert.equal(enrollments().length, 0);
    assert.equal(userCalls().length, 0);
  });

  it('PAY-PROVIDER-01: Stripe unreachable - nothing FAILED: payment back to PENDING, order unchanged, no enrollment, no notification', async () => {
    const { orderId, paymentId } = await seedOrder('stripe');
    // another learner's payOS payment in the same collection: a Stripe error must not touch it
    const other = await paymentDb.payment.create({ data: { orderId: 'f0'.repeat(12), userId: USER_B, amount: 99000, currency: 'vnd', status: 'PENDING', type: 'COURSE_PURCHASE', provider: 'payos', payosOrderCode: '7999000002', metadata: {} } });
    const before = await snapshot();
    stripeScript = async () => { throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); };
    assert.equal((await pay('session-a', orderId)).status, 500);
    const after = await snapshot();
    assert.deepEqual(after.orders, before.orders);
    assert.deepEqual(after.items, before.items);
    const payment = await paymentDb.payment.findUnique({ where: { id: paymentId } });
    assert.equal(payment.status, 'PENDING');
    assert.equal(payment.errorMessage, 'connect ETIMEDOUT');
    assert.deepEqual(after.payments.find((p: any) => p._id.$oid === other.id), before.payments.find((p: any) => p._id.$oid === other.id), 'the payOS payment is untouched');
    assert.equal(enrollments().length, 0);
  });

  it('ownership (FIX 07B-1.1) unchanged: B paying A\'s order is refused before the payment-service is called', async () => {
    const { orderId } = await seedOrder('stripe');
    const before = await snapshot();
    assert.equal((await pay('session-b', orderId)).status, 403);
    assert.deepEqual(await snapshot(), before);
    assert.equal(stripeAsked.length, 0);
    assert.equal(enrollments().length, 0);
  });

  it('mock gate (FIX 07B-1) unchanged: with Stripe NOT configured and the flag off / production, the demo confirm is refused and nothing changes', async () => {
    const key = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      for (const [flag, env] of [[undefined, 'development'], ['true', 'production']] as const) {
        if (flag === undefined) delete process.env.PAYMENT_MOCK_ENABLED; else process.env.PAYMENT_MOCK_ENABLED = flag;
        process.env.NODE_ENV = env;
        const { orderId } = await seedOrder('stripe', 'pi_mock_e2e');
        const before = await snapshot();
        assert.equal((await pay('session-a', orderId)).status, 500);
        assert.deepEqual(await snapshot(), before);
        assert.equal(enrollments().length, 0);
      }
    } finally {
      process.env.STRIPE_SECRET_KEY = key;
    }
  });

  it('FIX 07B-1.3: the real answers match the frontend contract fixture (succeeded, pending, failed, forbidden, server error)', async () => {
    const contract = JSON.parse(require('fs').readFileSync(path.resolve(__dirname, '../../../frontend/tests/fixtures/payment-confirmation-contract.json'), 'utf8'));
    const contains = (actual: any, expected: any, where: string): void => {
      if (expected !== null && typeof expected === 'object') {
        assert.ok(actual !== null && typeof actual === 'object', `${where}: expected an object, got ${JSON.stringify(actual)}`);
        for (const [k, v] of Object.entries(expected)) contains(actual[k], v, `${where}.${k}`);
      } else assert.deepEqual(actual, expected, where);
    };
    const check = (res: { status: number; json: any }, key: string) => {
      assert.equal(res.status, contract.orderPayment[key].http, `orderPayment.${key}: HTTP status`);
      contains(res.json, contract.orderPayment[key].body, `orderPayment.${key}`);
    };
    for (const [key, stripeStatus] of [['succeeded', 'succeeded'], ['pending', 'processing'], ['failed', 'requires_payment_method']]) {
      const { orderId } = await seedOrder('stripe');
      stripeScript = async (id) => ({ id, status: stripeStatus });
      check(await pay('session-a', orderId), key);
    }
    const { orderId } = await seedOrder('stripe');
    check(await pay('session-b', orderId), 'forbidden');
    const payos = await seedOrder('payos');
    check(await pay('session-a', payos.orderId), 'serverError');
  });
});
