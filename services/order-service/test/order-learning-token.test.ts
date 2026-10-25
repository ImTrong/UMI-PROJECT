/**
 * FIX-INS-04 - order-service side of the Order <-> Learning credential ORDER_LEARNING_TOKEN and of the payment proof.
 *
 *   calling      every paid-course enrollment (payment webhook, admin completion) goes through LearningEnrollmentClient: POST
 *                /api/learning/internal/courses/:courseId/enroll with { userId, orderId } and ORDER_LEARNING_TOKEN - and nothing at
 *                all without a usable value (no fallback to INTERNAL_SERVICE_TOKEN, a default or "")
 *   receiving    GET /api/orders/internal/:orderId/entitlement (the learning-service's payment check) accepts only ORDER_LEARNING_TOKEN,
 *                answers from this service's records and never writes
 *   ordering     the webhook stores paymentStatus PAID BEFORE asking for the enrollments (the learning-service checks that record),
 *                increments enrolledCount only for an enrollment written now (201), and a retried webhook grants nothing twice
 *
 * The REAL express app runs on an ephemeral port with a small in-memory database stand-in (orders + order items; every other model
 * answers null). The learning- and course-services are one loopback stub; on an enrollment request it reads the order AS STORED AT
 * THAT MOMENT, like the real learning-service's callback would. Every token is random per run.
 *
 * Run: node -r ts-node/register/transpile-only --test test/order-learning-token.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ---------------------------------------------------------------- in-memory database (orders + order items)
type Row = Record<string, any>;
let orders: Row[] = [];
let items: Row[] = [];
const writes: Array<{ model: string; op: string; where?: any; data?: any }> = [];
const inert = () => new Proxy({}, { get: () => async () => null });
class FakePrismaClient {
  order = {
    findUnique: async ({ where, include }: any) => {
      const o = orders.find((x) => x.id === where.id);
      if (!o) return null;
      return include?.orderItems ? { ...o, orderItems: items.filter((i) => i.orderId === o.id).map((i) => ({ ...i })) } : { ...o };
    },
    update: async ({ where, data }: any) => {
      const o = orders.find((x) => x.id === where.id);
      writes.push({ model: 'order', op: 'update', where, data: { ...data } });
      Object.assign(o!, data);
      return { ...o };
    },
  };
  orderItem = {
    findFirst: async () => null, // nothing purchased before (checkAlreadyPurchased)
    update: async ({ where, data }: any) => {
      const i = items.find((x) => x.id === where.id);
      writes.push({ model: 'orderItem', op: 'update', where, data: { ...data } });
      Object.assign(i!, data);
      return { ...i };
    },
  };
  cart = inert();
  constructor() {
    return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : typeof k === 'string' && !k.startsWith('$') ? inert() : async () => undefined) });
  }
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

const TOKEN = randomBytes(32).toString('hex');           // ORDER_LEARNING_TOKEN
const SHARED = randomBytes(32).toString('hex');          // INTERNAL_SERVICE_TOKEN - never sent / accepted here
const ORDER_PAYMENT = randomBytes(32).toString('hex');   // ORDER_PAYMENT_TOKEN (webhook)
const ORDER_COURSE = randomBytes(32).toString('hex');    // ORDER_COURSE_TOKEN (increment)
const id = (c: string) => c.repeat(12);
const ALICE = id('a1');
const BOB = id('a2');
const C1 = id('b1');
const C2 = id('b2');
const ORDER = id('c1');
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));

const seed = (over: Row = {}) => {
  orders = [{ id: ORDER, orderNumber: 'ORD-1', userId: ALICE, items: [], subtotal: 300000, totalPrice: 300000, status: 'PENDING', paymentStatus: 'UNPAID', notes: '', refundableAmount: 0, ...over }];
  items = [
    { id: id('d1'), orderId: ORDER, courseId: C1, courseTitle: 'C1', price: 150000, finalPrice: 150000, status: 'PENDING' },
    { id: id('d2'), orderId: ORDER, courseId: C2, courseTitle: 'C2', price: 150000, finalPrice: 150000, status: 'PENDING' },
  ];
};

describe('FIX-INS-04 order-service: ORDER_LEARNING_TOKEN and the payment proof for enrollments', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let LearningEnrollmentClient: any;
  const logs: string[] = [];
  const enrollCalls: Array<{ courseId: string; body: any; token: unknown; paymentStatusAtCall: string | undefined }> = [];
  const incrementCalls: string[] = [];
  let learningAnswer: 'created' | 'existing' | 'refuse' | 'down' = 'created';

  before(async () => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const enroll = (req.url || '').match(/^\/api\/learning\/internal\/courses\/([0-9a-f]{24})\/enroll$/);
        if (enroll) {
          let body: any = null;
          try { body = JSON.parse(raw); } catch { /* not JSON */ }
          const stored = orders.find((o) => o.id === body?.orderId);
          enrollCalls.push({ courseId: enroll[1], body, token: req.headers['x-internal-service-token'], paymentStatusAtCall: stored?.paymentStatus });
          if (req.headers['x-internal-service-token'] !== TOKEN) { res.statusCode = 403; return res.end('{}'); }
          if (learningAnswer === 'down') { res.statusCode = 503; return res.end('{}'); }
          // like the real learning-service: grant only when the order record says PAID at this moment
          if (learningAnswer === 'refuse' || stored?.paymentStatus !== 'PAID') { res.statusCode = 403; return res.end(JSON.stringify({ code: 'NOT_ENTITLED' })); }
          res.statusCode = learningAnswer === 'created' ? 201 : 200;
          return res.end(JSON.stringify({ data: { userId: body.userId, courseId: enroll[1] } }));
        }
        const inc = (req.url || '').match(/^\/api\/courses\/([0-9a-f]{24})\/increment-enrollment$/);
        if (inc) { incrementCalls.push(inc[1]); return res.end(JSON.stringify({ message: 'Enrollment incremented' })); }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, {
      LEARNING_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, AUTH_SERVICE_URL: stubBase, PAYMENT_SERVICE_URL: stubBase,
      ORDER_LEARNING_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED, ORDER_PAYMENT_TOKEN: ORDER_PAYMENT, ORDER_COURSE_TOKEN: ORDER_COURSE,
      RATE_LIMIT_MAX_REQUESTS: '100000', NODE_ENV: 'test',
    });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack} ${JSON.stringify((a as any).config || {})}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        return original(...args);
      };
    }
    ({ LearningEnrollmentClient } = require('../src/services/learning.client'));
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
  });

  beforeEach(() => {
    seed();
    writes.length = 0;
    logs.length = 0;
    enrollCalls.length = 0;
    incrementCalls.length = 0;
    learningAnswer = 'created';
    process.env.ORDER_LEARNING_TOKEN = TOKEN;
  });

  const webhook = async (status: string, orderId = ORDER) => {
    const res = await fetch(`${base}/api/orders/webhook/payment`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-service-token': ORDER_PAYMENT }, body: JSON.stringify({ orderId, status }),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const entitlement = async (headers: Record<string, string>, orderId = ORDER, userId = ALICE, courseId = C1) => {
    const res = await fetch(`${base}/api/orders/internal/${orderId}/entitlement?userId=${userId}&courseId=${courseId}`, { headers });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const withToken = (t: string) => ({ 'x-internal-service-token': t });

  // ---------------------------------------------------------------------------------------------- calling side
  it('the client sends { userId, orderId } with ORDER_LEARNING_TOKEN (never INTERNAL_SERVICE_TOKEN); 201 = created, 200 = already enrolled', async () => {
    orders[0].paymentStatus = 'PAID';
    assert.deepEqual(await LearningEnrollmentClient.enroll(C1, ALICE, ORDER), { ok: true, created: true });
    learningAnswer = 'existing';
    assert.deepEqual(await LearningEnrollmentClient.enroll(C1, ALICE, ORDER), { ok: true, created: false });
    assert.equal(enrollCalls.length, 2);
    for (const c of enrollCalls) {
      assert.deepEqual(c.body, { userId: ALICE, orderId: ORDER });
      assert.equal(c.token, TOKEN);
    }
  });

  it('WITHOUT a usable ORDER_LEARNING_TOKEN (unset, empty, short, spaces, the public default) nothing is sent - no fallback to INTERNAL_SERVICE_TOKEN', async () => {
    orders[0].paymentStatus = 'PAID';
    for (const configured of [undefined, '', '   ', 'too-short-value', `${TOKEN.slice(0, 20)} ${TOKEN.slice(20)}`, ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.ORDER_LEARNING_TOKEN;
      else process.env.ORDER_LEARNING_TOKEN = configured;
      const r = await LearningEnrollmentClient.enroll(C1, ALICE, ORDER);
      assert.equal(r.ok, false);
    }
    assert.equal(enrollCalls.length, 0, 'no request at all');
    assert.ok(process.env.INTERNAL_SERVICE_TOKEN, 'INTERNAL_SERVICE_TOKEN was configured the whole time');
  });

  it('a refused / failed enrollment is logged with its status only - the token never reaches the logs', async () => {
    learningAnswer = 'down';
    const r = await LearningEnrollmentClient.enroll(C1, ALICE, ORDER);
    assert.deepEqual(r, { ok: false, reason: 'HTTP 503' });
    process.env.LEARNING_SERVICE_URL_SAVED = process.env.LEARNING_SERVICE_URL;
    process.env.LEARNING_SERVICE_URL = 'http://127.0.0.1:1';
    try { assert.equal((await LearningEnrollmentClient.enroll(C1, ALICE, ORDER)).ok, false); } finally { process.env.LEARNING_SERVICE_URL = process.env.LEARNING_SERVICE_URL_SAVED; }
    assert.ok(logs.some((l) => l.includes('Failed to enroll user')));
    assert.ok(!logs.some((l) => l.includes(TOKEN)));
  });

  // ---------------------------------------------------------------------------------------------- receiving side
  it('entitlement endpoint: no token, a wrong token, INTERNAL_SERVICE_TOKEN, the public default, a user session: 403 and nothing written', async () => {
    orders[0].paymentStatus = 'PAID';
    for (const headers of [{}, withToken(SHARED), withToken(`${TOKEN}0`), withToken(ORDER_PAYMENT), ...PUBLIC_DEFAULTS.map(withToken), { authorization: 'Bearer user' }]) {
      const res = await entitlement(headers);
      assert.equal(res.status, 403, JSON.stringify(Object.keys(headers)));
      assert.ok(!res.text.includes('entitled'));
    }
    assert.deepEqual(writes, []);
  });

  it('entitlement endpoint without a usable ORDER_LEARNING_TOKEN on the server: 500 fail-closed', async () => {
    delete process.env.ORDER_LEARNING_TOKEN;
    assert.equal((await entitlement(withToken(TOKEN))).status, 500);
    assert.equal((await entitlement(withToken(SHARED))).status, 500);
  });

  it('entitlement answers from the order record: PAID + own order + course in it = yes; anything else = no; it never writes', async () => {
    const ask = async (over: Row, userId = ALICE, courseId = C1, itemStatus?: string) => {
      seed(over);
      if (itemStatus) items[0].status = itemStatus;
      const res = await entitlement(withToken(TOKEN), ORDER, userId, courseId);
      assert.equal(res.status, 200);
      return res.json.data;
    };
    assert.deepEqual(await ask({ paymentStatus: 'PAID' }), { entitled: true, reason: 'PAID' });
    assert.deepEqual(await ask({ paymentStatus: 'PAID', status: 'CANCELLED' }), { entitled: true, reason: 'PAID' }, 'late payment of a cancelled order (existing policy)');
    assert.equal((await ask({ paymentStatus: 'UNPAID' })).reason, 'PAYMENT_NOT_CONFIRMED');
    assert.equal((await ask({ paymentStatus: 'FAILED', status: 'FAILED' })).reason, 'PAYMENT_NOT_CONFIRMED');
    assert.equal((await ask({ paymentStatus: 'REFUNDED', status: 'CANCELLED' })).reason, 'PAYMENT_NOT_CONFIRMED');
    assert.equal((await ask({ paymentStatus: 'PAID' }, BOB)).reason, 'ORDER_OF_ANOTHER_USER');
    assert.equal((await ask({ paymentStatus: 'PAID' }, ALICE, id('ee'))).reason, 'COURSE_NOT_IN_ORDER');
    assert.equal((await ask({ paymentStatus: 'PAID' }, ALICE, C1, 'ALREADY_OWNED_DUPLICATE')).reason, 'ITEM_ALREADY_OWNED_DUPLICATE');
    assert.equal((await ask({ paymentStatus: 'PAID' }, ALICE, C1, 'REFUNDED')).reason, 'ITEM_REFUNDED');
    // a legacy order with only the JSON `items` snapshot
    seed({ paymentStatus: 'PAID', items: [{ courseId: C2, fulfillmentStatus: 'FULFILLED' }] });
    items = [];
    assert.equal((await entitlement(withToken(TOKEN), ORDER, ALICE, C2)).json.data.entitled, true);
    assert.equal((await entitlement(withToken(TOKEN), id('ff'), ALICE, C1)).json.data.reason, 'ORDER_NOT_FOUND');
    assert.deepEqual(writes, [], 'the entitlement check never writes');
  });

  it('entitlement endpoint: malformed ids are refused with 400 (after the token check)', async () => {
    assert.equal((await entitlement(withToken(TOKEN), 'nope')).status, 400);
    assert.equal((await entitlement(withToken(TOKEN), ORDER, 'alice')).status, 400);
    assert.equal((await entitlement({}, 'nope')).status, 403);
  });

  // ---------------------------------------------------------------------------------------------- ordering + webhook
  it('PAID webhook: paymentStatus PAID is stored BEFORE the enrollments; both courses granted; order COMPLETED; each counted once', async () => {
    const res = await webhook('PAID');
    assert.equal(res.status, 200);
    assert.deepEqual(enrollCalls.map((c) => [c.courseId, c.paymentStatusAtCall, c.body.orderId]).sort(), [[C1, 'PAID', ORDER], [C2, 'PAID', ORDER]]);
    assert.equal(orders[0].status, 'COMPLETED');
    assert.equal(orders[0].paymentStatus, 'PAID');
    assert.deepEqual(incrementCalls.sort(), [C1, C2].sort());
  });

  it('a retried PAID webhook (order already COMPLETED) grants nothing again and counts nothing again', async () => {
    await webhook('PAID');
    enrollCalls.length = 0;
    incrementCalls.length = 0;
    for (let i = 0; i < 3; i++) assert.equal((await webhook('PAID')).status, 200);
    assert.equal(enrollCalls.length, 0);
    assert.equal(incrementCalls.length, 0);
  });

  it('recovery: a PAID webhook re-delivered after a partial failure re-asks the learning-service; an existing enrollment (200) is not counted again', async () => {
    learningAnswer = 'down';
    await webhook('PAID');                       // the learning-service was down: nothing granted, nothing counted
    assert.equal(incrementCalls.length, 0);
    orders[0].status = 'PENDING';                // the order is re-processed (e.g. the payment outbox re-delivers before completion)
    learningAnswer = 'existing';
    enrollCalls.length = 0;
    await webhook('PAID');
    assert.equal(enrollCalls.length, 2, 'asked again for both courses');
    assert.equal(incrementCalls.length, 0, 'already-enrolled answers (200) do not move enrolledCount');
  });

  it('FAILED / CANCELLED / REFUNDED webhooks enroll nobody and never mark the order PAID', async () => {
    for (const status of ['FAILED', 'CANCELLED', 'REFUNDED']) {
      seed();
      await webhook(status);
      assert.equal(enrollCalls.length, 0, status);
      assert.notEqual(orders[0].paymentStatus, 'PAID', status);
    }
  });

  it('without ORDER_LEARNING_TOKEN the PAID webhook still answers (as before) but grants nothing and counts nothing', async () => {
    delete process.env.ORDER_LEARNING_TOKEN;
    const res = await webhook('PAID');
    assert.equal(res.status, 200);
    assert.equal(enrollCalls.length, 0);
    assert.equal(incrementCalls.length, 0);
  });

  it('every enrollment request in the source goes through LearningEnrollmentClient (no other place builds the enroll URL)', () => {
    const src = (f: string) => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
    // the URL being BUILT (a template literal), not the comments that mention the route
    const builds = (text: string) => (text.match(/\/api\/learning\/internal\/courses\/\$\{/g) || []).length;
    assert.equal(builds(src('services/order.service.ts')), 0);
    assert.equal(builds(src('services/learning.client.ts')), 1);
    assert.ok(!/INTERNAL_SERVICE_TOKEN/.test(src('services/order.service.ts').replace(/\/\/.*$/gm, '')), 'order.service no longer reads INTERNAL_SERVICE_TOKEN');
  });
});
