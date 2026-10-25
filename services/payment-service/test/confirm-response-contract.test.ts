/**
 * FIX 07B-1.3 - the payment-service side of the confirmation response contract. The frontend reads the answers listed in
 * frontend/tests/fixtures/payment-confirmation-contract.json; this test produces each of them with the REAL app (real routing,
 * middleware, controllers and PaymentService; in-memory database stand-in, loopback stub for auth / order / user, scripted Stripe)
 * and checks that every key / value of the fixture is present in the real answer. If an answer changes shape, this fails.
 *
 * Run: node -r ts-node/register/transpile-only --test test/confirm-response-contract.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, any>;
const payments: Row[] = [];
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
const paymentModel = {
  findFirst: async ({ where }: any = {}) => { const r = payments.filter((p) => matches(p, where)).pop(); return r ? structuredClone(r) : null; },
  findUnique: async ({ where }: any = {}) => { const r = payments.find((p) => matches(p, where)); return r ? structuredClone(r) : null; },
  update: async ({ where, data }: any) => { const row = payments.find((p) => matches(p, where))!; Object.assign(row, structuredClone(data)); return structuredClone(row); },
  updateMany: async ({ where, data }: any) => { const rows = payments.filter((p) => matches(p, where)); rows.forEach((r) => Object.assign(r, structuredClone(data))); return { count: rows.length }; },
};
const noopModel = new Proxy({}, { get: () => async () => null });
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

const contract = JSON.parse(readFileSync(path.resolve(__dirname, '../../../frontend/tests/fixtures/payment-confirmation-contract.json'), 'utf8'));
const USER_A = 'a1'.repeat(12);
const USER_B = 'b2'.repeat(12);
const PAY = 'd4'.repeat(12);            // the id used in the fixture
const ORDER = 'c3'.repeat(12);
const SESSIONS: Record<string, any> = { 'session-a': { userId: USER_A, email: 'a@test.local' }, 'session-b': { userId: USER_B, email: 'b@test.local' } };

/** every key / value of `expected` is present in `actual` (recursively) */
function assertContains(actual: any, expected: any, where: string) {
  if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null && typeof actual === 'object', `${where}: expected an object, got ${JSON.stringify(actual)}`);
    for (const [k, v] of Object.entries(expected)) assertContains(actual[k], v, `${where}.${k}`);
  } else {
    assert.deepEqual(actual, expected, where);
  }
}

describe('FIX 07B-1.3: the payment-service answers exactly what the frontend contract fixture says', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let StripeService: any;
  let stripeScript: (id: string) => Promise<any> = async (id) => ({ id, status: 'succeeded' });
  const savedEnv = { ...process.env };

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
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, { AUTH_SERVICE_URL: stubBase, ORDER_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'), ORDER_PAYMENT_TOKEN: randomBytes(32).toString('hex'), PAYMENT_USER_TOKEN: randomBytes(32).toString('hex') });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    StripeService = require('../src/services/stripe.service').StripeService;
    StripeService.getPaymentIntent = async (id: string) => stripeScript(id);
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

  const seed = (over: Row = {}) => {
    payments.length = 0;
    payments.push({ id: PAY, orderId: ORDER, userId: USER_A, amount: 199000, currency: 'vnd', status: 'PENDING', type: 'COURSE_PURCHASE', provider: 'stripe', stripePaymentIntentId: 'pi_3Contract', metadata: {}, orderSynced: false, ...over });
  };
  beforeEach(() => {
    seed();
    stripeScript = async (id) => ({ id, status: 'succeeded' });
    process.env.NODE_ENV = 'production';
    delete process.env.PAYMENT_MOCK_ENABLED;
    process.env.STRIPE_SECRET_KEY = `sk_test_${randomBytes(12).toString('hex')}`;
  });

  const post = async (url: string, body: unknown, session = 'session-a') => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify(body) });
    return { http: res.status, body: await res.json().catch(() => null) };
  };
  const confirm = (session = 'session-a') => post('/api/payments/confirm', { paymentIntentId: PAY, paymentMethodId: 'pm_card_visa' }, session);
  const check = (actual: { http: number; body: any }, expected: { http: number; body: any }, name: string) => {
    assert.equal(actual.http, expected.http, `${name}: HTTP status`);
    assertContains(actual.body, expected.body, name);
  };

  it('confirm: succeeded / pending / failed / cancelled are all HTTP 200 { message, data: Payment } - only data.status differs', async () => {
    for (const [key, stripeStatus] of [['succeeded', 'succeeded'], ['pending', 'processing'], ['failed', 'requires_payment_method'], ['cancelled', 'canceled']]) {
      seed();
      stripeScript = async (id) => ({ id, status: stripeStatus });
      check(await confirm(), contract.confirm[key], `confirm.${key}`);
    }
  });

  it('confirm: provider mismatch 409, not the owner 404, demo blocked 403, provider error 500', async () => {
    seed({ provider: 'payos', payosOrderCode: '7000000001', stripePaymentIntentId: null });
    check(await confirm(), contract.confirm.providerMismatch, 'confirm.providerMismatch');
    seed();
    check(await confirm('session-b'), contract.confirm.notOwner, 'confirm.notOwner');
    seed({ stripePaymentIntentId: 'pi_mock_contract', metadata: { isMock: true } });
    check(await confirm(), contract.confirm.mockBlocked, 'confirm.mockBlocked');
    seed();
    stripeScript = async () => { throw new Error('connect ETIMEDOUT'); };
    check(await confirm(), contract.confirm.providerError, 'confirm.providerError');
  });

  it('mock-complete: { success, message, payment } (no `data` envelope); already completed; 404 when disabled', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    seed({ stripePaymentIntentId: 'pi_mock_contract', metadata: { isMock: true } });
    const first = await post('/api/payments/mock-complete', { orderId: ORDER });
    check(first, contract.mockComplete.succeeded, 'mockComplete.succeeded');
    assert.equal(first.body.data, undefined, 'not wrapped in data');
    check(await post('/api/payments/mock-complete', { orderId: ORDER }), contract.mockComplete.alreadyCompleted, 'mockComplete.alreadyCompleted');
    process.env.PAYMENT_MOCK_ENABLED = 'false';
    check(await post('/api/payments/mock-complete', { orderId: ORDER }), contract.mockComplete.disabled, 'mockComplete.disabled');
  });
});
