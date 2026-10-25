/**
 * IMPLEMENT-01: becoming an instructor = STUDENT -> application PENDING -> ADMIN approves (INSTRUCTOR) / rejects (stays STUDENT).
 *
 *   POST /api/users/become-instructor                                    signed-in STUDENT without a pending application
 *   GET  /api/users/become-instructor/me                                 the caller's role + latest application
 *   GET  /api/users/admin/instructor-applications                        ADMIN
 *   POST /api/users/admin/instructor-applications/:id/approve | /reject  ADMIN; the reviewer is the caller
 *
 * The REAL express app runs on an ephemeral port; the database is an in-memory stand-in (profiles, applications with the unique
 * pendingKey, notifications) and the auth-service is a loopback stub that maps a token to an identity.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, any>;
const id = (c: string) => c.repeat(24);
const STUDENT_A = id('a');
const STUDENT_B = id('b');
const INSTRUCTOR = id('c');
const ADMIN = id('d');
const ADMIN2 = id('e');
const NO_PROFILE = id('f');

let profiles: Row[] = [];
let applications: Row[] = [];
const notifications: Row[] = [];
const roleWrites: Array<{ userId: string; role: string }> = [];
let seq = 0;
const match = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
    if ('in' in v) return (v.in as any[]).includes(row[k]);
    return false;
  }
  return row[k] === v;
});
const sortDesc = (rows: Row[], key: string) => [...rows].sort((a, b) => (a[key] < b[key] ? 1 : -1));

class FakePrismaClient {
  userProfile = {
    findUnique: async ({ where }: any) => { const r = profiles.find((p) => match(p, where)); return r ? { ...r } : null; },
    findMany: async ({ where }: any = {}) => profiles.filter((p) => match(p, where)).map((p) => ({ ...p })),
    update: async ({ where, data }: any) => {
      const r = profiles.find((p) => match(p, where));
      if (!r) throw new Error('P2025');
      if ('role' in data) roleWrites.push({ userId: r.userId, role: data.role });
      Object.assign(r, data);
      return { ...r, education: [], work: [] };
    },
  };
  instructorApplication = {
    findFirst: async ({ where, orderBy }: any = {}) => {
      const rows = applications.filter((a) => match(a, where));
      return (orderBy ? sortDesc(rows, 'submittedAt') : rows)[0] ? { ...(orderBy ? sortDesc(rows, 'submittedAt') : rows)[0] } : null;
    },
    findUnique: async ({ where }: any) => { const r = applications.find((a) => match(a, where)); return r ? { ...r } : null; },
    findMany: async ({ where, skip = 0, take = 20 }: any = {}) => sortDesc(applications.filter((a) => match(a, where)), 'submittedAt').slice(skip, skip + take).map((a) => ({ ...a })),
    count: async ({ where }: any = {}) => applications.filter((a) => match(a, where)).length,
    create: async ({ data }: any) => {
      if (applications.some((a) => a.pendingKey === data.pendingKey)) throw Object.assign(new Error('Unique constraint failed on pendingKey'), { code: 'P2002' });
      const row = { id: (++seq).toString(16).padStart(24, '0'), submittedAt: new Date(Date.now() + seq), reviewedBy: null, reviewedAt: null, rejectionReason: null, source: 'FORM', ...data };
      applications.push(row);
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      const rows = applications.filter((a) => match(a, where));
      for (const r of rows) Object.assign(r, data);
      return { count: rows.length };
    },
  };
  notification = { create: async ({ data }: any) => { notifications.push(data); return { id: 'n'.repeat(24), ...data }; } };
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient, Role: { STUDENT: 'STUDENT', INSTRUCTOR: 'INSTRUCTOR', ADMIN: 'ADMIN' } },
} as any;

// auth-service stub: the token names the identity; CLAIMS_ADMIN carries a forged role in the token answer
const tokens: Record<string, Row> = {
  A: { userId: STUDENT_A, email: 'a@umi.test', fullName: 'Student A' },
  B: { userId: STUDENT_B, email: 'b@umi.test', fullName: 'Student B' },
  INSTRUCTOR: { userId: INSTRUCTOR, email: 't@umi.test', fullName: 'Teacher' },
  ADMIN: { userId: ADMIN, email: 'boss@umi.test', fullName: 'Boss' },
  ADMIN2: { userId: ADMIN2, email: 'boss2@umi.test', fullName: 'Boss Two' },
  CLAIMS_ADMIN: { userId: STUDENT_B, email: 'b@umi.test', fullName: 'Student B', role: 'ADMIN' },
  NO_PROFILE: { userId: NO_PROFILE, email: 'x@umi.test', fullName: 'Nobody' },
};

describe('IMPLEMENT-01: instructor application and ADMIN review', () => {
  let server: http.Server;
  let authServer: http.Server;
  let base = '';

  before(async () => {
    authServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let token = '';
        try { token = JSON.parse(raw).token; } catch { /* ignore */ }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(tokens[token] ? { valid: true, user: tokens[token] } : { valid: false }));
      });
    });
    await new Promise<void>((resolve) => authServer.listen(0, '127.0.0.1', resolve));
    process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as AddressInfo).port}`;
    process.env.RATE_LIMIT_MAX_REQUESTS = '100000';
    process.env.INTERNAL_SERVICE_TOKEN = randomBytes(32).toString('hex');
    process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(16).toString('hex');
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => authServer.close(resolve));
  });

  const profile = (userId: string, role: string, n: string) => ({ id: `${n}`.repeat(24).slice(0, 24), userId, email: `${n}@umi.test`, fullName: `User ${n}`, role, isActive: true, phoneNumber: null, address: null });
  beforeEach(() => {
    profiles = [profile(STUDENT_A, 'STUDENT', '1'), profile(STUDENT_B, 'STUDENT', '2'), profile(INSTRUCTOR, 'INSTRUCTOR', '3'), profile(ADMIN, 'ADMIN', '4'), profile(ADMIN2, 'ADMIN', '5')];
    applications = [];
    notifications.length = 0;
    roleWrites.length = 0;
  });

  const call = async (method: string, url: string, token?: string, payload?: unknown) => {
    const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const APPLY = '/api/users/become-instructor';
  const MINE = '/api/users/become-instructor/me';
  const LIST = '/api/users/admin/instructor-applications';
  const approve = (aid: string) => `${LIST}/${aid}/approve`;
  const reject = (aid: string) => `${LIST}/${aid}/reject`;
  const form = { bio: 'Tôi có 5 năm kinh nghiệm giảng dạy lập trình web.', phoneNumber: '0900000000', address: 'Hà Nội', expertise: 'Lập trình Web' };
  const roleOf = (userId: string) => profiles.find((p) => p.userId === userId)!.role;

  // =============================================================================================== applying
  it('1. applying files a PENDING application with the expertise; the role does not change', async () => {
    const r = await call('POST', APPLY, 'A', form);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.data.status, 'PENDING');
    assert.equal(r.json.data.expertise, 'Lập trình Web');
    assert.equal(r.json.data.motivation, form.bio);
    assert.equal(applications.length, 1);
    assert.equal(applications[0].userId, STUDENT_A);
    assert.equal(roleOf(STUDENT_A), 'STUDENT');
    assert.deepEqual(roleWrites, []);
    const mine = await call('GET', MINE, 'A');
    assert.equal(mine.json.data.role, 'STUDENT');
    assert.equal(mine.json.data.application.status, 'PENDING');
    assert.ok(!('reviewedBy' in mine.json.data.application), 'the applicant does not see reviewer ids');
  });

  it('2. a second application while one is PENDING is refused (also two at the same instant)', async () => {
    assert.equal((await call('POST', APPLY, 'A', form)).status, 201);
    const again = await call('POST', APPLY, 'A', form);
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'APPLICATION_PENDING');
    const burst = await Promise.all(Array.from({ length: 8 }, () => call('POST', APPLY, 'B', form)));
    assert.equal(burst.filter((r) => r.status === 201).length, 1);
    assert.ok(burst.filter((r) => r.status !== 201).every((r) => r.status === 409));
    assert.equal(applications.filter((a) => a.userId === STUDENT_B && a.status === 'PENDING').length, 1);
  });

  it('3. not signed in -> 401; an INSTRUCTOR / ADMIN cannot apply; a user without profile neither; nothing is written', async () => {
    assert.equal((await call('POST', APPLY, undefined, form)).status, 401);
    assert.equal((await call('GET', MINE)).status, 401);
    for (const t of ['INSTRUCTOR', 'ADMIN']) {
      const r = await call('POST', APPLY, t, form);
      assert.equal(r.status, 409, t);
      assert.equal(r.json.code, 'NOT_A_STUDENT');
    }
    assert.equal((await call('POST', APPLY, 'NO_PROFILE', form)).status, 404);
    assert.equal(applications.length, 0);
  });

  it('4. expertise is validated (required, text, 2-200 chars); motivation bounded', async () => {
    for (const bad of [{}, { expertise: '' }, { expertise: ' x ' }, { expertise: 123 }, { expertise: ['Web'] }, { expertise: 'x'.repeat(201) }, { expertise: 'Web', bio: 'y'.repeat(2001) }]) {
      const r = await call('POST', APPLY, 'A', bad);
      assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 60));
    }
    assert.equal(applications.length, 0);
  });

  it('5. forged userId / role / status / reviewer in the application body change nothing', async () => {
    const r = await call('POST', APPLY, 'A', { ...form, userId: STUDENT_B, role: 'INSTRUCTOR', status: 'APPROVED', reviewedBy: ADMIN, pendingKey: 'x', source: 'LEGACY_PAYMENT' });
    assert.equal(r.status, 201);
    assert.equal(applications[0].userId, STUDENT_A);
    assert.equal(applications[0].status, 'PENDING');
    assert.equal(applications[0].source, 'FORM');
    assert.equal(applications[0].pendingKey, STUDENT_A);
    assert.equal(applications[0].reviewedBy, null);
    assert.equal(roleOf(STUDENT_A), 'STUDENT');
    assert.equal(roleOf(STUDENT_B), 'STUDENT');
  });

  // =============================================================================================== review
  it('6. STUDENT / INSTRUCTOR (and a token claiming ADMIN) cannot list, approve or reject; nothing changes', async () => {
    await call('POST', APPLY, 'A', form);
    const aid = applications[0].id;
    for (const t of ['A', 'B', 'INSTRUCTOR', 'CLAIMS_ADMIN']) {
      assert.equal((await call('GET', LIST, t)).status, 403, `${t} list`);
      assert.equal((await call('POST', approve(aid), t, { role: 'ADMIN' })).status, 403, `${t} approve`);
      assert.equal((await call('POST', reject(aid), t, { reason: 'no way' })).status, 403, `${t} reject`);
    }
    for (const [m, u] of [['GET', LIST], ['POST', approve(aid)], ['POST', reject(aid)]] as const) assert.equal((await call(m, u, undefined, m === 'GET' ? undefined : {})).status, 401);
    assert.equal(applications[0].status, 'PENDING');
    assert.equal(roleOf(STUDENT_A), 'STUDENT');
    assert.deepEqual(roleWrites, []);
  });

  it('7. ADMIN lists (pending filter, applicant details) and approves: application APPROVED, reviewer = caller, role INSTRUCTOR', async () => {
    await call('POST', APPLY, 'A', form);
    await call('POST', APPLY, 'B', form);
    const list = await call('GET', `${LIST}?status=PENDING`, 'ADMIN');
    assert.equal(list.status, 200);
    assert.equal(list.json.pagination.total, 2);
    assert.ok(list.json.data.every((a: any) => a.applicant && a.applicant.email));
    const aid = applications.find((a) => a.userId === STUDENT_A)!.id;
    const ok = await call('POST', approve(aid), 'ADMIN', { reviewedBy: ADMIN2, userId: STUDENT_B, role: 'ADMIN' });
    assert.equal(ok.status, 200, ok.text);
    const app = applications.find((a) => a.id === aid)!;
    assert.equal(app.status, 'APPROVED');
    assert.equal(app.reviewedBy, ADMIN, 'the reviewer is the authenticated admin, not the body');
    assert.ok(app.reviewedAt instanceof Date);
    assert.equal(roleOf(STUDENT_A), 'INSTRUCTOR');
    assert.equal(roleOf(STUDENT_B), 'STUDENT', 'a forged userId in the body touches nobody else');
    assert.deepEqual(roleWrites, [{ userId: STUDENT_A, role: 'INSTRUCTOR' }]);
    assert.equal(notifications.length, 1);
    assert.equal((await call('GET', MINE, 'A')).json.data.application.status, 'APPROVED');
    assert.equal((await call('GET', `${LIST}?status=WHATEVER`, 'ADMIN')).status, 400);
  });

  it('8. reject keeps the STUDENT, stores the reason; the learner can apply again; a decision is final', async () => {
    await call('POST', APPLY, 'A', form);
    const aid = applications[0].id;
    assert.equal((await call('POST', reject(aid), 'ADMIN', {})).status, 400, 'a reason is required');
    assert.equal((await call('POST', reject(aid), 'ADMIN', { reason: 'x' })).status, 400, 'too short');
    assert.equal(applications[0].status, 'PENDING');
    const r = await call('POST', reject(aid), 'ADMIN2', { reason: 'Vui lòng bổ sung kinh nghiệm giảng dạy' });
    assert.equal(r.status, 200, r.text);
    assert.equal(applications[0].status, 'REJECTED');
    assert.equal(applications[0].rejectionReason, 'Vui lòng bổ sung kinh nghiệm giảng dạy');
    assert.equal(applications[0].reviewedBy, ADMIN2);
    assert.equal(roleOf(STUDENT_A), 'STUDENT');
    assert.deepEqual(roleWrites, []);
    const mine = (await call('GET', MINE, 'A')).json.data;
    assert.equal(mine.application.status, 'REJECTED');
    assert.equal(mine.application.rejectionReason, 'Vui lòng bổ sung kinh nghiệm giảng dạy');
    // closed: no second decision either way
    assert.equal((await call('POST', approve(aid), 'ADMIN')).status, 409);
    assert.equal((await call('POST', reject(aid), 'ADMIN', { reason: 'again please' })).status, 409);
    assert.equal(roleOf(STUDENT_A), 'STUDENT');
    // apply again
    const again = await call('POST', APPLY, 'A', { ...form, expertise: 'Lập trình Web + DevOps' });
    assert.equal(again.status, 201);
    assert.equal(applications.filter((a) => a.userId === STUDENT_A).length, 2);
    assert.equal((await call('GET', MINE, 'A')).json.data.application.status, 'PENDING', 'the latest application is shown');
  });

  it('9. approving twice at the same instant upgrades once; unknown / malformed ids are 404', async () => {
    await call('POST', APPLY, 'A', form);
    const aid = applications[0].id;
    const answers = await Promise.all([call('POST', approve(aid), 'ADMIN'), call('POST', approve(aid), 'ADMIN2'), call('POST', reject(aid), 'ADMIN', { reason: 'too late' })]);
    assert.equal(answers.filter((a) => a.status === 200).length, 1);
    assert.equal(roleWrites.length <= 1, true);
    assert.equal((await call('POST', approve(id('9')), 'ADMIN')).status, 404);
    assert.equal((await call('POST', approve('not-an-id'), 'ADMIN')).status, 404);
  });

  it('10. an applicant who became ADMIN meanwhile is never downgraded by an approval', async () => {
    await call('POST', APPLY, 'A', form);
    profiles.find((p) => p.userId === STUDENT_A)!.role = 'ADMIN';
    assert.equal((await call('POST', approve(applications[0].id), 'ADMIN')).status, 200);
    assert.equal(roleOf(STUDENT_A), 'ADMIN');
    assert.deepEqual(roleWrites, []);
  });
});
