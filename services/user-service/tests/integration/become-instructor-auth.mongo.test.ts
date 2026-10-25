/**
 * FIX 07B-1 (AUTH-01) against a REAL MongoDB replica set: POST /api/users/become-instructor/confirm accepts only the
 * Payment -> User credential PAYMENT_USER_TOKEN, and "refused" means the learner's ROLE in the database is untouched and no
 * notification document is written.
 *
 * The REAL express app (real middleware, controller, UserService and Prisma client) runs on an ephemeral port against the
 * ISOLATED database named by TEST_DATABASE_URL (its name must contain "test"; this file uses its own database `<name>_uinst`,
 * which is dropped at the end).
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix06c_test?replicaSet=rsTest" npm test
 *
 * Without TEST_DATABASE_URL this file is skipped. No Docker container, no shared database and no real learner is involved.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { resolveTestDb } from '../helpers/test-db-url';

const target = resolveTestDb('uinst');
const ROUTE = '/api/users/become-instructor/confirm';
const TOKEN = randomBytes(32).toString('hex');        // random per run: no secret in the source
const OTHER_TOKEN = randomBytes(32).toString('hex');  // the shared INTERNAL_SERVICE_TOKEN of the other internal routes
const USER = 'a7'.repeat(12);
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));

describe('REAL MongoDB: become-instructor/confirm is authenticated with PAYMENT_USER_TOKEN (FIX 07B-1)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let admin: any;
  let server: any;
  let base = '';
  const logs: string[] = [];

  before(async () => {
    assert.match(target.url as string, /test/i, 'refusing to run against a database whose name does not contain "test"');
    process.env.DATABASE_URL = target.url as string;          // the app's own Prisma client reads this
    process.env.PAYMENT_USER_TOKEN = TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = OTHER_TOKEN;
    process.env.RATE_LIMIT_MAX_REQUESTS = '100000';
    process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(16).toString('hex');
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient({ datasources: { db: { url: target.url } } });
    await admin.$runCommandRaw({ dropDatabase: 1 });

    const logger = require('../../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => { logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(typeof a === 'object' ? JSON.stringify(a) : a))).join(' ')); return original(...args); };
    }
    const app = require('../../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    try { await admin?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
    await new Promise((resolve) => server?.close(resolve));
  });

  beforeEach(async () => {
    process.env.PAYMENT_USER_TOKEN = TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = OTHER_TOKEN;
    await admin.notification.deleteMany({});
    await admin.instructorApplication.deleteMany({});
    await admin.userProfile.deleteMany({});
    await admin.userProfile.create({ data: { userId: USER, email: 'learner-07b1@test.local', fullName: 'Learner 07B-1', role: 'STUDENT' } });
  });

  const body = { userId: USER, status: 'INSTRUCTOR_REGISTRATION_SUCCESS' };
  const call = async (headers: Record<string, string> = {}, url = ROUTE, payload: unknown = body) => {
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const withToken = (token: string) => ({ 'x-internal-service-token': token });
  const roleInDb = async () => (await admin.userProfile.findUnique({ where: { userId: USER } })).role;
  const unchanged = async (label: string) => {
    assert.equal(await roleInDb(), 'STUDENT', `${label}: the role in the database must stay STUDENT`);
    assert.equal(await admin.notification.count(), 0, `${label}: no notification document`);
    assert.equal(await admin.instructorApplication.count(), 0, `${label}: no application document`);
  };

  it('no token, wrong tokens of every length, the INTERNAL_SERVICE_TOKEN and the public default: 403, role STUDENT in the DB', async () => {
    const attempts: Array<Record<string, string>> = [
      {}, withToken(''), withToken('x'), withToken(TOKEN.slice(0, -1)), withToken(`${TOKEN}0`), withToken('z'.repeat(8192)),
      withToken(`${TOKEN[0] === 'a' ? 'b' : 'a'}${TOKEN.slice(1)}`), withToken(OTHER_TOKEN), ...PUBLIC_DEFAULTS.map(withToken),
      { authorization: `Bearer ${TOKEN}` }, { 'x-internal-token': TOKEN },
    ];
    for (const headers of attempts) {
      const res = await call(headers);
      assert.equal(res.status, 403);
      assert.deepEqual(res.json, { error: 'Forbidden: Invalid internal service token' });
    }
    const viaQuery = await call({}, `${ROUTE}?x-internal-service-token=${TOKEN}`);
    const viaBody = await call({}, ROUTE, { ...body, 'x-internal-service-token': TOKEN, token: TOKEN });
    assert.equal(viaQuery.status, 403);
    assert.equal(viaBody.status, 403);
    for (const variant of [`${ROUTE}/`, ROUTE.toUpperCase()]) assert.equal((await call({}, variant)).status, 403, variant);
    await unchanged('refused');
  });

  it('server without a usable PAYMENT_USER_TOKEN (unset, empty, short, public default): 500 fail-closed, role STUDENT in the DB', async () => {
    for (const configured of [undefined, '', 'too-short-value', ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.PAYMENT_USER_TOKEN;
      else process.env.PAYMENT_USER_TOKEN = configured;
      for (const headers of [{}, withToken(TOKEN), withToken(configured ?? ''), withToken(OTHER_TOKEN)]) {
        const res = await call(headers);
        assert.equal(res.status, 500);
        assert.deepEqual(res.json, { error: 'Internal service authentication not configured' });
      }
    }
    await unchanged('not configured');
  });

  it('IMPLEMENT-01: the valid Payment -> User token no longer upgrades: role STUDENT in the DB, one PENDING application', async () => {
    const res = await call(withToken(TOKEN));
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { upgraded: false, applicationQueued: true });
    assert.equal(await roleInDb(), 'STUDENT');
    const apps = await admin.instructorApplication.findMany({});
    assert.equal(apps.length, 1);
    assert.equal(apps[0].userId, USER);
    assert.equal(apps[0].status, 'PENDING');
    assert.equal(apps[0].source, 'LEGACY_PAYMENT');
    assert.equal(await admin.notification.count(), 0);
    assert.equal((await call(withToken(TOKEN))).status, 200, 'a retried notification is idempotent');
    assert.equal(await admin.instructorApplication.count(), 1);
  });

  it('refused and accepted calls at the same instant: exactly one application, no role change, refusals leave no trace', async () => {
    const answers = await Promise.all([
      ...Array.from({ length: 15 }, () => call()),
      ...Array.from({ length: 15 }, () => call(withToken(OTHER_TOKEN))),
      call(withToken(TOKEN)),
    ]);
    assert.equal(answers.filter((a) => a.status === 200).length, 1);
    assert.equal(answers.filter((a) => a.status === 403).length, 30);
    assert.equal(await roleInDb(), 'STUDENT');
    assert.equal(await admin.instructorApplication.count(), 1);
  });

  it('no answer and no log line of this file contains a token', async () => {
    const answers = [await call(), await call(withToken(`${TOKEN.slice(0, 40)}-wrong`)), await call(withToken(TOKEN))];
    for (const a of answers) assert.ok(!a.text.includes(TOKEN.slice(0, 16)) && !a.text.includes(OTHER_TOKEN.slice(0, 16)));
    assert.ok(logs.length > 0);
    for (const line of logs) {
      for (const secret of [TOKEN.slice(0, 16), OTHER_TOKEN.slice(0, 16), ...PUBLIC_DEFAULTS]) assert.ok(!line.includes(secret), `log line leaks a token: ${line.slice(0, 80)}`);
    }
  });
});
