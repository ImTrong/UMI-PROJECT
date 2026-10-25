/**
 * FIX 07B-2A end to end against a REAL MongoDB replica set: the payment-service (this process) and the order-service (a child
 * process with its OWN environment) talk to each other only with ORDER_PAYMENT_TOKEN, in both directions:
 *
 *   order  -> POST /api/payments/internal/confirm            (PaymentClient, user's order payment)
 *   payment-> POST /api/orders/webhook/payment               (notifyOrderService during confirm / Stripe webhook, and the outbox job)
 *
 * Same token: the order is completed and the courses granted once. Different / missing tokens: nothing is changed wrongly, the
 * payment waits in the outbox (orderSynced=false) and is delivered by the job once the tokens agree - exactly once.
 * Both services use the ISOLATED database named by TEST_DATABASE_URL (`<name>_optok`, dropped at the end); auth, learning and course
 * services are a loopback stub that records every call; Stripe is scripted. Every token is drawn at random for this run.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" \
 *     node -r ts-node/register/transpile-only --test test/order-payment-token.mongo.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

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

const target = resolveTestDb('optok');
const TOKEN = randomBytes(32).toString('hex');           // ORDER_PAYMENT_TOKEN when both sides agree
const OTHER = randomBytes(32).toString('hex');           // a different ORDER_PAYMENT_TOKEN
const SHARED = randomBytes(32).toString('hex');          // INTERNAL_SERVICE_TOKEN, identical on both sides
const USER_A = 'a1'.repeat(12);
const COURSE_1 = 'e1'.repeat(12);
const COURSE_2 = 'e2'.repeat(12);
const SESSIONS: Record<string, any> = { 'session-a': { userId: USER_A, email: 'a@test.local' } };

describe('REAL MongoDB end to end: Order <-> Payment with ORDER_PAYMENT_TOKEN (FIX 07B-2A)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let paymentDb: any;
  let orderDb: any;
  let server: http.Server;
  let stub: http.Server;
  let child: ChildProcess;
  let orderBase = '';
  let PaymentService: any;
  let syncPendingOrders: any;
  const stubCalls: Array<{ url: string; body: any }> = [];
  const stripeAsked: string[] = [];

  const toChild = (key: string, value: string | null) => new Promise<void>((resolve) => {
    const onMsg = (m: any) => { if (m?.type === 'env-set' && m.key === key) { child.off('message', onMsg); resolve(); } };
    child.on('message', onMsg);
    child.send({ type: 'env', key, value });
  });

  before(async () => {
    assert.match(target.url as string, /test/i);
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: any = null;
        try { body = JSON.parse(raw); } catch { /* not JSON */ }
        stubCalls.push({ url: req.url || '', body });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/auth/verify-token') {
          const user = SESSIONS[body?.token];
          return res.end(JSON.stringify(user ? { valid: true, user } : { valid: false }));
        }
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

    // the payment-service (this process) on a port known before the order-service starts
    Object.assign(process.env, {
      DATABASE_URL: target.url, NODE_ENV: 'production', AUTH_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase,
      ORDER_PAYMENT_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED, PAYMENT_USER_TOKEN: randomBytes(32).toString('hex'),
      STRIPE_SECRET_KEY: `sk_test_${randomBytes(12).toString('hex')}`,
    });
    delete process.env.PAYMENT_MOCK_ENABLED;
    const { PrismaClient } = require('@prisma/client');
    paymentDb = new PrismaClient({ datasources: { db: { url: target.url } } });
    orderDb = new (require(path.resolve(__dirname, '../../order-service/node_modules/@prisma/client')).PrismaClient)({ datasources: { db: { url: target.url } } });
    await paymentDb.$runCommandRaw({ dropDatabase: 1 });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    require('../src/services/stripe.service').StripeService.getPaymentIntent = async (id: string) => { stripeAsked.push(id); return { id, status: 'succeeded' }; };
    PaymentService = require('../src/services/payment.service').PaymentService;
    syncPendingOrders = require('../src/jobs/order-sync.job').syncPendingOrders;
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const paymentBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    child = fork(path.join(__dirname, 'helpers', 'order-service-process.js'), [], {
      cwd: os.tmpdir(), execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: target.url, NODE_ENV: 'test', RATE_LIMIT_MAX_REQUESTS: '100000',
        ORDER_PAYMENT_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED, PAYMENT_SERVICE_URL: paymentBase,
        AUTH_SERVICE_URL: stubBase, LEARNING_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase,
      } as any,
    });
    const port = await new Promise<number>((resolve, reject) => {
      child.once('message', (m: any) => (m?.type === 'ready' ? resolve(m.port) : reject(new Error('unexpected message'))));
      child.once('exit', (code) => reject(new Error(`order-service child exited with ${code}`)));
    });
    orderBase = `http://127.0.0.1:${port}`;
    process.env.ORDER_SERVICE_URL = orderBase;
  });

  after(async () => {
    try { await paymentDb?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await paymentDb?.$disconnect();
    await orderDb?.$disconnect();
    try { child?.disconnect(); } catch { /* gone */ }
    child?.kill();
    await new Promise((resolve) => server?.close(resolve));
    await new Promise((resolve) => stub?.close(resolve));
  });

  const ids: Record<string, string> = {};
  beforeEach(async () => {
    process.env.ORDER_PAYMENT_TOKEN = TOKEN;
    await toChild('ORDER_PAYMENT_TOKEN', TOKEN);
    await orderDb.orderItem.deleteMany({});
    await orderDb.order.deleteMany({});
    await paymentDb.payment.deleteMany({});
    const order = await orderDb.order.create({ data: { orderNumber: `ORD-OPT-${Date.now()}`, userId: USER_A, items: [], subtotal: 300000, totalPrice: 300000, paymentProvider: 'stripe' } });
    for (const courseId of [COURSE_1, COURSE_2]) await orderDb.orderItem.create({ data: { orderId: order.id, courseId, courseTitle: courseId.slice(0, 4), price: 150000, finalPrice: 150000 } });
    const payment = await paymentDb.payment.create({ data: { orderId: order.id, orderNumber: order.orderNumber, userId: USER_A, amount: 300000, currency: 'vnd', status: 'PENDING', type: 'COURSE_PURCHASE', provider: 'stripe', stripePaymentIntentId: `pi_3Opt${Date.now()}`, metadata: {}, orderSynced: false } });
    await orderDb.order.update({ where: { id: order.id }, data: { paymentId: payment.id } });
    Object.assign(ids, { order: order.id, payment: payment.id, pi: payment.stripePaymentIntentId });
    stubCalls.length = 0;
    stripeAsked.length = 0;
  });

  const pay = async () => {
    const res = await fetch(`${orderBase}/api/orders/${ids.order}/payment`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer session-a' }, body: JSON.stringify({ paymentMethodId: 'pm_card_visa' }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const order = () => orderDb.order.findUnique({ where: { id: ids.order } });
  const payment = () => paymentDb.payment.findUnique({ where: { id: ids.payment } });
  const enrollments = () => stubCalls.filter((c) => /\/api\/learning\/internal\/courses\/[0-9a-f]{24}\/enroll$/.test(c.url));
  const stripeSucceeded = () => PaymentService.handleStripeWebhook({ id: `evt_${ids.pi}`, type: 'payment_intent.succeeded', data: { object: { id: ids.pi } } }, { skipEventTracking: true });

  it('AUTH-OP-01: same ORDER_PAYMENT_TOKEN on both sides - order -> internal confirm -> order webhook: COMPLETED, each course granted once', async () => {
    const res = await pay();
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, 'SUCCEEDED');
    assert.deepEqual(stripeAsked, [ids.pi]);
    const o = await order();
    assert.deepEqual([o.status, o.paymentStatus], ['COMPLETED', 'PAID']);
    assert.equal(enrollments().length, 2);
    assert.equal((await payment()).orderSynced, true);
  });

  it('AUTH-OP-02: the order-service sends a different token - the internal confirm is refused: payment and order unchanged, Stripe never asked', async () => {
    await toChild('ORDER_PAYMENT_TOKEN', OTHER);
    const [o0, p0] = [await order(), await payment()];
    const res = await pay();
    assert.equal(res.status, 500);
    assert.deepEqual(await order(), o0);
    assert.deepEqual(await payment(), p0);
    assert.equal(stripeAsked.length, 0);
    assert.equal(enrollments().length, 0);
  });

  it('AUTH-OP-03/04: the order webhook refuses the payment-service\'s token; the success waits in the outbox and is delivered ONCE when the tokens agree', async () => {
    await toChild('ORDER_PAYMENT_TOKEN', OTHER);                // order-service expects OTHER, payment-service sends TOKEN
    await stripeSucceeded();                                   // the real Stripe success path: 3 refused attempts, then outbox
    let p = await payment();
    assert.equal(p.status, 'SUCCEEDED');
    assert.equal(p.orderSynced, false, 'left for the outbox - never a fake success');
    assert.deepEqual([(await order()).status, enrollments().length], ['PENDING', 0]);

    const refused = await syncPendingOrders({ ignoreConcurrencyLock: true });
    assert.deepEqual([refused.processed, refused.succeeded, refused.failed], [1, 0, 1], 'the outbox tries and records the failure (backoff)');
    assert.equal((await order()).status, 'PENDING');

    await toChild('ORDER_PAYMENT_TOKEN', TOKEN);                // tokens agree now
    await paymentDb.payment.update({ where: { id: ids.payment }, data: { lastSyncAttemptAt: new Date(0) } });   // let the backoff pass
    const delivered = await syncPendingOrders({ ignoreConcurrencyLock: true });
    assert.equal(delivered.succeeded, 1);
    const o = await order();
    assert.deepEqual([o.status, o.paymentStatus], ['COMPLETED', 'PAID']);
    assert.equal(enrollments().length, 2, 'each course granted once');
    p = await payment();
    assert.equal(p.orderSynced, true);

    const again = await syncPendingOrders({ ignoreConcurrencyLock: true });
    assert.equal(again.processed, 0, 'nothing left to deliver');
    assert.equal(enrollments().length, 2);
  });

  it('AUTH-OP-03: only the shared INTERNAL_SERVICE_TOKEN configured (same on both sides, no ORDER_PAYMENT_TOKEN in the payment-service): nothing is sent, nothing is wrongly changed', async () => {
    delete process.env.ORDER_PAYMENT_TOKEN;
    await stripeSucceeded();
    const p = await payment();
    assert.deepEqual([p.status, p.orderSynced], ['SUCCEEDED', false]);
    assert.equal((await order()).status, 'PENDING');
    const job = await syncPendingOrders({ ignoreConcurrencyLock: true });
    assert.deepEqual(job, { processed: 0, succeeded: 0, failed: 0, skippedBackoff: 0, skippedLocked: 0 }, 'the outbox does not even try (no attempt counted)');
    assert.equal((await payment()).syncAttempts ?? 0, 0);
    assert.equal(enrollments().length, 0);

    // the order-service without ORDER_PAYMENT_TOKEN: it does not call the payment-service either
    process.env.ORDER_PAYMENT_TOKEN = TOKEN;
    await toChild('ORDER_PAYMENT_TOKEN', null);
    await paymentDb.payment.update({ where: { id: ids.payment }, data: { status: 'PENDING', orderSynced: false } });
    stripeAsked.length = 0;
    assert.equal((await pay()).status, 500);
    assert.equal(stripeAsked.length, 0, 'no internal confirm was sent');
    assert.equal((await payment()).status, 'PENDING');
  });
});
