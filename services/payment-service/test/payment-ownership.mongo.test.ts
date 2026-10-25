/**
 * FIX 07B-1.1 against a REAL MongoDB replica set: POST /api/payments/confirm confirms only the caller's own payment, and a refusal
 * leaves the Payment documents exactly as they were and tells nobody anything (no order PAID -> no enrollment, no role upgrade).
 *
 * The payment-service app and PaymentService run in this process against the ISOLATED database named by TEST_DATABASE_URL (its name
 * must contain "test"; this file uses its own database `<name>_payown`, dropped at the end). Auth, order and user services are a
 * loopback stub that records every call. Stripe is never called (getPaymentIntent is replaced).
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" \
 *     node -r ts-node/register/transpile-only --test test/payment-ownership.mongo.test.ts
 *
 * Without TEST_DATABASE_URL this file is skipped.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

function resolveTestDb(suffix: string): { enabled: boolean; url?: string } {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return { enabled: false };
  const [base, query] = raw.split('?');
  const name = base.split('/').pop() || '';
  if (!/test/i.test(name) || !/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(base)) {
    console.error(`Refusing to run: "${name}" is not an isolated local test database.`);
    return { enabled: false };
  }
  return { enabled: true, url: `${base.slice(0, base.length - name.length)}${name}_${suffix}${query ? `?${query}` : ''}` };
}

const target = resolveTestDb('payown');
const USER_A = 'a1'.repeat(12);
const USER_B = 'b2'.repeat(12);
const ORDER_A = 'c3'.repeat(12);
const PI_REAL = 'pi_3MongoOwnerA_course';
const PI_INSTR = 'pi_3MongoOwnerA_instr';
const USER_TOKEN = randomBytes(32).toString('hex');
const SESSIONS: Record<string, any> = { 'session-a': { userId: USER_A, email: 'a@test.local' }, 'session-b': { userId: USER_B, email: 'b@test.local' } };

describe('REAL MongoDB: FIX 07B-1.1 payment confirmation ownership', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let admin: any;
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let StripeService: any;
  const stubCalls: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  const stripeAsked: string[] = [];
  const ids: Record<string, string> = {};

  before(async () => {
    assert.match(target.url as string, /test/i);
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
    Object.assign(process.env, {
      DATABASE_URL: target.url, AUTH_SERVICE_URL: stubBase, ORDER_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase,
      INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'), ORDER_PAYMENT_TOKEN: randomBytes(32).toString('hex'), PAYMENT_USER_TOKEN: USER_TOKEN,
    });
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient({ datasources: { db: { url: target.url } } });
    await admin.$runCommandRaw({ dropDatabase: 1 });

    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    StripeService = require('../src/services/stripe.service').StripeService;
    StripeService.getPaymentIntent = async (id: string) => { stripeAsked.push(id); return { id, status: 'succeeded' }; };
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    try { await admin?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
    await new Promise((resolve) => server?.close(resolve));
    await new Promise((resolve) => stub?.close(resolve));
  });

  beforeEach(async () => {
    await admin.payment.deleteMany({});
    const common = { userId: USER_A, amount: 199000, currency: 'vnd', status: 'PENDING', provider: 'stripe', orderSynced: false };
    ids.mock = (await admin.payment.create({ data: { ...common, orderId: ORDER_A, orderNumber: 'ORD-OWN-1', type: 'COURSE_PURCHASE', stripePaymentIntentId: 'pi_mock_own', metadata: { isMock: true } } })).id;
    ids.real = (await admin.payment.create({ data: { ...common, orderId: ORDER_A, orderNumber: 'ORD-OWN-2', type: 'COURSE_PURCHASE', stripePaymentIntentId: PI_REAL, metadata: {} } })).id;
    ids.instr = (await admin.payment.create({ data: { ...common, type: 'INSTRUCTOR_REGISTRATION', amount: 500000, stripePaymentIntentId: PI_INSTR, metadata: {} } })).id;
    stubCalls.length = 0;
    stripeAsked.length = 0;
    process.env.NODE_ENV = 'development';
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = `sk_test_${randomBytes(12).toString('hex')}`;
  });

  const snapshot = async () => (await admin.$runCommandRaw({ find: 'payments', filter: {}, sort: { _id: 1 } })).cursor.firstBatch;
  const statusOf = async (id: string) => (await admin.payment.findUnique({ where: { id } })).status;
  const downstream = () => stubCalls.filter((c) => !c.url.startsWith('/api/auth'));
  const confirm = async (session: string, body: Record<string, unknown>, url = '/api/payments/confirm') => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify({ paymentMethodId: 'pm_card_visa', ...body }) });
    return { status: res.status, text: await res.text() };
  };

  it('PAY-OWN-02/03/04: B (also forging A\'s userId in the body) and a missing payment - 404, documents byte-for-byte unchanged, nobody told', async () => {
    const before = await snapshot();
    const attempts: Array<[string, Record<string, unknown>]> = [];
    for (const id of [ids.mock, ids.real, ids.instr, PI_REAL, PI_INSTR, 'pi_mock_own']) {
      attempts.push(['session-b', { paymentIntentId: id }], ['session-b', { paymentIntentId: id, userId: USER_A, user: { userId: USER_A } }]);
    }
    const answers = [];
    for (const [s, body] of attempts) answers.push(await confirm(s, body));
    const missing = [await confirm('session-a', { paymentIntentId: 'ab'.repeat(12) }), await confirm('session-a', { paymentIntentId: 'pi_3Missing' })];
    for (const a of [...answers, ...missing]) {
      assert.equal(a.status, 404);
      assert.equal(a.text, '{"error":"Payment not found"}');
    }
    for (const mode of [['false', 'production'], ['true', 'production']]) {   // also on the real-Stripe path
      [process.env.PAYMENT_MOCK_ENABLED, process.env.NODE_ENV] = mode;
      for (const id of [ids.real, PI_INSTR]) assert.equal((await confirm('session-b', { paymentIntentId: id, userId: USER_A })).status, 404);
    }
    assert.deepEqual(await snapshot(), before, 'status, metadata, updatedAt ... unchanged');
    assert.equal(downstream().length, 0, 'no order PAID/FAILED (no enrollment), no user-service upgrade');
    assert.equal(stripeAsked.length, 0);
  });

  it('PAY-OWN-02 many concurrent attempts by B next to one by the owner: only the owner\'s payment moves', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'false';
    process.env.NODE_ENV = 'production';
    const answers = await Promise.all([
      ...Array.from({ length: 12 }, () => confirm('session-b', { paymentIntentId: ids.instr, userId: USER_A })),
      confirm('session-a', { paymentIntentId: ids.real }),
    ]);
    assert.equal(answers.filter((a) => a.status === 404).length, 12);
    assert.equal(answers.at(-1)!.status, 200);
    assert.equal(await statusOf(ids.instr), 'PENDING');
    assert.equal(await statusOf(ids.real), 'SUCCEEDED');
    assert.equal(downstream().filter((c) => c.url.startsWith('/api/users')).length, 0, 'no role upgrade for B\'s attempts');
  });

  it('PAY-OWN-01: the owner confirms their real payments - Stripe decides, order told PAID, instructor upgrade sent as before', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'false';
    process.env.NODE_ENV = 'production';
    assert.equal((await confirm('session-a', { paymentIntentId: PI_REAL })).status, 200);
    assert.equal((await confirm('session-a', { paymentIntentId: ids.instr })).status, 200);
    assert.deepEqual(stripeAsked, [PI_REAL, PI_INSTR]);
    assert.equal(await statusOf(ids.real), 'SUCCEEDED');
    assert.equal(await statusOf(ids.instr), 'SUCCEEDED');
    assert.deepEqual(downstream().map((c) => c.url), ['/api/orders/webhook/payment', '/api/users/become-instructor/confirm']);
    assert.equal(downstream()[1].headers['x-internal-service-token'], USER_TOKEN);
    assert.equal(await statusOf(ids.mock), 'PENDING', 'nothing else touched');
  });

  it('PAY-OWN-05: flag off / production blocks the demo for the owner (403) and B still gets 404; flag on -> owner only', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    for (const mode of [[undefined, 'development'], ['false', 'test'], ['true', 'production']] as const) {
      if (mode[0] === undefined) delete process.env.PAYMENT_MOCK_ENABLED; else process.env.PAYMENT_MOCK_ENABLED = mode[0];
      process.env.NODE_ENV = mode[1];
      const before = await snapshot();
      assert.equal((await confirm('session-a', { paymentIntentId: ids.mock })).status, 403);
      assert.equal((await confirm('session-b', { paymentIntentId: ids.mock })).status, 404);
      assert.equal((await confirm('session-a', { orderId: ORDER_A }, '/api/payments/mock-complete')).status, 404);
      assert.deepEqual(await snapshot(), before);
    }
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    process.env.NODE_ENV = 'development';
    const before = await snapshot();
    assert.equal((await confirm('session-b', { paymentIntentId: ids.mock })).status, 404);
    assert.notEqual((await confirm('session-b', { orderId: ORDER_A }, '/api/payments/mock-complete')).status, 200);
    assert.deepEqual(await snapshot(), before);
    assert.equal(downstream().length, 0);
    assert.equal((await confirm('session-a', { paymentIntentId: ids.mock })).status, 200);
    assert.equal(await statusOf(ids.mock), 'SUCCEEDED');
  });
});
