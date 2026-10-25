/**
 * One payment-service "instance" for the multi-process refund tests (FIX 07B-2A.2): its own Node process, Prisma client and
 * connection pool, the REAL PaymentService / StripeService / stripe-node client. Only two things are test harness:
 *   - the stripe-node client is pointed at the local fake Stripe (host / port / protocol / timeout), FAKE_STRIPE_PORT;
 *   - `{ type: 'park', method }` replaces one PaymentService step with a promise that never settles and reports `parked`, so the
 *     parent can SIGKILL this process at that exact point (e.g. after the reservation, or after Stripe answered);
 *   - `{ type: 'hold', method }` makes the first call of a step wait for `{ type: 'continue' }` (reports `held`) - a barrier.
 * Commands: `{ type: 'call', id, fn, args }` -> `{ type: 'result', id, ok, result | error }`. Refuses a non-isolated DATABASE_URL.
 */
const path = require('path');

const PS = path.resolve(__dirname, '..', '..');
if (!/127\.0\.0\.1:\d+\/[^/?]*test/i.test(process.env.DATABASE_URL || '')) {
  console.error('refusing to start: DATABASE_URL is not an isolated local test database');
  process.exit(2);
}
process.env.TS_NODE_PROJECT = path.join(PS, 'tsconfig.json');
require(path.join(PS, 'node_modules', 'ts-node', 'register', 'transpile-only'));

// --- harness: the SDK talks to the fake Stripe on 127.0.0.1 ---
const stripePath = require.resolve('stripe', { paths: [path.join(PS, 'src')] });
const RealStripe = require(stripePath);
function TestStripe(key, config) {
  return new RealStripe(key, {
    ...config,
    host: '127.0.0.1',
    port: Number(process.env.FAKE_STRIPE_PORT),
    protocol: 'http',
    timeout: Number(process.env.STRIPE_TEST_TIMEOUT_MS || 20000),
  });
}
Object.setPrototypeOf(TestStripe, RealStripe);
TestStripe.default = TestStripe;
TestStripe.Stripe = TestStripe;
if (RealStripe.__esModule) TestStripe.__esModule = true;
require.cache[stripePath].exports = TestStripe;

const logger = require(path.join(PS, 'src', 'utils', 'logger')).default;
logger.transports.forEach((t) => { t.silent = true; });
const { PaymentService } = require(path.join(PS, 'src', 'services', 'payment.service'));
if (process.env.REFUND_LEASE_MS) PaymentService.REFUND_LEASE_MS = Number(process.env.REFUND_LEASE_MS);   // shorter lease for the tests

const continueResolvers = [];
process.on('message', async (m) => {
  if (!m) return;
  if (m.type === 'hold') {
    // barrier: the FIRST call of this step waits (inside whatever transaction it runs in) until { type: 'continue' }
    const original = PaymentService[m.method];
    let used = false;
    PaymentService[m.method] = async function held(...args) {
      if (!used) {
        used = true;
        process.send({ type: 'held', method: m.method });
        await new Promise((resolve) => continueResolvers.push(resolve));
      }
      return original.apply(this, args);
    };
    process.send({ type: 'hold-set', method: m.method });
    return;
  }
  if (m.type === 'continue') { const next = continueResolvers.shift(); if (next) next(); return; }
  if (m.type === 'park') {
    PaymentService[m.method] = function parked() {
      process.send({ type: 'parked', method: m.method });
      return new Promise(() => {});
    };
    process.send({ type: 'park-set', method: m.method });
    return;
  }
  if (m.type === 'call') {
    try {
      const result = await PaymentService[m.fn](...m.args);
      process.send({ type: 'result', id: m.id, ok: true, result: JSON.parse(JSON.stringify(result ?? null)) });
    } catch (error) {
      process.send({ type: 'result', id: m.id, ok: false, error: { message: error.message, code: error.code, httpStatus: error.httpStatus } });
    }
  }
});
process.on('disconnect', () => process.exit(0));
process.send({ type: 'ready', pid: process.pid });
