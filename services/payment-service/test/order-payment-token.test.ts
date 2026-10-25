/**
 * FIX 07B-2A - payment-service side of the Order <-> Payment credential ORDER_PAYMENT_TOKEN.
 *
 *   receiving   the four routes the order-service calls (/api/payments/internal/create-intent | confirm | create-payos | cancel-payos)
 *               accept ONLY ORDER_PAYMENT_TOKEN in X-Internal-Service-Token (constant-time, fail-closed); webhooks, user routes and
 *               the operations routes are unchanged
 *   calling     notifyOrderService and the outbox job send ORDER_PAYMENT_TOKEN - and nothing at all without a usable one
 *   starting    src/index.ts refuses to start without a usable ORDER_PAYMENT_TOKEN
 *
 * The REAL express app runs on an ephemeral port with an in-memory database stand-in; the order service is a loopback stub that
 * records every call. Every token is drawn at random for this run; the public default is read from docker-compose.yml.
 *
 * Run: node -r ts-node/register/transpile-only --test test/order-payment-token.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, any>;
const payments: Row[] = [];
const writes: Array<{ op: string; where: any; data?: any }> = [];
let reads = 0;
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
const paymentModel = {
  findFirst: async ({ where }: any = {}) => { reads++; const r = payments.filter((p) => matches(p, where)).pop(); return r ? structuredClone(r) : null; },
  findUnique: async ({ where }: any = {}) => { reads++; const r = payments.find((p) => matches(p, where)); return r ? structuredClone(r) : null; },
  findMany: async () => { reads++; return payments.filter((p) => p.status === 'SUCCEEDED' && p.orderSynced !== true).map((p) => structuredClone(p)); },
  update: async ({ where, data }: any) => { writes.push({ op: 'update', where, data }); const row = payments.find((p) => matches(p, where)); if (!row) throw new Error('not found'); Object.assign(row, structuredClone(data)); return structuredClone(row); },
  updateMany: async ({ where, data }: any) => { writes.push({ op: 'updateMany', where, data }); const rows = payments.filter((p) => matches(p, where)); rows.forEach((r) => Object.assign(r, structuredClone(data))); return { count: rows.length }; },
  create: async ({ data }: any) => { writes.push({ op: 'create', where: null, data }); const row = { id: randomBytes(12).toString('hex'), ...data }; payments.push(row); return structuredClone(row); },
};
const noopModel = new Proxy({}, { get: () => async () => { writes.push({ op: 'other', where: null }); return null; } });
class FakePrismaClient {
  payment = paymentModel;
  constructor() { return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : typeof k === 'string' && !k.startsWith('$') ? noopModel : async () => undefined) }); }
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: {
    PrismaClient: FakePrismaClient,
    PaymentStatus: { PENDING: 'PENDING', PROCESSING: 'PROCESSING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED', REFUNDED: 'REFUNDED', CANCELLED: 'CANCELLED' },
    RefundStatus: {}, Prisma: {},
  },
} as any;

const TOKEN = randomBytes(32).toString('hex');            // ORDER_PAYMENT_TOKEN
const SHARED = randomBytes(32).toString('hex');           // INTERNAL_SERVICE_TOKEN
const USER_TOKEN = randomBytes(32).toString('hex');       // PAYMENT_USER_TOKEN
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));
const USER_A = 'a1'.repeat(12);
const ORDER_ID = 'c3'.repeat(12);
const PAY = 'd4'.repeat(12);
const ORDER_ROUTES: Array<[string, Record<string, unknown>]> = [
  ['/api/payments/internal/create-intent', { orderId: ORDER_ID, orderNumber: 'ORD-1', userId: USER_A, amount: 199000, currency: 'vnd' }],
  ['/api/payments/internal/confirm', { paymentIntentId: PAY, paymentMethodId: 'pm_card_visa' }],
  ['/api/payments/internal/create-payos', { orderId: ORDER_ID, orderNumber: 'ORD-1', orderCode: 7000000001, userId: USER_A, amount: 199000, description: 'x', items: [] }],
  ['/api/payments/internal/cancel-payos', { orderCode: '7000000001', reason: 'expired' }],
];

describe('FIX 07B-2A payment-service: ORDER_PAYMENT_TOKEN', () => {
  let app: any;
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let stubBase = '';
  let PaymentService: any;
  let syncPendingOrders: any;
  let startupConfigProblems: any;
  let orderAnswer = 200;
  const stubCalls: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  const logs: string[] = [];
  const savedEnv = { ...process.env };

  before(async () => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: any = null;
        try { body = JSON.parse(raw); } catch { /* not JSON */ }
        stubCalls.push({ url: req.url || '', headers: req.headers, body });
        res.statusCode = req.url === '/api/orders/webhook/payment' ? orderAnswer : 200;
        res.setHeader('content-type', 'application/json');
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, { AUTH_SERVICE_URL: stubBase, ORDER_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, NODE_ENV: 'production' });
    delete process.env.STRIPE_SECRET_KEY;
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => { if (typeof a === 'string') return a; try { return `${a?.message ?? ''} ${a?.stack ?? ''} ${JSON.stringify(a)}`; } catch { return String(a); } }).join(' '));
        return original(...args);
      };
    }
    PaymentService = require('../src/services/payment.service').PaymentService;
    syncPendingOrders = require('../src/jobs/order-sync.job').syncPendingOrders;
    startupConfigProblems = require('../src/utils/startup-config').startupConfigProblems;
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

  const seed = () => {
    payments.length = 0;
    payments.push({ id: PAY, orderId: ORDER_ID, userId: USER_A, amount: 199000, currency: 'vnd', status: 'PENDING', type: 'COURSE_PURCHASE', provider: 'stripe', stripePaymentIntentId: 'pi_mock_op', metadata: { isMock: true }, orderSynced: false });
  };
  beforeEach(() => {
    seed();
    writes.length = 0;
    stubCalls.length = 0;
    reads = 0;
    orderAnswer = 200;
    Object.assign(process.env, { ORDER_PAYMENT_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED, PAYMENT_USER_TOKEN: USER_TOKEN, NODE_ENV: 'production' });
    delete process.env.PAYMENT_MOCK_ENABLED;
  });

  const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, text };
  };
  const withToken = (t: string) => ({ 'x-internal-service-token': t });
  const nothingReached = (label: string) => {
    assert.equal(reads, 0, `${label}: refused before the controller - nothing read`);
    assert.equal(writes.length, 0, `${label}: nothing written`);
    assert.equal(stubCalls.length, 0, `${label}: nothing sent onwards`);
  };

  // ============================================================================================== AUTH-OP-02 / 03 receiving

  it('AUTH-OP-02/03: no token, wrong tokens of any length/case, the public default, INTERNAL_SERVICE_TOKEN, PAYMENT_USER_TOKEN -> 403 on all four routes', async () => {
    const wrong = [
      `${TOKEN[0] === 'a' ? 'b' : 'a'}${TOKEN.slice(1)}`, TOKEN.slice(0, -1), `${TOKEN}0`, TOKEN.toUpperCase(), 'x', 'y'.repeat(10_000), '',
      SHARED, USER_TOKEN, randomBytes(32).toString('hex'), ...PUBLIC_DEFAULTS,
    ];
    assert.ok(PUBLIC_DEFAULTS.length > 0);
    for (const [route, body] of ORDER_ROUTES) {
      assert.equal((await post(route, body)).status, 403, `${route} without a token`);
      for (const t of wrong) {
        const res = await post(route, body, withToken(t));
        assert.equal(res.status, 403, `${route} with a token of length ${t.length}`);
        assert.deepEqual(JSON.parse(res.text), { error: 'Forbidden: Invalid internal service token' });
      }
    }
    nothingReached('wrong tokens');
  });

  it('the token counts only in X-Internal-Service-Token: query string, body, Authorization and other header names are refused', async () => {
    for (const [route, body] of ORDER_ROUTES) {
      for (const [url, b, h] of [
        [`${route}?token=${TOKEN}&x-internal-service-token=${TOKEN}`, body, {}],
        [route, { ...body, token: TOKEN, 'x-internal-service-token': TOKEN }, {}],
        [route, body, { authorization: `Bearer ${TOKEN}` }],
        [route, body, { 'x-order-payment-token': TOKEN }],
      ] as Array<[string, any, Record<string, string>]>) {
        assert.equal((await post(url, b, h)).status, 403, url);
      }
    }
    nothingReached('token in the wrong place');
  });

  it('server without a usable ORDER_PAYMENT_TOKEN (unset, empty, short, public default): 500 fail-closed, even with INTERNAL_SERVICE_TOKEN set', async () => {
    for (const configured of [undefined, '', 'short-value', ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.ORDER_PAYMENT_TOKEN; else process.env.ORDER_PAYMENT_TOKEN = configured;
      for (const [route, body] of ORDER_ROUTES) {
        for (const headers of [{}, withToken(TOKEN), withToken(SHARED), withToken(configured ?? '')]) {
          const res = await post(route, body, headers);
          assert.equal(res.status, 500, route);
          assert.deepEqual(JSON.parse(res.text), { error: 'Internal service authentication not configured' });
        }
      }
    }
    nothingReached('not configured');
  });

  it('AUTH-OP-01: the right token reaches the handlers (internal confirm of a demo payment, dev with the flag)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    const res = await post('/api/payments/internal/confirm', { paymentIntentId: PAY, paymentMethodId: 'pm_card_visa' }, withToken(TOKEN));
    assert.equal(res.status, 200);
    assert.equal(payments[0].status, 'SUCCEEDED');
    assert.ok(!res.text.includes(TOKEN));
  });

  it('comparison is crypto.timingSafeEqual over 32-byte digests, for tokens of any length', async () => {
    const crypto = require('crypto');
    const real = crypto.timingSafeEqual;
    const seen: Array<[number, number]> = [];
    crypto.timingSafeEqual = (a: Buffer, b: Buffer) => { seen.push([a.length, b.length]); return real(a, b); };
    try {
      for (const t of ['x', TOKEN.slice(0, 40), `${TOKEN}${TOKEN}`]) await post('/api/payments/internal/cancel-payos', { orderCode: '1' }, withToken(t));
    } finally {
      crypto.timingSafeEqual = real;
    }
    assert.equal(seen.length, 3);
    assert.ok(seen.every(([a, b]) => a === 32 && b === 32));
  });

  // ============================================================================================== AUTH-OP-04 calling

  it('notifyOrderService sends ORDER_PAYMENT_TOKEN in X-Internal-Service-Token - not the shared or the Payment -> User token', async () => {
    await PaymentService.notifyOrderService(ORDER_ID, 'PAID');
    assert.equal(stubCalls.length, 1);
    assert.equal(stubCalls[0].url, '/api/orders/webhook/payment');
    assert.deepEqual(stubCalls[0].body, { orderId: ORDER_ID, status: 'PAID' });
    assert.equal(stubCalls[0].headers['x-internal-service-token'], TOKEN);
    assert.ok(!Object.values(stubCalls[0].headers).some((v) => v === SHARED || v === USER_TOKEN));
  });

  it('notifyOrderService without a usable ORDER_PAYMENT_TOKEN sends NOTHING and fails like an unreachable order service (no fake success)', async () => {
    for (const configured of [undefined, '', 'short', ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.ORDER_PAYMENT_TOKEN; else process.env.ORDER_PAYMENT_TOKEN = configured;
      await assert.rejects(PaymentService.notifyOrderService(ORDER_ID, 'PAID', 1), /Failed to notify order service/);
    }
    assert.equal(stubCalls.length, 0, 'INTERNAL_SERVICE_TOKEN / PAYMENT_USER_TOKEN are configured but never used instead');
  });

  it('a refusing order service (403) keeps the existing retries (3 attempts) and ends in the existing error; the log has the status, not the token', async () => {
    orderAnswer = 403;
    const before = logs.length;
    await assert.rejects(PaymentService.notifyOrderService(ORDER_ID, 'PAID'), /after 3 attempts/);
    assert.equal(stubCalls.length, 3);
    assert.ok(logs.slice(before).some((l) => /HTTP 403/.test(l)));
  });

  it('confirm with the order service unreachable for want of a token: the payment stays SUCCEEDED with orderSynced=false for the outbox', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    delete process.env.ORDER_PAYMENT_TOKEN;
    const svc = await PaymentService.confirmPayment({ paymentIntentId: PAY, paymentMethodId: 'pm' }, { kind: 'user', userId: USER_A });
    assert.equal(svc.status, 'SUCCEEDED');
    assert.equal(payments[0].orderSynced, false);
    assert.equal(stubCalls.length, 0);
  });

  it('outbox job: sends ORDER_PAYMENT_TOKEN; without a usable one it sends nothing, records no attempt and leaves the payment pending', async () => {
    payments[0].status = 'SUCCEEDED';
    const fakeAxios = { calls: [] as any[], post: async (url: string, body: any, cfg: any) => { fakeAxios.calls.push({ url, body, cfg }); return { data: {} }; } };
    delete process.env.ORDER_PAYMENT_TOKEN;
    const refused = await syncPendingOrders({ axiosInstance: fakeAxios, ignoreConcurrencyLock: true, orderServiceUrl: stubBase });
    assert.deepEqual(refused, { processed: 0, succeeded: 0, failed: 0, skippedBackoff: 0, skippedLocked: 0 });
    for (const injected of ['', 'short', SHARED.slice(0, 10), ...PUBLIC_DEFAULTS]) {
      await syncPendingOrders({ axiosInstance: fakeAxios, ignoreConcurrencyLock: true, internalToken: injected });
    }
    assert.equal(fakeAxios.calls.length, 0);
    assert.equal(writes.length, 0, 'no attempt counted, no lock taken');
    assert.equal(payments[0].orderSynced, false);

    process.env.ORDER_PAYMENT_TOKEN = TOKEN;
    const ok = await syncPendingOrders({ axiosInstance: fakeAxios, ignoreConcurrencyLock: true, orderServiceUrl: stubBase });
    assert.equal(ok.succeeded, 1);
    assert.equal(fakeAxios.calls.length, 1);
    assert.equal(fakeAxios.calls[0].url, `${stubBase}/api/orders/webhook/payment`);
    assert.deepEqual(fakeAxios.calls[0].body, { orderId: ORDER_ID, status: 'PAID' });
    assert.deepEqual(fakeAxios.calls[0].cfg.headers, { 'x-internal-service-token': TOKEN });
    assert.equal(payments[0].orderSynced, true);
  });

  // ============================================================================================== unchanged routes, startup, logs

  it('route table: the four order routes use requireServiceToken(ORDER_PAYMENT_TOKEN); operations routes keep verifyInternalService; webhooks / user routes unchanged', () => {
    const chains: Record<string, string[]> = {};
    for (const l of app._router.stack) if (l.route) chains[`${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`] = l.route.stack.map((s: any) => s.name);
    const internal = Object.keys(chains).filter((k) => k.includes('/api/payments/internal/')).sort();
    assert.deepEqual(internal, [
      'GET /api/payments/internal/payment-status/:paymentId',
      'GET /api/payments/internal/stripe-events/exhausted',
      'POST /api/payments/internal/cancel-payos',
      'POST /api/payments/internal/confirm',
      'POST /api/payments/internal/create-intent',
      'POST /api/payments/internal/create-payos',
      'POST /api/payments/internal/create-refund',
      'POST /api/payments/internal/payment-evidence',   // ADMIN-DASHBOARD-01: read-only, for the sales statistics
      'POST /api/payments/internal/stripe-events/replay',
      'POST /api/payments/internal/sync-pending-orders',
    ], 'a new internal route must be classified here');
    for (const [route] of ORDER_ROUTES) assert.equal(chains[`POST ${route}`][0], 'requireServiceToken(ORDER_PAYMENT_TOKEN)', route);
    for (const k of ['GET /api/payments/internal/payment-status/:paymentId', 'POST /api/payments/internal/create-refund', 'POST /api/payments/internal/payment-evidence']) assert.equal(chains[k][0], 'requireServiceToken(ORDER_PAYMENT_TOKEN)', k);   // FIX 07B-2A.1 / ADMIN-DASHBOARD-01
    for (const k of ['GET /api/payments/internal/stripe-events/exhausted', 'POST /api/payments/internal/stripe-events/replay', 'POST /api/payments/internal/sync-pending-orders']) assert.equal(chains[k][0], 'verifyInternalService', k);
    assert.ok(chains['POST /api/payments/webhook/stripe'].includes('verifyStripeWebhook'));
    assert.ok(!chains['POST /api/payments/webhook/stripe'].some((n) => /ServiceToken|verifyInternalService/.test(n)));
    assert.ok(!chains['POST /api/payments/webhook/payos'].some((n) => /ServiceToken|verifyInternalService/.test(n)));
    assert.equal(chains['POST /api/payments/confirm'][0], 'authenticateToken');
    const tokenRoutes = Object.entries(chains).filter(([, c]) => c.some((n) => n.startsWith('requireServiceToken'))).map(([k]) => k).sort();
    assert.deepEqual(tokenRoutes, [...ORDER_ROUTES.map(([r]) => `POST ${r}`), 'GET /api/payments/internal/payment-status/:paymentId', 'POST /api/payments/internal/create-refund', 'POST /api/payments/internal/payment-evidence'].sort(), 'no other route got the Order <-> Payment credential');
    assert.equal(chains['POST /api/payments/:paymentId/refund'][0], 'authenticateToken', 'the user refund route keeps its JWT');
    assert.equal(chains['GET /api/payments/:paymentId'][0], 'authenticateToken', 'the admin payment route keeps its JWT');
  });

  it('startupConfigProblems: refuses a missing, blank, short, non-ASCII or public-default ORDER_PAYMENT_TOKEN; accepts a long random one', () => {
    for (const v of [undefined, '', '   ', 'short', TOKEN.slice(0, 23), `${TOKEN.slice(0, 20)} ${TOKEN.slice(20)}`, `${TOKEN}é`, ...PUBLIC_DEFAULTS]) {
      assert.equal(startupConfigProblems({ ORDER_PAYMENT_TOKEN: v } as any).length, 1, JSON.stringify(v?.slice?.(0, 8)));
    }
    assert.equal(startupConfigProblems({ INTERNAL_SERVICE_TOKEN: SHARED } as any).length, 1, 'the shared token does not stand in');
    assert.deepEqual(startupConfigProblems({ ORDER_PAYMENT_TOKEN: TOKEN } as any), []);
  });

  it('src/index.ts fails fast without ORDER_PAYMENT_TOKEN (exit 1, never listens) and starts with a valid one', async () => {
    const start = (env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-start-'));            // no .env here, log files stay out of the repo
      const child = spawn(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.resolve(__dirname, '../src/index.ts')], {
        cwd, env: { PATH: process.env.PATH!, SystemRoot: process.env.SystemRoot || '', TS_NODE_PROJECT: path.resolve(__dirname, '../tsconfig.json'), PORT: '0', DATABASE_URL: 'mongodb://127.0.0.1:9/startup_test', NODE_ENV: 'test', ORDER_SERVICE_URL: 'http://127.0.0.1:9', ...env },
      });
      let out = '';
      const done = (code: number | null) => { clearTimeout(timer); resolve({ code, out }); };
      child.stdout.on('data', (d) => { out += d; if (/running on port/.test(out)) { child.kill(); } });
      child.stderr.on('data', (d) => { out += d; });
      child.on('exit', (code) => done(code));
      const timer = setTimeout(() => child.kill(), 60_000);
    });
    const refused = await start({});
    assert.equal(refused.code, 1);
    assert.match(refused.out, /Refusing to start: ORDER_PAYMENT_TOKEN is not configured/);
    assert.ok(!/running on port/.test(refused.out));
    const weak = await start({ ORDER_PAYMENT_TOKEN: PUBLIC_DEFAULTS[0], INTERNAL_SERVICE_TOKEN: SHARED });
    assert.equal(weak.code, 1);
    assert.ok(!weak.out.includes(PUBLIC_DEFAULTS[0]), 'the rejected value is not printed');
    const ok = await start({ ORDER_PAYMENT_TOKEN: TOKEN });
    assert.match(ok.out, /Payment service running on port/);
    assert.ok(!ok.out.includes(TOKEN));
  });

  it('no log line of this file contains a token', () => {
    assert.ok(logs.length > 0);
    for (const line of logs) for (const t of [TOKEN, TOKEN.slice(0, 16), SHARED.slice(0, 16), USER_TOKEN.slice(0, 16), ...PUBLIC_DEFAULTS]) assert.ok(!line.includes(t), line.slice(0, 100));
  });
});
