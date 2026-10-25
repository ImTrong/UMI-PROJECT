/**
 * FIX 07B-2A - order-service side of the Order <-> Payment credential ORDER_PAYMENT_TOKEN.
 *
 *   receiving   POST /api/orders/webhook/payment (called only by the payment-service: notifyOrderService + outbox) accepts ONLY
 *               ORDER_PAYMENT_TOKEN in X-Internal-Service-Token (constant-time, fail-closed)
 *   calling     PaymentClient (create-intent, create-payos, cancel-payos - also from the order-expiry path -, confirm) sends
 *               ORDER_PAYMENT_TOKEN - and nothing at all without a usable one
 *   starting    src/index.ts refuses to start without a usable ORDER_PAYMENT_TOKEN
 *
 * The REAL express app runs on an ephemeral port with an in-memory database stand-in; the payment-service is a loopback stub that
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

const prismaCalls: string[] = [];
const recorder = (model: string) => new Proxy({}, { get: (_t, op) => async () => { prismaCalls.push(`${model}.${String(op)}`); return null; } });
class FakePrismaClient {
  constructor() { return new Proxy({}, { get: (_t, k) => (typeof k === 'string' && !k.startsWith('$') ? recorder(k) : async () => undefined) }); }
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

const TOKEN = randomBytes(32).toString('hex');            // ORDER_PAYMENT_TOKEN
const SHARED = randomBytes(32).toString('hex');           // INTERNAL_SERVICE_TOKEN
const USER_TOKEN = randomBytes(32).toString('hex');       // PAYMENT_USER_TOKEN (belongs to Payment -> User)
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));
const ORDER_ID = 'c3'.repeat(12);
const WEBHOOK = '/api/orders/webhook/payment';

describe('FIX 07B-2A order-service: ORDER_PAYMENT_TOKEN', () => {
  let app: any;
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let PaymentClient: any;
  let startupConfigProblems: any;
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
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: { id: 'p1', status: 'SUCCEEDED', clientSecret: 'cs', paymentId: 'p1', checkoutUrl: 'u', qrCode: 'q', orderCode: 1 } }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, { PAYMENT_SERVICE_URL: stubBase, AUTH_SERVICE_URL: stubBase, LEARNING_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, NODE_ENV: 'test' });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => { if (typeof a === 'string') return a; try { return `${a?.message ?? ''} ${a?.stack ?? ''} ${JSON.stringify(a)}`; } catch { return String(a); } }).join(' '));
        return original(...args);
      };
    }
    PaymentClient = require('../src/services/payment.client').PaymentClient;
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

  beforeEach(() => {
    prismaCalls.length = 0;
    stubCalls.length = 0;
    Object.assign(process.env, { ORDER_PAYMENT_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED, PAYMENT_USER_TOKEN: USER_TOKEN });
  });

  const webhook = async (headers: Record<string, string> = {}, url = WEBHOOK, body: unknown = { orderId: ORDER_ID, status: 'PAID' }) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: res.status, text: await res.text() };
  };
  const withToken = (t: string) => ({ 'x-internal-service-token': t });

  // ============================================================================================== receiving

  it('AUTH-OP-02/03: no token, wrong tokens of any length/case, the public default, INTERNAL_SERVICE_TOKEN, PAYMENT_USER_TOKEN -> 403, order untouched', async () => {
    assert.ok(PUBLIC_DEFAULTS.length > 0);
    assert.equal((await webhook()).status, 403);
    for (const t of [`${TOKEN[0] === 'a' ? 'b' : 'a'}${TOKEN.slice(1)}`, TOKEN.slice(0, -1), `${TOKEN}0`, TOKEN.toUpperCase(), 'x', 'z'.repeat(10_000), '', SHARED, USER_TOKEN, randomBytes(32).toString('hex'), ...PUBLIC_DEFAULTS]) {
      const res = await webhook(withToken(t));
      assert.equal(res.status, 403, `token of length ${t.length}`);
      assert.deepEqual(JSON.parse(res.text), { error: 'Forbidden: Invalid internal service token' });
    }
    for (const [url, body, headers] of [
      [`${WEBHOOK}?token=${TOKEN}`, { orderId: ORDER_ID, status: 'PAID' }, {}],
      [WEBHOOK, { orderId: ORDER_ID, status: 'PAID', token: TOKEN, 'x-internal-service-token': TOKEN }, {}],
      [WEBHOOK, { orderId: ORDER_ID, status: 'PAID' }, { authorization: `Bearer ${TOKEN}` }],
      [`${WEBHOOK}/`, { orderId: ORDER_ID, status: 'PAID' }, {}],
      [WEBHOOK.toUpperCase(), { orderId: ORDER_ID, status: 'PAID' }, {}],
    ] as Array<[string, any, Record<string, string>]>) {
      assert.equal((await webhook(headers, url, body)).status, 403, url);
    }
    assert.deepEqual(prismaCalls, [], 'refused before the controller: the order is not even read');
  });

  it('server without a usable ORDER_PAYMENT_TOKEN: 500 fail-closed for every header, even with INTERNAL_SERVICE_TOKEN set', async () => {
    for (const configured of [undefined, '', 'short-value', ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.ORDER_PAYMENT_TOKEN; else process.env.ORDER_PAYMENT_TOKEN = configured;
      for (const headers of [{}, withToken(TOKEN), withToken(SHARED), withToken(configured ?? '')]) {
        const res = await webhook(headers);
        assert.equal(res.status, 500);
        assert.deepEqual(JSON.parse(res.text), { error: 'Internal service authentication not configured' });
      }
    }
    assert.deepEqual(prismaCalls, []);
  });

  it('AUTH-OP-01: the right token reaches the webhook handler (it reads the order)', async () => {
    const res = await webhook(withToken(TOKEN));
    assert.ok(prismaCalls.includes('order.findUnique'), 'the handler ran');
    assert.notEqual(res.status, 403);
    assert.ok(!res.text.includes(TOKEN));
  });

  it('comparison is crypto.timingSafeEqual over 32-byte digests, for tokens of any length', async () => {
    const crypto = require('crypto');
    const real = crypto.timingSafeEqual;
    const seen: Array<[number, number]> = [];
    crypto.timingSafeEqual = (a: Buffer, b: Buffer) => { seen.push([a.length, b.length]); return real(a, b); };
    try {
      for (const t of ['x', TOKEN.slice(0, 40), `${TOKEN}${TOKEN}`]) await webhook(withToken(t));
    } finally {
      crypto.timingSafeEqual = real;
    }
    assert.equal(seen.length, 3);
    assert.ok(seen.every(([a, b]) => a === 32 && b === 32));
  });

  // ============================================================================================== calling

  const calls = [
    ['createPaymentIntent', '/api/payments/internal/create-intent', () => PaymentClient.createPaymentIntent({ orderId: ORDER_ID, orderNumber: 'ORD-1', userId: 'u', amount: 1, currency: 'vnd', description: 'd' })],
    ['createPayosPayment', '/api/payments/internal/create-payos', () => PaymentClient.createPayosPayment({ orderId: ORDER_ID, orderNumber: 'ORD-1', orderCode: 1, userId: 'u', amount: 1, description: 'd', items: [] })],
    ['cancelPayosPayment', '/api/payments/internal/cancel-payos', () => PaymentClient.cancelPayosPayment(7000000001, 'expired')],
    ['confirmPayment', '/api/payments/internal/confirm', () => PaymentClient.confirmPayment('p1', 'pm')],
  ] as const;

  it('AUTH-OP-04: every PaymentClient call to /api/payments/internal/* sends ORDER_PAYMENT_TOKEN - never the shared or Payment -> User token', async () => {
    for (const [name, url, call] of calls) {
      stubCalls.length = 0;
      await call();
      assert.equal(stubCalls.length, 1, name);
      assert.equal(stubCalls[0].url, url, name);
      assert.equal(stubCalls[0].headers['x-internal-service-token'], TOKEN, name);
      assert.ok(!Object.values(stubCalls[0].headers).some((v) => v === SHARED || v === USER_TOKEN), name);
    }
  });

  it('without a usable ORDER_PAYMENT_TOKEN nothing is sent; each call fails as it always did (no fake success), the shared token is not used', async () => {
    for (const configured of [undefined, '', 'short', ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.ORDER_PAYMENT_TOKEN; else process.env.ORDER_PAYMENT_TOKEN = configured;
      await assert.rejects(calls[0][2](), /Payment service unavailable/);
      await assert.rejects(calls[1][2](), /PayOS payment service unavailable/);
      assert.equal(await calls[2][2](), null, 'cancel keeps its "best effort" answer');
      await assert.rejects(calls[3][2](), /Payment confirmation failed/);
    }
    assert.equal(stubCalls.length, 0);
  });

  it('route table: the webhook is the only route with the Order <-> Payment credential, and it runs first', () => {
    const chains: Record<string, string[]> = {};
    for (const l of app._router.stack) if (l.route) chains[`${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`] = l.route.stack.map((s: any) => s.name);
    assert.deepEqual(chains[`POST ${WEBHOOK}`], ['requireServiceToken(ORDER_PAYMENT_TOKEN)', 'handlePaymentWebhook']);
    // the Order <-> Payment credential guards the webhook and nothing else
    assert.deepEqual(Object.entries(chains).filter(([, c]) => c.some((n) => /ORDER_PAYMENT_TOKEN/.test(n))).map(([k]) => k), [`POST ${WEBHOOK}`]);
    // every service-authenticated route, each with its OWN credential first (FIX-INS-04 added the learning-service's entitlement check)
    assert.deepEqual(
      Object.entries(chains).filter(([, c]) => c.some((n) => /ServiceToken|verifyInternalService/.test(n))).map(([k, c]) => [k, c[0]]),
      [[`POST ${WEBHOOK}`, 'requireServiceToken(ORDER_PAYMENT_TOKEN)'], ['GET /api/orders/internal/:orderId/entitlement', 'requireServiceToken(ORDER_LEARNING_TOKEN)']],
    );
  });

  it('startupConfigProblems: refuses a missing, short or public-default ORDER_PAYMENT_TOKEN (the shared token does not stand in); accepts a long random one', () => {
    for (const v of [undefined, '', '   ', 'short', TOKEN.slice(0, 23), ...PUBLIC_DEFAULTS]) assert.equal(startupConfigProblems({ ORDER_PAYMENT_TOKEN: v } as any).length, 1);
    assert.equal(startupConfigProblems({ INTERNAL_SERVICE_TOKEN: SHARED } as any).length, 1);
    assert.deepEqual(startupConfigProblems({ ORDER_PAYMENT_TOKEN: TOKEN } as any), []);
  });

  it('src/index.ts fails fast without ORDER_PAYMENT_TOKEN (exit 1, never listens) and starts with a valid one', async () => {
    const start = (env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'order-start-'));
      const child = spawn(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.resolve(__dirname, '../src/index.ts')], {
        cwd, env: { PATH: process.env.PATH!, SystemRoot: process.env.SystemRoot || '', TS_NODE_PROJECT: path.resolve(__dirname, '../tsconfig.json'), PORT: '0', DATABASE_URL: 'mongodb://127.0.0.1:9/startup_test', NODE_ENV: 'test', ...env },
      });
      let out = '';
      const timer = setTimeout(() => child.kill(), 60_000);
      child.stdout.on('data', (d) => { out += d; if (/running on port/.test(out)) child.kill(); });
      child.stderr.on('data', (d) => { out += d; });
      child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
    const refused = await start({ INTERNAL_SERVICE_TOKEN: SHARED });
    assert.equal(refused.code, 1);
    assert.match(refused.out, /Refusing to start: ORDER_PAYMENT_TOKEN is not configured/);
    assert.ok(!/running on port/.test(refused.out));
    const ok = await start({ ORDER_PAYMENT_TOKEN: TOKEN });
    assert.match(ok.out, /Order service running on port/);
    assert.ok(!ok.out.includes(TOKEN));
  });

  it('no log line of this file contains a token', () => {
    assert.ok(logs.length > 0);
    for (const line of logs) for (const t of [TOKEN.slice(0, 16), SHARED.slice(0, 16), USER_TOKEN.slice(0, 16), ...PUBLIC_DEFAULTS]) assert.ok(!line.includes(t), line.slice(0, 100));
  });
});
