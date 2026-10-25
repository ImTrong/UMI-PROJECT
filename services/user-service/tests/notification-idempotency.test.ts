/**
 * FIX 06C-4B2B1: idempotent notification creation (X-Idempotency-Key) - contract tests.
 *
 * Part 1 - the pure functions (deriveNotificationId, readIdempotencyKey, identityMismatch).
 * Part 2 - the REAL express app (real route, authentication, controller, NotificationService) with the database client replaced
 *          by an in-memory stand-in that enforces a unique _id exactly like MongoDB (Prisma error P2002 on `_id_`) and can inject
 *          failures, and the Socket.IO gateway replaced by a recorder. The same behaviour on a real replica set:
 *          tests/integration/notification-idempotency.mongo.test.ts.
 *
 * No secret in this file: the internal token is random per run.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const ROUTE = '/api/users/internal/notifications';

// ---- in-memory Prisma stand-in with MongoDB's unique _id (installed before the app is loaded) ----
const docs = new Map<string, any>();
let autoId = 0;
const fault = { failNextCreate: null as null | Error, hideOnRead: false, createCalls: 0 };
const duplicateId = () => Object.assign(new Error('Unique constraint failed on the constraint: `_id_`'), { code: 'P2002', meta: { modelName: 'Notification', target: '_id_' } });

class FakePrismaClient {
  userProfile = { findMany: async () => [] as any[] };
  notification = {
    create: async ({ data }: any) => {
      fault.createCalls++;
      await new Promise((r) => setImmediate(r)); // let concurrent requests really interleave
      if (fault.failNextCreate) { const e = fault.failNextCreate; fault.failNextCreate = null; throw e; }
      const id = data.id ?? String(++autoId).padStart(24, 'f');
      if (docs.has(id)) throw duplicateId();
      const row = {
        id, userId: data.userId, title: data.title, message: data.message, type: data.type ?? 'INFO', isRead: false,
        link: data.link ?? null, createdAt: new Date('2026-10-23T00:00:00.000Z'), idempotencyKey: data.idempotencyKey ?? null,
      };
      docs.set(id, row);
      return { ...row };
    },
    findUnique: async ({ where }: any) => {
      await new Promise((r) => setImmediate(r));
      if (fault.hideOnRead) return null;
      const row = docs.get(where.id);
      return row ? { ...row } : null;
    },
  };
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient, Role: { STUDENT: 'STUDENT', INSTRUCTOR: 'INSTRUCTOR', ADMIN: 'ADMIN' } },
} as any;

const TOKEN = randomBytes(24).toString('hex');
const U1 = 'a1'.repeat(12);
const U2 = 'b2'.repeat(12);
const KEY = `reward_lb_notify_9_2026_${U1}`;
const payload = (over: Record<string, unknown> = {}) => ({
  userId: U1, title: '🏆 Chúc mừng!', message: 'Bạn đạt thứ hạng #1.', type: 'SUCCESS', link: '/leaderboard', ...over,
});

/* eslint-disable @typescript-eslint/no-var-requires */
const idem = require('../src/services/notification-idempotency');

