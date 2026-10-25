/**
 * FIX 07B-1.1 - POST /api/payments/confirm: a signed-in user may confirm ONLY their own payment.
 *
 * The REAL express app of the payment-service runs on an ephemeral port (real routing, authenticateToken, validation, controllers and
 * PaymentService). Only the database client is replaced by an in-memory stand-in that records every read filter and every write, and
 * the neighbouring services (auth, order, user) by ONE loopback stub: the "auth service" maps a bearer value to a fixed identity,
 * exactly like the real verify-token answer. Stripe is never called: getPaymentIntent is replaced where a real intent is needed.
 * The same guarantees are checked against a real MongoDB replica set by test/payment-ownership.mongo.test.ts.
 *
 * Run: node -r ts-node/register/transpile-only --test test/payment-ownership.test.ts
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
const lookups: any[] = [];
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
const paymentModel = {
  findFirst: async ({ where }: any = {}) => { lookups.push(where); const r = payments.filter((p) => matches(p, where)).pop(); return r ? { ...r } : null; },
  findUnique: async ({ where }: any = {}) => { lookups.push(where); const r = payments.find((p) => matches(p, where)); return r ? { ...r } : null; },
  update: async ({ where, data }: any) => {
    writes.push({ op: 'payment.update', where, data });
    const row = payments.find((p) => matches(p, where));
    if (!row) throw new Error('record not found');
    Object.assign(row, data);
    return { ...row };
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
const ORDER_A = 'c3'.repeat(12);
const PAY_MOCK = 'd4'.repeat(12);        // A's demo payment (no real Stripe intent)
const PAY_REAL = 'e5'.repeat(12);        // A's course payment with a real Stripe intent
const PAY_INSTR = 'f6'.repeat(12);       // A's instructor registration with a real Stripe intent
const PI_REAL = 'pi_3OwnerA07b11course';
const PI_INSTR = 'pi_3OwnerA07b11instr';
const INTERNAL = randomBytes(32).toString('hex');            // the shared INTERNAL_SERVICE_TOKEN - no longer valid on Order <-> Payment routes
const ORDER_PAYMENT = randomBytes(32).toString('hex');       // ORDER_PAYMENT_TOKEN (FIX 07B-2A)
const USER_TOKEN = randomBytes(32).toString('hex');
// bearer value -> identity the stub auth service vouches for (what the real verify-token returns for a signed JWT)
const SESSIONS: Record<string, any> = {
  'session-a': { userId: USER_A, email: 'a@test.local' },
  'session-b': { userId: USER_B, email: 'b@test.local' },
  'session-no-id': { email: 'ghost@test.local' },
  'session-bad-id': { userId: 'not-an-object-id', email: 'bad@test.local' },
};

describe('FIX 07B-1.1: payment confirmation is limited to the payment owner', () => {
  let app: any;
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let PaymentService: any;
  let StripeService: any;
  const stubCalls: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  const stripeAsked: string[] = [];
  let realGetPaymentIntent: any;
  const savedEnv = { ...process.env };

  before(async () => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: any = null;
        try { body = JSON.parse(raw); } catch { /* not JSON */ }
        stubCalls.push({ url: req.url || '', headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/auth/verify-token') {
          const user = SESSIONS[body?.token];
          return res.end(JSON.stringify(user ? { valid: true, user } : { valid: false }));
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, { AUTH_SERVICE_URL: stubBase, ORDER_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, INTERNAL_SERVICE_TOKEN: INTERNAL, ORDER_PAYMENT_TOKEN: ORDER_PAYMENT, PAYMENT_USER_TOKEN: USER_TOKEN });

    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });   // never write error.log / combined.log into the repository
    PaymentService = require('../src/services/payment.service').PaymentService;
    StripeService = require('../src/services/stripe.service').StripeService;
    realGetPaymentIntent = StripeService.getPaymentIntent;
    StripeService.getPaymentIntent = async (id: string) => { stripeAsked.push(id); return { id, status: 'succeeded' }; };
    app = require('../src/app').default;
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
    const common = { userId: USER_A, amount: 199000, currency: 'vnd', status: 'PENDING', provider: 'stripe', orderSynced: false };
    payments.push(
      { ...common, id: PAY_MOCK, orderId: ORDER_A, type: 'COURSE_PURCHASE', stripePaymentIntentId: 'pi_mock_07b11', metadata: { isMock: true } },
      { ...common, id: PAY_REAL, orderId: ORDER_A, type: 'COURSE_PURCHASE', stripePaymentIntentId: PI_REAL, metadata: {} },
      { ...common, id: PAY_INSTR, orderId: null, type: 'INSTRUCTOR_REGISTRATION', amount: 500000, stripePaymentIntentId: PI_INSTR, metadata: {} },
    );
  };
  const snapshot = () => JSON.parse(JSON.stringify(payments));
  beforeEach(() => {
    seed();
    writes.length = 0;
    lookups.length = 0;
    stubCalls.length = 0;
    stripeAsked.length = 0;
    process.env.NODE_ENV = 'development';
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = `sk_test_${randomBytes(12).toString('hex')}`;   // dummy: real-intent branch, Stripe call replaced
  });

  const confirm = async (session: string | null, body: Record<string, unknown>, url = '/api/payments/confirm', headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}), ...headers },
      body: JSON.stringify({ paymentMethodId: 'pm_card_visa', ...body }),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const downstream = () => stubCalls.filter((c) => !c.url.startsWith('/api/auth'));
  const nothingHappened = (label: string, before: any) => {
    assert.deepEqual(payments, before, `${label}: every payment is exactly as it was`);
    assert.equal(writes.length, 0, `${label}: nothing written`);
    assert.equal(downstream().length, 0, `${label}: no order notification (no enrollment), no user-service call (no role change)`);
    assert.equal(stripeAsked.length, 0, `${label}: Stripe is not even asked`);
  };
  const NOT_FOUND = { status: 404, json: { error: 'Payment not found' } };

  // ---------------------------------------------------------------------------------------------- PAY-OWN-01

  it('PAY-OWN-01 owner A confirms their real Stripe payments (by Mongo id and by intent id): existing flow, Stripe decides', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'false';
    process.env.NODE_ENV = 'production';
    const byId = await confirm('session-a', { paymentIntentId: PAY_REAL });
    assert.equal(byId.status, 200);
    assert.equal(byId.json.data.status, 'SUCCEEDED');
    assert.deepEqual(stripeAsked, [PI_REAL], 'the payment provider still decides the outcome');
    assert.deepEqual(downstream().map((c) => [c.url, c.body]), [['/api/orders/webhook/payment', { orderId: ORDER_A, status: 'PAID' }]]);
    assert.ok(lookups.every((w) => w.userId === USER_A), 'the lookup is limited to the caller');

    stubCalls.length = 0;
    const byIntent = await confirm('session-a', { paymentIntentId: PI_INSTR });
    assert.equal(byIntent.status, 200);
    const userCalls = downstream().filter((c) => c.url === '/api/users/become-instructor/confirm');
    assert.equal(userCalls.length, 1, 'the instructor upgrade contract is unchanged');
    assert.equal(userCalls[0].headers['x-internal-service-token'], USER_TOKEN);
    assert.deepEqual(userCalls[0].body, { userId: USER_A, status: 'INSTRUCTOR_REGISTRATION_SUCCESS' });
  });

  // ---------------------------------------------------------------------------------------------- PAY-OWN-02

  it('PAY-OWN-02 user B sends A\'s payment ids (mock, real course, instructor; Mongo id and intent id): 404, no side effect', async () => {
    const before = snapshot();
    for (const id of [PAY_MOCK, PAY_REAL, PAY_INSTR, PI_REAL, PI_INSTR, 'pi_mock_07b11']) {
      const res = await confirm('session-b', { paymentIntentId: id });
      assert.deepEqual({ status: res.status, json: res.json }, NOT_FOUND, id);
    }
    assert.ok(lookups.length > 0 && lookups.every((w) => w.userId === USER_B), 'every lookup carried B\'s identity');
    nothingHappened('user B', before);
  });

  it('PAY-OWN-02 the same holds in production with the flag off (real Stripe path) - B is refused before Stripe is asked', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'false';
    process.env.NODE_ENV = 'production';
    const before = snapshot();
    for (const id of [PAY_REAL, PI_REAL, PAY_INSTR, PI_INSTR]) assert.equal((await confirm('session-b', { paymentIntentId: id })).status, 404, id);
    nothingHappened('user B, production', before);
  });

  // ---------------------------------------------------------------------------------------------- PAY-OWN-03

  it('PAY-OWN-03 B claims to be A in the body (userId, user, ownerId, user.userId): still 404 - identity comes from the token', async () => {
    const before = snapshot();
    const forged = [{ userId: USER_A }, { user: { userId: USER_A } }, { ownerId: USER_A, requesterId: USER_A }, { userId: USER_A, 'user.userId': USER_A }];
    for (const extra of forged) {
      for (const id of [PAY_REAL, PI_REAL, PAY_MOCK]) {
        const res = await confirm('session-b', { paymentIntentId: id, ...extra });
        assert.deepEqual({ status: res.status, json: res.json }, NOT_FOUND);
      }
    }
    // headers that look like an identity do not count either
    const viaHeader = await confirm('session-b', { paymentIntentId: PAY_REAL }, '/api/payments/confirm', { 'x-user-id': USER_A, 'x-forwarded-user': USER_A });
    assert.equal(viaHeader.status, 404);
    nothingHappened('forged body', before);
  });

  // ---------------------------------------------------------------------------------------------- PAY-OWN-04

  it('PAY-OWN-04 a payment that does not exist gets the SAME answer as someone else\'s payment, and nothing happens', async () => {
    const before = snapshot();
    const foreign = await confirm('session-b', { paymentIntentId: PAY_REAL });
    for (const id of ['0'.repeat(24), 'ab'.repeat(12), 'pi_3DoesNotExist']) {
      const missing = await confirm('session-a', { paymentIntentId: id });
      assert.equal(missing.status, foreign.status);
      assert.equal(missing.text, foreign.text, 'indistinguishable from a foreign payment');
    }
    nothingHappened('missing payment', before);
  });

  it('PAY-OWN-04 an unidentifiable caller (no id, malformed id, unknown session, no token, auth service down) changes nothing', async () => {
    const before = snapshot();
    assert.deepEqual(await confirm('session-no-id', { paymentIntentId: PAY_REAL }).then((r) => [r.status, r.json]), [404, { error: 'Payment not found' }]);
    assert.deepEqual(await confirm('session-bad-id', { paymentIntentId: PAY_REAL }).then((r) => [r.status, r.json]), [404, { error: 'Payment not found' }]);
    assert.equal((await confirm('session-unknown', { paymentIntentId: PAY_REAL })).status, 401);
    assert.equal((await confirm(null, { paymentIntentId: PAY_REAL })).status, 401);
    const authUrl = process.env.AUTH_SERVICE_URL;
    process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:9';
    try {
      assert.equal((await confirm('session-a', { paymentIntentId: PAY_REAL })).status, 401, 'auth service unreachable: fail-closed');
    } finally {
      process.env.AUTH_SERVICE_URL = authUrl;
    }
    assert.equal(lookups.length, 0, 'none of them reached the payment lookup');
    nothingHappened('unidentifiable caller', before);
  });

  it('PAY-OWN-04 a payment row without a usable owner is never confirmed by a user', async () => {
    payments.push({ id: '9a'.repeat(12), userId: null, orderId: ORDER_A, status: 'PENDING', type: 'COURSE_PURCHASE', stripePaymentIntentId: 'pi_3NoOwner', metadata: {} });
    const before = snapshot();
    for (const s of ['session-a', 'session-b']) assert.equal((await confirm(s, { paymentIntentId: 'pi_3NoOwner' })).status, 404);
    nothingHappened('owner unknown', before);
  });

  // ---------------------------------------------------------------------------------------------- direct service calls

  it('direct service calls must say who is calling: none / unknown kind / bad user id are refused before the database is read', async () => {
    const before = snapshot();
    const data = { paymentIntentId: PAY_REAL, paymentMethodId: 'pm_card_visa' };
    await assert.rejects(PaymentService.confirmPayment(data), /requires an authenticated caller/);
    await assert.rejects(PaymentService.confirmPayment(data, { kind: 'admin' }), /requires an authenticated caller/);
    for (const userId of [undefined, '', 'not-an-id', null, 42, `${USER_A} `]) {
      await assert.rejects(PaymentService.confirmPayment(data, { kind: 'user', userId }), /Payment not found/, String(userId));
    }
    await assert.rejects(PaymentService.confirmPayment(data, { kind: 'user', userId: USER_B }), /Payment not found/);
    assert.ok(lookups.every((w) => w.userId === USER_B), 'only the well-formed identity reached the lookup, with its filter');
    nothingHappened('direct calls', before);
  });

  it('even if the filtered lookup returned another user\'s row, the row\'s owner is checked again', async () => {
    const realFindFirst = paymentModel.findFirst;
    paymentModel.findFirst = async ({ where }: any) => { lookups.push(where); return { ...payments.find((p) => p.id === PAY_REAL) }; };  // ignores userId
    try {
      const before = snapshot();
      await assert.rejects(PaymentService.confirmPayment({ paymentIntentId: PAY_REAL, paymentMethodId: 'pm' }, { kind: 'user', userId: USER_B }), /Payment not found/);
      nothingHappened('second check', before);
    } finally {
      paymentModel.findFirst = realFindFirst;
    }
  });

  it('the internal route (order-service) keeps working without a user identity; without the service token it is refused', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'false';
    process.env.NODE_ENV = 'production';
    const refused = await confirm(null, { paymentIntentId: PAY_REAL }, '/api/payments/internal/confirm');
    assert.equal(refused.status, 403);
    const shared = await confirm(null, { paymentIntentId: PAY_REAL }, '/api/payments/internal/confirm', { 'x-internal-service-token': INTERNAL });
    assert.equal(shared.status, 403, 'the shared INTERNAL_SERVICE_TOKEN is refused here (FIX 07B-2A)');
    assert.equal(writes.length, 0);
    const ok = await confirm(null, { paymentIntentId: PAY_REAL }, '/api/payments/internal/confirm', { 'x-internal-service-token': ORDER_PAYMENT });
    assert.equal(ok.status, 200);
    assert.equal(payments.find((p) => p.id === PAY_REAL)!.status, 'SUCCEEDED');
    assert.deepEqual(lookups.at(-1), { id: PAY_REAL }, 'internal lookups are not limited to a user');
  });

  // ---------------------------------------------------------------------------------------------- PAY-OWN-05

  it('PAY-OWN-05 flag off / production: every demo path is still blocked, for the owner too; B still gets 404', async () => {
    for (const [flag, env] of [[undefined, 'development'], ['false', 'test'], ['true', 'production']] as const) {
      if (flag === undefined) delete process.env.PAYMENT_MOCK_ENABLED; else process.env.PAYMENT_MOCK_ENABLED = flag;
      process.env.NODE_ENV = env;
      delete process.env.STRIPE_SECRET_KEY;   // Stripe not configured: every payment would be "mock"
      const before = snapshot();
      assert.equal((await confirm('session-a', { paymentIntentId: PAY_MOCK })).status, 403, `owner ${flag}/${env}`);
      assert.equal((await confirm('session-a', { paymentIntentId: PAY_REAL })).status, 403, `owner, Stripe off ${flag}/${env}`);
      assert.equal((await confirm('session-b', { paymentIntentId: PAY_MOCK })).status, 404, `B ${flag}/${env}`);
      assert.equal((await confirm('session-a', { orderId: ORDER_A }, '/api/payments/mock-complete')).status, 404);
      nothingHappened(`demo ${flag}/${env}`, before);
    }
  });

  it('PAY-OWN-05 flag on in development: the demo still completes for the owner only', async () => {
    const before = snapshot();
    assert.equal((await confirm('session-b', { paymentIntentId: PAY_MOCK })).status, 404);
    const mc = await confirm('session-b', { orderId: ORDER_A }, '/api/payments/mock-complete');
    assert.notEqual(mc.status, 200, 'mock-complete looks up the order\'s payment by the caller too');
    nothingHappened('B on the demo', before);

    const ok = await confirm('session-a', { paymentIntentId: PAY_MOCK });
    assert.equal(ok.status, 200);
    assert.equal(payments.find((p) => p.id === PAY_MOCK)!.status, 'SUCCEEDED');
    assert.deepEqual(downstream().map((c) => c.body), [{ orderId: ORDER_A, status: 'PAID' }]);
  });

  it('route table: /api/payments/confirm still requires authenticateToken first; the internal route still verifyInternalService', () => {
    const chain = (p: string) => app._router.stack.filter((l: any) => l.route && l.route.path === p).map((l: any) => l.route.stack.map((s: any) => s.name))[0];
    assert.equal(chain('/api/payments/confirm')[0], 'authenticateToken');
    assert.equal(chain('/api/payments/confirm').at(-1), 'confirmPayment');
    assert.equal(chain('/api/payments/internal/confirm')[0], 'requireServiceToken(ORDER_PAYMENT_TOKEN)');
  });
});
