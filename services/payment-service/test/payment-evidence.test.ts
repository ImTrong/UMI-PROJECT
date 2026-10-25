/**
 * ADMIN-DASHBOARD-01 payment-service side: POST /api/payments/internal/payment-evidence (the order-service's sales statistics).
 *
 *   access     ORDER_PAYMENT_TOKEN only (never INTERNAL_SERVICE_TOKEN, a user token or the public default); fail-closed
 *   input      1..200 distinct 24-hex order ids, anything else is refused (400) before the database is read
 *   answer     the stored COURSE_PURCHASE payments of those orders - status exactly as stored, amounts - and nothing else: no client
 *              secret, no provider ids; read-only
 *
 * The REAL express app runs on an ephemeral port with an in-memory database stand-in.
 *
 * Run: node -r ts-node/register/transpile-only --test test/payment-evidence.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, any>;
const payments: Row[] = [];
const queries: any[] = [];
const writes: string[] = [];
const paymentModel = {
  findMany: async (args: any = {}) => {
    queries.push(args);
    const ids: string[] = args.where?.orderId?.in ?? [];
    return payments.filter((p) => ids.includes(p.orderId) && (!args.where?.type || p.type === args.where.type)).map((p) => structuredClone(p));
  },
  create: async () => { writes.push('create'); return null; },
  update: async () => { writes.push('update'); return null; },
  updateMany: async () => { writes.push('updateMany'); return { count: 0 }; },
  delete: async () => { writes.push('delete'); return null; },
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

const TOKEN = randomBytes(32).toString('hex');
const SHARED = randomBytes(32).toString('hex');
const USER_TOKEN = randomBytes(32).toString('hex');
const id = (c: string) => c.repeat(12);
const [O1, O2, O3] = [id('01'), id('02'), id('03')];
const ROUTE = '/api/payments/internal/payment-evidence';

describe('ADMIN-DASHBOARD-01 payment-service: payment-evidence', () => {
  let server: http.Server;
  let base = '';
  const savedEnv = { ...process.env };

  before(async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env.STRIPE_SECRET_KEY;
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  });

  beforeEach(() => {
    queries.length = 0;
    writes.length = 0;
    Object.assign(process.env, { ORDER_PAYMENT_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED, PAYMENT_USER_TOKEN: USER_TOKEN });
    payments.length = 0;
    payments.push(
      { id: id('a1'), orderId: O1, userId: id('e1'), amount: 800000, currency: 'vnd', status: 'SUCCEEDED', type: 'COURSE_PURCHASE', provider: 'payos', refundedTotal: 0, clientSecret: 'pi_secret_do_not_leak', stripePaymentIntentId: 'pi_do_not_leak', payosCheckoutUrl: 'https://pay.example/do-not-leak', completedAt: '2026-01-02T00:00:00.000Z' },
      { id: id('a2'), orderId: O1, userId: id('e1'), amount: 800000, currency: 'vnd', status: 'FAILED', type: 'COURSE_PURCHASE', provider: 'stripe', refundedTotal: 0 },
      { id: id('a3'), orderId: O2, userId: id('e2'), amount: 400000, currency: 'vnd', status: 'PARTIALLY_REFUNDED', type: 'COURSE_PURCHASE', provider: 'stripe', refundedTotal: 100000 },
      { id: id('a4'), orderId: O3, userId: id('e3'), amount: 50000, currency: 'vnd', status: 'SUCCEEDED', type: 'INSTRUCTOR_REGISTRATION', provider: 'stripe', refundedTotal: 0 },
    );
  });

  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const withToken = (t: string) => ({ 'x-internal-service-token': t });

  it('403 for no token, a wrong token, INTERNAL_SERVICE_TOKEN and a user token - the database is not read', async () => {
    for (const headers of [{}, withToken('x'), withToken(SHARED), withToken(USER_TOKEN), withToken(`${TOKEN}0`), { authorization: `Bearer ${TOKEN}` }]) {
      assert.equal((await post({ orderIds: [O1] }, headers)).status, 403);
    }
    assert.equal(queries.length, 0);
  });

  it('refuses a body that is not 1..200 distinct 24-hex order ids (400, nothing read)', async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(24, '0'));
    for (const body of [undefined, {}, { orderIds: [] }, { orderIds: 'abc' }, { orderIds: [O1, 'not-an-id'] }, { orderIds: [{ $ne: null }] }, { orderIds: tooMany }, { orderIds: [O1, 5] }]) {
      const r = await post(body, withToken(TOKEN));
      assert.equal(r.status, 400, JSON.stringify(body)?.slice(0, 60));
    }
    assert.equal(queries.length, 0);
  });

  it('answers the stored course-purchase payments of the asked orders, status as stored, and nothing a client could misuse', async () => {
    const r = await post({ orderIds: [O1, O2, O3, id('04')] }, withToken(TOKEN));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.map((p: any) => [p.id, p.orderId, p.status, p.amount, p.refundedTotal]), [
      [id('a1'), O1, 'SUCCEEDED', 800000, 0],
      [id('a2'), O1, 'FAILED', 800000, 0],
      [id('a3'), O2, 'PARTIALLY_REFUNDED', 400000, 100000],       // O3 only has a registration payment: not a course purchase
    ]);
    assert.ok(!/do-not-leak|secret|userId/i.test(r.text), 'no client secret, provider id, checkout link or user id');
    assert.equal(queries[0].where.type, 'COURSE_PURCHASE');
    assert.deepEqual(writes, []);
  });

  it('duplicates in the list are asked once; an order with no payment simply has no row', async () => {
    const r = await post({ orderIds: [O1, O1.toUpperCase(), id('09')] }, withToken(TOKEN));
    assert.equal(r.status, 200);
    assert.deepEqual(queries[0].where.orderId.in, [O1, id('09')]);
    assert.equal(r.json.data.filter((p: any) => p.orderId === id('09')).length, 0);
  });

  it('no usable ORDER_PAYMENT_TOKEN on this side: every call is refused with 500 (fail-closed, like every service-token route)', async () => {
    delete process.env.ORDER_PAYMENT_TOKEN;
    assert.equal((await post({ orderIds: [O1] }, withToken(TOKEN))).status, 500);
    assert.equal(queries.length, 0);
  });
});
