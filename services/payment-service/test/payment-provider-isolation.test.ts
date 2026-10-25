/**
 * FIX 07B-1.2 (PAY-PROVIDER-01): POST /api/payments/confirm confirms Stripe payments only, and marks a payment FAILED only when
 * Stripe itself says so for THAT payment.
 *
 * The REAL express app of the payment-service runs on an ephemeral port; only the database client is an in-memory stand-in that
 * records every write, and auth / order / user services are ONE loopback stub that records every call. Stripe is replaced by a
 * scripted getPaymentIntent that records every intent it is asked about. The same guarantees are checked against a real MongoDB
 * replica set by test/payment-provider-isolation.mongo.test.ts and end to end (order-service + payment-service) by
 * order-service/test/payment-status-contract.mongo.test.ts.
 *
 * Run: node -r ts-node/register/transpile-only --test test/payment-provider-isolation.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ---- in-memory Prisma stand-in (installed before anything from src/ is loaded) ----
type Row = Record<string, any>;
const payments: Row[] = [];
const writes: Array<{ op: string; where: any; data?: any }> = [];
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
const paymentModel = {
  findFirst: async ({ where }: any = {}) => { const r = payments.filter((p) => matches(p, where)).pop(); return r ? structuredClone(r) : null; },
  findUnique: async ({ where }: any = {}) => { const r = payments.find((p) => matches(p, where)); return r ? structuredClone(r) : null; },
  update: async ({ where, data }: any) => {
    writes.push({ op: 'update', where, data });
    const row = payments.find((p) => matches(p, where));
    if (!row) throw new Error('record not found');
    Object.assign(row, structuredClone(data));
    return structuredClone(row);
  },
  updateMany: async ({ where, data }: any) => {
    writes.push({ op: 'updateMany', where, data });
    const rows = payments.filter((p) => matches(p, where));
    for (const row of rows) Object.assign(row, structuredClone(data));
    return { count: rows.length };
  },
};
const noopModel = new Proxy({}, { get: () => async () => { writes.push({ op: 'other', where: null }); return null; } });
class FakePrismaClient {
  payment = paymentModel;
  constructor() {
    return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : typeof k === 'string' && !k.startsWith('$') ? noopModel : async () => undefined) });
  }
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: {
    PrismaClient: FakePrismaClient,
    PaymentStatus: { PENDING: 'PENDING', PROCESSING: 'PROCESSING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED', REFUNDED: 'REFUNDED', CANCELLED: 'CANCELLED' },
    RefundStatus: { PENDING: 'PENDING', PROCESSING: 'PROCESSING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' },
    Prisma: {},
  },
} as any;

const USER_A = 'a1'.repeat(12);
const USER_B = 'b2'.repeat(12);
const ORDER_STRIPE = 'c3'.repeat(12);
const ORDER_PAYOS = 'c4'.repeat(12);
const PAY_STRIPE = 'd4'.repeat(12);
const PAY_PAYOS = 'd5'.repeat(12);
const PAY_INSTR = 'd6'.repeat(12);
const PI = 'pi_3ProviderIsolationA';
const PI_INSTR = 'pi_3ProviderIsolationI';
const SESSIONS: Record<string, any> = { 'session-a': { userId: USER_A, email: 'a@test.local' }, 'session-b': { userId: USER_B, email: 'b@test.local' } };

describe('FIX 07B-1.2 PAY-PROVIDER-01: confirm touches Stripe payments only, FAILED only on Stripe\'s word', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let StripeService: any;
  let realGetPaymentIntent: any;
  const INTERNAL = randomBytes(32).toString('hex');   // ORDER_PAYMENT_TOKEN: the internal confirm route is called by the order-service (FIX 07B-2A)
  const stubCalls: Array<{ url: string; body: any }> = [];
  let orderStatus = 200;
  const stripeAsked: string[] = [];
  let stripeScript: (id: string) => Promise<any> = async (id) => ({ id, status: 'succeeded' });
  const savedEnv = { ...process.env };

  before(async () => {
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
        if (req.url === '/api/orders/webhook/payment') { res.statusCode = orderStatus; return res.end('{}'); }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, { AUTH_SERVICE_URL: stubBase, ORDER_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'), ORDER_PAYMENT_TOKEN: INTERNAL, PAYMENT_USER_TOKEN: randomBytes(32).toString('hex') });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    StripeService = require('../src/services/stripe.service').StripeService;
    realGetPaymentIntent = StripeService.getPaymentIntent;
    StripeService.getPaymentIntent = async (id: string) => { stripeAsked.push(id); return stripeScript(id); };
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    StripeService.getPaymentIntent = realGetPaymentIntent;
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  });

  const seed = () => {
    payments.length = 0;
    const common = { userId: USER_A, amount: 199000, currency: 'vnd', status: 'PENDING', orderSynced: false };
    payments.push(
      { ...common, id: PAY_STRIPE, orderId: ORDER_STRIPE, type: 'COURSE_PURCHASE', provider: 'stripe', stripePaymentIntentId: PI, metadata: {} },
      { ...common, id: PAY_PAYOS, orderId: ORDER_PAYOS, type: 'COURSE_PURCHASE', provider: 'payos', payosOrderCode: '7123456789', stripePaymentIntentId: null, metadata: { orderCode: 7123456789, orderSynced: false } },
      { ...common, id: PAY_INSTR, orderId: null, type: 'INSTRUCTOR_REGISTRATION', provider: 'stripe', stripePaymentIntentId: PI_INSTR, metadata: {} },
    );
  };
  beforeEach(() => {
    seed();
    writes.length = 0;
    stubCalls.length = 0;
    stripeAsked.length = 0;
    orderStatus = 200;
    stripeScript = async (id) => ({ id, status: 'succeeded' });
    process.env.NODE_ENV = 'production';
    delete process.env.PAYMENT_MOCK_ENABLED;
    process.env.STRIPE_SECRET_KEY = `sk_test_${randomBytes(12).toString('hex')}`;   // Stripe "configured" (calls are scripted)
  });

  const confirm = async (session: string | null, paymentIntentId: string, url = '/api/payments/confirm') => {
    const res = await fetch(`${base}${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : { 'x-internal-service-token': INTERNAL }) },
      body: JSON.stringify({ paymentIntentId, paymentMethodId: 'pm_card_visa' }),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  const row = (id: string) => payments.find((p) => p.id === id)!;
  const downstream = () => stubCalls.filter((c) => !c.url.startsWith('/api/auth'));
  const untouched = (label: string, before: Row[]) => {
    assert.deepEqual(payments, before, `${label}: every payment exactly as it was`);
    assert.equal(writes.length, 0, `${label}: nothing written`);
    assert.equal(downstream().length, 0, `${label}: order / user service not told anything`);
    assert.equal(stripeAsked.length, 0, `${label}: Stripe not asked`);
  };
  const REJECTED = (code: string) => ({ status: 409, json: { error: 'Payment cannot be confirmed through this endpoint', code } });

  it('a valid Stripe payment: Stripe decides, SUCCEEDED recorded, order told PAID once, orderSynced=true', async () => {
    const res = await confirm('session-a', PI);
    assert.equal(res.status, 200);
    assert.deepEqual(stripeAsked, [PI]);
    assert.equal(row(PAY_STRIPE).status, 'SUCCEEDED');
    assert.equal(row(PAY_STRIPE).orderSynced, true);
    assert.deepEqual(downstream().map((c) => [c.url, c.body]), [['/api/orders/webhook/payment', { orderId: ORDER_STRIPE, status: 'PAID' }]]);
    assert.equal(row(PAY_PAYOS).status, 'PENDING', 'the payOS payment is not touched');
  });

  it('a payOS payment while Stripe is configured: 409 PAYMENT_PROVIDER_MISMATCH, never sent to Stripe, never FAILED (user and internal route)', async () => {
    const before = structuredClone(payments);
    for (const id of [PAY_PAYOS]) {
      assert.deepEqual(await confirm('session-a', id), REJECTED('PAYMENT_PROVIDER_MISMATCH'));
      assert.deepEqual(await confirm(null, id, '/api/payments/internal/confirm'), REJECTED('PAYMENT_PROVIDER_MISMATCH'));
    }
    untouched('payOS via confirm', before);
  });

  it('a payOS payment in development with the demo flag ON and Stripe NOT configured: still 409, not "mock-completed" through Stripe\'s route', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    delete process.env.STRIPE_SECRET_KEY;
    row(PAY_PAYOS).metadata.isMock = true;
    const before = structuredClone(payments);
    assert.deepEqual(await confirm('session-a', PAY_PAYOS), REJECTED('PAYMENT_PROVIDER_MISMATCH'));
    untouched('payOS demo', before);
  });

  it('provider missing / unknown / contradictory, or a Stripe payment without its intent: refused (409) before any write - never guessed', async () => {
    const cases: Array<[string, Row, string]> = [
      ['provider missing', { provider: undefined }, 'PAYMENT_PROVIDER_UNKNOWN'],
      ['provider null', { provider: null }, 'PAYMENT_PROVIDER_UNKNOWN'],
      ['provider empty', { provider: '' }, 'PAYMENT_PROVIDER_UNKNOWN'],
      ['provider "Stripe"', { provider: 'Stripe' }, 'PAYMENT_PROVIDER_UNKNOWN'],
      ['provider paypal', { provider: 'paypal' }, 'PAYMENT_PROVIDER_UNKNOWN'],
      ['stripe + payOS order code', { payosOrderCode: '7000000001' }, 'PAYMENT_PROVIDER_UNKNOWN'],
      ['stripe, intent empty', { stripePaymentIntentId: '' }, 'STRIPE_INTENT_MISSING'],
      ['stripe, intent missing', { stripePaymentIntentId: null }, 'STRIPE_INTENT_MISSING'],
    ];
    for (const [label, over, code] of cases) {
      seed();
      Object.assign(row(PAY_STRIPE), over);
      if (over.provider === undefined && 'provider' in over) delete row(PAY_STRIPE).provider;
      const before = structuredClone(payments);
      writes.length = 0;
      assert.deepEqual(await confirm('session-a', PAY_STRIPE), REJECTED(code), label);
      untouched(label, before);
    }
  });

  it('Stripe unreachable / unknown intent / API error: payment back to PENDING (not FAILED), order not told FAILED, other payments untouched', async () => {
    for (const failure of [
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('No such payment_intent: pi_3ProviderIsolationA'), { type: 'StripeInvalidRequestError', code: 'resource_missing' }),
      Object.assign(new Error('Rate limited'), { type: 'StripeRateLimitError' }),
    ]) {
      seed();
      stubCalls.length = 0;
      stripeScript = async () => { throw failure; };
      const res = await confirm('session-a', PI);
      assert.equal(res.status, 500, failure.message);
      assert.equal(row(PAY_STRIPE).status, 'PENDING', 'restored, not FAILED');
      assert.equal(row(PAY_STRIPE).errorMessage, failure.message, 'the error is kept for diagnosis');
      assert.equal(row(PAY_PAYOS).status, 'PENDING');
      assert.equal(row(PAY_INSTR).status, 'PENDING');
      assert.equal(downstream().length, 0, 'no FAILED (or any) notification');
    }
  });

  it('a payment already PROCESSING keeps PROCESSING after a Stripe error (its previous status), and a concurrent success is not overwritten', async () => {
    row(PAY_STRIPE).status = 'PROCESSING';
    stripeScript = async () => { throw new Error('timeout'); };
    assert.equal((await confirm('session-a', PI)).status, 500);
    assert.equal(row(PAY_STRIPE).status, 'PROCESSING');
    // a webhook marks it SUCCEEDED while Stripe is being asked: the restore only applies to a payment still PROCESSING
    seed();
    stripeScript = async () => { row(PAY_STRIPE).status = 'SUCCEEDED'; throw new Error('late failure'); };
    await confirm('session-a', PI);
    assert.equal(row(PAY_STRIPE).status, 'SUCCEEDED');
  });

  it('Stripe\'s own verdicts are kept: requires_payment_method -> FAILED, canceled -> CANCELLED, processing -> PENDING (no order notification)', async () => {
    for (const [stripeStatus, expected] of [['requires_payment_method', 'FAILED'], ['canceled', 'CANCELLED'], ['processing', 'PENDING'], ['requires_action', 'PENDING']]) {
      seed();
      stubCalls.length = 0;
      stripeScript = async (id) => ({ id, status: stripeStatus });
      const res = await confirm('session-a', PI);
      assert.equal(res.status, 200);
      assert.equal(row(PAY_STRIPE).status, expected, stripeStatus);
      assert.equal(downstream().length, 0, stripeStatus);
    }
  });

  it('the order service cannot be reached after Stripe said succeeded: the payment stays SUCCEEDED with orderSynced=false for the outbox', async () => {
    orderStatus = 503;
    const res = await confirm('session-a', PI);
    assert.equal(res.status, 200);
    assert.equal(row(PAY_STRIPE).status, 'SUCCEEDED', 'money was taken: never FAILED because of a downstream error');
    assert.equal(row(PAY_STRIPE).orderSynced, false, 'left for the outbox worker');
    assert.equal(row(PAY_STRIPE).metadata.orderSynced, false);
    assert.equal(downstream().filter((c) => c.url === '/api/orders/webhook/payment').length, 3, 'notifyOrderService\'s own retries, unchanged');
  });

  it('confirming again after a success changes nothing and tells nobody twice', async () => {
    assert.equal((await confirm('session-a', PI)).status, 200);
    const afterFirst = structuredClone(payments);
    stubCalls.length = 0;
    writes.length = 0;
    stripeAsked.length = 0;
    for (let i = 0; i < 3; i++) assert.equal((await confirm('session-a', PI)).status, 200);
    untouched('repeat', afterFirst);
  });

  it('ownership (FIX 07B-1.1) still first: B gets 404 for A\'s Stripe and payOS payments, nothing happens', async () => {
    const before = structuredClone(payments);
    for (const id of [PAY_STRIPE, PI, PAY_PAYOS]) assert.deepEqual((await confirm('session-b', id)).json, { error: 'Payment not found' });
    untouched('user B', before);
  });

  it('mock gate (FIX 07B-1) unchanged: Stripe demo payment blocked with the flag off and in production, works in development with the flag', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    for (const [flag, env] of [[undefined, 'development'], ['true', 'production']] as const) {
      if (flag === undefined) delete process.env.PAYMENT_MOCK_ENABLED; else process.env.PAYMENT_MOCK_ENABLED = flag;
      process.env.NODE_ENV = env;
      const before = structuredClone(payments);
      assert.equal((await confirm('session-a', PAY_STRIPE)).status, 403);
      untouched(`demo ${flag}/${env}`, before);
    }
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    process.env.NODE_ENV = 'development';
    assert.equal((await confirm('session-a', PAY_STRIPE)).status, 200);
    assert.equal(row(PAY_STRIPE).status, 'SUCCEEDED');
    assert.equal(stripeAsked.length, 0, 'the demo never asks Stripe');
  });
});