// ================================================================================================ part 1
describe('notification idempotency: pure functions', () => {
  it('deriveNotificationId = first 12 bytes of SHA-256(versioned namespace + key), as 24 hex characters', () => {
    assert.equal(idem.NOTIFICATION_ID_NAMESPACE, 'umi:notification-idempotency:v1:');
    const expected = createHash('sha256').update(`umi:notification-idempotency:v1:${KEY}`).digest().subarray(0, 12).toString('hex');
    assert.equal(idem.deriveNotificationId(KEY), expected);
    // pinned value (the one measured in the audit FIX 06C-4B1): a change of namespace or algorithm would re-create delivered notifications
    assert.equal(idem.deriveNotificationId(`reward_lb_notify_9_2026_${'a'.repeat(23)}1`), '7183bdf58362a98ab58c8b1f');
    assert.match(idem.deriveNotificationId(KEY), /^[0-9a-f]{24}$/);
  });

  it('is a pure function: same key -> same id, every time; different keys -> different ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add(idem.deriveNotificationId(KEY));
    assert.equal(ids.size, 1);
    const many = new Set(Array.from({ length: 2000 }, (_, i) => idem.deriveNotificationId(`k_${i}`)));
    assert.equal(many.size, 2000);
  });

  it('checks the key BEFORE hashing', () => {
    for (const bad of ['', ' ', 'a b', 'x\ny', 'x\u0000', 'é', 'k,k', 'x'.repeat(201)]) {
      assert.throws(() => idem.deriveNotificationId(bad), idem.IdempotencyKeyError, JSON.stringify(bad).slice(0, 30));
    }
    assert.doesNotThrow(() => idem.deriveNotificationId('x'.repeat(200)));
  });

  it('readIdempotencyKey: no header -> undefined (the old flow); exactly one valid key matching the recipient -> the key', () => {
    assert.equal(idem.readIdempotencyKey(undefined, payload()), undefined);
    assert.equal(idem.readIdempotencyKey(KEY, payload()), KEY);
    assert.equal(idem.readIdempotencyKey(`reward_lb_notify_12_2030_${U1.toUpperCase()}`, payload()), `reward_lb_notify_12_2030_${U1.toUpperCase()}`);
    assert.equal(idem.readIdempotencyKey('badge:course_completer:abc-1', payload()), 'badge:course_completer:abc-1');
  });

  it('readIdempotencyKey rejects every malformed key or recipient mismatch', () => {
    const bad: Array<[any, any]> = [
      ['', payload()], ['   ', payload()], [[KEY, KEY], payload()], [`${KEY}, ${KEY}`, payload()], ['k\tk', payload()],
      ['x'.repeat(201), payload()],
      ['reward_lb_notify_13_2026_' + U1, payload()], ['reward_lb_notify_0_2026_' + U1, payload()], ['reward_lb_notify_9_1999_' + U1, payload()],
      ['reward_lb_notify_9_26_' + U1, payload()], ['reward_lb_notify_9_2026_' + U1.slice(1), payload()], ['reward_lb_notify_9_2026', payload()],
      ['reward_lb_notify_x_2026_' + U1, payload()],
      [KEY, payload({ userId: U2 })],                 // key for U1, body for U2
      ['other-key', payload({ userId: 'not-an-id' })],  // keyed request without a valid recipient
      ['other-key', { title: 't', message: 'm' }],
    ];
    for (const [header, body] of bad) assert.throws(() => idem.readIdempotencyKey(header, body), idem.IdempotencyKeyError, String(header).slice(0, 40));
  });

  it('identityMismatch compares userId, type (default INFO) and link (default null) only', () => {
    const stored = { userId: U1, type: 'SUCCESS', link: '/leaderboard' };
    assert.deepEqual(idem.identityMismatch(stored, payload({ title: 'other', message: 'other' })), []);
    assert.deepEqual(idem.identityMismatch(stored, payload({ userId: U2, type: 'INFO', link: '/x' })), ['userId', 'type', 'link']);
    assert.deepEqual(idem.identityMismatch({ userId: U1, type: 'INFO', link: null }, { userId: U1 }), []);
  });
});

