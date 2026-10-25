/**
 * FIX-INS-04: POST /api/learning/internal/courses/:courseId/enroll - the paid-course enrollment.
 *
 *   auth      only the Order <-> Learning credential ORDER_LEARNING_TOKEN in X-Internal-Service-Token (constant-time, fail-closed):
 *             no INTERNAL_SERVICE_TOKEN (its docker-compose default is public), no user token, no default.
 *   payment   a valid token proves WHICH service calls, not that anything was paid. Nothing is written until the order-service
 *             (the record of the authenticated payment webhook) confirms, on GET /api/orders/internal/:orderId/entitlement, that
 *             the order is PAID, belongs to the learner and grants the course. A payment status / price / role in the body is
 *             refused; an order that is unpaid, failed, someone else's or does not contain the course grants nothing.
 *   retries   idempotent: 201 when the enrollment is written, 200 when it already existed - never a second CourseProgress.
 *
 * The REAL express app (all routes and middleware) runs on an ephemeral port against the in-memory Prisma fake. The course-service,
 * the order-service and the auth / user services are one loopback stub that records every call. Every token is random per run;
 * the public default is read from docker-compose.yml. Temp directories the app creates on load go to a fresh OS temp folder.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { installFakePrisma, db } from './helpers/fake-prisma';

installFakePrisma();

const TOKEN = randomBytes(32).toString('hex');       // ORDER_LEARNING_TOKEN
const INTERNAL = randomBytes(32).toString('hex');    // INTERNAL_SERVICE_TOKEN (other internal routes) - must NOT work here
const COURSE_LEARNING = randomBytes(32).toString('hex');
const id = (c: string) => c.repeat(12);
const PAID_COURSE = id('a1');
const OTHER_COURSE = id('a2');
const DRAFT_COURSE = id('a3');
const FREE_COURSE = id('a4');
const ALICE = id('b1');
const BOB = id('b2');
const ORDER_PAID = id('c1');       // Alice, PAID, contains PAID_COURSE + DRAFT_COURSE
const ORDER_UNPAID = id('c2');     // Alice, UNPAID
const ORDER_FAILED = id('c3');     // Alice, FAILED
const ORDER_BOB = id('c4');        // Bob, PAID, contains PAID_COURSE
const ORDER_DUP = id('c5');        // Alice, PAID, PAID_COURSE set aside as an already-owned duplicate
const ROUTE = (courseId = PAID_COURSE) => `/api/learning/internal/courses/${courseId}/enroll`;
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));

// what the order-service's records say (the stub applies the same rules as OrderService.getEnrollmentEntitlement)
const ORDERS: Record<string, { userId: string; paymentStatus: string; items: Record<string, string> }> = {
  [ORDER_PAID]: { userId: ALICE, paymentStatus: 'PAID', items: { [PAID_COURSE]: 'FULFILLED', [DRAFT_COURSE]: 'FULFILLED' } },
  [ORDER_UNPAID]: { userId: ALICE, paymentStatus: 'UNPAID', items: { [PAID_COURSE]: 'PENDING' } },
  [ORDER_FAILED]: { userId: ALICE, paymentStatus: 'FAILED', items: { [PAID_COURSE]: 'PENDING' } },
  [ORDER_BOB]: { userId: BOB, paymentStatus: 'PAID', items: { [PAID_COURSE]: 'FULFILLED' } },
  [ORDER_DUP]: { userId: ALICE, paymentStatus: 'PAID', items: { [PAID_COURSE]: 'ALREADY_OWNED_DUPLICATE' } },
};
const entitlement = (orderId: string, userId: string, courseId: string) => {
  const o = ORDERS[orderId];
  if (!o) return { entitled: false, reason: 'ORDER_NOT_FOUND' };
  if (o.userId !== userId) return { entitled: false, reason: 'ORDER_OF_ANOTHER_USER' };
  if (o.paymentStatus !== 'PAID') return { entitled: false, reason: 'PAYMENT_NOT_CONFIRMED' };
  if (!o.items[courseId]) return { entitled: false, reason: 'COURSE_NOT_IN_ORDER' };
  if (o.items[courseId] === 'ALREADY_OWNED_DUPLICATE') return { entitled: false, reason: 'ITEM_ALREADY_OWNED_DUPLICATE' };
  return { entitled: true, reason: 'PAID' };
};
const COURSES: Record<string, any> = {
  [PAID_COURSE]: { id: PAID_COURSE, title: 'Paid', published: true, price: 199000, instructorId: id('d1') },
  [OTHER_COURSE]: { id: OTHER_COURSE, title: 'Other', published: true, price: 99000, instructorId: id('d1') },
  [DRAFT_COURSE]: { id: DRAFT_COURSE, title: 'Draft', published: false, price: 99000, instructorId: id('d1') },
  [FREE_COURSE]: { id: FREE_COURSE, title: 'Free', published: true, price: 0, instructorId: id('d1') },
};

let orderMode: 'ok' | 'down' | 'garbage' = 'ok';
const entitlementCalls: Array<{ orderId: string; userId: string; courseId: string; token: unknown }> = [];

describe('FIX-INS-04: paid-course enrollment needs ORDER_LEARNING_TOKEN AND a payment confirmed by the order-service', () => {
  let server: http.Server;
  let stub: http.Server;
  let app: any;
  let base = '';
  let tmp = '';
  const logs: string[] = [];

  before(async () => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const u = new URL(req.url || '/', 'http://stub');
        const ent = u.pathname.match(/^\/api\/orders\/internal\/([0-9a-f]{24})\/entitlement$/);
        if (ent) {
          const call = { orderId: ent[1], userId: String(u.searchParams.get('userId')), courseId: String(u.searchParams.get('courseId')), token: req.headers['x-internal-service-token'] };
          entitlementCalls.push(call);
          if (call.token !== TOKEN) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'Forbidden: Invalid internal service token' })); }
          if (orderMode === 'down') { res.statusCode = 503; return res.end('{}'); }
          if (orderMode === 'garbage') return res.end(JSON.stringify({ data: { entitled: 'yes' } }));
          return res.end(JSON.stringify({ data: entitlement(call.orderId, call.userId, call.courseId) }));
        }
        const lessons = u.pathname.match(/^\/api\/courses\/internal\/([0-9a-f]{24})\/lessons$/);
        if (lessons) return res.end(JSON.stringify({ data: [{ id: 'L1' }, { id: 'L2' }] }));
        const course = u.pathname.match(/^\/api\/courses\/([0-9a-f]{24})$/);
        if (course) {
          if (!COURSES[course[1]]) { res.statusCode = 404; return res.end('{}'); }
          return res.end(JSON.stringify({ data: COURSES[course[1]] }));
        }
        if (u.pathname === '/api/auth/verify-token') {
          const token = (() => { try { return JSON.parse(raw).token; } catch { return ''; } })();
          const user = token === 'alice-session' ? { userId: ALICE, email: 'alice@umi.test' } : null;
          return res.end(JSON.stringify(user ? { valid: true, user } : { valid: false }));
        }
        if (u.pathname.startsWith('/api/users/')) return res.end(JSON.stringify({ data: { role: 'STUDENT' } }));
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins04-'));
    for (const v of ['ZIP_UPLOAD_DIR', 'ZIP_EXTRACT_DIR', 'VIDEO_UPLOAD_DIR', 'HLS_TEMP_DIR']) process.env[v] = path.join(tmp, v.toLowerCase());
    Object.assign(process.env, {
      ORDER_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, AUTH_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase,
      ORDER_LEARNING_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: INTERNAL, COURSE_LEARNING_TOKEN: COURSE_LEARNING,
      RATE_LIMIT_MAX_REQUESTS: '100000', BLOCKCHAIN_ENABLED: 'false',
    });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack} ${JSON.stringify((a as any).config || {})}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        return original(...args);
      };
    }
    app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.reset();
    entitlementCalls.length = 0;
    orderMode = 'ok';
    process.env.ORDER_LEARNING_TOKEN = TOKEN;
  });

  const post = async (url: string, headers: Record<string, string> = {}, payload: unknown = { userId: ALICE, orderId: ORDER_PAID }, rawBody?: string) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: rawBody ?? JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const withToken = (t: string) => ({ 'x-internal-service-token': t });
  const enrollments = () => db.tables.courseProgress;
  const nothingWritten = (label: string) => {
    for (const table of ['courseProgress', 'userProgress', 'activityLog', 'lessonProgress']) assert.equal(db.count(table), 0, `${label}: ${table} stays empty`);
  };
  const FORBIDDEN = { error: 'Forbidden: Invalid internal service token' };

  // ---------------------------------------------------------------------------------------------- 1. authentication
  it('no token / the INTERNAL_SERVICE_TOKEN / the old public default / a user session: 403 before anything is read or written', async () => {
    const attempts: Array<Record<string, string>> = [
      {}, withToken(INTERNAL), ...PUBLIC_DEFAULTS.map(withToken), withToken(COURSE_LEARNING), { authorization: 'Bearer alice-session' },
      withToken(`${TOKEN[0] === 'a' ? 'b' : 'a'}${TOKEN.slice(1)}`), withToken(TOKEN.slice(0, -1)), withToken(`${TOKEN}0`), withToken(TOKEN.toUpperCase()), withToken(''),
    ];
    for (const headers of attempts) {
      const res = await post(ROUTE(), headers);
      assert.equal(res.status, 403, JSON.stringify(Object.keys(headers)));
      assert.deepEqual(res.json, FORBIDDEN);
    }
    assert.equal(entitlementCalls.length, 0, 'the order-service is not even asked');
    nothingWritten('refused tokens');
  });

  it('the token counts only in X-Internal-Service-Token (query string, body, Authorization: Bearer do not)', async () => {
    assert.equal((await post(`${ROUTE()}?x-internal-service-token=${TOKEN}`)).status, 403);
    assert.equal((await post(ROUTE(), { authorization: `Bearer ${TOKEN}` })).status, 403);
    assert.equal((await post(ROUTE(), {}, { userId: ALICE, orderId: ORDER_PAID, token: TOKEN })).status, 403);
    nothingWritten('token elsewhere');
  });

  it('server WITHOUT a usable ORDER_LEARNING_TOKEN (unset, empty, short, the public default): 500 fail-closed - INTERNAL_SERVICE_TOKEN never stands in', async () => {
    for (const configured of [undefined, '', 'too-short-value', ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.ORDER_LEARNING_TOKEN;
      else process.env.ORDER_LEARNING_TOKEN = configured;
      for (const headers of [{}, withToken(TOKEN), withToken(INTERNAL), withToken(configured ?? '')]) {
        const res = await post(ROUTE(), headers);
        assert.equal(res.status, 500);
        assert.deepEqual(res.json, { error: 'Internal service authentication not configured' });
      }
    }
    assert.equal(entitlementCalls.length, 0);
    nothingWritten('not configured');
  });

  // ---------------------------------------------------------------------------------------------- 2. valid caller, paid order
  it('the order-service with the right token and a PAID order of that learner: 201, ONE enrollment, after asking the order-service', async () => {
    const res = await post(ROUTE(), withToken(TOKEN));
    assert.equal(res.status, 201);
    assert.equal(res.json.data.userId, ALICE);
    assert.equal(res.json.data.courseId, PAID_COURSE);
    assert.equal(enrollments().length, 1);
    assert.equal(enrollments()[0].totalLessons, 2);
    assert.deepEqual(entitlementCalls, [{ orderId: ORDER_PAID, userId: ALICE, courseId: PAID_COURSE, token: TOKEN }]);
    assert.equal(db.tables.userProgress[0].totalCoursesEnrolled, 1);
  });

  it('retries (sequential and concurrent) never create a second enrollment: 200 "already enrolled"', async () => {
    assert.equal((await post(ROUTE(), withToken(TOKEN))).status, 201);
    for (let i = 0; i < 3; i++) {
      const again = await post(ROUTE(), withToken(TOKEN));
      assert.equal(again.status, 200);
      assert.equal(again.json.message, 'Already enrolled in course');
    }
    const burst = await Promise.all([1, 2, 3, 4].map(() => post(ROUTE(), withToken(TOKEN))));
    assert.ok(burst.every((r) => r.status === 200 || r.status === 201));
    assert.equal(enrollments().filter((e) => e.userId === ALICE && e.courseId === PAID_COURSE).length, 1);
    assert.equal(db.tables.userProgress[0].totalCoursesEnrolled, 1, 'the enrolled-courses counter moved once');
  });

  // ---------------------------------------------------------------------------------------------- 3-5. payment
  it('a forged payment status / price / role in the body is refused (400) - only { userId, orderId } is accepted', async () => {
    for (const body of [
      { userId: ALICE, orderId: ORDER_UNPAID, paymentStatus: 'PAID' },
      { userId: ALICE, paymentStatus: 'PAID' },
      { userId: ALICE, orderId: ORDER_PAID, price: 0 },
      { userId: ALICE, orderId: ORDER_PAID, role: 'ADMIN' },
      { userId: ALICE, orderId: ORDER_PAID, isInternal: true },
      { userId: ALICE },
      { orderId: ORDER_PAID },
      { userId: 'alice', orderId: ORDER_PAID },
      { userId: ALICE, orderId: { $ne: null } },
      [ALICE, ORDER_PAID],
    ]) {
      const res = await post(ROUTE(), withToken(TOKEN), body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(entitlementCalls.length, 0);
    nothingWritten('forged bodies');
  });

  it('an order that is unpaid, FAILED, of another learner, without the course, or with the course set aside as a duplicate: 403, nothing written', async () => {
    const cases: Array<[string, string, string, string]> = [
      [ALICE, ORDER_UNPAID, PAID_COURSE, 'PAYMENT_NOT_CONFIRMED'],
      [ALICE, ORDER_FAILED, PAID_COURSE, 'PAYMENT_NOT_CONFIRMED'],
      [ALICE, ORDER_BOB, PAID_COURSE, 'ORDER_OF_ANOTHER_USER'],     // Alice borrowing Bob's paid order
      [BOB, ORDER_PAID, PAID_COURSE, 'ORDER_OF_ANOTHER_USER'],      // Bob borrowing Alice's paid order
      [ALICE, ORDER_PAID, OTHER_COURSE, 'COURSE_NOT_IN_ORDER'],     // a paid order used for another course
      [ALICE, ORDER_DUP, PAID_COURSE, 'ITEM_ALREADY_OWNED_DUPLICATE'],
      [ALICE, id('ee'), PAID_COURSE, 'ORDER_NOT_FOUND'],
    ];
    for (const [userId, orderId, courseId, reason] of cases) {
      const res = await post(ROUTE(courseId), withToken(TOKEN), { userId, orderId });
      assert.equal(res.status, 403, reason);
      assert.equal(res.json.code, 'NOT_ENTITLED');
      assert.equal(res.json.reason, reason);
    }
    nothingWritten('not entitled');
  });

  it('when the payment cannot be verified (order-service down / unexpected answer): 503, nothing written', async () => {
    for (const mode of ['down', 'garbage'] as const) {
      orderMode = mode;
      const res = await post(ROUTE(), withToken(TOKEN));
      assert.equal(res.status, 503, mode);
      assert.equal(res.json.code, 'ENTITLEMENT_UNAVAILABLE');
    }
    nothingWritten('unverifiable');
  });

  it('existing policy kept: a paid order cannot enroll into an UNPUBLISHED course (403 from the course check)', async () => {
    const res = await post(ROUTE(DRAFT_COURSE), withToken(TOKEN));
    assert.equal(res.status, 403);
    nothingWritten('draft course');
  });

  it('existing policy kept: the public route still enrolls a signed-in user in a FREE course and refuses a paid one', async () => {
    const free = await fetch(`${base}/api/learning/courses/${FREE_COURSE}/enroll`, { method: 'POST', headers: { authorization: 'Bearer alice-session' } });
    assert.equal(free.status, 201);
    const paid = await fetch(`${base}/api/learning/courses/${PAID_COURSE}/enroll`, { method: 'POST', headers: { authorization: 'Bearer alice-session' } });
    assert.equal(paid.status, 403);
    assert.deepEqual(enrollments().map((e) => e.courseId), [FREE_COURSE]);
    assert.equal(entitlementCalls.length, 0, 'the free path does not involve orders');
  });

  // ---------------------------------------------------------------------------------------------- hygiene
  it('the token never reaches the logs or a response', async () => {
    await post(ROUTE(), withToken(TOKEN));
    await post(ROUTE(), withToken(`${TOKEN}x`));
    orderMode = 'down';
    const down = await post(ROUTE(OTHER_COURSE), withToken(TOKEN), { userId: ALICE, orderId: ORDER_PAID });
    assert.ok(!down.text.includes(TOKEN));
    assert.ok(!logs.some((l) => l.includes(TOKEN)), 'no log line carries the token');
  });

  it('route table: the enroll route runs requireServiceToken(ORDER_LEARNING_TOKEN) first; no route uses the shared verifyInternalService any more', () => {
    const layers = (app._router.stack as any[]).filter((l) => l.route?.path === '/api/learning/internal/courses/:courseId/enroll');
    assert.equal(layers.length, 1);
    assert.deepEqual(layers[0].route.methods, { post: true });
    assert.equal(layers[0].route.stack[0].handle.name, 'requireServiceToken(ORDER_LEARNING_TOKEN)');
    const { ProgressController } = require('../src/controllers/progress.controller');
    const reaching = (app._router.stack as any[]).filter((l) => l.route && l.route.stack.some((s: any) => s.handle === ProgressController.enrollInCourseInternal));
    assert.equal(reaching.length, 1, 'exactly one route reaches the internal enroll controller');
    const shared = (app._router.stack as any[]).filter((l) => l.route && l.route.stack.some((s: any) => s.handle.name === 'verifyInternalService'));
    assert.deepEqual(shared.map((l) => l.route.path), []);
  });
});
