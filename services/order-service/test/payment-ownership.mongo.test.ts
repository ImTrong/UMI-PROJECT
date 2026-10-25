/**
 * FIX 07B-1.1 against a REAL MongoDB replica set: POST /api/orders/:orderId/payment is the user-facing entry of the payment-service's
 * INTERNAL confirm (which trusts this service), so only the owner of the order may trigger it. A refusal leaves the Order document
 * exactly as it was and sends nothing to the payment-service.
 *
 * The REAL order-service app runs in this process against the ISOLATED database named by TEST_DATABASE_URL (its name must contain
 * "test"; this file uses its own database `<name>_ordown`, dropped at the end). Auth, payment, course and learning services are a
 * loopback stub that records every call; the stub answers the internal confirm like the payment-service does.
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

const target = resolveTestDb('ordown');
const USER_A = 'a1'.repeat(12);
const USER_B = 'b2'.repeat(12);
const PAYMENT_A = 'd4'.repeat(12);
const INTERNAL = randomBytes(32).toString('hex');        // the shared INTERNAL_SERVICE_TOKEN - must NOT be sent to the payment-service
const ORDER_PAYMENT = randomBytes(32).toString('hex');   // ORDER_PAYMENT_TOKEN (FIX 07B-2A)
const SESSIONS: Record<string, any> = { 'session-a': { userId: USER_A, email: 'a@test.local' }, 'session-b': { userId: USER_B, email: 'b@test.local' } };

describe('REAL MongoDB: FIX 07B-1.1 order payment is limited to the order owner', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let admin: any;
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let orderId = '';
  const stubCalls: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];

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
        if (req.url === '/api/payments/internal/confirm') {
          return res.end(JSON.stringify({ message: 'Payment confirmed', data: { id: body?.paymentIntentId, status: 'SUCCEEDED' } }));
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(process.env, {
      DATABASE_URL: target.url, AUTH_SERVICE_URL: stubBase, PAYMENT_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase,
      LEARNING_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, INTERNAL_SERVICE_TOKEN: INTERNAL, ORDER_PAYMENT_TOKEN: ORDER_PAYMENT, RATE_LIMIT_MAX_REQUESTS: '100000', NODE_ENV: 'test',
    });
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient({ datasources: { db: { url: target.url } } });
    await admin.$runCommandRaw({ dropDatabase: 1 });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });   // never write error.log / combined.log into the repository
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
    await admin.order.deleteMany({});
    const order = await admin.order.create({
      data: { orderNumber: `ORD-OWN-${Date.now()}`, userId: USER_A, items: [{ courseId: 'e5'.repeat(12), price: 199000 }], subtotal: 199000, totalPrice: 199000, paymentId: PAYMENT_A, paymentProvider: 'stripe' },
    });
    orderId = order.id;
    stubCalls.length = 0;
  });

  const snapshot = async () => (await admin.$runCommandRaw({ find: 'orders', filter: {} })).cursor.firstBatch;
  const pay = async (session: string, id: string, body: Record<string, unknown> = {}) => {
    const res = await fetch(`${base}/api/orders/${id}/payment`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify({ paymentMethodId: 'pm_card_visa', ...body }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const confirms = () => stubCalls.filter((c) => c.url === '/api/payments/internal/confirm');

  it('user B pays A\'s order (also with A\'s userId in the body): 403, order unchanged, payment-service never called', async () => {
    const before = await snapshot();
    for (const body of [{}, { userId: USER_A }, { user: { userId: USER_A } }]) {
      const res = await pay('session-b', orderId, body);
      assert.equal(res.status, 403);
      assert.deepEqual(res.json, { error: 'Access forbidden' });
    }
    assert.deepEqual(await snapshot(), before);
    assert.equal(confirms().length, 0, 'no internal confirm: the payment-service is not asked to confirm A\'s payment');
    assert.equal(stubCalls.filter((c) => !c.url.startsWith('/api/auth')).length, 0, 'no call to any other service either');
  });

  it('an order that does not exist: 404, nothing sent', async () => {
    const res = await pay('session-a', 'ab'.repeat(12));
    assert.equal(res.status, 404);
    assert.equal(confirms().length, 0);
  });

  it('the owner A reaches the payment-service internal confirm exactly once, with the service token and the order\'s payment id', async () => {
    const res = await pay('session-a', orderId);
    assert.equal(res.status, 200);
    assert.equal(confirms().length, 1);
    assert.deepEqual(confirms()[0].body, { paymentIntentId: PAYMENT_A, paymentMethodId: 'pm_card_visa' });
    assert.equal(confirms()[0].headers['x-internal-service-token'], ORDER_PAYMENT, 'the Order <-> Payment credential, not the shared one');
  });
});
