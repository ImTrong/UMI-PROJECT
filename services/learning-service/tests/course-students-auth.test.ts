/**
 * FIX-INS-03: the per-course student-progress routes of the learning-service accept ONLY the Course -> Learning credential.
 *
 *   GET /api/learning/progress/course/:courseId/students           every learner's CourseProgress of a course
 *   GET /api/learning/progress/course/:courseId/students/:userId   one learner's CourseProgress (+ lessons) in a course
 *
 * Callers (all in the course-service, each doing its own user check first): the instructor student list / detail, the review
 * enrollment check and the course-deletion guard. Browsers never call these routes. They now require COURSE_LEARNING_TOKEN in
 * X-Internal-Service-Token (constant-time, fail-closed: no INTERNAL_SERVICE_TOKEN, no user token, no public default).
 *
 * The REAL express app (all routes and middleware) runs on an ephemeral port against the in-memory Prisma fake
 * (tests/helpers/fake-prisma.ts). Every token is drawn at random for this run; the public default is read from docker-compose.yml.
 * Temp directories the app creates on load are redirected to a fresh folder under the OS temp dir, removed at the end.
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

const TOKEN = randomBytes(32).toString('hex');           // COURSE_LEARNING_TOKEN for this run
const INTERNAL = randomBytes(32).toString('hex');        // the shared INTERNAL_SERVICE_TOKEN of the other internal routes
const COURSE = 'c1'.repeat(12);
const OTHER_COURSE = 'c2'.repeat(12);
const ALICE = 'a1'.repeat(12);
const BOB = 'b1'.repeat(12);
const NOBODY = 'f9'.repeat(12);
const LIST = `/api/learning/progress/course/${COURSE}/students`;
const ONE = (userId: string, courseId = COURSE) => `/api/learning/progress/course/${courseId}/students/${userId}`;
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));

describe('FIX-INS-03: learning-service per-course student-progress routes need COURSE_LEARNING_TOKEN', () => {
  let server: http.Server;
  let base = '';
  let app: any;
  let tmp = '';
  const logs: string[] = [];

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins03-'));
    for (const v of ['ZIP_UPLOAD_DIR', 'ZIP_EXTRACT_DIR', 'VIDEO_UPLOAD_DIR', 'HLS_TEMP_DIR']) process.env[v] = path.join(tmp, v.toLowerCase());
    process.env.COURSE_LEARNING_TOKEN = TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = INTERNAL;
    process.env.RATE_LIMIT_MAX_REQUESTS = '100000';
    process.env.BLOCKCHAIN_ENABLED = 'false';
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        return original(...args);
      };
    }
    app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    process.env.COURSE_LEARNING_TOKEN = TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = INTERNAL;
    db.reset();
    db.seed('courseProgress', { userId: ALICE, courseId: COURSE, courseTitle: 'C1', totalLessons: 2, progressPercentage: 50 });
    db.seed('courseProgress', { userId: BOB, courseId: COURSE, courseTitle: 'C1', totalLessons: 2, progressPercentage: 100 });
    db.seed('courseProgress', { userId: ALICE, courseId: OTHER_COURSE, courseTitle: 'C2', totalLessons: 1 });
  });

  const call = async (url: string, headers: Record<string, string> = {}, method = 'GET') => {
    const res = await fetch(`${base}${url}`, { method, headers });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const withToken = (t: string) => ({ 'x-internal-service-token': t });
  const FORBIDDEN = { error: 'Forbidden: Invalid internal service token' };
  const NOT_CONFIGURED = { error: 'Internal service authentication not configured' };
  const progressReads = () => db.calls.filter((c) => c.table === 'courseProgress').length;
  const leaksNothing = (res: { text: string }, label: string) => {
    assert.ok(!res.text.includes(ALICE) && !res.text.includes(BOB), `${label}: no learner id in the answer`);
    assert.ok(!res.text.includes(TOKEN), `${label}: the token is never echoed`);
  };

  // ------------------------------------------------------------------------------------------- refused
  it('a browser / anonymous client (no token): 403 on both routes, the database is not even read', async () => {
    for (const url of [LIST, ONE(ALICE), ONE(BOB)]) {
      const res = await call(url);
      assert.equal(res.status, 403, url);
      assert.deepEqual(res.json, FORBIDDEN);
      leaksNothing(res, url);
    }
    assert.equal(progressReads(), 0);
  });

  it('a wrong token (one char off, shorter, longer, other case, empty, 10 000 chars) or the INTERNAL_SERVICE_TOKEN: 403', async () => {
    const wrong = [`${TOKEN[0] === 'a' ? 'b' : 'a'}${TOKEN.slice(1)}`, TOKEN.slice(0, -1), `${TOKEN}0`, TOKEN.toUpperCase(), '', 'y'.repeat(10_000), INTERNAL, ...PUBLIC_DEFAULTS];
    for (const t of wrong) {
      for (const url of [LIST, ONE(ALICE)]) {
        const res = await call(url, withToken(t));
        assert.equal(res.status, 403, `token of length ${t.length} on ${url}`);
        leaksNothing(res, 'wrong token');
      }
    }
    assert.equal(progressReads(), 0);
  });

  it('a signed-in USER cannot read anyone\'s progress here - not another learner\'s by changing userId, not even their own', async () => {
    // a perfectly valid-looking user session: Bearer token, cookie, role / userId claims in the query string
    const userHeaders = { authorization: 'Bearer some-user-jwt', cookie: 'token=some-user-jwt', 'x-user-id': ALICE, 'x-user-role': 'ADMIN' };
    for (const url of [ONE(BOB), ONE(ALICE), `${ONE(BOB)}?userId=${ALICE}&role=ADMIN`, `${LIST}?userId=${ALICE}`]) {
      const res = await call(url, userHeaders);
      assert.equal(res.status, 403, url);
      leaksNothing(res, url);
    }
    assert.equal(progressReads(), 0);
  });

  it('the token counts only in X-Internal-Service-Token (query string, Authorization: Bearer, other header names do not)', async () => {
    const attempts: Array<[string, Record<string, string>]> = [
      [`${LIST}?token=${TOKEN}&x-internal-service-token=${TOKEN}`, {}],
      [LIST, { authorization: `Bearer ${TOKEN}` }],
      [LIST, { 'x-internal-token': TOKEN }],
      [LIST, { 'x-course-learning-token': TOKEN }],
      [LIST, { cookie: `x-internal-service-token=${TOKEN}` }],
    ];
    for (const [url, headers] of attempts) assert.equal((await call(url, headers)).status, 403, JSON.stringify(Object.keys(headers)));
  });

  it('the right token sent twice (duplicate header) does not pass', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${base}${LIST}`, { method: 'GET', headers: { 'x-internal-service-token': [TOKEN, TOKEN] } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode || 0)); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });

  it('server WITHOUT a usable COURSE_LEARNING_TOKEN (unset, empty, short, with spaces, the public default) refuses with 500 - never falls back to INTERNAL_SERVICE_TOKEN', async () => {
    for (const configured of [undefined, '', '   ', 'too-short-value', TOKEN.slice(0, 23), `${TOKEN.slice(0, 20)} ${TOKEN.slice(20)}`, ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.COURSE_LEARNING_TOKEN;
      else process.env.COURSE_LEARNING_TOKEN = configured;
      for (const headers of [{}, withToken(TOKEN), withToken(configured ?? ''), withToken(INTERNAL)]) {
        const res = await call(LIST, headers);
        assert.equal(res.status, 500, `configured length ${configured?.length}`);
        assert.deepEqual(res.json, NOT_CONFIGURED);
      }
    }
    assert.ok(process.env.INTERNAL_SERVICE_TOKEN, 'INTERNAL_SERVICE_TOKEN was configured the whole time');
    assert.equal(progressReads(), 0);
  });

  it('other spellings of the paths hit the same check (trailing slash, upper case) - no unprotected twin', async () => {
    for (const url of [`${LIST}/`, LIST.toUpperCase().replace(COURSE.toUpperCase(), COURSE), `${ONE(ALICE)}/`]) {
      assert.equal((await call(url)).status, 403, url);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await call(LIST, withToken(TOKEN), method);
      assert.ok([403, 404].includes(res.status), `${method} -> ${res.status}`);
    }
  });

  // ------------------------------------------------------------------------------------------- allowed, contract unchanged
  it('the course-service with the right token gets the list: 200 { data: [CourseProgress...] } of THAT course only', async () => {
    const res = await call(LIST, withToken(TOKEN));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.data));
    assert.deepEqual(res.json.data.map((p: any) => p.userId).sort(), [ALICE, BOB].sort());
    assert.ok(res.json.data.every((p: any) => p.courseId === COURSE));
    assert.equal(res.json.data.find((p: any) => p.userId === BOB).progressPercentage, 100);
  });

  it('a course without learners: 200 { data: [] } (what the course-deletion guard relies on)', async () => {
    const res = await call(`/api/learning/progress/course/${'d0'.repeat(12)}/students`, withToken(TOKEN));
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { data: [] });
  });

  it('one learner with the right token: 200 { data: CourseProgress }; not enrolled: 404 (what the review check relies on)', async () => {
    const ok = await call(ONE(ALICE), withToken(TOKEN));
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.userId, ALICE);
    assert.equal(ok.json.data.courseId, COURSE);
    assert.equal(ok.json.data.progressPercentage, 50);
    const missing = await call(ONE(NOBODY), withToken(TOKEN));
    assert.equal(missing.status, 404);
    assert.equal(typeof missing.json.error, 'string');
  });

  it('malformed ids are still refused with 400 - but only after the token check (an anonymous caller learns nothing)', async () => {
    assert.equal((await call('/api/learning/progress/course/not-an-id/students', withToken(TOKEN))).status, 400);
    assert.equal((await call(ONE('not-an-id'), withToken(TOKEN))).status, 400);
    assert.equal((await call('/api/learning/progress/course/not-an-id/students')).status, 403);
  });

  it('the token never reaches the logs', async () => {
    await call(LIST, withToken(TOKEN));
    await call(LIST, withToken(`${TOKEN}0`));
    assert.ok(!logs.some((l) => l.includes(TOKEN)), 'no log line carries the token');
  });

  // ------------------------------------------------------------------------------------------- route table
  it('route table: every route serving these controllers runs requireServiceToken(COURSE_LEARNING_TOKEN) FIRST, and only GET', () => {
    const { ProgressController } = require('../src/controllers/progress.controller');
    const guarded = [ProgressController.getCourseStudents, ProgressController.getStudentCourseProgress];
    const layers = (app._router.stack as any[]).filter((l) => l.route && l.route.stack.some((s: any) => guarded.includes(s.handle)));
    assert.equal(layers.length, 2, 'exactly two routes reach these controllers');
    for (const l of layers) {
      assert.deepEqual(l.route.methods, { get: true });
      assert.equal(l.route.stack[0].handle.name, 'requireServiceToken(COURSE_LEARNING_TOKEN)', l.route.path);
    }
    // the internal enroll route has its own credential since FIX-INS-04 (ORDER_LEARNING_TOKEN), never this one
    const enroll = (app._router.stack as any[]).find((l) => l.route?.path === '/api/learning/internal/courses/:courseId/enroll');
    assert.equal(enroll.route.stack[0].handle.name, 'requireServiceToken(ORDER_LEARNING_TOKEN)');
  });
});
