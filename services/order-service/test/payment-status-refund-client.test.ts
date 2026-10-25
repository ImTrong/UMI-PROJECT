/**
 * FIX 07B-2A.1 - order-service side: PaymentClient.getPaymentStatus / refundPayment call the payment-service's INTERNAL routes with
 * ORDER_PAYMENT_TOKEN (no user JWT forwarded or forged), and GET /api/orders/:orderId/payment-status keeps the owner check and
 * classifies the status with the shared contract.
 *
 * The REAL order app runs with an in-memory database stand-in; auth and payment services are ONE loopback stub with scripted
 * answers that records every call. Every token is drawn at random for this run.
 *
 * Run: node -r ts-node/register/transpile-only --test test/payment-status-refund-client.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const USER_A = 'a1'.repeat(12);
const USER_B = 'b2'.repeat(12);
const ORDER = 'c3'.repeat(12);
const PAY = 'd4'.repeat(12);
const orders: Record<string, any> = { [ORDER]: { id: ORDER, userId: USER_A, paymentId: PAY, status: 'COMPLETED', paymentStatus: 'PAID', items: [], orderItems: [] } };
class FakePrismaClient {
  order = { findUnique: async ({ where }: any) => { const o = orders[where.id]; return o && (!where.userId || where.userId === o.userId) ? { ...o } : null; } };
  constructor() { return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : typeof k === 'string' && !k.startsWith('$') ? new Proxy({}, { get: () => async () => null }) : async () => undefined) }); }
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient, OrderStatus: {}, PaymentStatus: { UNPAID: 'UNPAID', PAID: 'PAID', REFUNDED: 'REFUNDED', FAILED: 'FAILED' }, Prisma: {} },
} as any;

const TOKEN = randomBytes(32).toString('hex');
const SHARED = randomBytes(32).toString('hex');
const SESSIONS: Record<string, any> = { 'session-a': { userId: USER_A, email: 'a@test.local' }, 'session-b': { userId: USER_B, email: 'b@test.local' } };

describe('FIX 07B-2A.1 order-service: internal payment status / refund client', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let PaymentClient: any;
  const calls: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  let answer: { status: number; body: any } | 'hang' = { status: 200, body: {} };
  const logs: string[] = [];

  before(async () => {
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
        calls.push({ method: req.method || '', url: req.url || '', headers: req.headers, body });
        if (answer === 'hang') { req.socket.destroy(); return; }
        res.statusCode = answer.status;
        res.end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, { PAYMENT_SERVICE_URL: stubBase, AUTH_SERVICE_URL: stubBase, NODE_ENV: 'test' });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => { logs.push(args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } }).join(' ')); return original(...args); };
    }
    PaymentClient = require('../src/services/payment.client').PaymentClient;
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
    Object.assign(process.env, { ORDER_PAYMENT_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED });
  });

  const view = (status: string) => ({ id: PAY, orderId: ORDER, status, provider: 'stripe', amount: 300000, currency: 'vnd', refundedTotal: 0, completedAt: null, updatedAt: null });
  const refundReq = { paymentId: PAY, orderId: ORDER, amount: 100000, currency: 'vnd', reason: 'x', idempotencyKey: `order-refund-${ORDER}-1` };

  // ---------------------------------------------------------------------------------------------- status
  it('getPaymentStatus: GET on the internal route with the order id and ORDER_PAYMENT_TOKEN - no Authorization header', async () => {
    answer = { status: 200, body: { data: view('SUCCEEDED') } };
    const result = await PaymentClient.getPaymentStatus(PAY, ORDER);
    assert.deepEqual(result, view('SUCCEEDED'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, `/api/payments/internal/payment-status/${PAY}?orderId=${ORDER}`);
    assert.equal(calls[0].headers['x-internal-service-token'], TOKEN);
    assert.equal(calls[0].headers.authorization, undefined, 'no user JWT is forwarded or forged');
  });

  it('getPaymentStatus: 404 -> null; 500 / network -> throws; no usable token -> throws and sends nothing', async () => {
    answer = { status: 404, body: { error: 'Payment not found' } };
    assert.equal(await PaymentClient.getPaymentStatus(PAY, ORDER), null);
    answer = { status: 500, body: { error: 'x' } };
    await assert.rejects(PaymentClient.getPaymentStatus(PAY, ORDER), /Payment status check failed/);
    answer = 'hang';
    await assert.rejects(PaymentClient.getPaymentStatus(PAY, ORDER), /Payment status check failed/);
    calls.length = 0;
    for (const v of [undefined, '', 'short']) {
      if (v === undefined) delete process.env.ORDER_PAYMENT_TOKEN; else process.env.ORDER_PAYMENT_TOKEN = v;
      await assert.rejects(PaymentClient.getPaymentStatus(PAY, ORDER), /Payment status check failed/);
    }
    assert.equal(calls.length, 0, 'INTERNAL_SERVICE_TOKEN is configured but never used instead');
  });

  it('GET /api/orders/:orderId/payment-status: owner gets the status classified by the shared contract; unknown is never a success', async () => {
    const cases: Array<[string, string]> = [['SUCCEEDED', 'SUCCEEDED'], ['PENDING', 'PENDING'], ['PROCESSING', 'PENDING'], ['FAILED', 'FAILED'], ['CANCELLED', 'FAILED'], ['REFUNDED', 'REFUNDED'], ['PARTIALLY_REFUNDED', 'REFUNDED'], ['succeeded', 'UNKNOWN'], ['WEIRD', 'UNKNOWN']];
    for (const [stored, outcome] of cases) {
      answer = { status: 200, body: { data: view(stored) } };
      const res = await fetch(`${base}/api/orders/${ORDER}/payment-status`, { headers: { authorization: 'Bearer session-a' } });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual([json.data.status, json.data.outcome], [stored, outcome], stored);
    }
    answer = { status: 404, body: { error: 'Payment not found' } };
    const missing = await fetch(`${base}/api/orders/${ORDER}/payment-status`, { headers: { authorization: 'Bearer session-a' } });
    assert.deepEqual([missing.status, await missing.json()], [404, { error: 'No payment found for this order' }]);
  });

  it('GET /api/orders/:orderId/payment-status: another user (B) is refused by the order owner check before the payment-service is asked', async () => {
    answer = { status: 200, body: { data: view('SUCCEEDED') } };
    const res = await fetch(`${base}/api/orders/${ORDER}/payment-status`, { headers: { authorization: 'Bearer session-b' } });
    assert.notEqual(res.status, 200);
    assert.equal(calls.length, 0);
  });

  // ---------------------------------------------------------------------------------------------- refund
  it('refundPayment: POST on the internal route with ORDER_PAYMENT_TOKEN and the request as given; verified outcome passed on', async () => {
    answer = { status: 201, body: { data: { outcome: 'SUCCEEDED', replayed: false, refund: { id: 'r1', paymentId: PAY, orderId: ORDER, amount: 100000, currency: 'vnd', status: 'SUCCEEDED' } } } };
    const r = await PaymentClient.refundPayment(refundReq);
    assert.deepEqual([r.outcome, r.httpStatus, r.refund.id, r.replayed], ['SUCCEEDED', 201, 'r1', false]);
    assert.equal(calls[0].url, '/api/payments/internal/create-refund');
    assert.deepEqual(calls[0].body, refundReq);
    assert.equal(calls[0].headers['x-internal-service-token'], TOKEN);
    assert.equal(calls[0].headers.authorization, undefined);
  });

  it('refundPayment: PENDING / FAILED as verified; 4xx -> REJECTED; 502 / 500 / network / unknown outcome -> UNVERIFIED (never concluded)', async () => {
    const cases: Array<[any, string]> = [
      [{ status: 201, body: { data: { outcome: 'PENDING', refund: { id: 'r' } } } }, 'PENDING'],
      [{ status: 201, body: { data: { outcome: 'FAILED', refund: { id: 'r', status: 'FAILED' } } } }, 'FAILED'],          // FIX 07B-2A.2: Stripe rejected it - definite
      [{ status: 200, body: { data: { outcome: 'FAILED', replayed: true, refund: { id: 'r' } } } }, 'FAILED'],
      [{ status: 200, body: { data: { outcome: 'UNVERIFIED', replayed: true, refund: { id: 'r' } } } }, 'UNVERIFIED'],
      [{ status: 201, body: { data: { outcome: 'succeeded' } } }, 'UNVERIFIED'],
      [{ status: 201, body: {} }, 'UNVERIFIED'],
      [{ status: 404, body: { error: 'Payment not found' } }, 'REJECTED'],
      [{ status: 422, body: { code: 'IDEMPOTENCY_KEY_REUSED' } }, 'REJECTED'],
      [{ status: 409, body: { code: 'REFUND_IN_PROGRESS' } }, 'REJECTED'],
      [{ status: 502, body: { code: 'REFUND_NOT_VERIFIED', data: { outcome: 'UNVERIFIED' } } }, 'UNVERIFIED'],
      [{ status: 500, body: {} }, 'UNVERIFIED'],
      ['hang', 'UNVERIFIED'],
    ];
    for (const [a, outcome] of cases) {
      answer = a;
      assert.equal((await PaymentClient.refundPayment(refundReq)).outcome, outcome, JSON.stringify(a));
    }
  });

  it('refundPayment without a usable ORDER_PAYMENT_TOKEN sends nothing and answers UNVERIFIED (not success, not "failed")', async () => {
    for (const v of [undefined, '', 'short']) {
      if (v === undefined) delete process.env.ORDER_PAYMENT_TOKEN; else process.env.ORDER_PAYMENT_TOKEN = v;
      const r = await PaymentClient.refundPayment(refundReq);
      assert.deepEqual([r.outcome, r.httpStatus, r.refund], ['UNVERIFIED', null, null]);
    }
    assert.equal(calls.length, 0);
  });

  it('no log line contains a token', () => {
    for (const line of logs) for (const t of [TOKEN.slice(0, 16), SHARED.slice(0, 16)]) assert.ok(!line.includes(t), line.slice(0, 100));
  });
});
