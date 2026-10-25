/**
 * Starts the REAL user-service (its express app, controllers, NotificationService, generated Prisma client and Socket.IO gateway) in this
 * child process, for end-to-end tests of the notification contract (FIX 06C-4B2B2). The parent passes DATABASE_URL (an ISOLATED test
 * database - refused otherwise) and INTERNAL_SERVICE_TOKEN in the environment; this process answers on 127.0.0.1 only, reports
 * `{ type: 'ready', port }` and every real-time push `{ type: 'push', userId, id }` over IPC. Logs are silenced (and would go to the
 * temp folder this process runs in, never into the repository).
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
const sockets = require(path.join(US, 'src', 'sockets', 'notification.socket'));
const http = require('http');

const server = http.createServer(app);
const gateway = sockets.initializeSockets(server);
const realSend = gateway.sendNotificationToUser.bind(gateway);
gateway.sendNotificationToUser = (userId, event, data) => {
  process.send && process.send({ type: 'push', userId, id: data && data.id });
  return realSend(userId, event, data);
};
server.listen(0, '127.0.0.1', () => process.send && process.send({ type: 'ready', port: server.address().port }));
process.on('disconnect', () => process.exit(0));