// ================================================================================================ part 2
describe('POST /api/users/internal/notifications with X-Idempotency-Key (real express app, unique-_id stand-in)', () => {
  let server: any;
  let base = '';
  const pushes: Array<{ userId: string; data: any }> = [];
  let failNextPush = false;

  before(async () => {
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
    process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(16).toString('hex');
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../src/app').default;
    require('../src/sockets/notification.socket').notificationSocket = {
      sendNotificationToUser: (userId: string, _event: string, data: any) => {
        pushes.push({ userId, data });
        if (failNextPush) { failNextPush = false; throw new Error('socket gateway down'); }
      },
    };
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); });
  beforeEach(() => {
    docs.clear();
    pushes.length = 0;
    Object.assign(fault, { failNextCreate: null, hideOnRead: false, createCalls: 0 });
    failNextPush = false;
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
  });

  const call = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-service-token': TOKEN, ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers };
  };
  const keyed = (body: unknown, key = KEY, extra: Record<string, string> = {}) => call(body, { 'x-idempotency-key': key, ...extra });

  it('first request: 201, one notification with the DERIVED id and the key, one push, deduplicated:false', async () => {
    const r = await keyed(payload());
    assert.equal(r.status, 201);
    assert.equal(r.json.message, 'Notification created successfully');
    assert.equal(r.json.deduplicated, false);
    assert.equal(r.json.data.id, idem.deriveNotificationId(KEY));
    assert.equal(r.json.data.idempotencyKey, KEY);
    assert.equal(docs.size, 1);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].data.id, idem.deriveNotificationId(KEY));
  });

  it('replay: 200, deduplicated:true, the same notification unchanged, nothing written, no second push', async () => {
    const first = await keyed(payload());
    const second = await keyed(payload());
    assert.equal(second.status, 200);
    assert.equal(second.json.deduplicated, true);
    assert.equal(second.json.message, 'Notification already created');
    assert.deepEqual(second.json.data, first.json.data);
    assert.equal(second.json.payloadChanged, undefined);
    assert.equal(docs.size, 1);
    assert.equal(pushes.length, 1);
  });

  it('8 concurrent requests with the same key x 30 rounds: one 201 and seven 200 per round, one notification, one push, no 5xx', async () => {
    for (let round = 0; round < 30; round++) {
      const key = `reward_lb_notify_9_2026_${randomBytes(12).toString('hex')}`;
      const userId = key.slice(-24);
      const before = pushes.length;
      const answers = await Promise.all(Array.from({ length: 8 }, () => keyed(payload({ userId }), key)));
      const statuses = answers.map((a) => a.status).sort();
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 201], `round ${round}`);
      assert.equal(answers.filter((a) => a.json.deduplicated === false).length, 1);
      assert.equal(pushes.length - before, 1, `round ${round}: one push`);
      const id = idem.deriveNotificationId(key);
      assert.ok(docs.has(id));
      assert.ok(answers.every((a) => a.json.data.id === id));
    }
    assert.equal(docs.size, 30);
  });

  it('a request WITHOUT a key keeps the old behaviour: a new notification every time, random id, no key stored', async () => {
    const a = await call(payload());
    const b = await call(payload());
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.json.deduplicated, undefined, 'the old answer has no deduplicated field');
    assert.notEqual(a.json.data.id, b.json.data.id);
    assert.equal(a.json.data.idempotencyKey, null);
    assert.equal(docs.size, 2);
    assert.equal(pushes.length, 2);
  });

  it('the key does not replace authentication: no token or a wrong token -> 403, nothing written, no push', async () => {
    const noToken = await fetch(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-idempotency-key': KEY }, body: JSON.stringify(payload()) });
    assert.equal(noToken.status, 403);
    assert.equal((await keyed(payload(), KEY, { 'x-internal-service-token': 'wrong' })).status, 403);
    assert.equal(fault.createCalls, 0);
    assert.equal(pushes.length, 0);
  });

  it('an invalid key or a key for another recipient -> 400 INVALID_IDEMPOTENCY_KEY, nothing written, no push', async () => {
    for (const [key, body] of [
      ['', payload()], ['two words', payload()], [`${KEY}, ${KEY}`, payload()], ['x'.repeat(201), payload()],
      ['reward_lb_notify_13_2026_' + U1, payload()], ['reward_lb_notify_9_2026_' + U2, payload()],
      ['valid-key', payload({ userId: 'nope' })],
    ] as Array<[string, any]>) {
      const r = await keyed(body, key);
      assert.equal(r.status, 400, JSON.stringify(key).slice(0, 40));
      assert.equal(r.json.code, 'INVALID_IDEMPOTENCY_KEY');
    }
    assert.equal(fault.createCalls, 0);
    assert.equal(pushes.length, 0);
  });

  it('same key, different type / link / recipient -> 422 IDEMPOTENCY_KEY_REUSED and the first notification is untouched', async () => {
    await keyed(payload({ userId: U1 }), 'shared-key');
    const original = { ...docs.get(idem.deriveNotificationId('shared-key')) };
    for (const [over, field] of [[{ type: 'INFO' }, 'type'], [{ link: '/other' }, 'link'], [{ userId: U2 }, 'userId']] as Array<[any, string]>) {
      const r = await keyed(payload(over), 'shared-key');
      assert.equal(r.status, 422);
      assert.equal(r.json.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.deepEqual(r.json.fields, [field]);
    }
    assert.deepEqual(docs.get(idem.deriveNotificationId('shared-key')), original);
    assert.equal(docs.size, 1);
    assert.equal(pushes.length, 1);
  });

  it('same key, only title / message differ -> 200 deduplicated with payloadChanged, the first text stays', async () => {
    const first = await keyed(payload());
    const r = await keyed(payload({ title: 'Another title', message: 'Another message' }));
    assert.equal(r.status, 200);
    assert.equal(r.json.deduplicated, true);
    assert.equal(r.json.payloadChanged, true);
    assert.equal(r.json.data.title, first.json.data.title);
    assert.equal(docs.get(idem.deriveNotificationId(KEY)).message, 'Bạn đạt thứ hạng #1.');
    assert.equal(pushes.length, 1);
  });

  it('a database failure on create -> 500, no push; the retry creates exactly one notification', async () => {
    fault.failNextCreate = new Error('connection reset by the database');
    const failed = await keyed(payload());
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.json, { error: 'Failed to create notification' });
    assert.equal(docs.size, 0);
    assert.equal(pushes.length, 0);
    const retry = await keyed(payload());
    assert.equal(retry.status, 201);
    assert.equal(docs.size, 1);
    assert.equal(pushes.length, 1);
  });

  it('a duplicate _id whose notification cannot be read back -> 409 IDEMPOTENCY_RETRY with Retry-After, never a fake "deduplicated"', async () => {
    await keyed(payload());
    fault.hideOnRead = true;
    const r = await keyed(payload());
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'IDEMPOTENCY_RETRY');
    assert.equal(r.headers.get('retry-after'), '1');
    assert.equal(r.json.deduplicated, undefined);
    assert.equal(pushes.length, 1);
  });

  it('the push fails AFTER the notification was stored: the request still succeeds, and the retry finds it without pushing again', async () => {
    failNextPush = true;
    const first = await keyed(payload());
    assert.equal(first.status, 201, 'the notification is stored; the push is best effort');
    assert.equal(pushes.length, 1, 'one push attempt (it failed)');
    const retry = await keyed(payload());
    assert.equal(retry.status, 200);
    assert.equal(retry.json.deduplicated, true);
    assert.equal(docs.size, 1);
    assert.equal(pushes.length, 1, 'no second push');
  });

  it('documented limit: once the notification is deleted, a replay of its key creates it again', async () => {
    await keyed(payload());
    docs.delete(idem.deriveNotificationId(KEY));
    const r = await keyed(payload());
    assert.equal(r.status, 201);
    assert.equal(docs.size, 1);
  });
});
