/**
 * FIX 06C-4B2B1 on a REAL MongoDB replica set: idempotent notification creation with X-Idempotency-Key.
 *
 * The REAL express app, the REAL generated Prisma client with the real `Notification` model, and the REAL Socket.IO gateway (every
 * push counted) run against the ISOLATED database named by TEST_DATABASE_URL (name must contain "test"; this file uses
 * `<name>_unidem`, dropped at the end). Before anything else the database receives key-less notifications written the old way and
 * then `prisma db push` with the new schema - the proof that the optional `idempotencyKey` field (no index) is compatible with them.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" npm test
 *
 * Skipped without TEST_DATABASE_URL. No Docker container, no shared database, no real learner.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { resolveTestDb } from '../helpers/test-db-url';

const target = resolveTestDb('unidem');
const ROUTE = '/api/users/internal/notifications';
const TOKEN = randomBytes(24).toString('hex');
const oid = () => randomBytes(12).toString('hex');
const payload = (userId: string, over: Record<string, unknown> = {}) => ({
  userId, title: '🏆 Chúc mừng!', message: 'Bạn đạt thứ hạng #1.', type: 'SUCCESS', link: '/leaderboard', ...over,
});
const rewardKey = (userId: string) => `reward_lb_notify_9_2026_${userId}`;

describe('REAL MongoDB: idempotent POST /api/users/internal/notifications (FIX 06C-4B2B1)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let admin: any;
  let server: any;
  let gateway: any;
  let base = '';
  let idem: any;
  const pushes: Array<{ userId: string; data: any }> = [];
  let failNextPush = false;
  const legacyIds: string[] = [];
  let pushResult = '';

  before(async () => {
    assert.match(target.url as string, /test/i);
    process.env.DATABASE_URL = target.url as string;
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
    process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(16).toString('hex');
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient({ datasources: { db: { url: target.url } } });
    await admin.$runCommandRaw({ dropDatabase: 1 });

    // notifications written the OLD way (no idempotencyKey field at all), several of them
    for (let i = 0; i < 4; i++) {
      const id = oid();
      legacyIds.push(id);
      await admin.$runCommandRaw({ insert: 'notifications', documents: [{ _id: { $oid: id }, userId: { $oid: 'a1'.repeat(12) }, title: `old ${i}`, message: 'm', type: 'INFO', isRead: false, createdAt: { $date: new Date().toISOString() } }] });
    }
    // what every start of the user-service container runs, with the NEW schema
    pushResult = execSync('npx prisma db push --skip-generate', { cwd: path.join(__dirname, '..', '..'), env: { ...process.env, DATABASE_URL: target.url as string }, stdio: 'pipe' }).toString();

    idem = require('../../src/services/notification-idempotency');
    const logger = require('../../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    gateway = require('../../src/sockets/notification.socket').initializeSockets(server);
    const realSend = gateway.sendNotificationToUser.bind(gateway);
    gateway.sendNotificationToUser = (userId: string, event: string, data: any) => {
      pushes.push({ userId, data });
      if (failNextPush) { failNextPush = false; throw new Error('socket gateway down'); }
      return realSend(userId, event, data);
    };
  });

  after(async () => {
    try { await admin?.$runCommandRaw({ collMod: 'notifications', validator: {}, validationLevel: 'off' }); } catch { /* not there */ }
    try { await admin?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
    try { gateway?.io?.close(); } catch { /* closed */ }
    await new Promise((resolve) => server?.close(resolve));
  });

  beforeEach(() => {
    pushes.length = 0;
    failNextPush = false;
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
  });

  const call = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-service-token': TOKEN, ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  const keyed = (body: unknown, key: string) => call(body, { 'x-idempotency-key': key });
  const countFor = (userId: string) => admin.notification.count({ where: { userId } });

  it('schema compatibility: `prisma db push` with the new optional field succeeds on a collection of key-less notifications, adds no index, and the old documents stay readable and untouched', async () => {
    assert.match(pushResult, /in sync|Done/);
    const idx = await admin.$runCommandRaw({ listIndexes: 'notifications' });
    const names = idx.cursor.firstBatch.map((i: any) => Object.keys(i.key).join('+'));
    assert.ok(!names.some((n: string) => n.includes('idempotencyKey')), 'no index on idempotencyKey');
    assert.ok(idx.cursor.firstBatch.every((i: any) => !i.unique), 'no unique index was added');
    for (const id of legacyIds) {
      const doc = await admin.notification.findUnique({ where: { id } });
      assert.ok(doc, 'still there');
      assert.equal(doc.idempotencyKey, null, 'the absent field reads as null');
    }
  });

  it('first request 201 with the derived id (read back from MongoDB) and one push; replay 200 deduplicated, unchanged, no second push', async () => {
    const u = oid();
    const key = rewardKey(u);
    const first = await keyed(payload(u), key);
    assert.equal(first.status, 201);
    assert.equal(first.json.deduplicated, false);
    const raw = await admin.$runCommandRaw({ find: 'notifications', filter: { idempotencyKey: key } });
    assert.equal(raw.cursor.firstBatch.length, 1);
    assert.equal(raw.cursor.firstBatch[0]._id.$oid, idem.deriveNotificationId(key), 'the _id in MongoDB is the one derived from the key');
    assert.equal(pushes.length, 1);

    const again = await keyed(payload(u), key);
    assert.equal(again.status, 200);
    assert.equal(again.json.deduplicated, true);
    assert.deepEqual(again.json.data, first.json.data);
    assert.equal(await countFor(u), 1);
    assert.equal(pushes.length, 1);
  });

  it('8 concurrent requests with the same key, 30 rounds: one notification and one push per round, one 201 + seven 200, no 5xx, _id = derived id', async () => {
    let requests = 0;
    let created = 0;
    let deduplicated = 0;
    for (let round = 0; round < 30; round++) {
      const u = oid();
      const key = rewardKey(u);
      const pushesBefore = pushes.length;
      const answers = await Promise.all(Array.from({ length: 8 }, () => keyed(payload(u), key)));
      requests += answers.length;
      assert.deepEqual(answers.map((a) => a.status).sort(), [200, 200, 200, 200, 200, 200, 200, 201], `round ${round}`);
      created += answers.filter((a) => a.json.deduplicated === false).length;
      deduplicated += answers.filter((a) => a.json.deduplicated === true).length;
      assert.equal(await countFor(u), 1, `round ${round}: one notification`);
      assert.equal(pushes.length - pushesBefore, 1, `round ${round}: one push`);
      const raw = await admin.$runCommandRaw({ find: 'notifications', filter: { idempotencyKey: key } });
      assert.equal(raw.cursor.firstBatch[0]._id.$oid, idem.deriveNotificationId(key));
    }
    assert.equal(requests, 240);
    assert.equal(created, 30);
    assert.equal(deduplicated, 210);
  });

  it('without a key, with a valid token: the old behaviour (a new notification each time, no key stored)', async () => {
    const u = oid();
    const a = await call(payload(u));
    const b = await call(payload(u));
    assert.deepEqual([a.status, b.status], [201, 201]);
    assert.notEqual(a.json.data.id, b.json.data.id);
    assert.equal(a.json.deduplicated, undefined);
    assert.equal(await countFor(u), 2);
    assert.equal(pushes.length, 2);
  });

  it('missing or wrong token -> 403, an invalid key or a key for another recipient -> 400: nothing written, no push', async () => {
    const u = oid();
    const noToken = await fetch(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-idempotency-key': rewardKey(u) }, body: JSON.stringify(payload(u)) });
    assert.equal(noToken.status, 403);
    assert.equal((await call(payload(u), { 'x-idempotency-key': rewardKey(u), 'x-internal-service-token': 'wrong' })).status, 403);
    for (const key of ['', 'has space', `reward_lb_notify_13_2026_${u}`, rewardKey(oid()), 'x'.repeat(201)]) {
      const r = await keyed(payload(u), key);
      assert.equal(r.status, 400, key.slice(0, 30));
      assert.equal(r.json.code, 'INVALID_IDEMPOTENCY_KEY');
    }
    assert.equal(await countFor(u), 0);
    assert.equal(pushes.length, 0);
  });

  it('same key with a different type / link / recipient -> 422 and the first notification is unchanged; only title/message changed -> 200 payloadChanged', async () => {
    const u = oid();
    const key = `audit-${oid()}`;
    const first = await keyed(payload(u), key);
    assert.equal(first.status, 201);
    for (const [over, field] of [[{ type: 'INFO' }, 'type'], [{ link: '/elsewhere' }, 'link'], [{ userId: oid() }, 'userId']] as Array<[any, string]>) {
      const r = await keyed(payload(u, over), key);
      assert.equal(r.status, 422);
      assert.equal(r.json.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.deepEqual(r.json.fields, [field]);
    }
    const changed = await keyed(payload(u, { title: 'New title', message: 'New message' }), key);
    assert.equal(changed.status, 200);
    assert.equal(changed.json.payloadChanged, true);
    const stored = await admin.notification.findUnique({ where: { id: idem.deriveNotificationId(key) } });
    assert.equal(stored.title, '🏆 Chúc mừng!');
    assert.equal(stored.message, 'Bạn đạt thứ hạng #1.');
    assert.equal(stored.type, 'SUCCESS');
    assert.equal(stored.link, '/leaderboard');
    assert.equal(await countFor(u), 1);
    assert.equal(pushes.length, 1);
  });

  it('a real database failure on create (collection validator refuses every insert) -> 500, no push; once the database is fine the retry creates exactly one', async () => {
    const u = oid();
    const key = rewardKey(u);
    await admin.$runCommandRaw({ collMod: 'notifications', validator: { $expr: false }, validationLevel: 'strict', validationAction: 'error' });
    let failed;
    try {
      failed = await keyed(payload(u), key);
    } finally {
      await admin.$runCommandRaw({ collMod: 'notifications', validator: {}, validationLevel: 'off' });
    }
    assert.equal(failed.status, 500);
    assert.equal(await countFor(u), 0);
    assert.equal(pushes.length, 0);
    const retry = await keyed(payload(u), key);
    assert.equal(retry.status, 201);
    assert.equal(await countFor(u), 1);
    assert.equal(pushes.length, 1);
  });

  it('the push fails after the notification was committed: 201, and the retry finds it (200 deduplicated) without a second notification or push', async () => {
    const u = oid();
    const key = rewardKey(u);
    failNextPush = true;
    const first = await keyed(payload(u), key);
    assert.equal(first.status, 201);
    assert.equal(pushes.length, 1);
    const retry = await keyed(payload(u), key);
    assert.equal(retry.status, 200);
    assert.equal(retry.json.deduplicated, true);
    assert.equal(await countFor(u), 1);
    assert.equal(pushes.length, 1);
  });

  it('documented limit: after the learner deleted the notification, a replay of its key creates it again (same id)', async () => {
    const u = oid();
    const key = rewardKey(u);
    await keyed(payload(u), key);
    await admin.notification.delete({ where: { id: idem.deriveNotificationId(key) } });
    const again = await keyed(payload(u), key);
    assert.equal(again.status, 201);
    assert.equal(again.json.data.id, idem.deriveNotificationId(key));
    assert.equal(await countFor(u), 1);
  });
});
