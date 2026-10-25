/**
 * FIX 07B-1 against a REAL MongoDB replica set.
 *
 *   PAY-01  with the demo flag off (or in production) mock-complete and the demo branch of /confirm leave the Payment document
 *           byte-for-byte as it was and never tell the order service "PAID" (so no Order is paid and no enrollment is granted);
 *           with the flag on in development the demo flow still completes.
 *   AUTH-01 the real Stripe success handler of an instructor registration upgrades the learner in the REAL user-service (child
 *           process, same isolated database) only when both services share the same PAYMENT_USER_TOKEN; otherwise the role in the
 *           database stays STUDENT.
 *
 * The payment-service app and PaymentService run in this process against the ISOLATED database named by TEST_DATABASE_URL (its name
 * must contain "test"; this file uses its own database `<name>_pay07b1`, dropped at the end). Auth and order services are a loopback
 * stub that records every call. No real payment provider, Docker container or running service is involved.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" \
 *     node -r ts-node/register/transpile-only --test test/mock-payment-gate.mongo.test.ts
 *
 * Without TEST_DATABASE_URL this file is skipped. No token appears in this file: every run draws fresh random ones.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
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

const target = resolveTestDb('pay07b1');
const TOKEN = randomBytes(32).toString('hex');
const OTHER_TOKEN = randomBytes(32).toString('hex');
const USER = '8d'.repeat(12);
const ORDER = '9e'.repeat(12);

describe('REAL MongoDB: FIX 07B-1 mock payment gate and Payment -> User token', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let admin: any;
  let server: http.Server;
  let stub: http.Server;
  let child: ChildProcess;
  let base = '';
  let stubBase = '';
  let userBase = '';
  let PaymentService: any;
  let MockPaymentDisabledError: any;
  const stubCalls: Array<{ url: string; body: any }> = [];
  const logs: string[] = [];
  let paymentId = '';

  const toChild = (key: string, value: string | null) => new Promise<void>((resolve) => {
    const onMsg = (m: any) => { if (m?.type === 'env-set' && m.key === key) { child.off('message', onMsg); resolve(); } };
    child.on('message', onMsg);
    child.send({ type: 'env', key, value });
  });

  before(async () => {
    assert.match(target.url as string, /test/i);
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: any = null;
        try { body = JSON.parse(raw); } catch { /* not JSON */ }
        stubCalls.push({ url: req.url || '', body });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/auth/verify-token') return res.end(JSON.stringify({ valid: true, user: { userId: USER, email: 'buyer@test.local' } }));
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

    // the real user-service, same isolated database, its own PAYMENT_USER_TOKEN
    child = fork(path.join(__dirname, 'helpers', 'user-service-process.js'), [], {
      cwd: os.tmpdir(), execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: target.url, PAYMENT_USER_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: OTHER_TOKEN, RATE_LIMIT_MAX_REQUESTS: '100000', JWT_SECRET: randomBytes(16).toString('hex'), NODE_ENV: 'test' } as any,
    });
    const port = await new Promise<number>((resolve, reject) => {
      child.once('message', (m: any) => (m?.type === 'ready' ? resolve(m.port) : reject(new Error('unexpected message'))));
      child.once('exit', (code) => reject(new Error(`user-service child exited with ${code}`)));
    });
    userBase = `http://127.0.0.1:${port}`;

    process.env.DATABASE_URL = target.url as string;
    process.env.AUTH_SERVICE_URL = stubBase;
    process.env.ORDER_SERVICE_URL = stubBase;
    process.env.USER_SERVICE_URL = userBase;
    process.env.INTERNAL_SERVICE_TOKEN = OTHER_TOKEN;
    process.env.ORDER_PAYMENT_TOKEN = randomBytes(32).toString('hex');   // Order <-> Payment credential (FIX 07B-2A)
    delete process.env.STRIPE_SECRET_KEY;
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient({ datasources: { db: { url: target.url } } });
    await admin.$runCommandRaw({ dropDatabase: 1 });

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
    MockPaymentDisabledError = require('../src/utils/mock-payment').MockPaymentDisabledError;
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    try { await admin?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
    try { child?.disconnect(); } catch { /* gone */ }
    child?.kill();
    await new Promise((resolve) => server?.close(resolve));
    await new Promise((resolve) => stub?.close(resolve));
  });

  const seedPayment = async (over: Record<string, unknown> = {}) => {
    await admin.payment.deleteMany({});
    const p = await admin.payment.create({
      data: { orderId: ORDER, orderNumber: 'ORD-07B1', userId: USER, amount: 199000, currency: 'vnd', status: 'PENDING', type: 'COURSE_PURCHASE',
        provider: 'stripe', stripePaymentIntentId: 'pi_mock_07b1_demo', metadata: { isMock: true, orderSynced: false }, orderSynced: false, ...over },
    });
    paymentId = p.id;
    return p;
  };
  const snapshot = async () => (await admin.$runCommandRaw({ find: 'payments', filter: {} })).cursor.firstBatch;
  const seedLearner = async () => {
    await admin.$runCommandRaw({ delete: 'user_profiles', deletes: [{ q: {}, limit: 0 }] });
    await admin.$runCommandRaw({ delete: 'notifications', deletes: [{ q: {}, limit: 0 }] });
    const now = { $date: new Date().toISOString() };
    await admin.$runCommandRaw({ insert: 'user_profiles', documents: [{ userId: { $oid: USER }, email: 'learner-pay07b1@test.local', fullName: 'Learner', role: 'STUDENT', badges: [], preferences: {}, isActive: true, createdAt: now, updatedAt: now }] });
  };
  const roleInDb = async () => (await admin.$runCommandRaw({ find: 'user_profiles', filter: { userId: { $oid: USER } } })).cursor.firstBatch[0].role;
  const notificationCount = async () => (await admin.$runCommandRaw({ count: 'notifications' })).n;
  const orderCalls = () => stubCalls.filter((c) => c.url === '/api/orders/webhook/payment');
  const post = async (url: string, body: unknown) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer user-session' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  beforeEach(async () => {
    stubCalls.length = 0;
    process.env.NODE_ENV = 'development';
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    process.env.PAYMENT_USER_TOKEN = TOKEN;
    await toChild('PAYMENT_USER_TOKEN', TOKEN);
    await seedPayment();
  });

  // ============================================================================================== PAY-01

  it('flag OFF (unset, empty, "false", invalid) or production+true: mock-complete 404, /confirm 403, direct calls refused - Payment unchanged, order service never told', async () => {
    const before = await snapshot();
    const cases: Array<[string | undefined, string]> = [[undefined, 'development'], ['', 'development'], ['false', 'test'], ['TRUE', 'development'], ['1', 'development'], ['true', 'production']];
    for (const [flag, env] of cases) {
      if (flag === undefined) delete process.env.PAYMENT_MOCK_ENABLED; else process.env.PAYMENT_MOCK_ENABLED = flag;
      process.env.NODE_ENV = env;
      assert.equal((await post('/api/payments/mock-complete', { orderId: ORDER })).status, 404, `${flag}/${env}`);
      assert.equal((await post('/api/payments/confirm', { paymentIntentId: paymentId, paymentMethodId: 'pm_card_visa' })).status, 403, `${flag}/${env}`);
      assert.equal((await post('/api/payments/confirm', { paymentIntentId: 'pi_mock_07b1_demo', paymentMethodId: 'pm_card_visa' })).status, 403, `${flag}/${env}`);
      await assert.rejects(PaymentService.completeMockPayment(ORDER, USER), MockPaymentDisabledError);
      await assert.rejects(PaymentService.confirmPayment({ paymentIntentId: paymentId, paymentMethodId: 'pm_card_visa' }, { kind: 'user', userId: USER }), MockPaymentDisabledError);
      await assert.rejects(PaymentService.confirmPayment({ paymentIntentId: paymentId, paymentMethodId: 'pm_card_visa' }, { kind: 'internal' }), MockPaymentDisabledError);
    }
    assert.deepEqual(await snapshot(), before, 'the Payment document is exactly as it was (status, metadata, updatedAt...)');
    assert.equal((await snapshot())[0].status, 'PENDING');
    assert.equal(orderCalls().length, 0, 'no PAID / FAILED notification: no Order is paid and no enrollment granted');
  });

  it('flag ON in development: mock-complete completes the demo payment and tells the order service PAID once', async () => {
    const res = await post('/api/payments/mock-complete', { orderId: ORDER });
    assert.equal(res.status, 200);
    const [doc] = await snapshot();
    assert.equal(doc.status, 'SUCCEEDED');
    assert.equal(doc.metadata.completedViaMock, true);
    assert.deepEqual(orderCalls().map((c) => c.body), [{ orderId: ORDER, status: 'PAID' }]);
  });

  it('flag ON in development: the demo /confirm still completes', async () => {
    const res = await post('/api/payments/confirm', { paymentIntentId: paymentId, paymentMethodId: 'pm_card_visa' });
    assert.equal(res.status, 200);
    assert.equal((await snapshot())[0].status, 'SUCCEEDED');
    assert.deepEqual(orderCalls().map((c) => c.body), [{ orderId: ORDER, status: 'PAID' }]);
  });

  // ============================================================================================== AUTH-01 end to end

  const stripeSucceeded = async (pi: string) => {
    await seedPayment({ type: 'INSTRUCTOR_REGISTRATION', orderId: null, stripePaymentIntentId: pi, metadata: {} });
    await PaymentService.handleStripeWebhook({ id: `evt_${pi}`, type: 'payment_intent.succeeded', data: { object: { id: pi } } }, { skipEventTracking: true });
    assert.equal((await snapshot())[0].status, 'SUCCEEDED', 'the payment itself is recorded as before');
  };

  it('same PAYMENT_USER_TOKEN on both sides: the paid instructor registration upgrades the learner in the real user-service', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'false';
    process.env.NODE_ENV = 'production';     // the real flow does not depend on the demo flag
    await seedLearner();
    await stripeSucceeded('pi_3Instr07b1ok');
    assert.equal(await roleInDb(), 'INSTRUCTOR');
    assert.equal(await notificationCount(), 1);
  });

  it('tokens differ / payment-service has none / user-service has none: the role in the database stays STUDENT', async () => {
    const scenarios: Array<[string, () => Promise<void>]> = [
      ['different tokens', async () => { process.env.PAYMENT_USER_TOKEN = randomBytes(32).toString('hex'); }],
      ['payment-service without a token (INTERNAL_SERVICE_TOKEN configured)', async () => { delete process.env.PAYMENT_USER_TOKEN; }],
      ['payment-service with a short token', async () => { process.env.PAYMENT_USER_TOKEN = TOKEN.slice(0, 10); }],
      ['user-service without a token', async () => { await toChild('PAYMENT_USER_TOKEN', null); }],
      ['user-service configured with the shared INTERNAL_SERVICE_TOKEN only', async () => { await toChild('PAYMENT_USER_TOKEN', null); process.env.PAYMENT_USER_TOKEN = OTHER_TOKEN; }],
    ];
    for (const [label, arrange] of scenarios) {
      process.env.PAYMENT_USER_TOKEN = TOKEN;
      await toChild('PAYMENT_USER_TOKEN', TOKEN);
      await seedLearner();
      await arrange();
      await stripeSucceeded(`pi_3Instr07b1_${label.length}`);
      assert.equal(await roleInDb(), 'STUDENT', label);
      assert.equal(await notificationCount(), 0, label);
    }
  });

  it('no log line of the payment-service contains a token', () => {
    assert.ok(logs.length > 0);
    for (const line of logs) for (const secret of [TOKEN.slice(0, 16), OTHER_TOKEN.slice(0, 16)]) assert.ok(!line.includes(secret), line.slice(0, 100));
  });
});
