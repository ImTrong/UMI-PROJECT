/**
 * FIX 07B-2A.2 - the refund core across SEVERAL PROCESSES on a REAL MongoDB replica set.
 *
 * Each worker (test/helpers/refund-worker.js) is a separate Node process with its own Prisma client running the REAL PaymentService,
 * StripeService and stripe-node client; the client talks to a local fake Stripe (test/helpers/fake-stripe.js) that keeps Stripe's
 * idempotency rules and lets the test hold, answer, drop or "process without answering" each request - deterministic barriers, no
 * timing guesses. Crashes are real SIGKILLs at a parked step. Webhooks are delivered by this process (a further instance) through
 * PaymentService.handleStripeWebhook. Every check reads MongoDB: Refund rows, the payment's counters, and the invariant
 *     refundedTotal + pendingRefundTotal <= amount      (and both counters equal to what the rows say)
 * Database: `<TEST_DATABASE_URL name>_refundmp` with the unique Refund.idempotencyKey index the schema declares; dropped at the end.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" \
 *     node -r ts-node/register/transpile-only --test test/refund-multiprocess.mongo.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
const { createFakeStripe } = require('./helpers/fake-stripe');

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

const target = resolveTestDb('refundmp');
const LEASE_MS = 1500;
const oid = () => randomBytes(12).toString('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(probe: () => Promise<T> | T, what: string, timeoutMs = 30_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

type Worker = { child: ChildProcess; pid: number; call: (fn: string, ...args: any[]) => Promise<any>; park: (method: string) => Promise<void>; parked: Promise<string>; hold: (method: string) => Promise<void>; held: Promise<string>; resume: () => void; kill: () => Promise<void> };

describe('REAL MongoDB, several processes: refund reservation, idempotency and unknown outcomes (FIX 07B-2A.2)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  const fake = createFakeStripe();
  let stub: http.Server;
  let db: any;
  let PaymentService: any;
  const notifications: Array<{ orderId: string; status: string }> = [];
  const workerEnv: Record<string, string> = {};
  const workers: Worker[] = [];          // every process started (for clean-up)
  let pool: Worker[] = [];               // the four long-lived instances the tests use
  let payment: any;

  const spawnWorker = async (extra: Record<string, string> = {}): Promise<Worker> => {
    const child = fork(path.join(__dirname, 'helpers', 'refund-worker.js'), [], { cwd: os.tmpdir(), execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...workerEnv, ...extra } as any });
    const pending = new Map<number, (m: any) => void>();
    let seq = 0;
    let parkedResolve!: (m: string) => void;
    const parked = new Promise<string>((r) => { parkedResolve = r; });
    const parkSet = new Map<string, () => void>();
    let heldResolve!: (m: string) => void;
    const held = new Promise<string>((r) => { heldResolve = r; });
    const ready = new Promise<number>((resolve, reject) => {
      child.on('message', (m: any) => {
        if (m?.type === 'ready') resolve(m.pid);
        else if (m?.type === 'result') { pending.get(m.id)?.(m); pending.delete(m.id); }
        else if (m?.type === 'parked') parkedResolve(m.method);
        else if (m?.type === 'park-set' || m?.type === 'hold-set') parkSet.get(m.method)?.();
        else if (m?.type === 'held') heldResolve(m.method);
      });
      child.once('exit', (code) => reject(new Error(`worker exited with ${code}`)));
    });
    const pid = await ready;
    const w: Worker = {
      child, pid, parked, held,
      hold: (method) => new Promise((resolve) => { parkSet.set(method, resolve); child.send({ type: 'hold', method }); }),
      resume: () => { child.send({ type: 'continue' }); },
      call: (fn, ...args) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); child.send({ type: 'call', id, fn, args }); }),
      park: (method) => new Promise((resolve) => { parkSet.set(method, resolve); child.send({ type: 'park', method }); }),
      kill: () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', () => resolve()); child.kill('SIGKILL'); }),
    };
    workers.push(w);
    return w;
  };

  before(async () => {
    assert.match(target.url as string, /test/i);
    const fakePort = await fake.listen();
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        if (req.url === '/api/orders/webhook/payment') { try { notifications.push(JSON.parse(raw)); } catch { /* ignore */ } }
        res.setHeader('content-type', 'application/json');
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    Object.assign(workerEnv, {
      PATH: process.env.PATH!, SystemRoot: process.env.SystemRoot || '', DATABASE_URL: target.url!, NODE_ENV: 'test',
      FAKE_STRIPE_PORT: String(fakePort), STRIPE_SECRET_KEY: `sk_test_${randomBytes(12).toString('hex')}`, STRIPE_TEST_TIMEOUT_MS: '20000',
      REFUND_LEASE_MS: String(LEASE_MS), ORDER_SERVICE_URL: stubBase, ORDER_PAYMENT_TOKEN: randomBytes(32).toString('hex'),
    });
    Object.assign(process.env, { DATABASE_URL: target.url, ORDER_SERVICE_URL: stubBase, ORDER_PAYMENT_TOKEN: workerEnv.ORDER_PAYMENT_TOKEN, NODE_ENV: 'test' });
    const { PrismaClient } = require('@prisma/client');
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    await db.$runCommandRaw({ dropDatabase: 1 });
    // what `prisma db push` creates for `idempotencyKey String? @unique` (a plain unique index) - and the collections, so
    // no transaction has to create them
    await db.$runCommandRaw({ createIndexes: 'refunds', indexes: [{ key: { idempotencyKey: 1 }, name: 'refunds_idempotencyKey_key', unique: true }] });
    await db.$runCommandRaw({ createIndexes: 'payments', indexes: [{ key: { stripePaymentIntentId: 1 }, name: 'payments_stripePaymentIntentId_idx' }] });
    require('../src/utils/logger').default.transports.forEach((t: any) => { t.silent = true; });
    PaymentService = require('../src/services/payment.service').PaymentService;
    pool = await Promise.all([spawnWorker(), spawnWorker(), spawnWorker(), spawnWorker()]);
  });

  after(async () => {
    for (const w of workers) await w.kill();
    try { await db?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await db?.$disconnect();
    await fake.close();
    await new Promise((resolve) => stub.close(resolve));
  });

  const seedPayment = async (amount = 300000) => db.payment.create({
    data: { orderId: oid(), orderNumber: `ORD-MP-${oid().slice(0, 6)}`, userId: oid(), amount, currency: 'vnd', status: 'SUCCEEDED', type: 'COURSE_PURCHASE', provider: 'stripe', stripePaymentIntentId: `pi_mp_${oid()}`, metadata: {}, orderSynced: true, refundedTotal: 0, pendingRefundTotal: 0, refundVersion: 0 },
  });
  beforeEach(async () => {
    fake.reset();
    notifications.length = 0;
    await db.refund.deleteMany({});
    await db.payment.deleteMany({});
    payment = await seedPayment();
  });

  const req = (key: string, amount = 100000, over: Record<string, unknown> = {}) => ({ paymentId: payment.id, orderId: payment.orderId, amount, currency: 'vnd', reason: 'requested_by_customer', idempotencyKey: key, ...over });
  const stripeKey = (key: string) => `order_refund:${key}`;
  const rows = (paymentId = payment.id) => db.refund.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } });
  const pay = (id = payment.id) => db.payment.findUnique({ where: { id } });
  const snapshot = async () => ({ payments: (await db.$runCommandRaw({ find: 'payments', filter: {} })).cursor.firstBatch, refunds: (await db.$runCommandRaw({ find: 'refunds', filter: {} })).cursor.firstBatch });
  /** the invariant and the counters, straight from MongoDB, for every payment */
  const invariant = async () => {
    for (const p of await db.payment.findMany({})) {
      const rs = await db.refund.findMany({ where: { paymentId: p.id } });
      const pending = rs.filter((r: any) => r.status === 'PENDING').reduce((s: number, r: any) => s + r.amount, 0);
      const refunded = rs.filter((r: any) => r.status === 'SUCCEEDED').reduce((s: number, r: any) => s + (r.actualAmount ?? r.amount), 0);
      assert.ok(p.refundedTotal + p.pendingRefundTotal <= p.amount, `invariant broken: ${p.refundedTotal} + ${p.pendingRefundTotal} > ${p.amount}`);
      assert.deepEqual([p.refundedTotal, p.pendingRefundTotal], [refunded, pending], 'counters equal what the Refund rows say');
    }
  };
  const ok = (m: any) => { assert.ok(m.ok, `worker error: ${m.error?.message}`); return m.result; };
  const chargeRefunded = (refundObjects: any[], amountRefunded: number, p = payment) => PaymentService.handleStripeWebhook(
    { id: `evt_${oid()}`, type: 'charge.refunded', data: { object: { id: `ch_${oid()}`, payment_intent: p.stripePaymentIntentId, currency: 'vnd', amount: p.amount, amount_refunded: amountRefunded, refunds: { data: refundObjects } } } },
    { skipEventTracking: true }
  );
  const refundUpdated = (refundObject: any) => PaymentService.handleStripeWebhook({ id: `evt_${oid()}`, type: 'charge.refund.updated', data: { object: refundObject } }, { skipEventTracking: true });

  // ---------------------------------------------------------------------------------------------- 1. different keys, over the limit

  it('1a: two keys whose sum exceeds what is left - while the first is INSIDE Stripe, the second process is refused; nothing over-reserved', async () => {
    fake.script(stripeKey('k-a'), ['hold']);
    const first = pool[0].call('refundForOrder', req('k-a', 200000));
    await waitFor(() => fake.isHeld(stripeKey('k-a')), 'the first refund to reach Stripe');
    let p = await pay();
    assert.deepEqual([p.pendingRefundTotal, p.refundedTotal], [200000, 0], 'the first reservation is committed before Stripe is called');

    const before = await snapshot();
    const second = await pool[1].call('refundForOrder', req('k-b', 200000));
    assert.equal(second.ok, false);
    assert.match(second.error.message, /exceeds remaining refundable amount \(100000\)/);
    assert.deepEqual(await snapshot(), before, 'the refused request changed nothing');
    assert.equal(fake.postsFor(stripeKey('k-b')).length, 0, 'never sent to Stripe');

    fake.release(stripeKey('k-a'), 'succeed');
    assert.equal(ok(await first).outcome, 'SUCCEEDED');
    p = await pay();
    assert.deepEqual([p.status, p.refundedTotal, p.pendingRefundTotal], ['PARTIALLY_REFUNDED', 200000, 0]);
    assert.equal(fake.refunds.length, 1);
    await invariant();
  });

  it('1b: four processes, four keys, 4 x 100000 on a 300000 payment at the same instant (3 rounds) - exactly three refunds, never more', async () => {
    for (let round = 0; round < 3; round++) {
      fake.reset();
      notifications.length = 0;
      payment = await seedPayment();
      const results = await Promise.all(pool.map((w, i) => w.call('refundForOrder', req(`race-${round}-${i}`, 100000))));
      const succeeded = results.filter((r) => r.ok && r.result.outcome === 'SUCCEEDED');
      const refused = results.filter((r) => !r.ok);
      assert.equal(succeeded.length, 3, `round ${round}: ${JSON.stringify(results.map((r) => r.ok ? r.result.outcome : r.error.message))}`);
      assert.equal(refused.length, 1);
      // which refusal depends on the interleaving: what is left is too little, nothing is left, or the payment is fully refunded
      assert.match(refused[0].error.message, /exceeds remaining refundable amount|Refund already processed|Payment already processed/);
      const p = await pay();
      assert.deepEqual([p.status, p.refundedTotal, p.pendingRefundTotal], ['REFUNDED', 300000, 0]);
      assert.equal(fake.refunds.length, 3, 'Stripe refunded exactly the three accepted amounts');
      assert.equal(notifications.filter((n) => n.orderId === payment.orderId && n.status === 'REFUNDED').length, 1, 'the order is told once');
      await invariant();
    }
  });

  it('1c: process A is stopped INSIDE its reservation transaction while process B reserves and commits - the transaction of A conflicts, is retried, sees B and is refused', async () => {
    const a = await spawnWorker();
    await a.hold('refundRowTotals');                       // A's reservation transaction waits after reading the payment
    const callA = a.call('refundForOrder', req('tx-a', 200000));
    assert.equal(await a.held, 'refundRowTotals');
    const b = ok(await pool[1].call('refundForOrder', req('tx-b', 200000)));
    assert.equal(b.outcome, 'SUCCEEDED');
    a.resume();
    const resultA = await callA;
    assert.equal(resultA.ok, false, 'A must not reserve on its stale view');
    assert.match(resultA.error.message, /exceeds remaining refundable amount \(100000\)/);
    const p = await pay();
    assert.deepEqual([p.refundedTotal, p.pendingRefundTotal], [200000, 0]);
    assert.equal((await rows()).length, 1);
    assert.equal(fake.refunds.length, 1);
    await invariant();
  });

  // ---------------------------------------------------------------------------------------------- 2. same key, several processes

  it('2: the same key from four processes at once - one Refund row, one Stripe request, the others 409 (never a fake success), replays after', async () => {
    const key = 'same-key-4p';
    fake.script(stripeKey(key), ['hold']);
    const calls = pool.map((w) => w.call('refundForOrder', req(key, 100000)));
    await waitFor(() => fake.isHeld(stripeKey(key)), 'one request at Stripe');
    const settled: any[] = [];
    calls.forEach((c) => c.then((m: any) => settled.push(m)));
    await waitFor(() => settled.length === 3, 'the three other answers');
    for (const m of settled) {
      assert.equal(m.ok, false, JSON.stringify(m));
      assert.deepEqual([m.error.code, m.error.httpStatus], ['REFUND_IN_PROGRESS', 409]);
    }
    assert.equal((await rows()).length, 1);
    fake.release(stripeKey(key), 'succeed');
    const all = await Promise.all(calls);
    assert.equal(all.filter((m) => m.ok && m.result.outcome === 'SUCCEEDED').length, 1);
    const replays = await Promise.all(pool.map((w) => w.call('refundForOrder', req(key, 100000))));
    for (const m of replays) assert.deepEqual([ok(m).outcome, m.result.replayed], ['SUCCEEDED', true]);
    assert.equal((await rows()).length, 1);
    assert.equal(fake.postsFor(stripeKey(key)).length, 1, 'Stripe saw ONE request for this key');
    assert.equal(fake.refunds.length, 1);
    const p = await pay();
    assert.deepEqual([p.refundedTotal, p.pendingRefundTotal], [100000, 0]);
    await invariant();
  });

  // ---------------------------------------------------------------------------------------------- 3. same key, other request

  it('3: the same key with another amount, another payment or another currency -> 422, database and Stripe untouched', async () => {
    assert.equal(ok(await pool[0].call('refundForOrder', req('k-used', 100000))).outcome, 'SUCCEEDED');
    const other = await seedPayment();
    const before = await snapshot();
    const posts = fake.log.length;
    const r1 = await pool[1].call('refundForOrder', req('k-used', 50000));
    const r2 = await pool[2].call('refundForOrder', { ...req('k-used', 100000), paymentId: other.id, orderId: other.orderId });
    const r3 = await pool[3].call('refundForOrder', req('k-used', 100000, { currency: 'usd' }));
    assert.deepEqual([r1.error.code, r1.error.httpStatus], ['IDEMPOTENCY_KEY_REUSED', 422]);
    assert.deepEqual([r2.error.code, r2.error.httpStatus], ['IDEMPOTENCY_KEY_REUSED', 422]);
    assert.deepEqual([r3.error.code, r3.error.httpStatus], ['CURRENCY_MISMATCH', 422]);
    assert.deepEqual(await snapshot(), before);
    assert.equal(fake.log.length, posts);
    await invariant();
  });

  // ---------------------------------------------------------------------------------------------- 4. what Stripe answers

  it('4: Stripe answers - succeeded / pending / failed / declined / 5xx / connection resets / timeouts - each recorded for what it proves', async () => {
    const slow = await spawnWorker({ STRIPE_TEST_TIMEOUT_MS: '700' });
    const cases: Array<{ mode: string[]; worker?: Worker; outcome: string; status: string; pending: number; refunded: number; effects: number }> = [
      { mode: ['succeed'], outcome: 'SUCCEEDED', status: 'SUCCEEDED', pending: 0, refunded: 100000, effects: 1 },
      { mode: ['pending'], outcome: 'PENDING', status: 'PENDING', pending: 100000, refunded: 0, effects: 1 },
      { mode: ['fail-status'], outcome: 'FAILED', status: 'FAILED', pending: 0, refunded: 0, effects: 1 },
      { mode: ['decline'], outcome: 'FAILED', status: 'FAILED', pending: 0, refunded: 0, effects: 0 },
      { mode: ['error500'], outcome: 'UNVERIFIED', status: 'PENDING', pending: 100000, refunded: 0, effects: 0 },
      { mode: Array(8).fill('reset'), outcome: 'UNVERIFIED', status: 'PENDING', pending: 100000, refunded: 0, effects: 0 },
      { mode: ['hang'], worker: slow, outcome: 'UNVERIFIED', status: 'PENDING', pending: 100000, refunded: 0, effects: 0 },
    ];
    for (const c of cases) {
      fake.reset();
      payment = await seedPayment();
      const key = `answer-${c.mode[0]}`;
      fake.script(stripeKey(key), c.mode);
      const result = ok(await (c.worker ?? pool[0]).call('refundForOrder', req(key, 100000)));
      const [row] = await rows();
      const p = await pay();
      assert.equal(result.outcome, c.outcome, c.mode[0]);
      assert.equal(row.status, c.status, c.mode[0]);
      assert.deepEqual([p.pendingRefundTotal, p.refundedTotal], [c.pending, c.refunded], `${c.mode[0]}: reservation`);
      assert.equal(fake.refunds.length, c.effects, `${c.mode[0]}: refunds Stripe made`);
      if (c.outcome === 'UNVERIFIED') assert.match(row.errorMessage, /^UNVERIFIED: /);
      if (c.mode[0] === 'pending') assert.ok(row.stripeRefundId, 'Stripe\'s id is kept for the webhook / a later look-up');
      await invariant();
    }
    // a definite failure is final: the same key reports it again without asking Stripe
    fake.reset();
    payment = await seedPayment();
    fake.script(stripeKey('final'), ['decline']);
    assert.equal(ok(await pool[0].call('refundForOrder', req('final'))).outcome, 'FAILED');
    const again = ok(await pool[1].call('refundForOrder', req('final')));
    assert.deepEqual([again.outcome, again.replayed, fake.postsFor(stripeKey('final')).length], ['FAILED', true, 1]);
  });

  // ---------------------------------------------------------------------------------------------- 5. retry after a timeout

  it('5: Stripe refunded but every answer timed out -> UNVERIFIED with the money reserved; a retry from ANOTHER process re-sends the identical request and records the same refund', async () => {
    const slow = await spawnWorker({ STRIPE_TEST_TIMEOUT_MS: '700' });
    const key = 'timeout-then-retry';
    fake.script(stripeKey(key), ['process-hang']);
    const first = ok(await slow.call('refundForOrder', req(key)));
    assert.equal(first.outcome, 'UNVERIFIED');
    assert.equal(fake.refunds.length, 1, 'Stripe DID refund');
    let p = await pay();
    assert.deepEqual([p.pendingRefundTotal, p.refundedTotal], [100000, 0], 'not released: the money moved');
    fake.stick(stripeKey(key), null);                      // Stripe reachable again
    const retry = ok(await pool[2].call('refundForOrder', req(key)));
    assert.deepEqual([retry.outcome, retry.replayed], ['SUCCEEDED', true]);
    assert.equal(fake.refunds.length, 1, 'no second refund at Stripe');
    const posts = fake.postsFor(stripeKey(key));
    assert.ok(posts.length >= 2);
    for (const post of posts) assert.deepEqual(post.params, posts[0].params, 'the same parameters every time');
    const [row] = await rows();
    assert.deepEqual([row.status, row.stripeRefundId], ['SUCCEEDED', fake.refunds[0].id]);
    p = await pay();
    assert.deepEqual([p.pendingRefundTotal, p.refundedTotal], [0, 100000]);
    await invariant();
  });

  it('5b: an unverified refund older than the Stripe idempotency window is NOT re-sent (it could refund twice) - it stays UNVERIFIED and reserved', async () => {
    const slow = await spawnWorker({ STRIPE_TEST_TIMEOUT_MS: '700' });
    const key = 'outside-window';
    fake.script(stripeKey(key), ['hang']);
    assert.equal(ok(await slow.call('refundForOrder', req(key))).outcome, 'UNVERIFIED');
    fake.stick(stripeKey(key), null);
    const [row] = await rows();
    await db.refund.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    const posts = fake.log.length;
    const retry = ok(await pool[0].call('refundForOrder', req(key)));
    assert.deepEqual([retry.outcome, fake.log.length], ['UNVERIFIED', posts], 'Stripe is not asked again with an expired key');
    assert.deepEqual([(await rows())[0].status, (await pay()).pendingRefundTotal], ['PENDING', 100000]);
    await invariant();
  });

  // ---------------------------------------------------------------------------------------------- 6. a process dies

  it('6a: the process dies right after the reservation (before Stripe): the lease keeps others out, then a retry completes it once', async () => {
    const victim = await spawnWorker();
    await victim.park('requestStripeRefund');
    const key = 'crash-after-reserve';
    void victim.call('refundForOrder', req(key));
    assert.equal(await victim.parked, 'requestStripeRefund');
    await victim.kill();
    let [row] = await rows();
    assert.deepEqual([row.status, row.stripeRefundId], ['PENDING', null]);
    assert.equal((await pay()).pendingRefundTotal, 100000, 'the reservation survives the crash');
    assert.equal(fake.log.length, 0, 'Stripe was never called');

    const early = await pool[0].call('refundForOrder', req(key));
    assert.deepEqual([early.ok, early.error?.code], [false, 'REFUND_IN_PROGRESS'], 'the dead process still holds the lease');
    await waitFor(async () => { const r = await db.refund.findUnique({ where: { id: row.id } }); return !r.processingUntil || r.processingUntil.getTime() < Date.now() - 50; }, 'the lease to expire', 10_000);
    const resumed = ok(await pool[1].call('refundForOrder', req(key)));
    assert.equal(resumed.outcome, 'SUCCEEDED');
    [row] = await rows();
    assert.equal(row.status, 'SUCCEEDED');
    assert.equal(fake.refunds.length, 1);
    await invariant();
  });

  it('6b: the process dies while Stripe processes the request: the webhook (matched by the refund metadata) settles it; a later retry does not refund again', async () => {
    const victim = await spawnWorker();
    const key = 'crash-at-stripe';
    fake.script(stripeKey(key), ['hold']);
    void victim.call('refundForOrder', req(key));
    await waitFor(() => fake.isHeld(stripeKey(key)), 'the request at Stripe');
    await victim.kill();
    const stripeRefund = fake.processWithoutAnswer(stripeKey(key));      // Stripe completes it; nobody hears the answer
    const [row0] = await rows();
    assert.equal(stripeRefund.metadata.localRefundId, row0.id, 'the row id travelled to Stripe');
    assert.deepEqual([row0.status, row0.stripeRefundId], ['PENDING', null]);

    await chargeRefunded([stripeRefund], 100000);
    let [row] = await rows();
    assert.deepEqual([row.status, row.stripeRefundId], ['SUCCEEDED', stripeRefund.id]);
    assert.deepEqual([(await pay()).refundedTotal, (await pay()).pendingRefundTotal], [100000, 0]);
    await waitFor(async () => { const r = await db.refund.findUnique({ where: { id: row.id } }); return !r.processingUntil || r.processingUntil.getTime() < Date.now(); }, 'lease', 10_000);
    const posts = fake.log.length;
    const retry = ok(await pool[0].call('refundForOrder', req(key)));
    assert.deepEqual([retry.outcome, retry.replayed], ['SUCCEEDED', true]);
    assert.equal(fake.log.length, posts, 'already settled: Stripe is not asked again');
    await chargeRefunded([stripeRefund], 100000);                          // the same webhook again
    [row] = await rows();
    assert.equal((await rows()).length, 1);
    assert.deepEqual([(await pay()).refundedTotal, (await pay()).pendingRefundTotal], [100000, 0]);
    assert.equal(fake.refunds.length, 1);
    await invariant();
  });

  it('6c: Stripe answered "succeeded" but the process died before recording it: a retry after the lease records the SAME Stripe refund once', async () => {
    const victim = await spawnWorker();
    await victim.park('markRefundSucceeded');
    const key = 'crash-before-record';
    void victim.call('refundForOrder', req(key));
    assert.equal(await victim.parked, 'markRefundSucceeded');
    await victim.kill();
    assert.equal(fake.refunds.length, 1);
    let [row] = await rows();
    assert.deepEqual([row.status, (await pay()).pendingRefundTotal], ['PENDING', 100000]);
    await waitFor(async () => { const r = await db.refund.findUnique({ where: { id: row.id } }); return r.processingUntil.getTime() < Date.now() - 50; }, 'lease', 10_000);
    const retry = ok(await pool[3].call('refundForOrder', req(key)));
    assert.equal(retry.outcome, 'SUCCEEDED');
    [row] = await rows();
    assert.deepEqual([row.status, row.stripeRefundId], ['SUCCEEDED', fake.refunds[0].id]);
    assert.equal(fake.refunds.length, 1, 'Stripe replayed the stored refund for the same key');
    await invariant();
  });

  // ---------------------------------------------------------------------------------------------- 7. webhooks

  it('7a: the webhook arrives while the refund is still waiting for Stripe\'s answer - recorded once; the late answer changes nothing', async () => {
    const key = 'webhook-first';
    fake.script(stripeKey(key), ['hold']);
    const call = pool[0].call('refundForOrder', req(key));
    await waitFor(() => fake.isHeld(stripeKey(key)), 'the request at Stripe');
    const stripeRefund = fake.processHeld(stripeKey(key));
    await chargeRefunded([stripeRefund], 100000);
    assert.equal((await rows())[0].status, 'SUCCEEDED');
    const before = await snapshot();
    fake.release(stripeKey(key), 'replay');
    assert.equal(ok(await call).outcome, 'SUCCEEDED');
    const after = await snapshot();
    assert.deepEqual(after.payments.map((p: any) => [p.refundedTotal, p.pendingRefundTotal]), before.payments.map((p: any) => [p.refundedTotal, p.pendingRefundTotal]), 'no double counting');
    assert.equal((await rows()).length, 1);
    await invariant();
  });

  it('7b: a full refund tells the order REFUNDED exactly once, however often the webhooks repeat', async () => {
    const r = ok(await pool[0].call('refundForOrder', req('full', 300000)));
    assert.equal(r.outcome, 'SUCCEEDED');
    const stripeRefund = fake.refunds[0];
    await chargeRefunded([stripeRefund], 300000);
    await chargeRefunded([stripeRefund], 300000);
    await refundUpdated(stripeRefund);
    const p = await pay();
    assert.deepEqual([p.status, p.refundedTotal, p.pendingRefundTotal], ['REFUNDED', 300000, 0]);
    assert.equal(notifications.filter((n) => n.status === 'REFUNDED').length, 1);
    assert.equal((await rows()).length, 1);
    await invariant();
  });

  it('7c: a refund Stripe accepted as pending and later reports failed (charge.refund.updated) releases the reservation', async () => {
    fake.script(stripeKey('pending-then-failed'), ['pending']);
    assert.equal(ok(await pool[0].call('refundForOrder', req('pending-then-failed'))).outcome, 'PENDING');
    assert.equal((await pay()).pendingRefundTotal, 100000);
    const failed = fake.setRefundStatus(fake.refunds[0].id, 'failed');
    await refundUpdated({ ...failed, failure_reason: 'expired_or_canceled_card' });
    const [row] = await rows();
    assert.deepEqual([row.status, (await pay()).pendingRefundTotal, (await pay()).refundedTotal], ['FAILED', 0, 0]);
    await refundUpdated({ ...failed, status: 'succeeded' });   // a FAILED row cannot be revived by a stray event (only PENDING moves)
    assert.deepEqual([(await rows())[0].status, (await pay()).refundedTotal, (await pay()).pendingRefundTotal], ['FAILED', 0, 0]);
    await invariant();
  });

  it('7d: a refund made outside this service (Stripe dashboard) is recorded once, under a key derived from Stripe\'s id', async () => {
    const external = { id: `re_dashboard_${oid()}`, object: 'refund', status: 'succeeded', amount: 50000, currency: 'vnd', payment_intent: payment.stripePaymentIntentId, metadata: {} };
    await Promise.all([chargeRefunded([external], 50000), chargeRefunded([external], 50000)]);
    await chargeRefunded([external], 50000);
    const rs = await rows();
    assert.equal(rs.length, 1);
    assert.deepEqual([rs[0].idempotencyKey, rs[0].status], [`stripe_refund:${external.id}`, 'SUCCEEDED']);
    assert.deepEqual([(await pay()).refundedTotal, (await pay()).pendingRefundTotal], [50000, 0]);
    await invariant();
  });

  // ---------------------------------------------------------------------------------------------- 8. counters that drifted (legacy B.6)

  const driftRows = async (rowsToCreate: Array<{ status: string; amount: number; stripeRefundId?: string }>) => {
    for (const r of rowsToCreate) {
      await db.refund.create({ data: { paymentId: payment.id, orderId: payment.orderId, userId: payment.userId, amount: r.amount, currency: 'vnd', status: r.status, stripeRefundId: r.stripeRefundId ?? null, idempotencyKey: `drift-${oid()}`, completedAt: r.status === 'SUCCEEDED' ? new Date() : null } });
    }
    await db.payment.update({ where: { id: payment.id }, data: { refundedTotal: 0, pendingRefundTotal: 0, status: 'SUCCEEDED' } });
  };

  it('8a: a SUCCEEDED refund the counters missed is counted once by a repeated charge.refunded; PENDING stays reserved, FAILED is not counted', async () => {
    await driftRows([{ status: 'SUCCEEDED', amount: 50000, stripeRefundId: 're_drift_1' }, { status: 'PENDING', amount: 100000 }, { status: 'FAILED', amount: 30000 }]);
    const stripeRefund = { id: 're_drift_1', object: 'refund', status: 'succeeded', amount: 50000, currency: 'vnd', metadata: {} };
    await chargeRefunded([stripeRefund], 50000);
    await chargeRefunded([stripeRefund], 50000);
    const p = await pay();
    assert.deepEqual([p.status, p.refundedTotal, p.pendingRefundTotal], ['PARTIALLY_REFUNDED', 50000, 100000]);
    assert.equal((await rows()).length, 3, 'no row added');
    assert.equal(notifications.length, 0, 'not fully refunded: the order is not told');
    await invariant();
  });

  it('8b: counters that missed a FULL refund are repaired by the webhook; the order hears REFUNDED once even when the webhook repeats', async () => {
    await driftRows([{ status: 'SUCCEEDED', amount: 200000, stripeRefundId: 're_drift_a' }, { status: 'SUCCEEDED', amount: 100000, stripeRefundId: 're_drift_b' }]);
    const list = [{ id: 're_drift_a', status: 'succeeded', amount: 200000, metadata: {} }, { id: 're_drift_b', status: 'succeeded', amount: 100000, metadata: {} }];
    for (let i = 0; i < 3; i++) await chargeRefunded(list, 300000);
    const p = await pay();
    assert.deepEqual([p.status, p.refundedTotal, p.pendingRefundTotal], ['REFUNDED', 300000, 0]);
    assert.equal(notifications.filter((n) => n.orderId === payment.orderId && n.status === 'REFUNDED').length, 1);
    await invariant();
  });

  it('8c: the webhook re-sync has READ the rows (no reservation yet) and waits before writing; another process reserves and commits - the re-sync must not overwrite that reservation', async () => {
    await driftRows([{ status: 'SUCCEEDED', amount: 50000, stripeRefundId: 're_drift_c' }]);
    // Schedule (this process = the webhook instance, pool[0] = another instance):
    //   1. the final re-sync of handleChargeRefunded reads the payment and the Refund rows -> stale view (refunded 50000, pending 0)
    //   2. it is held AFTER that read returned, BEFORE it writes the payment's counters
    //   3. the other process reserves 100000 and commits (PENDING row + counters); its Stripe request is held at the fake
    //   4. the re-sync continues: inside a transaction its write conflicts and it is retried with a fresh read; outside one it would
    //      write the stale pending total (0) over the committed reservation
    const original = PaymentService.refundRowTotals;
    const reads: Array<{ pending: number; refunded: number }> = [];
    let staleResolve!: (v: { pending: number; refunded: number }) => void;
    const staleRead = new Promise<{ pending: number; refunded: number }>((r) => { staleResolve = r; });
    let openGate!: () => void;
    const gate = new Promise<void>((r) => { openGate = r; });
    PaymentService.refundRowTotals = async function heldAfterRead(this: any, ...args: any[]) {
      const totals = await original.apply(this, args);
      reads.push(totals);
      if (reads.length === 1) { staleResolve(totals); await gate; }   // the value is read; the write has not happened yet
      return totals;
    };
    try {
      const webhook = chargeRefunded([{ id: 're_drift_c', status: 'succeeded', amount: 50000, metadata: {} }], 50000);
      const stale = await staleRead;
      assert.deepEqual(stale, { pending: 0, refunded: 50000 }, 'the re-sync read BEFORE the reservation existed');
      fake.script(stripeKey('during-resync'), ['hold']);
      const reservation = pool[0].call('refundForOrder', req('during-resync', 100000));
      await waitFor(() => fake.isHeld(stripeKey('during-resync')), 'the other reservation committed and at Stripe');
      const committed = await pay();
      assert.deepEqual([committed.refundedTotal, committed.pendingRefundTotal], [50000, 100000], 'the reservation is committed while the re-sync waits');
      openGate();
      await webhook;
      let p = await pay();
      assert.deepEqual([p.refundedTotal, p.pendingRefundTotal], [50000, 100000], 'the stale re-sync must not overwrite the committed reservation');
      assert.ok(p.refundedTotal + p.pendingRefundTotal <= p.amount);
      await invariant();
      assert.ok(reads.length >= 2 && reads[reads.length - 1].pending === 100000, `the re-sync was retried with a fresh read after the write conflict (reads: ${JSON.stringify(reads)})`);
      fake.release(stripeKey('during-resync'), 'succeed');
      assert.equal(ok(await reservation).outcome, 'SUCCEEDED');
      p = await pay();
      assert.deepEqual([p.status, p.refundedTotal, p.pendingRefundTotal], ['PARTIALLY_REFUNDED', 150000, 0]);
      assert.equal((await rows()).length, 2, 'one drifted row + one reservation, nothing duplicated');
      assert.equal(fake.refunds.length, 1);
      await invariant();
    } finally {
      PaymentService.refundRowTotals = original;
    }
  });
});
