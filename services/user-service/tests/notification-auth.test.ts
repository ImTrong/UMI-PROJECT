/**
 * FIX 06C-4B2A: POST /api/users/internal/notifications is a service-to-service route and must be authenticated.
 *
 * The REAL express app is started on an ephemeral port (real middleware, rate limiter, routing, controller and
 * NotificationService); only the database client is replaced by a tiny in-memory stand-in that COUNTS every notification
 * it is asked to store, and the Socket.IO gateway by a recorder that counts every push. Nothing here touches a real
 * database, a real user or the network beyond 127.0.0.1. The same guarantees are checked against a real MongoDB replica
 * set (isolated TEST_DATABASE_URL) by tests/integration/notification-auth.mongo.test.ts.
 *
 * No token appears in this file: every run draws a fresh random one.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const ROUTE = '/api/users/internal/notifications';

// ---- minimal Prisma stand-in (installed before the app is loaded) ----
const stored: Array<{ data: any; row: any }> = [];
let failCreate = false;

class FakePrismaClient {
  userProfile = { findMany: async () => [] as any[] };
  notification = {
    create: async ({ data }: any) => {
      if (failCreate) throw new Error('database unavailable');
      const row = {
        id: String(stored.length + 1).padStart(24, '0'),
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type,
        isRead: false,
        link: data.link ?? null,
        createdAt: new Date('2026-10-22T00:00:00.000Z'),
      };
      stored.push({ data, row });
      return row;
    },
  };
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient, Role: { STUDENT: 'STUDENT', INSTRUCTOR: 'INSTRUCTOR', ADMIN: 'ADMIN' } },
} as any;

// a fresh random secret for every run - the source and the fixtures never contain one
const TOKEN = randomBytes(24).toString('hex');
const USER = 'a1'.repeat(12);
const body = (over: Record<string, unknown> = {}) => ({
  userId: USER,
  title: '🏆 Chúc mừng!',
  message: 'Bạn đạt thứ hạng #1.',
  type: 'SUCCESS',
  link: '/leaderboard',
  ...over,
});

describe('POST /api/users/internal/notifications (FIX 06C-4B2A)', () => {
  let server: http.Server;
  let base = '';
  let app: any;
  const pushes: Array<{ userId: string; event: string; data: any }> = [];

  before(async () => {
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
    process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(16).toString('hex');
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    app = require('../src/app').default;
    // the Socket.IO gateway is a module-level singleton that NotificationService reads at call time
    require('../src/sockets/notification.socket').notificationSocket = {
      sendNotificationToUser: (userId: string, event: string, data: any) => { pushes.push({ userId, event, data }); },
    };
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    stored.length = 0;
    pushes.length = 0;
    failCreate = false;
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
  });

  const call = async (payload: unknown, headers: Record<string, string> = {}, path = ROUTE, method = 'POST') => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(payload),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const withToken = (token: string) => ({ 'x-internal-service-token': token });
  const nothingHappened = (label: string) => {
    assert.equal(stored.length, 0, `${label}: no Notification may be stored`);
    assert.equal(pushes.length, 0, `${label}: nothing may be pushed over the socket`);
  };

  // ------------------------------------------------------------------------------------------------ refusals

  it('a request WITHOUT the token is refused with 403: nothing stored, nothing pushed', async () => {
    const res = await call(body());
    assert.equal(res.status, 403);
    assert.deepEqual(res.json, { error: 'Forbidden: Invalid internal service token' });
    nothingHappened('no token');
  });

  it('a WRONG token is refused with 403 - same length, shorter, longer, other case, empty: nothing stored, nothing pushed', async () => {
    const wrong = [
      `${TOKEN[0] === 'a' ? 'b' : 'a'}${TOKEN.slice(1)}`,   // one character different, same length
      TOKEN.slice(0, -1),                                   // shorter
      `${TOKEN}0`,                                          // longer
      TOKEN.toUpperCase(),                                  // other case
      'x',
    ];
    for (const token of wrong) {
      const res = await call(body(), withToken(token));
      assert.equal(res.status, 403, `token "${token.slice(0, 6)}…"`);
      assert.deepEqual(res.json, { error: 'Forbidden: Invalid internal service token' });
    }
    const empty = await call(body(), { 'x-internal-service-token': '' });
    assert.equal(empty.status, 403);
    nothingHappened('wrong token');
  });

  it('the secret counts only in the X-Internal-Service-Token header (query string, body, Authorization, other header names do not)', async () => {
    const attempts: Array<[string, Promise<{ status: number }>]> = [
      ['query string', call(body(), {}, `${ROUTE}?token=${TOKEN}&x-internal-service-token=${TOKEN}`)],
      ['body field', call(body({ token: TOKEN, internalToken: TOKEN, 'x-internal-service-token': TOKEN }))],
      ['Authorization: Bearer', call(body(), { authorization: `Bearer ${TOKEN}` })],
      ['x-internal-token', call(body(), { 'x-internal-token': TOKEN })],
      ['internal-service-token', call(body(), { 'internal-service-token': TOKEN })],
      ['x-internal-service: true', call(body(), { 'x-internal-service': 'true' })],
    ];
    for (const [label, promise] of attempts) assert.equal((await promise).status, 403, label);
    nothingHappened('token in the wrong place');
  });

  it('the right token repeated or mixed with another value does not pass (duplicate header)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        `${base}${ROUTE}`,
        { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-service-token': [TOKEN, TOKEN] } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode || 0)); }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body()));
    });
    assert.equal(status, 403);
    nothingHappened('duplicate header');
  });

  it('refusals do not reveal the configured secret, the secret that was sent, or any internals', async () => {
    const sent = `${TOKEN.slice(0, 20)}-not-it`;
    const answers = [await call(body()), await call(body(), withToken(sent))];
    delete process.env.INTERNAL_SERVICE_TOKEN;
    answers.push(await call(body(), withToken(sent)));
    for (const a of answers) {
      assert.ok(!a.text.includes(TOKEN), 'the configured secret is not in the answer');
      assert.ok(!a.text.includes(TOKEN.slice(0, 12)), 'no part of the configured secret is in the answer');
      assert.ok(!a.text.includes(sent), 'the secret that was sent is not echoed back');
      assert.ok(!/node_modules|\bat .*\(|INTERNAL_SERVICE_TOKEN|stack/i.test(a.text), 'no stack trace or variable name');
      assert.deepEqual(Object.keys(a.json), ['error'], 'the answer is just {error}');
    }
    nothingHappened('refusals');
  });

  it('WITHOUT INTERNAL_SERVICE_TOKEN configured every request is refused (fail-closed, 500) - never let through', async () => {
    for (const configured of [undefined, '']) {
      if (configured === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
      else process.env.INTERNAL_SERVICE_TOKEN = configured;
      for (const headers of [{}, withToken(TOKEN), withToken('anything'), withToken('')]) {
        const res = await call(body(), headers);
        assert.equal(res.status, 500, `configured=${JSON.stringify(configured)}`);
        assert.deepEqual(res.json, { error: 'Internal service authentication not configured' });
      }
    }
    nothingHappened('token not configured');
  });

  it('a whitespace-only secret is "configured" for the middleware but nothing can match it: every request is still refused', async () => {
    process.env.INTERNAL_SERVICE_TOKEN = '   ';
    for (const headers of [{}, withToken(TOKEN), withToken(''), withToken('   ')]) {
      const res = await call(body(), headers);
      assert.ok([403, 500].includes(res.status), `status ${res.status}`);
    }
    nothingHappened('whitespace-only secret');
  });

  // ------------------------------------------------------------------------------------------------ the authenticated path keeps its contract

  it('a correct token stores exactly ONE notification and pushes it once; the answer keeps the existing contract', async () => {
    const res = await call(body(), withToken(TOKEN));
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.json).sort(), ['data', 'message']);
    assert.equal(res.json.message, 'Notification created successfully');
    assert.deepEqual(res.json.data, {
      id: '000000000000000000000001', userId: USER, title: '🏆 Chúc mừng!', message: 'Bạn đạt thứ hạng #1.',
      type: 'SUCCESS', isRead: false, link: '/leaderboard', createdAt: '2026-10-22T00:00:00.000Z',
    });
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].data, { userId: USER, title: '🏆 Chúc mừng!', message: 'Bạn đạt thứ hạng #1.', type: 'SUCCESS', link: '/leaderboard' });
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].userId, USER);
    assert.equal(pushes[0].event, 'new_notification');
    assert.equal(pushes[0].data.id, '000000000000000000000001');
  });

  it('defaults of the existing business logic are untouched: type falls back to INFO, link is optional', async () => {
    const res = await call({ userId: USER, title: 't', message: 'm' }, withToken(TOKEN));
    assert.equal(res.status, 201);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].data.type, 'INFO');
    assert.equal(stored[0].data.link, undefined);
    assert.equal(res.json.data.link, null);
    assert.equal(pushes.length, 1);
  });

  it('a database failure after a correct token still answers 500 {error} and pushes nothing (existing behaviour)', async () => {
    failCreate = true;
    const res = await call(body(), withToken(TOKEN));
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: 'Failed to create notification' });
    nothingHappened('database failure');
  });

  it('the header name is case-insensitive like every HTTP header', async () => {
    const res = await call(body(), { 'X-Internal-Service-Token': TOKEN });
    assert.equal(res.status, 201);
    assert.equal(stored.length, 1);
  });

  // ------------------------------------------------------------------------------------------------ no way around the check

  it('no equivalent unprotected route: other methods and other spellings of the path create nothing', async () => {
    const spellings: Array<[string, string]> = [
      ['POST', `${ROUTE}/`],
      ['POST', ROUTE.toUpperCase()],
      ['POST', `/${ROUTE}`],
      ['POST', ROUTE.replace('/internal/', '/internal%2F')],
      ['POST', `${ROUTE}?x=1`],
      ['PUT', ROUTE], ['PATCH', ROUTE], ['DELETE', ROUTE], ['GET', ROUTE],
    ];
    for (const [method, path] of spellings) {
      const res = await call(body(), {}, path, method);
      assert.notEqual(res.status, 201, `${method} ${path}`);
      assert.ok([403, 404].includes(res.status), `${method} ${path} -> ${res.status}`);
    }
    // the spellings Express treats as the same route (trailing slash, upper case) must hit the check, not skip it
    assert.equal((await call(body(), {}, `${ROUTE}/`)).status, 403);
    assert.equal((await call(body(), {}, ROUTE.toUpperCase())).status, 403);
    nothingHappened('alternative spellings');
  });

  it('route table: exactly one route answers POST on the path, and `verifyInternalService` runs before the controller', () => {
    const { verifyInternalService } = require('../src/middleware/internal-auth.middleware');
    const { NotificationController } = require('../src/controllers/notification.controller');
    const layers = (app._router.stack as any[]).filter((l) => l.route && l.match(ROUTE) && l.route._handles_method('post'));
    assert.equal(layers.length, 1, 'one route handles POST on the path');
    const handlers = layers[0].route.stack.map((s: any) => s.handle);
    assert.deepEqual(layers[0].route.methods, { post: true });
    assert.equal(handlers.length, 2);
    assert.equal(handlers[0], verifyInternalService);
    assert.equal(handlers[1], NotificationController.createInternalNotification);
    // no `app.use(...)` layer sits between the routes (it could answer or re-route a request before the protected one is reached):
    // every non-route layer is registered before the first route (global middleware) or after the last one (404 + error handler)
    const stack = app._router.stack as any[];
    const routeIdx = stack.map((l, i) => (l.route ? i : -1)).filter((i) => i >= 0);
    const [first, last] = [routeIdx[0], routeIdx[routeIdx.length - 1]];
    stack.forEach((l, i) => { if (!l.route) assert.ok(i < first || i > last, `layer #${i} (${l.name}) sits between routes`); });
  });

  it('nothing else about the routing changed: the whole route table is pinned (only this route gained a middleware)', () => {
    const rows = (app._router.stack as any[])
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path} :: ${l.route.stack.map((s: any) => s.handle.name || '<anonymous>').join(' > ')}`);
    assert.deepEqual(rows, [
      'GET /api/users/health :: healthCheck',
      'GET /api/users/public/:userId :: getPublicProfile',
      'POST /api/users/batch :: getBatchUsers',
      'POST /api/users/internal/eligibility :: verifyInternalService > getEligibilityBatch',
      'GET /api/users :: authenticateToken > attachUserRole > getAllUsers', // FIX-INS-01: role read from the database for the admin / directory split
      'GET /api/users/me :: authenticateToken > getMyProfile',
      'GET /api/users/profile/avatar/upload-url :: authenticateToken > getAvatarUploadUrl',
      'PUT /api/users/me :: authenticateToken > <anonymous> > middleware > middleware > middleware > middleware > middleware > middleware > middleware > handleValidationErrors > updateMyProfile', // FIX-INS-01: allowOnlyFields + 7 type-checked profile fields
      'DELETE /api/users/me :: authenticateToken > deleteMyProfile',
      'GET /api/users/me/stats :: authenticateToken > getUserStats',
      'POST /api/users :: authenticateToken > <anonymous> > middleware > middleware > middleware > middleware > handleValidationErrors > createUserProfile',
      'GET /api/users/:userId :: authenticateToken > attachUserRole > middleware > handleValidationErrors > getUserProfile', // FIX-INS-01
      'POST /api/users/me/education :: authenticateToken > middleware > middleware > middleware > middleware > middleware > handleValidationErrors > addEducation',
      'PUT /api/users/me/education/:id :: authenticateToken > middleware > middleware > middleware > middleware > middleware > middleware > handleValidationErrors > updateEducation',
      'DELETE /api/users/me/education/:id :: authenticateToken > middleware > handleValidationErrors > deleteEducation',
      'POST /api/users/me/work :: authenticateToken > middleware > middleware > middleware > middleware > middleware > handleValidationErrors > addWorkExperience',
      'PUT /api/users/me/work/:id :: authenticateToken > middleware > middleware > middleware > middleware > middleware > middleware > handleValidationErrors > updateWorkExperience',
      'DELETE /api/users/me/work/:id :: authenticateToken > middleware > handleValidationErrors > deleteWorkExperience',
      'GET /api/users/me/notifications :: authenticateToken > getUserNotifications',
      'PUT /api/users/me/notifications/read-all :: authenticateToken > markAllAsRead',
      'PUT /api/users/me/notifications/:notificationId/read :: authenticateToken > markAsRead',
      'DELETE /api/users/me/notifications/:notificationId :: authenticateToken > deleteNotification',
      'POST /api/users/internal/notifications :: verifyInternalService > createInternalNotification',
      'GET /api/users/me/conversations :: authenticateToken > getConversations',
      'POST /api/users/me/conversations :: authenticateToken > createConversation',
      'GET /api/users/me/conversations/:conversationId/messages :: authenticateToken > getMessages',
      'POST /api/users/me/conversations/:conversationId/messages :: authenticateToken > sendMessage',
      'PUT /api/users/me/conversations/:conversationId/read :: authenticateToken > markAsRead',
      'GET /api/users/me/chat/unread-count :: authenticateToken > getUnreadCount',
      'GET /api/users/analytics :: authenticateToken > <anonymous> > getAnalytics',
      'PUT /api/users/:userId :: authenticateToken > <anonymous> > middleware > <anonymous> > middleware > middleware > middleware > middleware > middleware > middleware > middleware > middleware > middleware > handleValidationErrors > <anonymous>', // FIX-INS-01: allowOnlyFields + type-checked fields + role / isActive
      'DELETE /api/users/:userId :: authenticateToken > <anonymous> > middleware > handleValidationErrors > <anonymous>',
      'POST /api/users/become-instructor :: authenticateToken > becomeInstructor',
      // IMPLEMENT-01: application status for the applicant, review for ADMIN only
      'GET /api/users/become-instructor/me :: authenticateToken > getMyInstructorApplication',
      'GET /api/users/admin/instructor-applications :: authenticateToken > <anonymous> > listInstructorApplications',
      'POST /api/users/admin/instructor-applications/:applicationId/approve :: authenticateToken > <anonymous> > approveInstructorApplication',
      'POST /api/users/admin/instructor-applications/:applicationId/reject :: authenticateToken > <anonymous> > rejectInstructorApplication',
      'POST /api/users/become-instructor/confirm :: requireServiceToken(PAYMENT_USER_TOKEN) > confirmInstructor', // FIX 07B-1
    ]);
  });

  it('the eligibility route is unchanged: it shares the secret contract with this route', async () => {
    const send = (headers: Record<string, string>) =>
      fetch(`${base}/api/users/internal/eligibility`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ ids: [] }) });
    assert.equal((await send({})).status, 403);
    assert.equal((await send(withToken('wrong'))).status, 403);
    const ok = await send(withToken(TOKEN));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { data: [] });
  });
});
