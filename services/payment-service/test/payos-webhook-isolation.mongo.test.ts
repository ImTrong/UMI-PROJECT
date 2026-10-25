/**
 * FIX 07B-1.2 (PAY-PROVIDER-01) against a REAL MongoDB replica set: a payOS payment that /api/payments/confirm refuses is still
 * completed by its own, signed payOS webhook - and the two providers never touch each other's payments.
 *
 * The payment-service app runs in this process against the ISOLATED database named by TEST_DATABASE_URL (`<name>_payoswh`, dropped
 * at the end). The webhook is signed exactly like payOS does it, with the SDK's own signing function and a checksum key drawn at
 * random for this run (no real payOS account or credential is involved, nothing leaves 127.0.0.1). Stripe is scripted; auth and order
 * services are a loopback stub that records every call.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" \
 *     node -r ts-node/register/transpile-only --test test/payos-webhook-isolation.mongo.test.ts
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

const target = resolveTestDb('payoswh');
const USER_A = 'a1'.repeat(12);
const ORDER_PAYOS = 'c4'.repeat(12);
const ORDER_STRIPE = 'c3'.repeat(12);
const ORDER_CODE = 7123450001;
const CHECKSUM = randomBytes(32).toString('hex');
const SESSIONS: Record<string, any> = { 'session-a': { userId: USER_A, email: 'a@test.local' } };

describe('REAL MongoDB: payOS payments are completed by the signed payOS webhook only (FIX 07B-1.2)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let admin: any;
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let signer: any;
  const stubCalls: Array<{ url: string; body: any }> = [];
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
        stubCalls.push({ url: req.url || '', body });
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
      DATABASE_URL: target.url, NODE_ENV: 'production', AUTH_SERVICE_URL: stubBase, ORDER_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase,
      INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'), ORDER_PAYMENT_TOKEN: randomBytes(32).toString('hex'), STRIPE_SECRET_KEY: `sk_test_${randomBytes(12).toString('hex')}`,
      PAYOS_CLIENT_ID: `client-${randomBytes(8).toString('hex')}`, PAYOS_API_KEY: `key-${randomBytes(8).toString('hex')}`, PAYOS_CHECKSUM_KEY: CHECKSUM,
    });
    delete process.env.PAYMENT_MOCK_ENABLED;
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient({ datasources: { db: { url: target.url } } });
    await admin.$runCommandRaw({ dropDatabase: 1 });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const { StripeService } = require('../src/services/stripe.service');
    StripeService.getPaymentIntent = async (id: string) => { stripeAsked.push(id); return { id, status: 'succeeded' }; };
    const { NodeCryptoProvider } = require('@payos/node/lib/crypto/node-crypto');
    signer = new NodeCryptoProvider();
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
    ids.payos = (await admin.payment.create({ data: { orderId: ORDER_PAYOS, userId: USER_A, amount: 250000, currency: 'vnd', status: 'PENDING', type: 'COURSE_PURCHASE', provider: 'payos', payosOrderCode: String(ORDER_CODE), metadata: { orderCode: ORDER_CODE, orderSynced: false }, orderSynced: false } })).id;
    ids.stripe = (await admin.payment.create({ data: { orderId: ORDER_STRIPE, userId: USER_A, amount: 199000, currency: 'vnd', status: 'PENDING', type: 'COURSE_PURCHASE', provider: 'stripe', stripePaymentIntentId: 'pi_3PayosNeighbour', metadata: {}, orderSynced: false } })).id;
    stubCalls.length = 0;
    stripeAsked.length = 0;
  });

  const webhook = async (data: Record<string, unknown>, key = CHECKSUM) => ({
    code: '00', desc: 'success', success: true, data, signature: await signer.createSignatureFromObj(data, key),
  });
  const paid = (over: Record<string, unknown> = {}) => ({
    orderCode: ORDER_CODE, amount: 250000, description: 'UMI 7123450001', accountNumber: '0000000000', reference: 'FT-07B12', transactionDateTime: '2026-10-23 10:00:00',
    currency: 'VND', paymentLinkId: 'plink-07b12', code: '00', desc: 'success', counterAccountBankId: '', counterAccountBankName: '', counterAccountName: '', counterAccountNumber: '', virtualAccountName: '', virtualAccountNumber: '', ...over,
  });
  const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const snapshot = async () => (await admin.$runCommandRaw({ find: 'payments', filter: {}, sort: { _id: 1 } })).cursor.firstBatch;
  const orderCalls = () => stubCalls.filter((c) => c.url === '/api/orders/webhook/payment');

  it('confirm refuses the payOS payment (409, nothing written); the signed payOS webhook then completes it and tells the order PAID once', async () => {
    const before = await snapshot();
    const refused = await post('/api/payments/confirm', { paymentIntentId: ids.payos, paymentMethodId: 'pm_card_visa' }, { authorization: 'Bearer session-a' });
    assert.deepEqual([refused.status, refused.json?.code], [409, 'PAYMENT_PROVIDER_MISMATCH']);
    assert.deepEqual(await snapshot(), before);
    assert.equal(stripeAsked.length, 0);

    const res = await post('/api/payments/webhook/payos', await webhook(paid()));
    assert.equal(res.status, 200);
    const doc = await admin.payment.findUnique({ where: { id: ids.payos } });
    assert.equal(doc.status, 'SUCCEEDED');
    assert.equal(doc.orderSynced, true);
    assert.deepEqual(orderCalls().map((c) => c.body), [{ orderId: ORDER_PAYOS, status: 'PAID' }]);
    assert.equal((await admin.payment.findUnique({ where: { id: ids.stripe } })).status, 'PENDING', 'the Stripe payment is not touched');
    assert.equal(stripeAsked.length, 0, 'Stripe never asked about a payOS payment');
  });

  it('webhook signature verification unchanged: wrong key, altered amount, missing signature - 400, nothing changes', async () => {
    const before = await snapshot();
    const forged = await webhook(paid(), randomBytes(32).toString('hex'));
    const altered = await webhook(paid());
    (altered.data as any).amount = 1;
    const unsigned: any = await webhook(paid());
    delete unsigned.signature;
    for (const body of [forged, altered, unsigned]) assert.equal((await post('/api/payments/webhook/payos', body)).status, 400);
    assert.deepEqual(await snapshot(), before);
    assert.equal(orderCalls().length, 0);
  });

  it('the same signed webhook delivered again: idempotent, no second PAID notification', async () => {
    const body = await webhook(paid());
    assert.equal((await post('/api/payments/webhook/payos', body)).status, 200);
    const afterFirst = await snapshot();
    stubCalls.length = 0;
    for (let i = 0; i < 3; i++) assert.equal((await post('/api/payments/webhook/payos', body)).status, 200);
    assert.deepEqual(await snapshot(), afterFirst);
    assert.equal(orderCalls().length, 0);
  });

  it('a Stripe payment of the same learner is still confirmed through Stripe and leaves the payOS payment alone', async () => {
    const res = await post('/api/payments/confirm', { paymentIntentId: 'pi_3PayosNeighbour', paymentMethodId: 'pm_card_visa' }, { authorization: 'Bearer session-a' });
    assert.equal(res.status, 200);
    assert.deepEqual(stripeAsked, ['pi_3PayosNeighbour']);
    assert.equal((await admin.payment.findUnique({ where: { id: ids.stripe } })).status, 'SUCCEEDED');
    assert.equal((await admin.payment.findUnique({ where: { id: ids.payos } })).status, 'PENDING');
  });
});
