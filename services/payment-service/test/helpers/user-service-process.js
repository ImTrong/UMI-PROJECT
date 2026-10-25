/**
 * Starts the REAL user-service (express app, middleware, controllers, UserService and its generated Prisma client) in this child
 * process, for the Payment -> User end-to-end test of FIX 07B-1. The parent passes DATABASE_URL (an ISOLATED local test database -
 * refused otherwise) and PAYMENT_USER_TOKEN in the environment; it can change one variable later with `{ type: 'env', key, value }`
 * (value null = unset). This process answers on 127.0.0.1 only and reports `{ type: 'ready', port }` over IPC. Logs are silenced.
 */
const path = require('path');

const US = path.resolve(__dirname, '..', '..', '..', 'user-service');
if (!/127\.0\.0\.1:\d+\/[^/?]*test/i.test(process.env.DATABASE_URL || '')) {
  console.error('refusing to start: DATABASE_URL is not an isolated local test database');
  process.exit(2);
}
process.env.TS_NODE_PROJECT = path.join(US, 'tsconfig.json');
require(path.join(US, 'node_modules', 'ts-node', 'register', 'transpile-only'));

const logger = require(path.join(US, 'src', 'utils', 'logger')).default;
logger.transports.forEach((t) => { t.silent = true; });
const app = require(path.join(US, 'src', 'app')).default;

process.on('message', (msg) => {
  if (!msg || msg.type !== 'env') return;
  if (msg.value === null) delete process.env[msg.key];
  else process.env[msg.key] = msg.value;
  process.send && process.send({ type: 'env-set', key: msg.key });
});
const server = app.listen(0, '127.0.0.1', () => process.send && process.send({ type: 'ready', port: server.address().port }));
process.on('disconnect', () => process.exit(0));
