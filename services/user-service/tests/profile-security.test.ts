/**
 * FIX-INS-01 (AUDIT 01: S1, S2, S7): secure user profile writes, role assignment and user-data reads.
 *
 *   S1  PUT /api/users/me writes ONLY an allowlist of profile fields - never role / isActive / email / userId / badges.
 *   S2  A profile created on first sign-in is a STUDENT, whatever the e-mail address says; existing roles never change on read.
 *   S7  GET /api/users/:id, GET /api/users and POST /api/users/batch no longer hand personal data to callers who do not own it.
 *
 * The REAL express app runs on an ephemeral port (real routing, validators, middleware, controllers and UserService). Only two
 * things are replaced: the database client (a small in-memory stand-in that records every write) and the auth-service
 * (a local HTTP stub that answers /api/auth/verify-token the way the real one does - it NEVER returns a role).
 * Every identity here is synthetic; no real e-mail address, token or personal data appears in this file.
 * A real MongoDB is not needed: the guarantees under test are in the request path, not in Prisma.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const id = (c: string) => c.repeat(24);
const STUDENT_A = id('a');
const STUDENT_B = id('b');
const INSTRUCTOR = id('c');
const INACTIVE_INSTRUCTOR = id('d');
const ADMIN = id('e');
const NEWCOMER_ADMIN_MAIL = id('1');   // no profile yet, e-mail contains "admin"
const NEWCOMER_INSTRUCTOR_MAIL = id('2'); // no profile yet, e-mail contains "instructor"
const NEWCOMER_PLAIN = id('3');        // no profile yet, ordinary e-mail
const NEWCOMER_UPPER = id('4');        // no profile yet, e-mail contains "ADMIN" in capitals
const STUDENT_WITH_ADMIN_MAIL = id('5'); // existing STUDENT whose e-mail contains "admin"
const INSTRUCTOR_PLAIN_MAIL = id('6');   // existing INSTRUCTOR with a plain e-mail
const SECRET_PHONE = '0900000001';
const SECRET_ADDRESS = 'Secret Street 1';
const SECRET_MAIL_A = 'student.a.secret@umi.test';

// ---- in-memory Prisma stand-in (installed before the app is loaded) ----
type Row = Record<string, any>;
const mk = (userId: string, over: Row = {}): Row => ({
  id: `p${userId.slice(1)}`, userId, email: `${userId.slice(0, 6)}@umi.test`, fullName: `User ${userId[0]}`, avatar: null, bio: null,
  role: 'STUDENT', phoneNumber: SECRET_PHONE, address: SECRET_ADDRESS, dateOfBirth: new Date('2000-01-01'), badges: ['secret-badge'],
  preferences: { theme: 'dark' }, isActive: true, createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01'),
  education: [{ id: 'e1', institution: 'Uni', degree: 'BSc', fieldOfStudy: 'CS', startDate: new Date('2018-01-01'), endDate: null, grade: 'secret-grade', description: 'secret' }],
  work: [{ id: 'w1', company: 'Co', position: 'Dev', location: 'X', startDate: new Date('2020-01-01'), endDate: null, current: true, description: 'secret' }],
  ...over,
});
const seed = (): Row[] => [
  mk(STUDENT_A, { email: SECRET_MAIL_A }),
  mk(STUDENT_B),
  mk(INSTRUCTOR, { role: 'INSTRUCTOR', email: 'teacher.secret@umi.test', fullName: 'Teacher One' }),
  mk(INACTIVE_INSTRUCTOR, { role: 'INSTRUCTOR', isActive: false, fullName: 'Teacher Gone' }),
  mk(ADMIN, { role: 'ADMIN', email: 'boss@umi.test' }),
  mk(STUDENT_WITH_ADMIN_MAIL, { email: 'admin-fan@umi.test' }),
  mk(INSTRUCTOR_PLAIN_MAIL, { role: 'INSTRUCTOR', email: 'plain@umi.test' }),
];
let db: Row[] = [];
const writes: Array<{ where: any; data: Row }> = [];
const creates: Row[] = [];
const notifications: Row[] = [];

const pick = (row: Row, select: any): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(select)) {
    if (!v) continue;
    if (v === true) out[k] = row[k];
    else if (typeof v === 'object' && (v as any).select && Array.isArray(row[k])) out[k] = row[k].map((el: Row) => pick(el, (v as any).select));
    else out[k] = row[k];
  }
  return out;
};
const shape = (row: Row, args: any): Row => {
  if (args?.select) return pick(row, args.select);
  const copy = { ...row };
  if (!args?.include) { delete copy.education; delete copy.work; }
  return copy;
};
const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
  if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('in' in (v as Row)) return (v as Row).in.includes(row[k]);
    if ('contains' in (v as Row)) return String(row[k] ?? '').toLowerCase().includes(String((v as Row).contains).toLowerCase());
    if ('not' in (v as Row)) return row[k] !== (v as Row).not;
  }
  return row[k] === v;
});

class FakePrismaClient {
  userProfile = {
    findUnique: async (args: any) => {
      const hit = db.find((r) => matches(r, args.where));
      return hit ? shape(hit, args) : null;
    },
    findMany: async (args: any = {}) => {
      let rows = db.filter((r) => matches(r, args.where));
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take) rows = rows.slice(0, args.take);
      lastFindMany = { take: args.take, where: args.where };
      return rows.map((r) => shape(r, args));
    },
    count: async (args: any = {}) => db.filter((r) => matches(r, args.where)).length,
    create: async (args: any) => {
      const row = mk(args.data.userId, { ...args.data, phoneNumber: null, address: null, dateOfBirth: null, badges: [], education: [], work: [] });
      creates.push({ ...args.data });
      db.push(row);
      return shape(row, args);
    },
    update: async (args: any) => {
      const hit = db.find((r) => matches(r, args.where));
      if (!hit) throw new Error('P2025');
      writes.push({ where: args.where, data: { ...args.data } });
      Object.assign(hit, args.data);
      return shape(hit, args);
    },
  };
  notification = { create: async ({ data }: any) => { notifications.push(data); return { id: 'n1', ...data }; } };
  // IMPLEMENT-01: the registration form files an application instead of changing the role
  instructorApplication = {
    findFirst: async () => null,
    create: async ({ data }: any) => ({ id: 'a'.repeat(24), submittedAt: new Date(), ...data }),
  };
}
let lastFindMany: { take?: number; where?: any } = {};
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient, Role: { STUDENT: 'STUDENT', INSTRUCTOR: 'INSTRUCTOR', ADMIN: 'ADMIN' } },
} as any;

// ---- auth-service stub: token -> identity. It NEVER sends a role, except for the one token that tries to claim ADMIN ----
const tokens: Record<string, { userId: string; email: string; fullName: string; role?: string }> = {
  A: { userId: STUDENT_A, email: SECRET_MAIL_A, fullName: 'User a' },
  B: { userId: STUDENT_B, email: 'b@umi.test', fullName: 'User b' },
  INSTRUCTOR: { userId: INSTRUCTOR, email: 'teacher.secret@umi.test', fullName: 'Teacher One' },
  ADMIN: { userId: ADMIN, email: 'boss@umi.test', fullName: 'Boss' },
  CLAIMS_ADMIN: { userId: STUDENT_B, email: 'b@umi.test', fullName: 'User b', role: 'ADMIN' },
  NEW_ADMIN_MAIL: { userId: NEWCOMER_ADMIN_MAIL, email: 'admin@umi.test', fullName: 'Newcomer One' },
  NEW_ADMIN_SUBSTR: { userId: NEWCOMER_PLAIN, email: 'superadmin.fan@umi.test', fullName: 'Newcomer Two' },
  NEW_INSTRUCTOR_MAIL: { userId: NEWCOMER_INSTRUCTOR_MAIL, email: 'instructor@umi.test', fullName: 'Newcomer Three' },
  NEW_UPPER: { userId: NEWCOMER_UPPER, email: 'ADMIN.INSTRUCTOR@UMI.TEST', fullName: 'Newcomer Four' },
  ADMIN_FAN: { userId: STUDENT_WITH_ADMIN_MAIL, email: 'admin-fan@umi.test', fullName: 'Fan' },
  PLAIN_TEACHER: { userId: INSTRUCTOR_PLAIN_MAIL, email: 'plain@umi.test', fullName: 'Plain Teacher' },
};

describe('FIX-INS-01: profile writes, role assignment and user-data reads', () => {
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
        const user = tokens[token];
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(user ? { valid: true, user } : { valid: false }));
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

  beforeEach(() => {
    db = seed();
    writes.length = 0;
    creates.length = 0;
    notifications.length = 0;
    lastFindMany = {};
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
  const row = (userId: string) => db.find((r) => r.userId === userId)!;
  const noWrites = (label: string) => {
    assert.equal(writes.length, 0, `${label}: nothing may be written`);
    assert.equal(creates.length, 0, `${label}: nothing may be created`);
  };
  const PUBLIC_KEYS = ['createdAt', 'avatar', 'bio', 'education', 'fullName', 'role', 'userId', 'work'].sort();
  const assertNoPersonalData = (text: string, label: string) => {
    for (const secret of [SECRET_PHONE, SECRET_ADDRESS, SECRET_MAIL_A, 'teacher.secret@', 'secret-badge', 'secret-grade', '@umi.test']) {
      assert.ok(!text.includes(secret), `${label}: response must not contain "${secret}"`);
    }
  };

  // =========================================================================================== S1: PUT /api/users/me

  describe('S1 - PUT /api/users/me cannot write role or any internal field', () => {
    it('STUDENT sends role ADMIN: 400, role stays STUDENT, nothing written', async () => {
      const res = await call('PUT', '/api/users/me', 'A', { role: 'ADMIN' });
      assert.equal(res.status, 400);
      assert.deepEqual(res.json.fields, ['role']);
      assert.equal(row(STUDENT_A).role, 'STUDENT');
      noWrites('role ADMIN');
    });

    it('STUDENT sends role INSTRUCTOR: 400, role stays STUDENT, nothing written', async () => {
      const res = await call('PUT', '/api/users/me', 'A', { role: 'INSTRUCTOR' });
      assert.equal(res.status, 400);
      assert.equal(row(STUDENT_A).role, 'STUDENT');
      noWrites('role INSTRUCTOR');
    });

    it('a valid field sent TOGETHER with role is refused as a whole (the valid field is not written either)', async () => {
      const res = await call('PUT', '/api/users/me', 'A', { fullName: 'New Name', role: 'ADMIN' });
      assert.equal(res.status, 400);
      assert.equal(row(STUDENT_A).fullName, 'User a');
      noWrites('mixed body');
    });

    it('isActive, e-mail, userId, id, badges, createdAt and made-up privilege fields are refused: 400, nothing written', async () => {
      const forbidden: Array<Record<string, unknown>> = [
        { isActive: false }, { isActive: true }, { email: 'x@y.test' }, { userId: STUDENT_B }, { id: 'p1' }, { badges: ['gold'] },
        { createdAt: '2020-01-01' }, { updatedAt: '2020-01-01' }, { isAdmin: true }, { permissions: ['*'] }, { scope: 'admin' },
        { education: [] }, { notifications: [] }, { password: 'x' },
      ];
      for (const body of forbidden) {
        const res = await call('PUT', '/api/users/me', 'A', body);
        assert.equal(res.status, 400, JSON.stringify(Object.keys(body)));
      }
      noWrites('forbidden fields');
      assert.equal(row(STUDENT_A).isActive, true);
      assert.deepEqual(row(STUDENT_A).badges, ['secret-badge']);
    });

    it('__proto__ / constructor smuggled in the JSON body are refused', async () => {
      for (const raw of ['{"__proto__":{"role":"ADMIN"}}', '{"constructor":{"prototype":{"role":"ADMIN"}}}', '{"fullName":"Okay Name","__proto__":{"isActive":false}}']) {
        const res = await call('PUT', '/api/users/me', 'A', undefined, raw);
        assert.equal(res.status, 400, raw);
      }
      noWrites('prototype pollution');
      assert.equal(row(STUDENT_A).role, 'STUDENT');
      assert.equal(({} as any).role, undefined, 'Object.prototype was not polluted');
    });

    it('a body that is not an object (array, string, number, null) is refused', async () => {
      for (const raw of ['[{"fullName":"Okay Name"}]', '"role"', '42', 'null']) {
        const res = await call('PUT', '/api/users/me', 'A', undefined, raw);
        assert.equal(res.status, 400, raw);
      }
      noWrites('non-object body');
    });

    it('wrongly typed values are refused (arrays, objects, numbers, huge strings): 400, nothing written', async () => {
      const bad: Array<Record<string, unknown>> = [
        { fullName: ['Okay Name'] }, { fullName: { $ne: 1 } }, { fullName: 12345 }, { bio: ['x'] }, { bio: 'b'.repeat(501) },
        { phoneNumber: ['0900000000'] }, { phoneNumber: 'call me' }, { address: { a: 1 } }, { address: 'a'.repeat(256) },
        { dateOfBirth: ['2000-01-01'] }, { dateOfBirth: 'yesterday' }, { avatar: ['x'] }, { avatar: 'h'.repeat(2049) },
        { preferences: 'dark' }, { preferences: ['dark'] }, { preferences: { big: 'z'.repeat(5000) } }, { fullName: null },
      ];
      for (const body of bad) {
        const res = await call('PUT', '/api/users/me', 'A', body);
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      }
      noWrites('bad types');
    });

    it('a legitimate update works and writes ONLY the profile fields that were sent', async () => {
      const body = {
        fullName: 'Okay Name', bio: 'About me', phoneNumber: '0911111111', address: 'Somewhere 2', dateOfBirth: '1999-05-06',
        avatar: 'https://cdn.umi.test/a.png', preferences: { theme: 'light', notifications: true, language: 'vi' },
      };
      const res = await call('PUT', '/api/users/me', 'A', body);
      assert.equal(res.status, 200);
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0].where, { userId: STUDENT_A });
      const keys = Object.keys(writes[0].data).sort();
      assert.deepEqual(keys, [...Object.keys(body), 'updatedAt'].sort());
      assert.equal(row(STUDENT_A).fullName, 'Okay Name');
      assert.equal(row(STUDENT_A).role, 'STUDENT');
      assert.equal(row(STUDENT_A).isActive, true);
    });

    it('the exact payload the profile page sends (fullName, bio, phoneNumber, address, dateOfBirth) is accepted', async () => {
      const res = await call('PUT', '/api/users/me', 'A', { fullName: 'Okay Name', bio: '', phoneNumber: '0911111111', address: '', dateOfBirth: '' });
      assert.equal(res.status, 200);
      assert.equal(writes.length, 1);
    });

    it('the avatar-only update the avatar upload sends is accepted', async () => {
      const res = await call('PUT', '/api/users/me', 'A', { avatar: 'https://cdn.umi.test/a.png' });
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(writes[0].data).sort(), ['avatar', 'updatedAt']);
    });

    it('the identity comes from the token: the write targets the token owner, and a body userId cannot redirect it', async () => {
      const ok = await call('PUT', '/api/users/me', 'B', { fullName: 'Bee Name' });
      assert.equal(ok.status, 200);
      assert.deepEqual(writes[0].where, { userId: STUDENT_B });
      assert.equal(row(STUDENT_A).fullName, 'User a', 'the other user is untouched');
      const redirect = await call('PUT', '/api/users/me', 'B', { fullName: 'Bee Name', userId: STUDENT_A });
      assert.equal(redirect.status, 400);
      assert.equal(writes.length, 1);
    });

    it('without a valid token: 401 and nothing written', async () => {
      assert.equal((await call('PUT', '/api/users/me', undefined, { fullName: 'Okay Name' })).status, 401);
      assert.equal((await call('PUT', '/api/users/me', 'nope', { fullName: 'Okay Name' })).status, 401);
      noWrites('unauthenticated');
    });

    it('defense in depth: UserService.updateUserProfile itself drops role / isActive / email even when a caller passes them', async () => {
      const { UserService } = require('../src/services/user.service');
      await UserService.updateUserProfile(STUDENT_A, { fullName: 'Okay Name', role: 'ADMIN', isActive: false, email: 'x@y.test', userId: STUDENT_B, badges: ['x'] } as any);
      assert.equal(writes.length, 1);
      assert.deepEqual(Object.keys(writes[0].data).sort(), ['fullName', 'updatedAt']);
      assert.equal(row(STUDENT_A).role, 'STUDENT');
    });

    it('the instructor-registration form saves phone / address through the allowlisted writer and (IMPLEMENT-01) never the role', async () => {
      const res = await call('POST', '/api/users/become-instructor', 'A', { bio: 'Bio text here long enough', phoneNumber: '0922222222', address: 'City', expertise: 'Math', role: 'ADMIN', isActive: false });
      assert.equal(res.status, 201);
      assert.equal(res.json.data.status, 'PENDING');
      assert.equal(res.json.data.motivation, 'Bio text here long enough', 'the bio goes into the application');
      const profileWrite = writes.find((w) => 'phoneNumber' in w.data);
      assert.ok(profileWrite);
      assert.deepEqual(Object.keys(profileWrite!.data).sort(), ['address', 'phoneNumber', 'updatedAt']);
      assert.ok(!writes.some((w) => 'role' in w.data || 'isActive' in w.data), 'no role / isActive write');
      assert.equal(row(STUDENT_A).role, 'STUDENT', 'the role changes only when an ADMIN approves the application');
      assert.equal(row(STUDENT_A).isActive, true, 'extra body fields of the registration are ignored');
    });
  });

  // =========================================================================================== S1b: admin write

  describe('PUT /api/users/:userId is still the (admin-only) way to change role / isActive', () => {
    it('ADMIN changes a role and isActive: 200 and exactly those fields are written', async () => {
      const res = await call('PUT', `/api/users/${STUDENT_B}`, 'ADMIN', { role: 'INSTRUCTOR', isActive: false });
      assert.equal(res.status, 200);
      assert.deepEqual(writes[0].where, { userId: STUDENT_B });
      assert.deepEqual(Object.keys(writes[0].data).sort(), ['isActive', 'role', 'updatedAt']);
      assert.equal(row(STUDENT_B).role, 'INSTRUCTOR');
      assert.equal(row(STUDENT_B).isActive, false);
    });

    it('a STUDENT / INSTRUCTOR calling it gets 403 and nothing is written (also for their own id)', async () => {
      for (const token of ['A', 'INSTRUCTOR']) {
        for (const target of [STUDENT_A, STUDENT_B]) {
          const res = await call('PUT', `/api/users/${target}`, token, { role: 'ADMIN' });
          assert.equal(res.status, 403, `${token} -> ${target}`);
        }
      }
      noWrites('non-admin PUT /:userId');
      assert.equal(row(STUDENT_A).role, 'STUDENT');
    });

    it('a token that CLAIMS role ADMIN is not enough: requireRole reads the role from the database', async () => {
      const res = await call('PUT', `/api/users/${STUDENT_B}`, 'CLAIMS_ADMIN', { role: 'ADMIN' });
      assert.equal(res.status, 403);
      noWrites('claimed admin');
      assert.equal(row(STUDENT_B).role, 'STUDENT');
    });

    it('ADMIN cannot smuggle e-mail / userId / badges either, nor an invalid role or non-boolean isActive', async () => {
      for (const body of [{ email: 'x@y.test' }, { userId: STUDENT_A }, { badges: ['x'] }, { role: 'SUPERADMIN' }, { role: ['ADMIN'] }, { isActive: 'false' }, { isActive: 0 }]) {
        const res = await call('PUT', `/api/users/${STUDENT_B}`, 'ADMIN', body);
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      noWrites('admin bad bodies');
    });
  });

  // =========================================================================================== S2: role on first sign-in

  describe('S2 - a profile created on first sign-in is always a STUDENT', () => {
    const firstSignIn = async (token: string, userId: string) => {
      assert.equal(db.some((r) => r.userId === userId), false, 'precondition: no profile yet');
      const res = await call('GET', '/api/users/me', token);
      assert.equal(res.status, 200);
      return res;
    };

    it('e-mail containing "admin": STUDENT', async () => {
      const res = await firstSignIn('NEW_ADMIN_MAIL', NEWCOMER_ADMIN_MAIL);
      assert.equal(res.json.data.role, 'STUDENT');
      assert.equal(creates.length, 1);
      assert.equal(creates[0].role, 'STUDENT');
      assert.equal(row(NEWCOMER_ADMIN_MAIL).role, 'STUDENT');
    });

    it('e-mail containing "admin" inside a longer word ("superadmin.fan@..."): STUDENT', async () => {
      const res = await firstSignIn('NEW_ADMIN_SUBSTR', NEWCOMER_PLAIN);
      assert.equal(res.json.data.role, 'STUDENT');
      assert.equal(creates[0].role, 'STUDENT');
    });

    it('e-mail containing "instructor": STUDENT', async () => {
      const res = await firstSignIn('NEW_INSTRUCTOR_MAIL', NEWCOMER_INSTRUCTOR_MAIL);
      assert.equal(res.json.data.role, 'STUDENT');
      assert.equal(creates[0].role, 'STUDENT');
    });

    it('capitals and both words ("ADMIN.INSTRUCTOR@UMI.TEST"): STUDENT', async () => {
      const res = await firstSignIn('NEW_UPPER', NEWCOMER_UPPER);
      assert.equal(res.json.data.role, 'STUDENT');
      assert.equal(creates[0].role, 'STUDENT');
    });

    it('the created profile is bound to the token identity (userId / e-mail / name), nothing else is taken from the request', async () => {
      await call('GET', '/api/users/me?role=ADMIN&isActive=false', 'NEW_ADMIN_MAIL');
      assert.equal(creates.length, 1);
      assert.deepEqual(Object.keys(creates[0]).sort(), ['email', 'fullName', 'role', 'userId']);
      assert.equal(creates[0].userId, NEWCOMER_ADMIN_MAIL);
    });

    it('an EXISTING profile is never re-roled by reading it: a STUDENT with "admin" in the e-mail stays STUDENT, instructors and admins keep their role', async () => {
      for (const [token, expected] of [['ADMIN_FAN', 'STUDENT'], ['PLAIN_TEACHER', 'INSTRUCTOR'], ['ADMIN', 'ADMIN'], ['A', 'STUDENT']] as const) {
        const res = await call('GET', '/api/users/me', token);
        assert.equal(res.status, 200);
        assert.equal(res.json.data.role, expected, token);
      }
      noWrites('reading existing profiles');
    });

    it('signing in twice does not create a second profile', async () => {
      await call('GET', '/api/users/me', 'NEW_ADMIN_MAIL');
      await call('GET', '/api/users/me', 'NEW_ADMIN_MAIL');
      assert.equal(creates.length, 1);
      assert.equal(db.filter((r) => r.userId === NEWCOMER_ADMIN_MAIL).length, 1);
    });

    it('a brand-new user cannot reach INSTRUCTOR/ADMIN through the profile update that follows the first sign-in either', async () => {
      await call('GET', '/api/users/me', 'NEW_ADMIN_MAIL');
      const res = await call('PUT', '/api/users/me', 'NEW_ADMIN_MAIL', { role: 'ADMIN' });
      assert.equal(res.status, 400);
      assert.equal(row(NEWCOMER_ADMIN_MAIL).role, 'STUDENT');
    });
  });

  // =========================================================================================== S7: GET /api/users/:userId

  describe('S7 - GET /api/users/:userId', () => {
    it('another signed-in user gets ONLY the public subset: no e-mail, phone, address, date of birth, preferences, badges, isActive, profile id', async () => {
      const res = await call('GET', `/api/users/${STUDENT_A}`, 'B');
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.json.data).sort(), PUBLIC_KEYS);
      assert.equal(res.json.data.fullName, 'User a');
      for (const w of res.json.data.work) assert.ok(!('description' in w));
      for (const e of res.json.data.education) assert.ok(!('grade' in e) && !('description' in e));
      assertNoPersonalData(res.text, 'other user');
    });

    it('a token that claims role ADMIN gets only the public subset: the role comes from the database, not from the token', async () => {
      const res = await call('GET', `/api/users/${STUDENT_A}`, 'CLAIMS_ADMIN');
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.json.data).sort(), PUBLIC_KEYS);
      assertNoPersonalData(res.text, 'claimed admin');
    });

    it('the owner gets the full profile (other services read their own role this way)', async () => {
      const res = await call('GET', `/api/users/${STUDENT_A}`, 'A');
      assert.equal(res.status, 200);
      assert.equal(res.json.data.email, SECRET_MAIL_A);
      assert.equal(res.json.data.role, 'STUDENT');
      assert.equal(res.json.data.phoneNumber, SECRET_PHONE);
    });

    it('the owner id in capital hex letters is still the owner', async () => {
      const upper = id('A');
      db.push(mk(upper, { email: 'upper@umi.test' }));
      tokens.UPPER = { userId: upper.toLowerCase(), email: 'upper@umi.test', fullName: 'Up' };
      const res = await call('GET', `/api/users/${upper}`, 'UPPER');
      assert.equal(res.status, 200);
    });

    it('an ADMIN gets the full profile of anyone', async () => {
      const res = await call('GET', `/api/users/${STUDENT_A}`, 'ADMIN');
      assert.equal(res.status, 200);
      assert.equal(res.json.data.email, SECRET_MAIL_A);
      assert.equal(res.json.data.address, SECRET_ADDRESS);
    });

    it('an INSTRUCTOR reading a student gets only the public subset', async () => {
      const res = await call('GET', `/api/users/${STUDENT_A}`, 'INSTRUCTOR');
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.json.data).sort(), PUBLIC_KEYS);
    });

    it('no token: 401. Malformed id: 400. Unknown id: 404 (also for the public branch)', async () => {
      assert.equal((await call('GET', `/api/users/${STUDENT_A}`)).status, 401);
      assert.equal((await call('GET', '/api/users/not-an-id', 'A')).status, 400);
      assert.equal((await call('GET', `/api/users/${id('9')}`, 'A')).status, 404);
      assert.equal((await call('GET', `/api/users/${id('9')}`, 'ADMIN')).status, 404);
    });
  });

  // =========================================================================================== S7: GET /api/users

  describe('S7 - GET /api/users', () => {
    it('a STUDENT gets only the active-instructor directory with public fields (no e-mail, no students, no admins, no inactive)', async () => {
      const res = await call('GET', '/api/users', 'A');
      assert.equal(res.status, 200);
      const users = res.json.users as Row[];
      assert.deepEqual(users.map((u) => u.userId).sort(), [INSTRUCTOR, INSTRUCTOR_PLAIN_MAIL].sort());
      for (const u of users) assert.deepEqual(Object.keys(u).sort(), ['avatar', 'bio', 'createdAt', 'fullName', 'id', 'role', 'userId']);
      assertNoPersonalData(res.text, 'student list');
      assert.equal(res.json.pagination.total, 2);
    });

    it('asking for another role is refused for a non-admin: STUDENT / ADMIN filter -> 403', async () => {
      for (const role of ['STUDENT', 'ADMIN']) {
        const res = await call('GET', `/api/users?role=${role}`, 'A');
        assert.equal(res.status, 403, role);
        assert.ok(!res.text.includes('@umi.test'));
      }
    });

    it('a non-admin cannot search by e-mail (the search matches display names only) nor list inactive users', async () => {
      const byMail = await call('GET', '/api/users?search=teacher.secret', 'A');
      assert.equal(byMail.status, 200);
      assert.equal(byMail.json.users.length, 0);
      const byName = await call('GET', '/api/users?search=teacher%20one', 'A');
      assert.deepEqual(byName.json.users.map((u: Row) => u.userId), [INSTRUCTOR]);
      const gone = await call('GET', '/api/users?role=INSTRUCTOR&search=gone', 'A');
      assert.equal(gone.json.users.length, 0);
    });

    it('a non-admin page size is capped at 20; an admin page size at 100', async () => {
      await call('GET', '/api/users?limit=100000', 'A');
      assert.equal(lastFindMany.take, 20);
      await call('GET', '/api/users?limit=100000', 'ADMIN');
      assert.equal(lastFindMany.take, 100);
    });

    it('the ai-service instructor search (?search=&role=INSTRUCTOR&limit=5 with the user token) keeps working', async () => {
      const res = await call('GET', '/api/users?search=Teacher&role=INSTRUCTOR&limit=5', 'A');
      assert.equal(res.status, 200);
      assert.deepEqual(res.json.users.map((u: Row) => u.fullName), ['Teacher One']);
      assert.ok(res.json.users[0].id && res.json.users[0].fullName);
    });

    it('an ADMIN still gets the full list: all roles, e-mail included, role / isActive / search filters work', async () => {
      const all = await call('GET', '/api/users?limit=50', 'ADMIN');
      assert.equal(all.status, 200);
      assert.equal(all.json.users.length, db.length);
      assert.ok(all.json.users.some((u: Row) => u.email === SECRET_MAIL_A));
      const inst = await call('GET', '/api/users?role=INSTRUCTOR', 'ADMIN');
      assert.equal(inst.json.users.length, 3);
      const inactive = await call('GET', '/api/users?isActive=false', 'ADMIN');
      assert.deepEqual(inactive.json.users.map((u: Row) => u.userId), [INACTIVE_INSTRUCTOR]);
      const byMail = await call('GET', '/api/users?search=boss%40umi', 'ADMIN');
      assert.deepEqual(byMail.json.users.map((u: Row) => u.userId), [ADMIN]);
    });

    it('an ADMIN with an invalid role filter gets 400; an operator object in the query is not interpreted', async () => {
      assert.equal((await call('GET', '/api/users?role=ROOT', 'ADMIN')).status, 400);
      const res = await call('GET', '/api/users?search[$ne]=x&role[$ne]=STUDENT', 'ADMIN');
      assert.equal(res.status, 200);
      assert.equal(res.json.users.length, db.length, 'non-string filters are ignored, not passed to the database');
    });

    it('no token: 401', async () => {
      assert.equal((await call('GET', '/api/users')).status, 401);
    });
  });

  // =========================================================================================== S7: POST /api/users/batch

  describe('S7 - POST /api/users/batch (called without credentials by course / learning / review code)', () => {
    it('answers with userId, fullName and avatar ONLY - no e-mail, role, phone, address, anything else', async () => {
      const res = await call('POST', '/api/users/batch', undefined, { ids: [STUDENT_A, INSTRUCTOR, ADMIN] });
      assert.equal(res.status, 200);
      assert.equal(res.json.data.length, 3);
      for (const u of res.json.data) assert.deepEqual(Object.keys(u).sort(), ['avatar', 'fullName', 'userId']);
      assertNoPersonalData(res.text, 'batch');
      assert.ok(!res.text.includes('boss@'));
    });

    it('the callers\' needs are met: names and avatars are there for the review, student-list, leaderboard and certificate code', async () => {
      const res = await call('POST', '/api/users/batch', undefined, { ids: [INSTRUCTOR] });
      assert.deepEqual(res.json.data, [{ userId: INSTRUCTOR, fullName: 'Teacher One', avatar: null }]);
    });

    it('duplicate ids are collapsed; an unknown id is simply absent; an empty list is an empty answer', async () => {
      const res = await call('POST', '/api/users/batch', undefined, { ids: [STUDENT_A, STUDENT_A, id('9')] });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json.data.map((u: Row) => u.userId), [STUDENT_A]);
      const empty = await call('POST', '/api/users/batch', undefined, { ids: [] });
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.json.data, []);
    });

    it('invalid input is refused with 400: not an array, non-string / malformed ids, operator objects, more than 1000 ids, no body', async () => {
      const bad: unknown[] = [
        { ids: 'x' }, { ids: { $ne: null } }, { ids: [STUDENT_A, 'not-an-id'] }, { ids: [STUDENT_A, 123] }, { ids: [{ $gt: '' }] },
        { ids: Array.from({ length: 1001 }, () => STUDENT_A) }, {}, { notIds: [STUDENT_A] },
      ];
      for (const body of bad) {
        const res = await call('POST', '/api/users/batch', undefined, body);
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      }
      assert.equal((await call('POST', '/api/users/batch')).status, 400);
    });

    it('exactly 1000 ids is still allowed', async () => {
      const res = await call('POST', '/api/users/batch', undefined, { ids: Array.from({ length: 1000 }, () => STUDENT_A) });
      assert.equal(res.status, 200);
    });
  });

  // =========================================================================================== unchanged paths

  describe('paths that must keep working', () => {
    it('GET /api/users/public/:userId is still public and unchanged', async () => {
      const res = await call('GET', `/api/users/public/${STUDENT_A}`);
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.json.data).sort(), PUBLIC_KEYS);
    });

    it('POST /api/users/internal/eligibility still needs the internal token and returns only userId / role / isActive', async () => {
      const refused = await call('POST', '/api/users/internal/eligibility', undefined, { ids: [STUDENT_A] });
      assert.equal(refused.status, 403);
      const res = await fetch(`${base}/api/users/internal/eligibility`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-service-token': process.env.INTERNAL_SERVICE_TOKEN as string },
        body: JSON.stringify({ ids: [STUDENT_A] }),
      });
      assert.equal(res.status, 200);
      const json: any = await res.json();
      assert.deepEqual(Object.keys(json.data[0]).sort(), ['isActive', 'role', 'userId']);
    });

    it('GET /api/users/me returns the caller\'s own full profile', async () => {
      const me = await call('GET', '/api/users/me', 'A');
      assert.equal(me.json.data.email, SECRET_MAIL_A);
    });

    it('unauthenticated become-instructor is refused and changes nothing', async () => {
      const res = await call('POST', '/api/users/become-instructor', undefined, { bio: 'x'.repeat(30) });
      assert.equal(res.status, 401);
      noWrites('unauthenticated become-instructor');
    });
  });
});
