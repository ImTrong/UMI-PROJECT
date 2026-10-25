/**
 * SCOPE-RESET-01: POST /api/payments/:paymentId/refund is ADMIN only. A learner refunding their own payment kept the course (the
 * refund never revokes it), so the owner - or any non-admin, also with a role forged in the token answer - is refused before the
 * refund process runs: no refund row, no payment change. The ADMIN path and the order-service's internal refund route
 * (ORDER_PAYMENT_TOKEN) work as before.
 *
 * The REAL express app runs on an ephemeral port with an in-memory Prisma stand-in; auth- and user-service are one loopback stub
 * (the user-service is the source of the role, as for every requireRole route). The payment is a PayOS one, so an accepted refund
 * takes the existing manual path (PENDING, admin confirmation) and no provider is contacted.
 *
 * Run: node -r ts-node/register/transpile-only --test test/refund-admin-only.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, any>;
let payments: Row[] = [];
let refunds: Row[] = [];
const writes: string[] = [];
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && 'in' in (v as any)) return (v as any).in.includes(row[k]);
  return row[k] === v;
});
const paymentModel = {
  findUnique: async ({ where }: any) => { const r = payments.find((p) => matches(p, where)); return r ? { ...r } : null; },
  findFirst: async ({ where }: any = {}) => { const r = payments.find((p) => matches(p, where)); return r ? { ...r } : null; },
  update: async ({ where, data }: any) => {
    writes.push('payment.update');
    const r = payments.find((p) => matches(p, where))!;
    for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'increment' in (v as any) ? (r[k] || 0) + (v as any).increment : v;
    return { ...r };
  },
};
const refundModel = {
  findUnique: async ({ where }: any) => { const r = refunds.find((x) => matches(x, where)); return r ? { ...r } : null; },
  findMany: async ({ where }: any = {}) => refunds.filter((x) => matches(x, where)).map((x) => ({ ...x })),
  create: async ({ data }: any) => { writes.push('refund.create'); const r = { id: randomBytes(12).toString('hex'), createdAt: new Date(), ...data }; refunds.push(r); return { ...r }; },
  updateMany: async () => { writes.push('refund.updateMany'); return { count: 0 }; },
};
const noopModel = new Proxy({}, { get: () => async () => null });
class FakePrismaClient {
  payment = paymentModel;
  refund = refundModel;
  constructor() {
    const self = this;
    return new Proxy(this, {
      get: (t: any, k) => {
        if (k === '$transaction') return async (fn: any) => fn(self);
        return k in t ? t[k] : typeof k === 'string' && !k.startsWith('$') ? noopModel : async () => undefined;
      },
    });
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

const id = (c: string) => c.repeat(12);
const USERS: Record<string, { userId: string; role: string; tokenRole?: string }> = {
  OWNER: { userId: id('a1'), role: 'STUDENT' },
  OTHER: { userId: id('a2'), role: 'STUDENT' },
  INSTRUCTOR: { userId: id('b1'), role: 'INSTRUCTOR' },
  FORGED: { userId: id('a1'), role: 'STUDENT', tokenRole: 'ADMIN' },   // the owner whose token answer claims ADMIN
  ADMIN: { userId: id('c1'), role: 'ADMIN' },
};
const PAY = id('d1');
const ORDER = id('e1');
const ORDER_PAYMENT_TOKEN = randomBytes(32).toString('hex');

describe('SCOPE-RESET-01: refunds are started by an ADMIN only', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  const savedEnv = { ...process.env };

  before(async () => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/auth/verify-token') {
          const token = (() => { try { return JSON.parse(raw).token; } catch { return ''; } })();
          const u = USERS[token];
          return res.end(JSON.stringify(u ? { valid: true, user: { userId: u.userId, email: `${token}@test.local`, ...(u.tokenRole ? { role: u.tokenRole } : {}) } } : { valid: false }));
        }
        const user = (req.url || '').match(/^\/api\/users\/([0-9a-f]{24})$/);
        if (user) return res.end(JSON.stringify({ data: { role: Object.values(USERS).find((u) => u.userId === user[1])?.role || 'STUDENT' } }));
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, { AUTH_SERVICE_URL: stubBase, ORDER_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, ORDER_PAYMENT_TOKEN, RATE_LIMIT_MAX_REQUESTS: '100000' });
    process.env.INTERNAL_SERVICE_TOKEN = randomBytes(32).toString('hex');
    delete process.env.STRIPE_SECRET_KEY;
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
    process.env = savedEnv;
  });

  beforeEach(() => {
    writes.length = 0;
    refunds = [];
    payments = [{
      id: PAY, orderId: ORDER, orderNumber: 'ORD-1', userId: USERS.OWNER.userId, amount: 500000, currency: 'vnd', status: 'SUCCEEDED',
      type: 'COURSE_PURCHASE', provider: 'payos', payosOrderCode: '123456', stripePaymentIntentId: null, refundedTotal: 0, pendingRefundTotal: 0,
      refundVersion: 0, metadata: {},
    }];
  });

  const post = async (url: string, payload: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  const as = (t: string) => ({ authorization: `Bearer ${t}` });
  const REFUND = `/api/payments/${PAY}/refund`;

  it('the payment owner (learner) cannot refund their own payment: 403, no refund row, payment unchanged', async () => {
    const r = await post(REFUND, { amount: 500000, reason: 'I want my money back' }, as('OWNER'));
    assert.equal(r.status, 403);
    assert.deepEqual(writes, []);
    assert.equal(refunds.length, 0);
    assert.equal(payments[0].status, 'SUCCEEDED');
  });

  it('nobody but an ADMIN: another learner, an instructor, a token claiming ADMIN, no token', async () => {
    for (const t of ['OTHER', 'INSTRUCTOR', 'FORGED']) assert.equal((await post(REFUND, { amount: 1000 }, as(t))).status, 403, t);
    assert.equal((await post(REFUND, { amount: 1000 })).status, 401);
    assert.equal((await post(REFUND, { amount: 1000, role: 'ADMIN', isAdmin: true }, { ...as('OWNER'), 'x-user-role': 'ADMIN' })).status, 403, 'role in body / header');
    assert.deepEqual(writes, []);
  });

  it('an INSTRUCTOR (who also buys courses) cannot refund their OWN payment either', async () => {
    payments.push({ ...payments[0], id: id('d2'), orderId: id('e2'), userId: USERS.INSTRUCTOR.userId });
    const r = await post(`/api/payments/${id('d2')}/refund`, { amount: 500000 }, as('INSTRUCTOR'));
    assert.equal(r.status, 403);
    assert.deepEqual(writes, []);
  });

  it('an ADMIN still refunds through the existing process (PayOS -> manual PENDING refund)', async () => {
    const r = await post(REFUND, { amount: 200000, reason: 'Admin decision' }, as('ADMIN'));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.status, 'PENDING');
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].amount, 200000);
    assert.equal(payments[0].pendingRefundTotal, 200000);
  });

  it('the order-service internal refund route (ORDER_PAYMENT_TOKEN) is unchanged', async () => {
    const r = await post('/api/payments/internal/create-refund', { paymentId: PAY, orderId: ORDER, amount: 100000, idempotencyKey: 'order-refund-key-001', reason: 'duplicate' }, { 'x-internal-service-token': ORDER_PAYMENT_TOKEN });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.data.outcome, 'PENDING');
    assert.equal(refunds.length, 1);
  });

  it('route table: requireRole runs right after authenticateToken on the refund route', () => {
    const app = require('../src/app').default;
    const layer = app._router.stack.find((l: any) => l.route && l.route.path === '/api/payments/:paymentId/refund' && l.route.methods.post);
    const names = layer.route.stack.map((s: any) => s.name);
    assert.equal(names[0], 'authenticateToken');
    assert.ok(String(layer.route.stack[1].handle).includes('roles.includes'), 'requireRole before validation and controller');
  });
});
