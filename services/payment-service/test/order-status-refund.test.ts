/**
 * FIX 07B-2A.1 - the internal payment status and refund API of the payment-service for the order-service:
 *   GET  /api/payments/internal/payment-status/:paymentId?orderId=   (AUTH-OP-STATUS)
 *   POST /api/payments/internal/create-refund                        (AUTH-OP-REFUND)
 * both ORDER_PAYMENT_TOKEN only. The refund runs the EXISTING refund process (PaymentService.refundPayment) - only the order link,
 * currency, provider and idempotency key are added in front of it.
 *
 * The REAL app runs with an in-memory database stand-in (payments + refunds, the unique idempotencyKey of the schema enforced);
 * Stripe's refund call is scripted and every call to it is recorded. Every token is drawn at random for this run.
 *
 * Run: node -r ts-node/register/transpile-only --test test/order-status-refund.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, any>;
const payments: Row[] = [];
const refunds: Row[] = [];
const writes: string[] = [];
let reads = 0;
const cond = (value: any, expected: any): boolean => {
  if (expected === null) return value === null || value === undefined;
  if (expected instanceof Date) return value instanceof Date && value.getTime() === expected.getTime();
  if (expected && typeof expected === 'object') {
    if ('in' in expected) return expected.in.includes(value);
    if ('lt' in expected) return value instanceof Date && value.getTime() < expected.lt.getTime();
  }
  return value === expected;
};
const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => (k === 'OR' ? (v as Row[]).some((w) => matches(row, w)) : cond(row[k], v)));
const clone = <T>(v: T): T => structuredClone(v);
const apply = (row: Row, data: Row) => {
  for (const [k, v] of Object.entries(clone(data))) row[k] = v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v ? (row[k] || 0) + v.increment : v;
};
const paymentModel = {
  findUnique: async ({ where }: any) => { reads++; const r = payments.find((p) => matches(p, where)); return r ? clone(r) : null; },
  findFirst: async ({ where }: any) => { reads++; const r = payments.find((p) => matches(p, where)); return r ? clone(r) : null; },
  update: async ({ where, data }: any) => { writes.push('payment.update'); const r = payments.find((p) => matches(p, where))!; apply(r, data); return clone(r); },
  updateMany: async ({ where, data }: any) => { writes.push('payment.updateMany'); const rs = payments.filter((p) => matches(p, where)); rs.forEach((r) => apply(r, data)); return { count: rs.length }; },
};
const refundModel = {
  aggregate: async ({ where }: any) => { reads++; const rs = refunds.filter((r) => matches(r, where)); return { _sum: { amount: rs.length ? rs.reduce((s, r) => s + r.amount, 0) : null } }; },
  findUnique: async ({ where }: any) => { reads++; const r = refunds.find((x) => matches(x, where)); return r ? clone(r) : null; },
  findFirst: async ({ where }: any) => { reads++; const r = refunds.find((x) => matches(x, where)); return r ? clone(r) : null; },
  findMany: async ({ where }: any) => { reads++; return refunds.filter((x) => matches(x, where)).map(clone); },
  update: async ({ where, data }: any) => { writes.push('refund.update'); const r = refunds.find((x) => matches(x, where))!; apply(r, data); return clone(r); },
  updateMany: async ({ where, data }: any) => { writes.push('refund.updateMany'); const rs = refunds.filter((x) => matches(x, where)); rs.forEach((r) => apply(r, data)); return { count: rs.length }; },
  create: async ({ data }: any) => {
    writes.push('refund.create');
    if (data.idempotencyKey && refunds.some((r) => r.idempotencyKey === data.idempotencyKey)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const row = { id: randomBytes(12).toString('hex'), createdAt: new Date(), ...clone(data) };
    refunds.push(row);
    return clone(row);
  },
};
const noopModel = new Proxy({}, { get: () => async () => null });
class FakePrismaClient {
  payment = paymentModel;
  refund = refundModel;
  $transaction = async (fn: any) => fn({ payment: paymentModel, refund: refundModel });
  constructor() { return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : typeof k === 'string' && !k.startsWith('$') ? noopModel : async () => undefined) }); }
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: {
    PrismaClient: FakePrismaClient,
    PaymentStatus: { PENDING: 'PENDING', PROCESSING: 'PROCESSING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED', REFUNDED: 'REFUNDED', CANCELLED: 'CANCELLED' },
    RefundStatus: { PENDING: 'PENDING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED' },
    Prisma: {},
  },
} as any;

const TOKEN = randomBytes(32).toString('hex');
const SHARED = randomBytes(32).toString('hex');
const USER_TOKEN = randomBytes(32).toString('hex');
const USER_A = 'a1'.repeat(12);
const ORDER = 'c3'.repeat(12);
const OTHER_ORDER = 'c4'.repeat(12);
const PAY_STRIPE = 'd4'.repeat(12);
const PAY_PAYOS = 'd5'.repeat(12);
const PAY_ODD = 'd6'.repeat(12);
const PI = 'pi_3RefundStripeA';

describe('FIX 07B-2A.1 internal payment status and refund for the order-service', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let StripeService: any;
  const stripeRefunds: Array<{ pi: string; amount: number; currency: string; key: string }> = [];
  let stripeScript: () => Promise<any> = async () => ({ id: `re_${randomBytes(6).toString('hex')}`, status: 'succeeded' });
  const orderCalls: any[] = [];
  const savedEnv = { ...process.env };

  before(async () => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => { orderCalls.push({ url: req.url, body: raw }); res.setHeader('content-type', 'application/json'); res.end('{}'); });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, { AUTH_SERVICE_URL: stubBase, ORDER_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, NODE_ENV: 'production' });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    StripeService = require('../src/services/stripe.service').StripeService;
    StripeService.refundPayment = async (pi: string, amount: number, _reason: string, currency: string, key: string) => {
      stripeRefunds.push({ pi, amount, currency, key });
      return stripeScript();
    };
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  });

  const seed = () => {
    payments.length = 0;
    refunds.length = 0;
    const common = { userId: USER_A, amount: 300000, currency: 'vnd', status: 'SUCCEEDED', type: 'COURSE_PURCHASE', refundedTotal: 0, pendingRefundTotal: 0, refundVersion: 0, metadata: { secretish: 'x' }, orderSynced: true, completedAt: new Date('2026-10-20T00:00:00Z'), updatedAt: new Date('2026-10-20T00:00:00Z') };
    payments.push(
      { ...common, id: PAY_STRIPE, orderId: ORDER, orderNumber: 'ORD-R1', provider: 'stripe', stripePaymentIntentId: PI, clientSecret: 'pi_secret_should_not_leak', paymentMethodId: 'pm_card_visa', stripeCustomerId: 'cus_x' },
      { ...common, id: PAY_PAYOS, orderId: ORDER, orderNumber: 'ORD-R2', provider: 'payos', payosOrderCode: '7100000001', payosCheckoutUrl: 'https://pay.example/ck', stripePaymentIntentId: null },
      { ...common, id: PAY_ODD, orderId: ORDER, orderNumber: 'ORD-R3', provider: undefined, stripePaymentIntentId: 'pi_3Odd' },
    );
  };
  beforeEach(() => {
    seed();
    writes.length = 0;
    reads = 0;
    stripeRefunds.length = 0;
    orderCalls.length = 0;
    stripeScript = async () => ({ id: `re_${randomBytes(6).toString('hex')}`, status: 'succeeded' });
    Object.assign(process.env, { ORDER_PAYMENT_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED, PAYMENT_USER_TOKEN: USER_TOKEN });
  });

  const status = async (paymentId: string, orderId: string | null, token: string | null = TOKEN) => {
    const res = await fetch(`${base}/api/payments/internal/payment-status/${paymentId}${orderId === null ? '' : `?orderId=${orderId}`}`, { headers: token === null ? {} : { 'x-internal-service-token': token } });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const refund = async (body: Record<string, unknown>, token: string | null = TOKEN) => {
    const res = await fetch(`${base}/api/payments/internal/create-refund`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token === null ? {} : { 'x-internal-service-token': token }) }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const req = (over: Record<string, unknown> = {}) => ({ paymentId: PAY_STRIPE, orderId: ORDER, amount: 100000, currency: 'vnd', reason: 'requested_by_customer', idempotencyKey: `order-refund-${ORDER}-1`, ...over });
  const untouched = (label: string, before: { p: Row[]; r: Row[] }) => {
    assert.deepEqual(payments, before.p, `${label}: payments unchanged`);
    assert.deepEqual(refunds, before.r, `${label}: no refund row`);
    assert.equal(stripeRefunds.length, 0, `${label}: the provider was not called`);
    assert.equal(orderCalls.length, 0, `${label}: the order service was not told anything`);
  };
  const snap = () => ({ p: clone(payments), r: clone(refunds) });

  // ============================================================================================== AUTH-OP-STATUS

  it('AUTH-OP-STATUS: valid token -> the status of the order\'s payment, minimal fields only', async () => {
    const res = await status(PAY_STRIPE, ORDER);
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data).sort(), ['amount', 'completedAt', 'currency', 'id', 'orderId', 'provider', 'refundedTotal', 'status', 'updatedAt']);
    assert.deepEqual([res.json.data.id, res.json.data.orderId, res.json.data.status, res.json.data.provider], [PAY_STRIPE, ORDER, 'SUCCEEDED', 'stripe']);
    const text = JSON.stringify(res.json);
    for (const leak of ['pi_secret_should_not_leak', PI, 'pm_card_visa', 'cus_x', USER_A, 'secretish', 'https://pay.example/ck']) assert.ok(!text.includes(leak), `leaks ${leak}`);
  });

  it('AUTH-OP-STATUS: every stored status is passed through unchanged (classified on the order side)', async () => {
    for (const s of ['SUCCEEDED', 'PENDING', 'PROCESSING', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED']) {
      payments[0].status = s;
      assert.equal((await status(PAY_STRIPE, ORDER)).json.data.status, s);
    }
  });

  it('AUTH-OP-STATUS: missing payment, payment of another order, no orderId, malformed ids -> the same 404, nothing revealed', async () => {
    const answers = [await status('ab'.repeat(12), ORDER), await status(PAY_STRIPE, OTHER_ORDER), await status(PAY_STRIPE, null), await status('not-an-id', ORDER), await status(PAY_STRIPE, 'x')];
    for (const a of answers) assert.deepEqual([a.status, a.json], [404, { error: 'Payment not found' }]);
  });

  it('AUTH-OP-STATUS: no token, wrong token, INTERNAL_SERVICE_TOKEN, PAYMENT_USER_TOKEN -> 403 before anything is read; unconfigured -> 500', async () => {
    for (const t of [null, TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase(), SHARED, USER_TOKEN, randomBytes(32).toString('hex')]) assert.equal((await status(PAY_STRIPE, ORDER, t)).status, 403);
    assert.equal(reads, 0);
    delete process.env.ORDER_PAYMENT_TOKEN;
    assert.equal((await status(PAY_STRIPE, ORDER)).status, 500);
    assert.equal(reads, 0);
  });

  // ============================================================================================== AUTH-OP-REFUND

  it('AUTH-OP-REFUND: valid Stripe refund runs the existing process: Stripe called once with the request key, refund row, accounting', async () => {
    const res = await refund(req());
    assert.equal(res.status, 201);
    assert.deepEqual([res.json.data.outcome, res.json.data.replayed, res.json.data.refund.status], ['SUCCEEDED', false, 'SUCCEEDED']);
    assert.deepEqual(stripeRefunds, [{ pi: PI, amount: 100000, currency: 'vnd', key: `order_refund:order-refund-${ORDER}-1` }]);
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].idempotencyKey, `order_refund:order-refund-${ORDER}-1`);
    assert.deepEqual([payments[0].status, payments[0].refundedTotal, payments[0].pendingRefundTotal], ['PARTIALLY_REFUNDED', 100000, 0]);
    assert.equal(orderCalls.length, 0, 'partial refund: the order is not told REFUNDED (existing rule)');
  });

  it('AUTH-OP-REFUND: payOS payment -> existing manual path (PENDING, admin confirmation), no request to Stripe', async () => {
    const res = await refund(req({ paymentId: PAY_PAYOS }));
    assert.equal(res.status, 201);
    assert.deepEqual([res.json.data.outcome, res.json.data.refund.status], ['PENDING', 'PENDING']);
    assert.equal(stripeRefunds.length, 0);
    assert.equal(payments[1].pendingRefundTotal, 100000);
  });

  it('AUTH-OP-REFUND: a retry with the same key returns the recorded refund - no second Stripe call, no second row, no accounting change', async () => {
    assert.equal((await refund(req())).status, 201);
    const afterFirst = snap();
    for (let i = 0; i < 3; i++) {
      const again = await refund(req());
      assert.equal(again.status, 200);
      assert.deepEqual([again.json.data.outcome, again.json.data.replayed], ['SUCCEEDED', true]);
    }
    assert.deepEqual(payments, afterFirst.p);
    assert.equal(refunds.length, 1);
    assert.equal(stripeRefunds.length, 1);
  });

  it('AUTH-OP-REFUND: two concurrent requests with the same key -> exactly one refund (one row, one Stripe call)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    stripeScript = async () => { await gate; return { id: 're_concurrent', status: 'succeeded' }; };
    const first = refund(req());
    await new Promise((r) => setTimeout(r, 150));          // the first one is inside Stripe now
    const secondPending = refund(req());
    await new Promise((r) => setTimeout(r, 150));          // the second one has been answered or is (wrongly) inside Stripe too
    release();
    const [one, second] = await Promise.all([first, secondPending]);
    assert.equal(one.status, 201);
    assert.ok([200, 409].includes(second.status), `second answered ${second.status}`);
    if (second.status === 409) assert.equal(second.json.code, 'REFUND_IN_PROGRESS');
    assert.equal(refunds.length, 1);
    assert.equal(stripeRefunds.length, 1);
    assert.equal(payments[0].refundedTotal, 100000);
  });

  it('AUTH-OP-REFUND: the same key for another amount or payment is refused (422) and changes nothing', async () => {
    assert.equal((await refund(req())).status, 201);
    const before = snap();
    stripeRefunds.length = 0;
    for (const over of [{ amount: 50000 }, { paymentId: PAY_PAYOS }]) {
      const res = await refund(req(over));
      assert.deepEqual([res.status, res.json.code], [422, 'IDEMPOTENCY_KEY_REUSED']);
    }
    untouched('key reused', before);
  });

  it('AUTH-OP-REFUND: no / wrong / shared / Payment -> User token -> 403 and nothing read or written', async () => {
    const before = snap();
    for (const t of [null, TOKEN.slice(1), SHARED, USER_TOKEN, randomBytes(32).toString('hex')]) assert.equal((await refund(req(), t)).status, 403);
    assert.equal(reads, 0);
    assert.equal(writes.length, 0);
    untouched('unauthenticated', before);
  });

  it('AUTH-OP-REFUND: payment of another order / missing payment -> 404; currency mismatch -> 422; bad amount or key -> 400; nothing changed', async () => {
    const before = snap();
    const cases: Array<[Record<string, unknown>, number, string?]> = [
      [{ orderId: OTHER_ORDER }, 404], [{ paymentId: 'ab'.repeat(12) }, 404],
      [{ currency: 'usd' }, 422, 'CURRENCY_MISMATCH'],
      [{ amount: 0 }, 400, 'INVALID_REQUEST'], [{ amount: -5 }, 400, 'INVALID_REQUEST'], [{ amount: '100000' }, 400, 'INVALID_REQUEST'], [{ amount: Number.NaN }, 400, 'INVALID_REQUEST'],
      [{ idempotencyKey: undefined }, 400, 'INVALID_REQUEST'], [{ idempotencyKey: 'short' }, 400, 'INVALID_REQUEST'], [{ idempotencyKey: 'has spaces in it!' }, 400, 'INVALID_REQUEST'],
      [{ paymentId: 'not-an-id' }, 400, 'INVALID_REQUEST'],
    ];
    for (const [over, code, errCode] of cases) {
      const res = await refund(req(over));
      assert.equal(res.status, code, JSON.stringify(over));
      if (errCode) assert.equal(res.json.code, errCode);
    }
    untouched('invalid requests', before);
  });

  it('AUTH-OP-REFUND: more than the remaining amount, or a payment that cannot be refunded -> 422 from the existing rules, nothing reserved', async () => {
    let before = snap();
    const res = await refund(req({ amount: 300001 }));
    assert.deepEqual([res.status, res.json.code], [422, 'REFUND_NOT_ALLOWED']);
    untouched('too much', before);
    payments[0].status = 'PENDING';
    before = snap();
    assert.deepEqual((await refund(req({ idempotencyKey: 'order-refund-pending-1' }))).status, 422);
    untouched('not refundable', before);
  });

  it('AUTH-OP-REFUND: a client cannot steer status, owner or provider through the body (extra fields are ignored)', async () => {
    const res = await refund(req({ status: 'REFUNDED', userId: 'ff'.repeat(12), provider: 'payos', stripePaymentIntentId: 'pi_attacker', currency: 'VND' }));
    assert.equal(res.status, 201);
    assert.equal(stripeRefunds[0].pi, PI, 'the stored intent is used');
    assert.equal(refunds[0].userId, USER_A, 'the stored owner is used');
    assert.equal(payments[0].status, 'PARTIALLY_REFUNDED');
  });

  it('AUTH-OP-REFUND: provider not clear (no provider field) -> 409 before any provider call', async () => {
    const before = snap();
    const res = await refund(req({ paymentId: PAY_ODD }));
    assert.deepEqual([res.status, res.json.code], [409, 'PAYMENT_PROVIDER_UNKNOWN']);
    untouched('provider unknown', before);
  });

  it('AUTH-OP-REFUND: Stripe timeout -> 502 UNVERIFIED; the reservation is KEPT; a retry re-sends the SAME request (same key and amount)', async () => {
    stripeScript = async () => { throw Object.assign(new Error('Request timed out'), { stripeType: 'StripeConnectionError' }); };
    const res = await refund(req());
    assert.equal(res.status, 502);
    assert.deepEqual([res.json.code, res.json.data.outcome], ['REFUND_NOT_VERIFIED', 'UNVERIFIED']);
    assert.deepEqual([payments[0].status, payments[0].refundedTotal, payments[0].pendingRefundTotal], ['SUCCEEDED', 0, 100000], 'not released: money may have moved');
    assert.deepEqual([refunds.length, refunds[0].status], [1, 'PENDING']);
    stripeScript = async () => ({ id: 're_after_retry', status: 'succeeded' });
    const again = await refund(req());
    assert.deepEqual([again.status, again.json.data.outcome, again.json.data.replayed], [200, 'SUCCEEDED', true]);
    assert.equal(stripeRefunds.length, 2);
    assert.deepEqual(stripeRefunds[1], stripeRefunds[0], 'identical Stripe request: same intent, amount, currency and idempotency key');
    assert.deepEqual([refunds.length, payments[0].refundedTotal, payments[0].pendingRefundTotal], [1, 100000, 0]);
  });

  it('AUTH-OP-REFUND: Stripe rejects the request (definite) -> FAILED, reservation released, a retry reports FAILED without calling again', async () => {
    stripeScript = async () => { throw Object.assign(new Error('Charge has already been refunded'), { stripeType: 'StripeInvalidRequestError', statusCode: 400 }); };
    const res = await refund(req());
    assert.deepEqual([res.status, res.json.data.outcome, res.json.data.refund.status], [201, 'FAILED', 'FAILED']);
    assert.deepEqual([payments[0].status, payments[0].refundedTotal, payments[0].pendingRefundTotal], ['SUCCEEDED', 0, 0]);
    const again = await refund(req());
    assert.deepEqual([again.status, again.json.data.outcome, again.json.data.replayed], [200, 'FAILED', true]);
    assert.equal(stripeRefunds.length, 1);
  });

  it('the user refund route keeps its JWT (401 without it) and its own generated keys', async () => {
    const res = await fetch(`${base}/api/payments/${PAY_STRIPE}/refund`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-service-token': TOKEN }, body: JSON.stringify({ amount: 1 }) });
    assert.equal(res.status, 401);
    const PaymentService = require('../src/services/payment.service').PaymentService;
    await PaymentService.refundPayment(PAY_STRIPE, USER_A, 1000, 'x', false);
    assert.match(refunds[0].idempotencyKey, /^refund_d4/, 'the user path is unchanged');
  });
});
