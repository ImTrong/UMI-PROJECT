/**
 * Starts the REAL order-service (express app, middleware, controllers, OrderService and its generated Prisma client) in this child
 * process, so the Order <-> Payment end-to-end test of FIX 07B-2A can give each service its OWN environment (e.g. two different
 * ORDER_PAYMENT_TOKEN values). The parent passes DATABASE_URL (an ISOLATED local test database - refused otherwise) and the service
 * URLs; it changes one variable later with `{ type: 'env', key, value }` (value null = unset). Answers on 127.0.0.1 only, reports
 * `{ type: 'ready', port }` over IPC. Logs are silenced (and would go to the temp folder this process runs in).
 */
const path = require('path');

const OS = path.resolve(__dirname, '..', '..', '..', 'order-service');
if (!/127\.0\.0\.1:\d+\/[^/?]*test/i.test(process.env.DATABASE_URL || '')) {
  console.error('refusing to start: DATABASE_URL is not an isolated local test database');
  process.exit(2);
}
process.env.TS_NODE_PROJECT = path.join(OS, 'tsconfig.json');
require(path.join(OS, 'node_modules', 'ts-node', 'register', 'transpile-only'));

const logger = require(path.join(OS, 'src', 'utils', 'logger')).default;
logger.transports.forEach((t) => { t.silent = true; });
const app = require(path.join(OS, 'src', 'app')).default;

process.on('message', (msg) => {
  if (!msg || msg.type !== 'env') return;
  if (msg.value === null) delete process.env[msg.key];
  else process.env[msg.key] = msg.value;
  process.send && process.send({ type: 'env-set', key: msg.key });
});
const server = app.listen(0, '127.0.0.1', () => process.send && process.send({ type: 'ready', port: server.address().port }));
process.on('disconnect', () => process.exit(0));
