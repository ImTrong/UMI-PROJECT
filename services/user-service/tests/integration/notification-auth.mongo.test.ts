/**
 * FIX 06C-4B2A against a REAL MongoDB replica set: POST /api/users/internal/notifications refuses every request that
 * does not carry the service token, and refusing means "nothing reaches the database and nothing is pushed".
 *
 * The REAL express app (real middleware, controller, NotificationService and Prisma client) runs on an ephemeral port
 * against the ISOLATED database named by TEST_DATABASE_URL (its name must contain "test"; this file uses its own database
 * `<name>_unot`, which is dropped at the end). The Socket.IO gateway is the real one; every push is counted.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" npm test
 *
 * Without TEST_DATABASE_URL this file is skipped. No Docker container, no shared database and no real learner is involved.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { resolveTestDb } from '../helpers/test-db-url';

const target = resolveTestDb('unot');
const ROUTE = '/api/users/internal/notifications';
const TOKEN = randomBytes(24).toString('hex'); // random per run: no secret in the source
const USER = 'b2'.repeat(12);
const payload = (over: Record<string, unknown> = {}) => ({
  userId: USER, title: '🏆 Chúc mừng!', message: 'Bạn đạt thứ hạng #1.', type: 'SUCCESS', link: '/leaderboard', ...over,
});

describe('REAL MongoDB: POST /api/users/internal/notifications is authenticated (FIX 06C-4B2A)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let admin: any;
  let server: any;
  let socketGateway: any;
  let base = '';
  const pushes: Array<{ userId: string; event: string; data: any }> = [];

  before(async () => {
    assert.match(target.url as string, /test/i, 'refusing to run against a database whose name does not contain "test"');
    process.env.DATABASE_URL = target.url as string;          // the app's own Prisma client reads this
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
    process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(16).toString('hex');
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient({ datasources: { db: { url: target.url } } });
    await admin.$runCommandRaw({ dropDatabase: 1 });

    const logger = require('../../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // the real Socket.IO gateway on the same server; every push through it is counted
    const sockets = require('../../src/sockets/notification.socket');
    socketGateway = sockets.initializeSockets(server);
    const realSend = socketGateway.sendNotificationToUser.bind(socketGateway);
    socketGateway.sendNotificationToUser = (userId: string, event: string, data: any) => {
      pushes.push({ userId, event, data });
      return realSend(userId, event, data);
    };
  });

  after(async () => {
    try { await admin?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
    try { socketGateway?.io?.close(); } catch { /* already closed */ }
    await new Promise((resolve) => server?.close(resolve));
  });

  beforeEach(async () => {
    await admin.notification.deleteMany({});
    pushes.length = 0;
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
  });

  const call = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const stored = () => admin.notification.count();

  it('without a token: 403, the collection stays empty, no push - even for 25 requests at the same instant', async () => {
    const answers = await Promise.all(Array.from({ length: 25 }, () => call(payload())));
    assert.ok(answers.every((a) => a.status === 403));
    assert.equal(await stored(), 0);
    assert.equal(pushes.length, 0);
  });

  it('with a wrong token (same length, shorter, longer, empty): 403, nothing stored, no push', async () => {
    const wrong = [`${TOKEN[0] === 'a' ? 'b' : 'a'}${TOKEN.slice(1)}`, TOKEN.slice(0, -1), `${TOKEN}0`, ''];
    for (const token of wrong) {
      const res = await call(payload(), { 'x-internal-service-token': token });
      assert.equal(res.status, 403);
      assert.ok(!res.text.includes(TOKEN) && !res.text.includes(TOKEN.slice(0, 12)));
    }
    assert.equal(await stored(), 0);
    assert.equal(pushes.length, 0);
  });

  it('with the right token: exactly one document with the existing fields, one push, and the existing answer', async () => {
    const res = await call(payload(), { 'x-internal-service-token': TOKEN });
    assert.equal(res.status, 201);
    assert.equal(res.json.message, 'Notification created successfully');
    assert.equal(await stored(), 1);
    const doc = await admin.notification.findFirst({});
    assert.equal(doc.userId, USER);
    assert.equal(doc.title, '🏆 Chúc mừng!');
    assert.equal(doc.message, 'Bạn đạt thứ hạng #1.');
    assert.equal(doc.type, 'SUCCESS');
    assert.equal(doc.link, '/leaderboard');
    assert.equal(doc.isRead, false);
    assert.equal(res.json.data.id, doc.id);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].userId, USER);
    assert.equal(pushes[0].event, 'new_notification');
    assert.equal(pushes[0].data.id, doc.id);
  });

  it('refused and accepted requests mixed at the same instant: only the authenticated ones are stored and pushed', async () => {
    const answers = await Promise.all([
      ...Array.from({ length: 10 }, () => call(payload())),
      ...Array.from({ length: 3 }, () => call(payload(), { 'x-internal-service-token': TOKEN })),
      ...Array.from({ length: 10 }, () => call(payload(), { 'x-internal-service-token': 'wrong' })),
    ]);
    assert.equal(answers.filter((a) => a.status === 201).length, 3);
    assert.equal(answers.filter((a) => a.status === 403).length, 20);
    assert.equal(await stored(), 3);
    assert.equal(pushes.length, 3);
  });

  it('without INTERNAL_SERVICE_TOKEN configured the route is closed (500), whatever header is sent', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    for (const headers of [{}, { 'x-internal-service-token': TOKEN }, { 'x-internal-service-token': '' }]) {
      const res = await call(payload(), headers);
      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { error: 'Internal service authentication not configured' });
    }
    assert.equal(await stored(), 0);
    assert.equal(pushes.length, 0);
  });

  it('a malformed body with the right token keeps its existing behaviour (500) and stores nothing', async () => {
    const res = await call({ ...payload(), userId: 'not-an-object-id' }, { 'x-internal-service-token': TOKEN });
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: 'Failed to create notification' });
    assert.equal(await stored(), 0);
    assert.equal(pushes.length, 0);
  });
});
