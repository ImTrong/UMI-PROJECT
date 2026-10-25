/**
 * FIX 07B-2A.1 end to end against a REAL MongoDB replica set.
 *
 *   status  GET /api/orders/:orderId/payment-status (REAL order-service, child process) -> internal payment-status route (this process)
 *   refund  the order-service's REAL PaymentClient.refundPayment (loaded here) -> internal create-refund route -> existing refund process
 *
 * Both services use the ISOLATED database named by TEST_DATABASE_URL (`<name>_oprefund`, dropped at the end), with the unique index of
 * Refund.idempotencyKey that the schema declares. Stripe's refund call is scripted and counted; auth / learning / course services are
 * a loopback stub. Every token is drawn at random for this run.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" \
 *     node -r ts-node/register/transpile-only --test test/order-status-refund.mongo.test.ts
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

const target = resolveTestDb('oprefund');
const TOKEN = randomBytes(32).toString('hex');
const USER_A = 'a1'.repeat(12);
const SESSIONS: Record<string, any> = { 'session-a': { userId: USER_A, email: 'a@test.local' } };

describe('REAL MongoDB end to end: internal payment status and refund (FIX 07B-2A.1)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let paymentDb: any;
  let orderDb: any;
  let server: http.Server;
  let stub: http.Server;
  let child: ChildProcess;
  let paymentBase = '';
  let orderBase = '';
  let OrderPaymentClient: any;
  const stripeRefunds: Array<{ pi: string; amount: number; key: string }> = [];
  let stripeScript: () => Promise<any> = async () => ({ id: `re_${randomBytes(6).toString('hex')}`, status: 'succeeded' });
  const ids: Record<string, string> = {};

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
    Object.assign(process.env, {
      DATABASE_URL: target.url, NODE_ENV: 'production', AUTH_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase,
      ORDER_PAYMENT_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'), PAYMENT_USER_TOKEN: randomBytes(32).toString('hex'),
      STRIPE_SECRET_KEY: `sk_test_${randomBytes(12).toString('hex')}`,
    });
    const { PrismaClient } = require('@prisma/client');
    paymentDb = new PrismaClient({ datasources: { db: { url: target.url } } });
    orderDb = new (require(path.resolve(__dirname, '../../order-service/node_modules/@prisma/client')).PrismaClient)({ datasources: { db: { url: target.url } } });
    await paymentDb.$runCommandRaw({ dropDatabase: 1 });
    await paymentDb.$runCommandRaw({ createIndexes: 'refunds', indexes: [{ key: { idempotencyKey: 1 }, name: 'refunds_idempotencyKey_key', unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }] });
    require('../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    require('../src/services/stripe.service').StripeService.refundPayment = async (pi: string, amount: number, _r: string, _c: string, key: string) => {
      stripeRefunds.push({ pi, amount, key });
      return stripeScript();
    };
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    paymentBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // the order-service's own client, in this process (its base URL is read when the module loads)
    process.env.PAYMENT_SERVICE_URL = paymentBase;
    require(path.resolve(__dirname, '../../order-service/src/utils/logger')).default.transports.forEach((t: any) => { t.silent = true; });
    OrderPaymentClient = require(path.resolve(__dirname, '../../order-service/src/services/payment.client')).PaymentClient;

    child = fork(path.join(__dirname, 'helpers', 'order-service-process.js'), [], {
      cwd: os.tmpdir(), execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: target.url, NODE_ENV: 'test', RATE_LIMIT_MAX_REQUESTS: '100000', ORDER_PAYMENT_TOKEN: TOKEN, PAYMENT_SERVICE_URL: paymentBase, AUTH_SERVICE_URL: stubBase, LEARNING_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase } as any,
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

  beforeEach(async () => {
    process.env.ORDER_PAYMENT_TOKEN = TOKEN;
    await toChild('ORDER_PAYMENT_TOKEN', TOKEN);
    await paymentDb.refund.deleteMany({});
    await paymentDb.payment.deleteMany({});
    await orderDb.order.deleteMany({});
    const order = await orderDb.order.create({ data: { orderNumber: `ORD-RF-${Date.now()}`, userId: USER_A, items: [], subtotal: 300000, totalPrice: 300000, status: 'COMPLETED', paymentStatus: 'PAID', paymentProvider: 'stripe' } });
    const other = await orderDb.order.create({ data: { orderNumber: `ORD-RF-O-${Date.now()}`, userId: USER_A, items: [], subtotal: 1, totalPrice: 1 } });
    const payment = await paymentDb.payment.create({ data: { orderId: order.id, orderNumber: order.orderNumber, userId: USER_A, amount: 300000, currency: 'vnd', status: 'SUCCEEDED', type: 'COURSE_PURCHASE', provider: 'stripe', stripePaymentIntentId: `pi_3Rf${Date.now()}`, clientSecret: 'secret_should_not_leak', metadata: {}, orderSynced: true } });
    await orderDb.order.update({ where: { id: order.id }, data: { paymentId: payment.id } });
    Object.assign(ids, { order: order.id, other: other.id, payment: payment.id, pi: payment.stripePaymentIntentId });
    stripeRefunds.length = 0;
    stripeScript = async () => ({ id: `re_${randomBytes(6).toString('hex')}`, status: 'succeeded' });
  });

  const snapshot = async () => ({
    payments: (await paymentDb.$runCommandRaw({ find: 'payments', filter: {} })).cursor.firstBatch,
    refunds: (await paymentDb.$runCommandRaw({ find: 'refunds', filter: {} })).cursor.firstBatch,
    orders: (await orderDb.$runCommandRaw({ find: 'orders', filter: {} })).cursor.firstBatch,
  });
  const req = (over: Record<string, unknown> = {}) => ({ paymentId: ids.payment, orderId: ids.order, amount: 100000, currency: 'vnd', reason: 'requested_by_customer', idempotencyKey: `order-refund-${ids.order}-1`, ...over });

  it('AUTH-OP-STATUS: the owner reads the payment status through the order-service; minimal fields, classified; wrong token -> nothing', async () => {
    const res = await fetch(`${orderBase}/api/orders/${ids.order}/payment-status`, { headers: { authorization: 'Bearer session-a' } });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual([json.data.id, json.data.status, json.data.outcome], [ids.payment, 'SUCCEEDED', 'SUCCEEDED']);
    assert.ok(!JSON.stringify(json).includes('secret_should_not_leak') && !JSON.stringify(json).includes(ids.pi));

    await toChild('ORDER_PAYMENT_TOKEN', randomBytes(32).toString('hex'));
    const before = await snapshot();
    const refused = await fetch(`${orderBase}/api/orders/${ids.order}/payment-status`, { headers: { authorization: 'Bearer session-a' } });
    assert.equal(refused.status, 500);
    assert.deepEqual(await snapshot(), before);
  });

  it('AUTH-OP-REFUND: valid refund through the order client; a retry and 5 concurrent duplicates still leave exactly one refund', async () => {
    const first = await OrderPaymentClient.refundPayment(req());
    assert.deepEqual([first.outcome, first.httpStatus], ['SUCCEEDED', 201]);
    const answers = await Promise.all(Array.from({ length: 5 }, () => OrderPaymentClient.refundPayment(req())));
    for (const a of answers) assert.ok(['SUCCEEDED', 'REJECTED'].includes(a.outcome), JSON.stringify(a));
    const rows = await paymentDb.refund.findMany({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].idempotencyKey, `order_refund:order-refund-${ids.order}-1`);
    assert.equal(stripeRefunds.length, 1);
    const p = await paymentDb.payment.findUnique({ where: { id: ids.payment } });
    assert.deepEqual([p.status, p.refundedTotal, p.pendingRefundTotal], ['PARTIALLY_REFUNDED', 100000, 0]);
  });

  it('AUTH-OP-REFUND: no / wrong token, payment of another order, currency mismatch, too much -> refused, the database unchanged', async () => {
    const before = await snapshot();
    const raw = async (body: unknown, headers: Record<string, string>) => (await fetch(`${paymentBase}/api/payments/internal/create-refund`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })).status;
    assert.equal(await raw(req(), {}), 403);
    assert.equal(await raw(req(), { 'x-internal-service-token': randomBytes(32).toString('hex') }), 403);
    assert.equal(await raw(req(), { 'x-internal-service-token': process.env.INTERNAL_SERVICE_TOKEN! }), 403);
    assert.equal(await raw(req(), { 'x-internal-service-token': process.env.PAYMENT_USER_TOKEN! }), 403);
    for (const [over, outcome] of [[{ orderId: ids.other }, 'REJECTED'], [{ currency: 'usd' }, 'REJECTED'], [{ amount: 300001 }, 'REJECTED'], [{ amount: -1 }, 'REJECTED']] as const) {
      assert.equal((await OrderPaymentClient.refundPayment(req(over))).outcome, outcome, JSON.stringify(over));
    }
    assert.deepEqual(await snapshot(), before);
    assert.equal(stripeRefunds.length, 0);
  });

  it('AUTH-OP-REFUND: Stripe timeout -> UNVERIFIED with the amount still RESERVED (FIX 07B-2A.2); a retry re-sends the same request, never a new refund', async () => {
    stripeScript = async () => { throw Object.assign(new Error('Request timed out'), { type: 'StripeConnectionError' }); };
    const r = await OrderPaymentClient.refundPayment(req());
    assert.deepEqual([r.outcome, r.httpStatus], ['UNVERIFIED', 502]);
    let p = await paymentDb.payment.findUnique({ where: { id: ids.payment } });
    assert.deepEqual([p.status, p.refundedTotal, p.pendingRefundTotal], ['SUCCEEDED', 0, 100000]);
    const again = await OrderPaymentClient.refundPayment(req());
    assert.equal(again.outcome, 'UNVERIFIED');
    assert.equal(stripeRefunds.length, 2);
    assert.deepEqual(stripeRefunds[1], stripeRefunds[0], 'the same intent, amount and idempotency key');
    assert.equal((await paymentDb.refund.findMany({})).length, 1);
    stripeScript = async () => ({ id: 're_after_outage', status: 'succeeded' });
    const finally_ = await OrderPaymentClient.refundPayment(req());
    assert.equal(finally_.outcome, 'SUCCEEDED');
    p = await paymentDb.payment.findUnique({ where: { id: ids.payment } });
    assert.deepEqual([p.status, p.refundedTotal, p.pendingRefundTotal], ['PARTIALLY_REFUNDED', 100000, 0]);
  });

  it('AUTH-OP-REFUND: a full refund keeps the existing follow-up - payment REFUNDED and the order told REFUNDED (with ORDER_PAYMENT_TOKEN)', async () => {
    const r = await OrderPaymentClient.refundPayment(req({ amount: 300000, idempotencyKey: `order-refund-${ids.order}-full` }));
    assert.equal(r.outcome, 'SUCCEEDED');
    assert.equal((await paymentDb.payment.findUnique({ where: { id: ids.payment } })).status, 'REFUNDED');
    const o = await orderDb.order.findUnique({ where: { id: ids.order } });
    assert.deepEqual([o.status, o.paymentStatus], ['CANCELLED', 'REFUNDED']);
  });
});
