/**
 * IMPLEMENT-01: becoming an instructor is free and reviewed by an ADMIN (user-service), so the payment-service creates no new
 * INSTRUCTOR_REGISTRATION payment - through the user routes (/intents, /create-intent) nor the internal one. A refused request
 * writes nothing and never reaches the payment provider. Course purchases (the default type) are unchanged.
 *
 * The REAL express app runs on an ephemeral port with an in-memory Prisma stand-in and a loopback stub for auth / order / user.
 * STRIPE_SECRET_KEY is unset, so an accepted intent uses the existing Mock / Sandbox branch - no provider is contacted.
 *
 * Run: node -r ts-node/register/transpile-only --test test/instructor-registration-disabled.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, any>;
const payments: Row[] = [];
const writes: string[] = [];
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && 'in' in (v as any)) return (v as any).in.includes(row[k]);
  return row[k] === v;
});
const paymentModel = {
  findFirst: async ({ where }: any = {}) => { const r = payments.filter((p) => matches(p, where)).pop(); return r ? { ...r } : null; },
  findUnique: async ({ where }: any = {}) => { const r = payments.find((p) => matches(p, where)); return r ? { ...r } : null; },
  create: async ({ data }: any) => { writes.push(`payment.create:${data.type}`); const row = { id: randomBytes(12).toString('hex'), ...data }; payments.push(row); return { ...row }; },
  update: async ({ where, data }: any) => { writes.push('payment.update'); const r = payments.find((p) => matches(p, where)); Object.assign(r!, data); return { ...r }; },
};
const noopModel = new Proxy({}, { get: () => async () => { writes.push('other'); return null; } });
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
const ORDER_PAYMENT_TOKEN = randomBytes(32).toString('hex');

describe('IMPLEMENT-01 payment-service: no new instructor registration fee', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let providerCalls = 0;
  const savedEnv = { ...process.env };

  before(async () => {
    stub = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/auth/verify-token') return res.end(JSON.stringify({ valid: true, user: { userId: USER, email: 'buyer@test.local' } }));
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, { AUTH_SERVICE_URL: stubBase, ORDER_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, ORDER_PAYMENT_TOKEN, RATE_LIMIT_MAX_REQUESTS: '100000' });
    process.env.INTERNAL_SERVICE_TOKEN = randomBytes(32).toString('hex');
    delete process.env.STRIPE_SECRET_KEY;
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const { StripeService } = require('../src/services/stripe.service');
    const original = StripeService.createPaymentIntent;
    StripeService.createPaymentIntent = async (...args: any[]) => { providerCalls++; return original.apply(StripeService, args); };
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
    process.env = savedEnv;
  });

  beforeEach(() => { payments.length = 0; writes.length = 0; providerCalls = 0; });

  const post = async (url: string, payload: unknown, headers: Record<string, string>) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  const user = { authorization: 'Bearer buyer-session' };
  const internal = { 'x-internal-service-token': ORDER_PAYMENT_TOKEN };

  it('INSTRUCTOR_REGISTRATION (or any type but COURSE_PURCHASE) is refused with 400 on every create route; nothing written, no provider call', async () => {
    for (const type of ['INSTRUCTOR_REGISTRATION', 'instructor_registration', 'SOMETHING_ELSE']) {
      for (const [url, headers, extra] of [
        ['/api/payments/intents', user, {}],
        ['/api/payments/create-intent', user, {}],
        ['/api/payments/internal/create-intent', internal, { userId: USER }],
      ] as const) {
        const r = await post(url, { amount: 500000, currency: 'vnd', type, ...extra }, headers);
        assert.equal(r.status, 400, `${type} ${url}`);
        assert.deepEqual(r.json, { error: 'Unsupported payment type' });
      }
    }
    assert.deepEqual(writes, []);
    assert.equal(providerCalls, 0);
  });

  it('course purchases are unchanged: the default type (and an explicit COURSE_PURCHASE) still create the intent', async () => {
    const r1 = await post('/api/payments/intents', { orderId: ORDER, orderNumber: 'ORD-1', amount: 500000, currency: 'vnd' }, user);
    assert.equal(r1.status, 201, JSON.stringify(r1.json));
    payments.length = 0;
    const r2 = await post('/api/payments/internal/create-intent', { orderId: ORDER, orderNumber: 'ORD-2', userId: USER, amount: 500000, currency: 'vnd', type: 'COURSE_PURCHASE' }, internal);
    assert.equal(r2.status, 201, JSON.stringify(r2.json));
    assert.ok(writes.includes('payment.create:COURSE_PURCHASE'));
  });
});
