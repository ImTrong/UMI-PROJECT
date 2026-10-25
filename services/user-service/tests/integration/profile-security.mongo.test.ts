/**
 * FIX-INS-01 against a REAL MongoDB replica set: the profile-write allowlist, the first-sign-in role and the personal-data
 * limits of GET /api/users, GET /api/users/:id and POST /api/users/batch - checked by what is actually stored / returned
 * through the real Prisma client (so the Prisma query shapes, `select`, `in`, `contains` + `mode: insensitive`, are exercised).
 *
 * The REAL express app runs on an ephemeral port against the ISOLATED database named by TEST_DATABASE_URL (its name must
 * contain "test"; this file uses its own database `<name>_profsec`, dropped at the end). Only the auth-service is a local stub
 * (it answers /api/auth/verify-token like the real one: identity only, never a role). All identities are synthetic.
 *
 *   TEST_DATABASE_URL="mongodb://127.0.0.1:27099/umi_fix_ins01_test?replicaSet=rsTest" npm test
 *
 * Without TEST_DATABASE_URL this file is skipped.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolveTestDb } from '../helpers/test-db-url';

const target = resolveTestDb('profsec');
const id = (c: string) => c.repeat(24);
const STUDENT = id('a');
const OTHER = id('b');
const TEACHER = id('c');
const GONE = id('d');
const BOSS = id('e');
const NEWBIE = id('f');
const tokens: Record<string, { userId: string; email: string; fullName: string; role?: string }> = {
  STUDENT: { userId: STUDENT, email: 'stu-int@umi.test', fullName: 'Stu' },
  OTHER: { userId: OTHER, email: 'oth-int@umi.test', fullName: 'Oth' },
  CLAIMS: { userId: OTHER, email: 'oth-int@umi.test', fullName: 'Oth', role: 'ADMIN' },
  BOSS: { userId: BOSS, email: 'boss-int@umi.test', fullName: 'Boss' },
  NEWBIE: { userId: NEWBIE, email: 'admin.instructor@umi.test', fullName: 'Newbie' },
};

describe('REAL MongoDB: profile writes, first-sign-in role and user-data reads (FIX-INS-01)', { skip: target.enabled ? false : 'set TEST_DATABASE_URL (isolated replica-set test DB) to run' }, () => {
  let admin: any;
  let server: http.Server;
  let authServer: http.Server;
  let base = '';

  before(async () => {
    assert.match(target.url as string, /test/i, 'refusing to run against a database whose name does not contain "test"');
    process.env.DATABASE_URL = target.url as string;
    process.env.RATE_LIMIT_MAX_REQUESTS = '100000';
    process.env.INTERNAL_SERVICE_TOKEN = randomBytes(32).toString('hex');
    process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(16).toString('hex');
    const { PrismaClient } = require('@prisma/client');
    admin = new PrismaClient({ datasources: { db: { url: target.url } } });
    await admin.$runCommandRaw({ dropDatabase: 1 });

    authServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let token = '';
        try { token = JSON.parse(raw).token; } catch { /* ignore */ }
        const user = tokens[token];
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(user ? { valid: true, user } : { valid: false }));
      });
    });
    await new Promise<void>((resolve) => authServer.listen(0, '127.0.0.1', resolve));
    process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as AddressInfo).port}`;

    const logger = require('../../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    try { await admin?.$runCommandRaw({ dropDatabase: 1 }); } catch { /* best effort */ }
    await admin?.$disconnect();
    await new Promise((resolve) => server?.close(resolve));
    await new Promise((resolve) => authServer?.close(resolve));
  });

  beforeEach(async () => {
    await admin.notification.deleteMany({});
    await admin.userProfile.deleteMany({});
    const base = { phoneNumber: '0900000009', address: 'Secret Street 9', dateOfBirth: new Date('2000-02-02'), badges: ['secret-badge'], isActive: true };
    await admin.userProfile.createMany({
      data: [
        { userId: STUDENT, email: 'stu-int@umi.test', fullName: 'Stu', role: 'STUDENT', ...base },
        { userId: OTHER, email: 'oth-int@umi.test', fullName: 'Oth', role: 'STUDENT', ...base },
        { userId: TEACHER, email: 'teacher-int@umi.test', fullName: 'Teacher Int', role: 'INSTRUCTOR', ...base },
        { userId: GONE, email: 'gone-int@umi.test', fullName: 'Gone Int', role: 'INSTRUCTOR', ...base, isActive: false },
        { userId: BOSS, email: 'boss-int@umi.test', fullName: 'Boss', role: 'ADMIN', ...base },
      ],
    });
  });

  const call = async (method: string, url: string, token?: string, payload?: unknown, rawBody?: string) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${url}`, { method, headers, body: rawBody ?? (payload === undefined ? undefined : JSON.stringify(payload)) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const inDb = (userId: string) => admin.userProfile.findUnique({ where: { userId } });
  const PUBLIC_KEYS = ['avatar', 'bio', 'createdAt', 'education', 'fullName', 'role', 'userId', 'work'];

  it('PUT /me with role / isActive / email / badges / __proto__: 400 and the stored document is byte-for-byte unchanged', async () => {
    const before = await inDb(STUDENT);
    for (const raw of [
      '{"role":"ADMIN"}', '{"role":"INSTRUCTOR"}', '{"isActive":false}', '{"email":"x@y.test"}', '{"badges":["gold"]}',
      '{"fullName":"Okay Name","role":"ADMIN"}', '{"__proto__":{"role":"ADMIN"}}', '[1]', '"role"',
    ]) {
      assert.equal((await call('PUT', '/api/users/me', 'STUDENT', undefined, raw)).status, 400, raw);
    }
    assert.deepEqual(await inDb(STUDENT), before);
  });

  it('PUT /me with profile fields: stored, role / isActive / email / badges untouched; JSON preferences and date of birth round-trip', async () => {
    const res = await call('PUT', '/api/users/me', 'STUDENT', {
      fullName: 'Okay Name', bio: 'Hello', phoneNumber: '0911111111', address: 'Elsewhere 3', dateOfBirth: '1998-04-05',
      avatar: 'https://cdn.umi.test/s.png', preferences: { theme: 'light', notifications: true, language: 'vi' },
    });
    assert.equal(res.status, 200);
    const doc = await inDb(STUDENT);
    assert.equal(doc.fullName, 'Okay Name');
    assert.equal(doc.address, 'Elsewhere 3');
    assert.equal(doc.dateOfBirth.toISOString().slice(0, 10), '1998-04-05');
    assert.deepEqual(doc.preferences, { theme: 'light', notifications: true, language: 'vi' });
    assert.equal(doc.role, 'STUDENT');
    assert.equal(doc.isActive, true);
    assert.equal(doc.email, 'stu-int@umi.test');
    assert.deepEqual(doc.badges, ['secret-badge']);
    assert.equal((await inDb(OTHER)).fullName, 'Oth', 'another user is untouched');
  });

  it('first sign-in with an e-mail that contains "admin" and "instructor": the stored profile is a STUDENT; a second sign-in changes nothing', async () => {
    assert.equal(await inDb(NEWBIE), null);
    const first = await call('GET', '/api/users/me', 'NEWBIE');
    assert.equal(first.status, 200);
    assert.equal(first.json.data.role, 'STUDENT');
    const stored = await inDb(NEWBIE);
    assert.equal(stored.role, 'STUDENT');
    assert.equal(stored.email, 'admin.instructor@umi.test');
    const second = await call('GET', '/api/users/me', 'NEWBIE');
    assert.equal(second.json.data.role, 'STUDENT');
    assert.equal(await admin.userProfile.count({ where: { userId: NEWBIE } }), 1);
    assert.equal((await call('PUT', '/api/users/me', 'NEWBIE', { role: 'ADMIN' })).status, 400);
    assert.equal((await inDb(NEWBIE)).role, 'STUDENT');
  });

  it('existing roles survive being read (ADMIN stays ADMIN, INSTRUCTOR stays INSTRUCTOR)', async () => {
    tokens.TEACHER = { userId: TEACHER, email: 'teacher-int@umi.test', fullName: 'Teacher Int' };
    for (const [token, role] of [['BOSS', 'ADMIN'], ['TEACHER', 'INSTRUCTOR'], ['STUDENT', 'STUDENT']] as const) {
      assert.equal((await call('GET', '/api/users/me', token)).json.data.role, role);
    }
  });

  it('GET /:userId: another user gets only the public subset, the owner and an ADMIN get the full profile; a token claiming ADMIN does not', async () => {
    const other = await call('GET', `/api/users/${STUDENT}`, 'OTHER');
    assert.equal(other.status, 200);
    assert.deepEqual(Object.keys(other.json.data).sort(), PUBLIC_KEYS);
    for (const secret of ['stu-int@', '0900000009', 'Secret Street', 'secret-badge']) assert.ok(!other.text.includes(secret), secret);
    const claims = await call('GET', `/api/users/${STUDENT}`, 'CLAIMS');
    assert.deepEqual(Object.keys(claims.json.data).sort(), PUBLIC_KEYS);
    assert.equal((await call('GET', `/api/users/${STUDENT}`, 'STUDENT')).json.data.email, 'stu-int@umi.test');
    assert.equal((await call('GET', `/api/users/${STUDENT}`, 'BOSS')).json.data.address, 'Secret Street 9');
  });

  it('GET /api/users: a student sees only active instructors (public fields, name search, no e-mail search); an ADMIN sees everyone', async () => {
    const list = await call('GET', '/api/users', 'STUDENT');
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.users.map((u: any) => u.userId), [TEACHER]);
    assert.deepEqual(Object.keys(list.json.users[0]).sort(), ['avatar', 'bio', 'createdAt', 'fullName', 'id', 'role', 'userId']);
    assert.equal(list.json.pagination.total, 1);
    assert.equal((await call('GET', '/api/users?search=TEACHER', 'STUDENT')).json.users.length, 1, 'case-insensitive name search');
    assert.equal((await call('GET', '/api/users?search=teacher-int', 'STUDENT')).json.users.length, 0, 'e-mail is not searchable');
    assert.equal((await call('GET', '/api/users?role=STUDENT', 'STUDENT')).status, 403);
    const all = await call('GET', '/api/users?limit=50', 'BOSS');
    assert.equal(all.json.users.length, 5);
    assert.ok(all.json.users.every((u: any) => typeof u.email === 'string'));
    assert.equal((await call('GET', '/api/users?search=gone-int%40umi', 'BOSS')).json.users.length, 1);
  });

  it('POST /batch: userId / fullName / avatar only, for ids of every role; bad ids are refused', async () => {
    const res = await call('POST', '/api/users/batch', undefined, { ids: [STUDENT, TEACHER, BOSS, STUDENT] });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 3);
    for (const u of res.json.data) assert.deepEqual(Object.keys(u).sort(), ['avatar', 'fullName', 'userId']);
    assert.ok(!res.text.includes('@umi.test'));
    assert.equal((await call('POST', '/api/users/batch', undefined, { ids: ['nope'] })).status, 400);
  });

  it('PUT /:userId: only an ADMIN changes role / isActive (and it is stored); a student is refused and nothing changes', async () => {
    assert.equal((await call('PUT', `/api/users/${OTHER}`, 'STUDENT', { role: 'ADMIN' })).status, 403);
    assert.equal((await call('PUT', `/api/users/${OTHER}`, 'CLAIMS', { role: 'ADMIN' })).status, 403);
    assert.equal((await inDb(OTHER)).role, 'STUDENT');
    assert.equal((await call('PUT', `/api/users/${OTHER}`, 'BOSS', { email: 'x@y.test' })).status, 400);
    const ok = await call('PUT', `/api/users/${OTHER}`, 'BOSS', { role: 'INSTRUCTOR', isActive: false });
    assert.equal(ok.status, 200);
    const doc = await inDb(OTHER);
    assert.equal(doc.role, 'INSTRUCTOR');
    assert.equal(doc.isActive, false);
    assert.equal(doc.email, 'oth-int@umi.test');
  });
});
