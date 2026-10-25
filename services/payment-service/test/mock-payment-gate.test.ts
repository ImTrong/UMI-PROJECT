/**
 * FIX 07B-1 - PAY-01 (demo payment completion is development / test only) and AUTH-01 (the Payment -> User caller sends
 * PAYMENT_USER_TOKEN and nothing else).
 *
 * The REAL express app of the payment-service runs on an ephemeral port (real routing, flag middleware, authentication middleware,
 * controllers and PaymentService). Only the database client is replaced by an in-memory stand-in that records every write, and the
 * neighbouring services (auth, order, user) by ONE loopback stub that records every call it receives. No real payment provider,
 * database, Docker container or running service is involved. The same guarantees are checked against a real MongoDB replica set by
 * test/mock-payment-gate.mongo.test.ts.
 *
 * No token appears in this file: every run draws fresh random ones; the public default is read from docker-compose.yml.
 *
 * Run: node -r ts-node/register/transpile-only --test test/mock-payment-gate.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ---- in-memory Prisma stand-in (installed before anything from src/ is loaded) ----
type Row = Record<string, any>;
const payments: Row[] = [];
const writes: Array<{ op: string; where: any; data?: any }> = [];
let reads = 0;
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
const paymentModel = {
  findFirst: async ({ where }: any = {}) => { reads++; const r = payments.filter((p) => matches(p, where)).pop(); return r ? { ...r } : null; },
  findUnique: async ({ where }: any = {}) => { reads++; const r = payments.find((p) => matches(p, where)); return r ? { ...r } : null; },
  update: async ({ where, data }: any) => {
    writes.push({ op: 'payment.update', where, data });
    const row = payments.find((p) => matches(p, where));
    if (!row) throw new Error('record not found');
    Object.assign(row, data, { updatedAt: new Date() });
    return { ...row };
  },
  create: async ({ data }: any) => { writes.push({ op: 'payment.create', where: null, data }); payments.push({ ...data }); return { ...data }; },
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

const USER = '5a'.repeat(12);
const ORDER = '6b'.repeat(12);
const PAYMENT_ID = '7c'.repeat(12);
const TOKEN = randomBytes(32).toString('hex');
const OTHER_TOKEN = randomBytes(32).toString('hex');   // the shared INTERNAL_SERVICE_TOKEN
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));

describe('FIX 07B-1 payment-service: mock payment gate and Payment -> User token', () => {
  let app: any;
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let stubBase = '';
  let closedPort = 0;
  let PaymentService: any;
  let StripeService: any;
  let mock: typeof import('../src/utils/mock-payment');
  const logs: string[] = [];
  const stubCalls: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  let userServiceStatus = 200;
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
        if (req.url === '/api/auth/verify-token') return res.end(JSON.stringify({ valid: true, user: { userId: USER, email: 'buyer@test.local' } }));
        if (req.url?.startsWith('/api/users/become-instructor/confirm')) { res.statusCode = userServiceStatus; return res.end(JSON.stringify({ ok: userServiceStatus === 200 })); }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    closedPort = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));

    process.env.AUTH_SERVICE_URL = stubBase;
    process.env.ORDER_SERVICE_URL = stubBase;
    process.env.USER_SERVICE_URL = stubBase;
    process.env.INTERNAL_SERVICE_TOKEN = OTHER_TOKEN;
    process.env.ORDER_PAYMENT_TOKEN = randomBytes(32).toString('hex');   // Order <-> Payment credential (FIX 07B-2A)
    delete process.env.STRIPE_SECRET_KEY;

    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });   // never write error.log / combined.log into the repository
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => {
          if (typeof a === 'string') return a;
          try { return `${a?.message ?? ''} ${a?.stack ?? ''} ${JSON.stringify(a)}`; } catch { return String(a); }
        }).join(' '));
        return original(...args);
      };
    }
    mock = require('../src/utils/mock-payment');
    PaymentService = require('../src/services/payment.service').PaymentService;
    StripeService = require('../src/services/stripe.service').StripeService;
    app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  });

  const seed = (over: Row = {}) => {
    payments.length = 0;
    payments.push({
      id: PAYMENT_ID, orderId: ORDER, userId: USER, amount: 199000, currency: 'vnd', status: 'PENDING', type: 'COURSE_PURCHASE',
      provider: 'stripe', stripePaymentIntentId: 'pi_mock_07b1_demo', metadata: { isMock: true }, orderSynced: false, ...over,
    });
  };
  beforeEach(() => {
    seed();
    writes.length = 0;
    stubCalls.length = 0;
    reads = 0;
    userServiceStatus = 200;
    process.env.NODE_ENV = 'development';
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    process.env.PAYMENT_USER_TOKEN = TOKEN;
    process.env.USER_SERVICE_URL = stubBase;
    process.env.INTERNAL_SERVICE_TOKEN = OTHER_TOKEN;
    delete process.env.STRIPE_SECRET_KEY;
  });

  const setFlag = (value: string | undefined, nodeEnv: string | undefined = 'development') => {
    if (value === undefined) delete process.env.PAYMENT_MOCK_ENABLED; else process.env.PAYMENT_MOCK_ENABLED = value;
    if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
  };
  const post = async (url: string, body: unknown, headers: Record<string, string> = { authorization: 'Bearer user-session' }) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const OFF_VALUES: Array<string | undefined> = [undefined, '', 'false', 'FALSE', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', 'enabled'];
  const PRODUCTION = ['production', 'Production', ' PRODUCTION '];
  const untouched = (label: string) => {
    assert.equal(writes.length, 0, `${label}: nothing may be written`);
    assert.equal(payments[0].status, 'PENDING', `${label}: the payment stays PENDING`);
    assert.equal(stubCalls.filter((c) => c.url.startsWith('/api/orders')).length, 0, `${label}: the order service is not told anything`);
    assert.equal(stubCalls.filter((c) => c.url.startsWith('/api/users')).length, 0, `${label}: the user service is not told anything`);
  };

  // ============================================================================================== PAY-01

  it('flag matrix: ON only for PAYMENT_MOCK_ENABLED === "true" outside production', () => {
    for (const v of OFF_VALUES) for (const env of [undefined, 'development', 'test']) {
      assert.equal(mock.isMockPaymentEnabled({ PAYMENT_MOCK_ENABLED: v, NODE_ENV: env } as any), false, `${JSON.stringify(v)} / ${env}`);
      assert.throws(() => mock.assertMockPaymentEnabled({ PAYMENT_MOCK_ENABLED: v, NODE_ENV: env } as any), mock.MockPaymentDisabledError);
    }
    for (const env of [undefined, '', 'development', 'test', 'staging']) {
      assert.equal(mock.isMockPaymentEnabled({ PAYMENT_MOCK_ENABLED: 'true', NODE_ENV: env } as any), true, `true / ${env}`);
    }
    for (const env of PRODUCTION) {
      assert.equal(mock.isMockPaymentEnabled({ PAYMENT_MOCK_ENABLED: 'true', NODE_ENV: env } as any), false, `true / ${env}`);
    }
    assert.equal(mock.isMockPaymentEnabled({} as any), false, 'default (nothing set) is OFF');
  });

  it('mock-complete with the flag OFF (unset, empty, "false", invalid): 404 before authentication, nothing read or written', async () => {
    for (const v of OFF_VALUES) {
      setFlag(v);
      const res = await post('/api/payments/mock-complete', { orderId: ORDER });
      assert.equal(res.status, 404, `PAYMENT_MOCK_ENABLED=${JSON.stringify(v)}`);
      assert.deepEqual(res.json, { error: 'Route not found' });
    }
    assert.equal(stubCalls.length, 0, 'not even the auth service was asked');
    assert.equal(reads, 0);
    untouched('flag off');
  });

  it('mock-complete with PAYMENT_MOCK_ENABLED=true in PRODUCTION: 404, nothing changes', async () => {
    for (const env of PRODUCTION) {
      setFlag('true', env);
      const res = await post('/api/payments/mock-complete', { orderId: ORDER });
      assert.equal(res.status, 404, env);
    }
    assert.equal(reads, 0);
    untouched('production');
  });

  it('mock-complete with PAYMENT_MOCK_ENABLED=true in development: the demo flow works as before', async () => {
    setFlag('true', 'development');
    const res = await post('/api/payments/mock-complete', { orderId: ORDER });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.message, 'Payment completed successfully (Demo Mode)');
    assert.equal(payments[0].status, 'SUCCEEDED');
    assert.equal(payments[0].metadata.completedViaMock, true);
    const orderCalls = stubCalls.filter((c) => c.url === '/api/orders/webhook/payment');
    assert.equal(orderCalls.length, 1);
    assert.deepEqual(orderCalls[0].body, { orderId: ORDER, status: 'PAID' });
  });

  it('calling PaymentService.completeMockPayment DIRECTLY with the flag off / in production is refused before any database access', async () => {
    for (const [v, env] of [[undefined, 'development'], ['false', 'development'], ['true', 'production'], ['', 'test']] as const) {
      setFlag(v, env);
      await assert.rejects(PaymentService.completeMockPayment(ORDER, USER), mock.MockPaymentDisabledError);
    }
    assert.equal(reads, 0);
    untouched('direct service call');
  });

  it('the other demo shortcut - POST /api/payments/confirm on a payment without a real Stripe intent - follows the same flag', async () => {
    for (const [v, env] of [[undefined, 'development'], ['false', 'test'], ['true', 'production']] as const) {
      setFlag(v, env);
      for (const over of [{}, { metadata: {}, stripePaymentIntentId: 'pi_mock_x' }, { metadata: { isMock: true }, stripePaymentIntentId: null }]) {
        seed(over);
        const res = await post('/api/payments/confirm', { paymentIntentId: PAYMENT_ID, paymentMethodId: 'pm_card_visa' });
        assert.equal(res.status, 403, `${v}/${env}`);
        assert.deepEqual(res.json, { error: 'Mock payment completion is disabled in this environment' });
      }
      seed();
      await assert.rejects(PaymentService.confirmPayment({ paymentIntentId: PAYMENT_ID, paymentMethodId: 'pm_card_visa' }, { kind: 'user', userId: USER }), mock.MockPaymentDisabledError);
      await assert.rejects(PaymentService.confirmPayment({ paymentIntentId: PAYMENT_ID, paymentMethodId: 'pm_card_visa' }, { kind: 'internal' }), mock.MockPaymentDisabledError);
    }
    // refused BEFORE the PROCESSING / FAILED writes: the payment is exactly as it was
    untouched('confirm, flag off');
    // flag on in development: the demo confirm still completes
    setFlag('true', 'development');
    const ok = await post('/api/payments/confirm', { paymentIntentId: PAYMENT_ID, paymentMethodId: 'pm_card_visa' });
    assert.equal(ok.status, 200);
    assert.equal(payments[0].status, 'SUCCEEDED');
  });

  it('a REAL Stripe payment is confirmed with the flag off and in production - the provider flow is untouched', async () => {
    setFlag(undefined, 'production');
    process.env.STRIPE_SECRET_KEY = `sk_test_${randomBytes(12).toString('hex')}`;   // dummy: getPaymentIntent is replaced below
    const real = StripeService.getPaymentIntent;
    const asked: string[] = [];
    StripeService.getPaymentIntent = async (id: string) => { asked.push(id); return { id, status: 'succeeded' }; };
    try {
      seed({ stripePaymentIntentId: 'pi_3RealIntent07b1', metadata: {} });
      const res = await post('/api/payments/confirm', { paymentIntentId: 'pi_3RealIntent07b1', paymentMethodId: 'pm_card_visa' });
      assert.equal(res.status, 200);
      assert.deepEqual(asked, ['pi_3RealIntent07b1']);
      assert.equal(payments[0].status, 'SUCCEEDED');
      const orderCalls = stubCalls.filter((c) => c.url === '/api/orders/webhook/payment');
      assert.deepEqual(orderCalls.map((c) => c.body), [{ orderId: ORDER, status: 'PAID' }]);
    } finally {
      StripeService.getPaymentIntent = real;
    }
  });

  it('the Stripe webhook route still verifies signatures (unchanged): an unsigned event is refused and changes nothing', async () => {
    setFlag('true', 'development');
    const res = await fetch(`${base}/api/payments/webhook/stripe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_mock_07b1_demo' } } }) });
    assert.ok(res.status >= 400, `status ${res.status}`);
    untouched('unsigned webhook');
  });

  // ============================================================================================== AUTH-01 caller

  const notify = () => PaymentService.notifyUserService(USER, 'INSTRUCTOR_REGISTRATION_SUCCESS');
  const userCalls = () => stubCalls.filter((c) => c.url.startsWith('/api/users/become-instructor/confirm'));

  it('the caller sends PAYMENT_USER_TOKEN in X-Internal-Service-Token - same method, URL and payload as before, nothing else', async () => {
    await notify();
    const calls = userCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/users/become-instructor/confirm', 'no query string');
    assert.equal(calls[0].headers['x-internal-service-token'], TOKEN);
    assert.deepEqual(calls[0].body, { userId: USER, status: 'INSTRUCTOR_REGISTRATION_SUCCESS' });
    assert.equal(calls[0].headers.authorization, undefined);
    assert.ok(!JSON.stringify(calls[0].body).includes(TOKEN));
    assert.ok(!Object.values(calls[0].headers).some((v) => v === OTHER_TOKEN), 'the shared INTERNAL_SERVICE_TOKEN is never sent here');
  });

  it('without a usable PAYMENT_USER_TOKEN NOTHING is sent - no fallback to INTERNAL_SERVICE_TOKEN, a default or ""', async () => {
    const unusable: Array<string | undefined> = [undefined, '', '   ', 'short', TOKEN.slice(0, 23), `${TOKEN.slice(0, 20)} x ${TOKEN.slice(20)}`, ...PUBLIC_DEFAULTS];
    assert.ok(PUBLIC_DEFAULTS.length > 0, 'docker-compose.yml still carries the public default the caller must refuse');
    for (const value of unusable) {
      if (value === undefined) delete process.env.PAYMENT_USER_TOKEN; else process.env.PAYMENT_USER_TOKEN = value;
      process.env.INTERNAL_SERVICE_TOKEN = OTHER_TOKEN;   // configured and usable - must still not be used
      await notify();
    }
    assert.equal(userCalls().length, 0);
    assert.equal(logs.filter((l) => /Not notifying user service/.test(l)).length >= unusable.length, true);
  });

  it('a refusing or unreachable user service is logged with the HTTP status / error code only - never the token', async () => {
    const before = logs.length;
    userServiceStatus = 403;
    await notify();
    userServiceStatus = 500;
    await notify();
    process.env.USER_SERVICE_URL = `http://127.0.0.1:${closedPort}`;
    await notify();
    const lines = logs.slice(before);
    assert.ok(lines.some((l) => /HTTP 403/.test(l)));
    assert.ok(lines.some((l) => /HTTP 500/.test(l)));
    assert.ok(lines.some((l) => /ECONNREFUSED/.test(l)));
  });

  it('the Stripe success handler for an instructor registration calls the user service with the token (real flow, signature already verified)', async () => {
    seed({ type: 'INSTRUCTOR_REGISTRATION', orderId: null, stripePaymentIntentId: 'pi_3Instructor07b1', metadata: {} });
    await PaymentService.handleStripeWebhook({ id: 'evt_07b1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_3Instructor07b1' } } }, { skipEventTracking: true });
    assert.equal(payments[0].status, 'SUCCEEDED');
    assert.equal(userCalls().length, 1);
    assert.equal(userCalls()[0].headers['x-internal-service-token'], TOKEN);
  });

  it('no log line of this whole file contains a token', () => {
    assert.ok(logs.length > 0);
    for (const line of logs) {
      for (const secret of [TOKEN, TOKEN.slice(0, 16), OTHER_TOKEN, OTHER_TOKEN.slice(0, 16), ...PUBLIC_DEFAULTS]) {
        assert.ok(!line.includes(secret), `a log line contains a token: ${line.slice(0, 100)}`);
      }
    }
  });

  it('route table: the flag middleware runs FIRST on mock-complete; confirm and the webhooks keep their chains', () => {
    const chain = (p: string) => app._router.stack.filter((l: any) => l.route && l.route.path === p).map((l: any) => l.route.stack.map((s: any) => s.name));
    assert.deepEqual(chain('/api/payments/mock-complete'), [['requireMockPaymentEnabled', 'authenticateToken', 'completeMockPayment']]);
    assert.equal(chain('/api/payments/confirm').length, 1);
    assert.equal(chain('/api/payments/confirm')[0][0], 'authenticateToken');
    assert.equal(chain('/api/payments/confirm')[0].at(-1), 'confirmPayment');
    assert.ok(chain('/api/payments/webhook/stripe')[0].includes('verifyStripeWebhook'));
    assert.ok(chain('/api/payments/webhook')[0].includes('verifyStripeWebhook'));
  });
});
