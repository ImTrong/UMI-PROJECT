/**
 * FIX 07B-1 (AUTH-01): POST /api/users/become-instructor/confirm accepts only the Payment -> User credential PAYMENT_USER_TOKEN in
 * the X-Internal-Service-Token header. Since IMPLEMENT-01 an accepted call no longer changes the ROLE: it only queues (at most one)
 * PENDING instructor application for an ADMIN to review.
 *
 * The REAL express app is started on an ephemeral port (real middleware, rate limiter, routing, controller and UserService);
 * only the database client is replaced by a tiny in-memory stand-in that holds ONE learner profile and records every role
 * change and every notification. Every log line written by the service is captured too, to prove no token is ever logged.
 * The same guarantees are checked against a real MongoDB replica set by tests/integration/become-instructor-auth.mongo.test.ts.
 *
 * No token appears in this file: every run draws fresh random ones. The publicly known default is read from docker-compose.yml.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const ROUTE = '/api/users/become-instructor/confirm';
const USER = 'c3'.repeat(12);

// ---- minimal Prisma stand-in (installed before the app is loaded) ----
const profile = { id: 'd4'.repeat(12), userId: USER, email: 'learner@test.local', fullName: 'Learner', role: 'STUDENT' };
const roleChanges: Array<{ userId: string; role: string }> = [];
const notifications: any[] = [];
const applications: any[] = [];
let lookups = 0;

class FakePrismaClient {
  userProfile = {
    findUnique: async ({ where }: any) => { lookups++; return where.userId === profile.userId ? { ...profile } : null; },
    update: async ({ where, data }: any) => {
      roleChanges.push({ userId: where.userId, role: data.role });
      profile.role = data.role;
      return { ...profile, education: [], work: [] };
    },
    findMany: async () => [] as any[],
  };
  notification = { create: async ({ data }: any) => { notifications.push(data); return { id: 'e5'.repeat(12), ...data }; } };
  // IMPLEMENT-01: the pending application a paid (old-flow) registration fee now turns into
  instructorApplication = {
    findFirst: async ({ where }: any) => applications.find((a) => a.userId === where.userId && (!where.status || a.status === where.status)) ?? null,
    create: async ({ data }: any) => {
      if (applications.some((a) => a.pendingKey === data.pendingKey)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      const row = { id: (applications.length + 1).toString(16).padStart(24, '0'), submittedAt: new Date(), ...data };
      applications.push(row);
      return { ...row };
    },
  };
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient, Role: { STUDENT: 'STUDENT', INSTRUCTOR: 'INSTRUCTOR', ADMIN: 'ADMIN' } },
} as any;

// a fresh random secret for every run - the source and the fixtures never contain one
const TOKEN = randomBytes(32).toString('hex');
const OTHER_TOKEN = randomBytes(32).toString('hex');     // e.g. the INTERNAL_SERVICE_TOKEN of the other internal routes

// the publicly known default value(s): every `${...TOKEN:-<default>}` in docker-compose.yml
const composeFile = path.resolve(__dirname, '../../../docker-compose.yml');
const PUBLIC_DEFAULTS = Array.from(new Set(
  Array.from(fs.readFileSync(composeFile, 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1])
));

describe('POST /api/users/become-instructor/confirm needs PAYMENT_USER_TOKEN (FIX 07B-1)', () => {
  let server: http.Server;
  let base = '';
  let app: any;
  const logs: string[] = [];

  before(async () => {
    process.env.PAYMENT_USER_TOKEN = TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = OTHER_TOKEN;
    process.env.RATE_LIMIT_MAX_REQUESTS = '100000';   // this file sends a few hundred requests; the limiter itself is not under test
    process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(16).toString('hex');
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug', 'log']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        return original(...args);
      };
    }
    app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => { await new Promise((resolve) => server.close(resolve)); });

  beforeEach(() => {
    process.env.PAYMENT_USER_TOKEN = TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = OTHER_TOKEN;
    profile.role = 'STUDENT';
    roleChanges.length = 0;
    notifications.length = 0;
    applications.length = 0;
    lookups = 0;
  });

  const body = (over: Record<string, unknown> = {}) => ({ userId: USER, status: 'INSTRUCTOR_REGISTRATION_SUCCESS', ...over });
  const call = async (payload: unknown, headers: Record<string, string> = {}, url = ROUTE, method = 'POST') => {
    const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const withToken = (token: string) => ({ 'x-internal-service-token': token });
  const nothingHappened = (label: string) => {
    assert.equal(profile.role, 'STUDENT', `${label}: the role must stay STUDENT`);
    assert.equal(roleChanges.length, 0, `${label}: no role update may be written`);
    assert.equal(notifications.length, 0, `${label}: no notification may be created`);
    assert.equal(applications.length, 0, `${label}: no application may be created`);
    assert.equal(lookups, 0, `${label}: refused before the controller - the profile is not even read`);
  };
  const FORBIDDEN = { error: 'Forbidden: Invalid internal service token' };
  const NOT_CONFIGURED = { error: 'Internal service authentication not configured' };

  // ------------------------------------------------------------------------------------------------ refusals

  it('WITHOUT a token: 403, role unchanged, no notification', async () => {
    const res = await call(body());
    assert.equal(res.status, 403);
    assert.deepEqual(res.json, FORBIDDEN);
    nothingHappened('no token');
  });

  it('a WRONG token - one character off, shorter, longer, other case, 1 char, 10 000 chars, empty: 403, no crash, no stack', async () => {
    const wrong = [
      `${TOKEN[0] === 'a' ? 'b' : 'a'}${TOKEN.slice(1)}`,
      TOKEN.slice(0, -1),
      `${TOKEN}0`,
      TOKEN.toUpperCase(),
      'x',
      'y'.repeat(10_000),
      '',
    ];
    for (const token of wrong) {
      const res = await call(body(), withToken(token));
      assert.equal(res.status, 403, `token of length ${token.length}`);
      assert.deepEqual(res.json, FORBIDDEN);
      assert.ok(!/\bat .*\(|node_modules|stack/i.test(res.text), 'no stack trace');
    }
    nothingHappened('wrong token');
  });

  it('the INTERNAL_SERVICE_TOKEN of the other internal routes is NOT accepted here', async () => {
    const res = await call(body(), withToken(OTHER_TOKEN));
    assert.equal(res.status, 403);
    nothingHappened('INTERNAL_SERVICE_TOKEN');
  });

  it('the publicly known default is refused: as the header (403) and as the configured server value (500, fail-closed)', { skip: PUBLIC_DEFAULTS.length ? false : 'no public default left in docker-compose.yml' }, async () => {
    for (const known of PUBLIC_DEFAULTS) {
      assert.ok(known.length >= 24, 'the length rule alone would not catch it - the denylist must');
      const asHeader = await call(body(), withToken(known));
      assert.equal(asHeader.status, 403);
      process.env.PAYMENT_USER_TOKEN = known;
      for (const headers of [{}, withToken(known), withToken(TOKEN)]) {
        const res = await call(body(), headers);
        assert.equal(res.status, 500);
        assert.deepEqual(res.json, NOT_CONFIGURED);
      }
      process.env.PAYMENT_USER_TOKEN = TOKEN;
    }
    nothingHappened('public default');
  });

  it('server WITHOUT a usable PAYMENT_USER_TOKEN (unset, empty, blank, too short, with spaces) refuses everything with 500', async () => {
    const weak: Array<string | undefined> = [undefined, '', '   ', 'short-but-set', TOKEN.slice(0, 23), `${TOKEN.slice(0, 20)} ${TOKEN.slice(20)}`];
    for (const configured of weak) {
      if (configured === undefined) delete process.env.PAYMENT_USER_TOKEN;
      else process.env.PAYMENT_USER_TOKEN = configured;
      for (const headers of [{}, withToken(TOKEN), withToken(configured ?? ''), withToken(OTHER_TOKEN)]) {
        const res = await call(body(), headers);
        assert.equal(res.status, 500, `configured length ${configured?.length}`);
        assert.deepEqual(res.json, NOT_CONFIGURED);
      }
    }
    // the shared INTERNAL_SERVICE_TOKEN being configured never stands in for the missing one
    assert.ok(process.env.INTERNAL_SERVICE_TOKEN);
    nothingHappened('not configured');
  });

  it('the secret counts only in the X-Internal-Service-Token header (query string, body, Authorization, other header names do not)', async () => {
    const attempts: Array<[string, ReturnType<typeof call>]> = [
      ['query string', call(body(), {}, `${ROUTE}?token=${TOKEN}&x-internal-service-token=${TOKEN}`)],
      ['body field', call(body({ token: TOKEN, internalToken: TOKEN, 'x-internal-service-token': TOKEN }))],
      ['Authorization: Bearer', call(body(), { authorization: `Bearer ${TOKEN}` })],
      ['x-internal-token', call(body(), { 'x-internal-token': TOKEN })],
      ['x-payment-user-token', call(body(), { 'x-payment-user-token': TOKEN })],
      ['cookie', call(body(), { cookie: `x-internal-service-token=${TOKEN}` })],
    ];
    for (const [label, promise] of attempts) assert.equal((await promise).status, 403, label);
    nothingHappened('token in the wrong place');
  });

  it('the right token sent twice (duplicate header) does not pass', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-service-token': [TOKEN, TOKEN] } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode || 0)); });
      req.on('error', reject);
      req.end(JSON.stringify(body()));
    });
    assert.equal(status, 403);
    nothingHappened('duplicate header');
  });

  it('no spelling of the path reaches the controller without the token (trailing slash, upper case, encoded, other methods)', async () => {
    const variants: Array<[string, string]> = [
      ['POST', `${ROUTE}/`], ['POST', ROUTE.toUpperCase()], ['POST', '/api/users/Become-Instructor/Confirm'],
      ['POST', `${ROUTE}?x=1`], ['POST', '/api/users/become-instructor/confirm;x'], ['POST', '/api/users/become%2Dinstructor/confirm'],
      ['POST', '/api/users//become-instructor/confirm'], ['POST', '/api/users/become-instructor/./confirm'],
      ['PUT', ROUTE], ['PATCH', ROUTE], ['GET', ROUTE], ['DELETE', ROUTE],
    ];
    for (const [method, url] of variants) {
      const res = await call(method === 'GET' ? undefined : body(), {}, url, method);
      assert.notEqual(res.status, 200, `${method} ${url}`);
      assert.ok([401, 403, 404].includes(res.status), `${method} ${url} -> ${res.status}`);
    }
    nothingHappened('path variants');
  });

  it('refusals do not reveal the configured secret, the secret that was sent, or the variable name', async () => {
    const sent = `${TOKEN.slice(0, 30)}-not-it`;
    const answers = [await call(body()), await call(body(), withToken(sent))];
    delete process.env.PAYMENT_USER_TOKEN;
    answers.push(await call(body(), withToken(sent)));
    for (const a of answers) {
      assert.ok(!a.text.includes(TOKEN.slice(0, 12)), 'no part of the configured secret');
      assert.ok(!a.text.includes(sent), 'the sent value is not echoed');
      assert.ok(!/PAYMENT_USER_TOKEN|INTERNAL_SERVICE_TOKEN|stack|node_modules/i.test(a.text));
      assert.deepEqual(Object.keys(a.json), ['error']);
    }
    nothingHappened('refusal answers');
  });

  // ------------------------------------------------------------------------------------------------ the legitimate caller

  it('IMPLEMENT-01: the RIGHT token no longer upgrades anyone - 200, role STUDENT, one PENDING application for ADMIN review', async () => {
    const res = await call(body(), withToken(TOKEN));
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { upgraded: false, applicationQueued: true });
    assert.equal(profile.role, 'STUDENT');
    assert.deepEqual(roleChanges, [], 'no role update is written');
    assert.equal(applications.length, 1);
    assert.equal(applications[0].userId, USER);
    assert.equal(applications[0].status, 'PENDING');
    assert.equal(applications[0].source, 'LEGACY_PAYMENT');
    assert.ok(!res.text.includes(TOKEN));
    // the payment-service retrying the same notification does not queue a second application
    assert.equal((await call(body(), withToken(TOKEN))).status, 200);
    assert.equal(applications.length, 1);
    assert.equal(profile.role, 'STUDENT');
  });

  it('the header name is case-insensitive; the existing business checks still run after authentication', async () => {
    const wrongStatus = await call(body({ status: 'SOMETHING_ELSE' }), { 'X-Internal-Service-Token': TOKEN });
    assert.equal(wrongStatus.status, 400);
    assert.deepEqual(wrongStatus.json, { error: 'Invalid status' });
    const unknownUser = await call(body({ userId: 'f6'.repeat(12) }), { 'X-INTERNAL-SERVICE-TOKEN': TOKEN });
    assert.equal(unknownUser.status, 200);
    assert.deepEqual(unknownUser.json.data, { upgraded: false, applicationQueued: false }, 'an unknown user gets nothing');
    const notAnId = await call(body({ userId: 'not-an-id' }), { 'X-Internal-Service-Token': TOKEN });
    assert.equal(notAnId.status, 400);
    assert.equal(roleChanges.length, 0);
    assert.equal(notifications.length, 0);
    assert.equal(applications.length, 0);
  });

  it('refused and accepted calls at the same instant: only the authenticated one queues an application (and no role change)', async () => {
    const answers = await Promise.all([
      ...Array.from({ length: 20 }, () => call(body())),
      ...Array.from({ length: 20 }, () => call(body(), withToken(OTHER_TOKEN))),
      call(body(), withToken(TOKEN)),
    ]);
    assert.equal(answers.filter((a) => a.status === 200).length, 1);
    assert.equal(answers.filter((a) => a.status === 403).length, 40);
    assert.deepEqual(roleChanges, []);
    assert.equal(applications.length, 1);
    assert.equal(profile.role, 'STUDENT');
  });

  // ------------------------------------------------------------------------------------------------ logs and wiring

  it('no log line written during this file contains a token (configured, other, or sent)', () => {
    assert.ok(logs.length > 0, 'the refusals were logged');
    assert.ok(logs.some((l) => /Unauthorized service call/.test(l)));
    assert.ok(logs.some((l) => /PAYMENT_USER_TOKEN is not configured|shorter than 24|publicly known default/.test(l)));
    for (const line of logs) {
      for (const secret of [TOKEN, OTHER_TOKEN, ...PUBLIC_DEFAULTS]) assert.ok(!line.includes(secret), `a log line contains a token: ${line.slice(0, 80)}`);
      assert.ok(!line.includes(TOKEN.slice(0, 16)) && !line.includes(TOKEN.toUpperCase().slice(0, 16)), 'no part of the token either');
    }
  });

  it('the comparison is crypto.timingSafeEqual over equal-length digests - also for a token of another length', async () => {
    const crypto = require('crypto');
    const real = crypto.timingSafeEqual;
    const seen: Array<[number, number]> = [];
    crypto.timingSafeEqual = (a: Buffer, b: Buffer) => { seen.push([a.length, b.length]); return real(a, b); };
    try {
      for (const token of ['x', `${TOKEN}${TOKEN}`, TOKEN.slice(0, 40), TOKEN]) await call(body(), withToken(token));
    } finally {
      crypto.timingSafeEqual = real;
    }
    assert.equal(seen.length, 4, 'every presented token goes through timingSafeEqual');
    assert.ok(seen.every(([a, b]) => a === 32 && b === 32), 'both sides are 32-byte digests whatever the input length');
    assert.equal(applications.length, 1, 'only the last (right) token reached the controller');
    assert.equal(roleChanges.length, 0, 'and it did not change the role (IMPLEMENT-01)');
  });

  it('route table: exactly one route answers POST on the path and requireServiceToken(PAYMENT_USER_TOKEN) runs before the controller', () => {
    const layers = app._router.stack.filter((l: any) => l.route && l.route.path === ROUTE);
    assert.equal(layers.length, 1);
    const handlers = layers[0].route.stack.map((s: any) => s.name);
    assert.deepEqual(handlers, ['requireServiceToken(PAYMENT_USER_TOKEN)', 'confirmInstructor']);
    assert.ok(layers[0].route.methods.post);
  });
});
