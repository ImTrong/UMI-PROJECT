/**
 * FIX-INS-11: the Learning Path administration API is ADMIN only.
 *
 *   ADMIN only (requireRole(['ADMIN']) - role read from the user-service, never from the request):
 *     GET    /api/learning/admin/paths              GET /api/learning/admin/paths/:id
 *     POST   /api/learning/admin/paths              PUT /api/learning/admin/paths/:id
 *     PUT    /api/learning/admin/paths/:id/status   DELETE /api/learning/admin/paths/:id
 *     POST   /api/learning/admin/paths/:id/duplicate
 *   Allowlisted, type-checked fields; status in DRAFT / PUBLISHED / ARCHIVED; courseIds = distinct ObjectIds (<= 100), every newly
 *   added course must exist in the course-service (internal route, COURSE_LEARNING_TOKEN). createdBy / enrollmentCount /
 *   totalDurationMinutes / id are never taken from the body. A refused request writes nothing.
 *   Learners keep /api/learning/paths* (signed-in users) and the final-project read / submit routes.
 *
 * The REAL express app runs on an ephemeral port with the in-memory Prisma fake; auth-, user- and course-services are one loopback
 * stub.
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
import { installFakePrisma, FakePrismaClient } from './helpers/fake-prisma';

// ---------------------------------------------------------------- models on the shared fake
type Row = Record<string, any>;
const tables: Record<string, Row[]> = { learningPath: [], userPathEnrollment: [], finalProject: [] };
const writes: Array<{ table: string; op: string; data?: any; where?: any }> = [];
const match = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => {
  if (k === 'NOT') return !match(row, v as Row);
  if (v && typeof v === 'object' && !Array.isArray(v)) return false;   // compound / operator filters: no match in this fake
  return row[k] === v;
});
let seq = 0;
const model = (table: string) => ({
  findUnique: async ({ where }: any) => { const r = tables[table].find((x) => match(x, where)); return r ? { ...r } : null; },
  findMany: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).map((r) => ({ ...r })),
  count: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).length,
  create: async ({ data }: any) => {
    writes.push({ table, op: 'create', data: { ...data } });
    const row = { id: (++seq).toString(16).padStart(24, '0'), createdAt: new Date(), ...data };
    tables[table].push(row);
    return { ...row };
  },
  update: async ({ where, data }: any) => {
    const r = tables[table].find((x) => match(x, where));
    if (!r) throw new Error('Record to update not found');
    writes.push({ table, op: 'update', data: { ...data }, where });
    for (const [k, v] of Object.entries(data)) if (v !== undefined) r[k] = v;
    return { ...r };
  },
  delete: async ({ where }: any) => {
    writes.push({ table, op: 'delete', where });
    tables[table] = tables[table].filter((x) => !match(x, where));
    return {};
  },
});
Object.assign((FakePrismaClient as any).prototype, {
  learningPath: model('learningPath'), userPathEnrollment: model('userPathEnrollment'), finalProject: model('finalProject'),
});
installFakePrisma();

// ---------------------------------------------------------------- identities and data
const id = (c: string) => c.repeat(12);
const USERS: Record<string, { userId: string; role: string }> = {
  STUDENT: { userId: id('a1'), role: 'STUDENT' },
  INSTRUCTOR: { userId: id('b1'), role: 'INSTRUCTOR' },
  ADMIN: { userId: id('c1'), role: 'ADMIN' },
};
const C1 = id('d1');
const C2 = id('d2');
const C3 = id('d3');
const UNKNOWN_COURSE = id('d9');
const KNOWN_COURSES = [C1, C2, C3];
const P1 = id('71');   // published path, no learners
const P2 = id('72');   // path with an enrolled learner
const MISSING = id('99');
const COURSE_LEARNING_TOKEN = randomBytes(32).toString('hex');

describe('FIX-INS-11: Learning Path administration is ADMIN only', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let tmp = '';
  let removedCourse = '';
  const courseCalls: string[] = [];

  before(async () => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const url = req.url || '';
        if (url === '/api/auth/verify-token') {
          const token = (() => { try { return JSON.parse(raw).token; } catch { return ''; } })();
          const u = USERS[token];
          return res.end(JSON.stringify(u ? { valid: true, user: { userId: u.userId, email: `${token}@umi.test` } } : { valid: false }));
        }
        const user = url.match(/^\/api\/users\/([0-9a-f]{24})$/);
        if (user) return res.end(JSON.stringify({ data: { role: Object.values(USERS).find((u) => u.userId === user[1])?.role || 'STUDENT' } }));
        const lessons = url.match(/^\/api\/courses\/internal\/([0-9a-f]{24})\/lessons$/);
        if (lessons) {
          courseCalls.push(lessons[1]);
          if (req.headers['x-internal-service-token'] !== COURSE_LEARNING_TOKEN) { res.statusCode = 403; return res.end('{}'); }
          if (!KNOWN_COURSES.includes(lessons[1]) || lessons[1] === removedCourse) { res.statusCode = 404; return res.end('{}'); }
          return res.end(JSON.stringify({ data: [] }));
        }
        const course = url.match(/^\/api\/courses\/([0-9a-f]{24})$/);
        if (course && KNOWN_COURSES.includes(course[1])) return res.end(JSON.stringify({ data: { id: course[1], title: `Course ${course[1].slice(0, 2)}`, published: true, price: 0, totalLessons: 4 } }));
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins11-'));
    for (const v of ['ZIP_UPLOAD_DIR', 'ZIP_EXTRACT_DIR', 'VIDEO_UPLOAD_DIR', 'HLS_TEMP_DIR']) process.env[v] = path.join(tmp, v.toLowerCase());
    Object.assign(process.env, {
      AUTH_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, COURSE_LEARNING_TOKEN,
      RATE_LIMIT_MAX_REQUESTS: '100000', BLOCKCHAIN_ENABLED: 'false', INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'),
    });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const lp = (pid: string, over: Row = {}): Row => ({
    id: pid, title: `Path ${pid.slice(0, 2)}`, description: 'desc', slug: `path-${pid.slice(0, 2)}`, category: 'IT', difficulty: 'ALL',
    imageUrl: null, shortDescription: null, bannerUrl: null, careerGoal: null, skills: ['js'], prerequisiteRules: [], completionRule: 'ALL_COURSES',
    recommended: false, status: 'PUBLISHED', totalDurationMinutes: 120, enrollmentCount: 0, createdBy: USERS.ADMIN.userId, courseIds: [C1],
    certificateConfig: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...over,
  });
  const snapshot = () => JSON.stringify(tables);
  beforeEach(() => {
    writes.length = 0;
    courseCalls.length = 0;
    removedCourse = '';
    process.env.COURSE_LEARNING_TOKEN = COURSE_LEARNING_TOKEN;
    tables.learningPath = [lp(P1), lp(P2, { courseIds: [C1, C2], enrollmentCount: 1 })];
    tables.userPathEnrollment = [{ id: id('81'), userId: USERS.STUDENT.userId, learningPathId: P2 }];
    tables.finalProject = [{ id: id('91'), learningPathId: P2, createdBy: USERS.ADMIN.userId, title: 'Capstone' }];
  });

  const call = async (method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const ADMIN_ROUTES: Array<[string, string, unknown?]> = [
    ['GET', '/api/learning/admin/paths'],
    ['GET', `/api/learning/admin/paths/${P1}`],
    ['POST', '/api/learning/admin/paths', { title: 'Hijack', description: 'x', courseIds: [C2], status: 'PUBLISHED' }],
    ['PUT', `/api/learning/admin/paths/${P1}`, { title: 'Hijacked', courseIds: [C3], status: 'ARCHIVED', recommended: true }],
    ['PUT', `/api/learning/admin/paths/${P1}/status`, { status: 'ARCHIVED' }],
    ['DELETE', `/api/learning/admin/paths/${P1}`],
    ['POST', `/api/learning/admin/paths/${P1}/duplicate`],
  ];

  it('1. not signed in: 401 on every admin route, nothing read back, nothing written', async () => {
    const before = snapshot();
    for (const [m, u, b] of ADMIN_ROUTES) {
      const r = await call(m, u, undefined, b);
      assert.equal(r.status, 401, `${m} ${u}`);
      assert.ok(!r.text.includes('Path 71'));
    }
    assert.equal(snapshot(), before);
    assert.deepEqual(writes, []);
  });

  it('2. a STUDENT with a valid JWT cannot create a learning path', async () => {
    const r = await call('POST', '/api/learning/admin/paths', 'STUDENT', { title: 'Mine', description: 'x' });
    assert.equal(r.status, 403);
    assert.equal(tables.learningPath.length, 2);
    assert.deepEqual(writes, []);
  });

  it('3. an INSTRUCTOR with a valid JWT cannot update a learning path', async () => {
    const r = await call('PUT', `/api/learning/admin/paths/${P1}`, 'INSTRUCTOR', { title: 'Taken over', courseIds: [C1, C3] });
    assert.equal(r.status, 403);
    assert.equal(tables.learningPath[0].title, 'Path 71');
    assert.deepEqual(tables.learningPath[0].courseIds, [C1]);
    assert.deepEqual(writes, []);
  });

  it('4. a non-ADMIN cannot delete a learning path (nor have it archived)', async () => {
    for (const t of ['STUDENT', 'INSTRUCTOR']) {
      for (const pid of [P1, P2]) assert.equal((await call('DELETE', `/api/learning/admin/paths/${pid}`, t)).status, 403, `${t} ${pid}`);
    }
    assert.deepEqual(tables.learningPath.map((p) => [p.id, p.status]), [[P1, 'PUBLISHED'], [P2, 'PUBLISHED']]);
    assert.deepEqual(writes, []);
  });

  it('5/7/10. every admin route (read, write, status, courseIds, duplicate) refuses STUDENT and INSTRUCTOR; the DB is untouched', async () => {
    const before = snapshot();
    for (const t of ['STUDENT', 'INSTRUCTOR']) {
      for (const [m, u, b] of ADMIN_ROUTES) {
        const r = await call(m, u, t, b);
        assert.equal(r.status, 403, `${t} ${m} ${u}`);
        assert.ok(!r.text.includes('Path 71') && !r.text.includes('Path 72'), `${t} ${m} ${u}: no path data`);
      }
    }
    assert.equal(snapshot(), before);
    assert.deepEqual(writes, []);
  });

  it('6. a forged role / userId / isAdmin in body, query or headers grants nothing; other spellings of the route hit the same check', async () => {
    const forged = { role: 'ADMIN', isAdmin: true, userId: USERS.ADMIN.userId, user: { role: 'ADMIN' } };
    const headers = { 'x-user-role': 'ADMIN', 'x-user-id': USERS.ADMIN.userId, 'x-internal-service': 'true', 'x-internal-service-token': COURSE_LEARNING_TOKEN };
    const q = `?role=ADMIN&isAdmin=true&userId=${USERS.ADMIN.userId}`;
    for (const t of ['STUDENT', 'INSTRUCTOR']) {
      assert.equal((await call('POST', `/api/learning/admin/paths${q}`, t, { title: 'F', description: 'x', ...forged }, headers)).status, 403);
      assert.equal((await call('PUT', `/api/learning/admin/paths/${P1}${q}`, t, { title: 'F', ...forged }, headers)).status, 403);
      assert.equal((await call('PUT', `/api/learning/admin/paths/${P1}/status${q}`, t, { status: 'DRAFT', ...forged }, headers)).status, 403);
      assert.equal((await call('GET', `/api/learning/admin/paths${q}`, t, undefined, headers)).status, 403);
      for (const u of ['/API/learning/ADMIN/paths', '/api/learning/admin/paths/', `/api/learning/admin/PATHS/${P1}/Status`]) {
        assert.equal((await call(u.endsWith('Status') ? 'PUT' : 'GET', u, t, u.endsWith('Status') ? { status: 'DRAFT' } : undefined)).status, 403, u);
      }
    }
    // no token at all but every header an internal caller might use
    assert.equal((await call('POST', '/api/learning/admin/paths', undefined, { title: 'F', description: 'x' }, headers)).status, 401);
    assert.deepEqual(writes, []);
  });

  // =============================================================================================== ADMIN keeps the business
  it('8a. ADMIN lists and reads paths (unchanged contract)', async () => {
    const list = await call('GET', '/api/learning/admin/paths', 'ADMIN');
    assert.equal(list.status, 200);
    assert.equal(list.json.paths.length, 2);
    assert.equal(list.json.pagination.total, 2);
    const one = await call('GET', `/api/learning/admin/paths/${P1}`, 'ADMIN');
    assert.equal(one.json.data.id, P1);
    assert.equal((await call('GET', `/api/learning/admin/paths/${MISSING}`, 'ADMIN')).status, 404);
  });

  it('8b. ADMIN creates: createdBy = caller, server-owned fields ignored, courses verified with the internal token', async () => {
    const r = await call('POST', '/api/learning/admin/paths', 'ADMIN', {
      title: 'Fullstack', description: 'From zero', courseIds: [C1, C2], status: 'DRAFT', skills: ['js'], recommended: true,
      createdBy: USERS.INSTRUCTOR.userId, enrollmentCount: 999, totalDurationMinutes: 5, id: MISSING, userEnrollments: [], createdAt: '2000-01-01',
    });
    assert.equal(r.status, 201, r.text);
    const stored = writes[0].data;
    assert.equal(stored.createdBy, USERS.ADMIN.userId);
    assert.equal(stored.slug, 'fullstack');
    assert.deepEqual(stored.courseIds, [C1, C2]);
    for (const k of ['enrollmentCount', 'totalDurationMinutes', 'id', 'userEnrollments', 'createdAt']) assert.ok(!(k in stored), `${k} must not be stored`);
    assert.deepEqual(courseCalls.sort(), [C1, C2].sort());
  });

  it('8c. ADMIN updates, changes status, duplicates and deletes (archive when learners are enrolled)', async () => {
    const up = await call('PUT', `/api/learning/admin/paths/${P1}`, 'ADMIN', { title: 'Renamed', courseIds: [C1, C3], enrollmentCount: 50, createdBy: USERS.STUDENT.userId });
    assert.equal(up.status, 200, up.text);
    const p1 = tables.learningPath.find((p) => p.id === P1)!;
    assert.equal(p1.title, 'Renamed');
    assert.deepEqual(p1.courseIds, [C1, C3]);
    assert.equal(p1.enrollmentCount, 0);
    assert.equal(p1.createdBy, USERS.ADMIN.userId);
    assert.deepEqual(courseCalls, [C3], 'only the newly added course is looked up');
    assert.equal((await call('PUT', `/api/learning/admin/paths/${P1}/status`, 'ADMIN', { status: 'DRAFT' })).status, 200);
    assert.equal(tables.learningPath.find((p) => p.id === P1)!.status, 'DRAFT');
    const dup = await call('POST', `/api/learning/admin/paths/${P1}/duplicate`, 'ADMIN');
    assert.equal(dup.status, 201);
    assert.equal(dup.json.data.status, 'DRAFT');
    const archived = await call('DELETE', `/api/learning/admin/paths/${P2}`, 'ADMIN');
    assert.equal(archived.json.status, 'ARCHIVED');
    assert.equal(tables.learningPath.find((p) => p.id === P2)!.status, 'ARCHIVED');
    const deleted = await call('DELETE', `/api/learning/admin/paths/${P1}`, 'ADMIN');
    assert.equal(deleted.json.status, 'DELETED');
    assert.ok(!tables.learningPath.some((p) => p.id === P1));
  });

  it('8d. ADMIN input is still validated: status enum, courseIds shape / existence, required fields, field types - nothing written', async () => {
    const bad: Array<[string, string, unknown, string]> = [
      ['POST', '/api/learning/admin/paths', { description: 'no title' }, 'title'],
      ['POST', '/api/learning/admin/paths', { title: 'T', description: 'x', status: 'HACKED' }, 'status'],
      ['POST', '/api/learning/admin/paths', { title: 'T', description: 'x', courseIds: ['not-an-id'] }, 'courseIds'],
      ['POST', '/api/learning/admin/paths', { title: 'T', description: 'x', courseIds: [C1, C1] }, 'courseIds'],
      ['POST', '/api/learning/admin/paths', { title: 'T', description: 'x', courseIds: { $ne: null } }, 'courseIds'],
      ['POST', '/api/learning/admin/paths', { title: 'T', description: 'x', courseIds: [C1, UNKNOWN_COURSE] }, 'courseIds'],
      ['PUT', `/api/learning/admin/paths/${P1}`, { courseIds: [UNKNOWN_COURSE] }, 'courseIds'],
      ['PUT', `/api/learning/admin/paths/${P1}`, { status: 'DELETED' }, 'status'],
      ['PUT', `/api/learning/admin/paths/${P1}`, { title: { $set: 'x' } }, 'title'],
      ['PUT', `/api/learning/admin/paths/${P1}`, { recommended: 'yes' }, 'recommended'],
      ['PUT', `/api/learning/admin/paths/${P1}/status`, { status: 'HACKED' }, 'status'],
    ];
    for (const [m, u, b, field] of bad) {
      const r = await call(m, u, 'ADMIN', b);
      assert.equal(r.status, 400, `${m} ${u} ${JSON.stringify(b)}`);
      assert.ok(r.json.fields.includes(field), `${JSON.stringify(b)} -> ${field}`);
    }
    assert.equal((await call('PUT', `/api/learning/admin/paths/${MISSING}/status`, 'ADMIN', { status: 'DRAFT' })).status, 404);
    assert.deepEqual(writes, []);
  });

  it('8e. a course already on the path that the course-service no longer knows does not block saving; course-service down -> 503', async () => {
    removedCourse = C2;
    assert.equal((await call('PUT', `/api/learning/admin/paths/${P2}`, 'ADMIN', { title: 'Still saves', courseIds: [C2, C1] })).status, 200);
    delete process.env.COURSE_LEARNING_TOKEN;
    writes.length = 0;
    assert.equal((await call('PUT', `/api/learning/admin/paths/${P1}`, 'ADMIN', { courseIds: [C1, C3] })).status, 503);
    assert.deepEqual(writes, []);
  });

  it('11. the admin form payload (loaded path spread, server fields deleted) still saves; the create form payload too', async () => {
    const loaded = (await call('GET', `/api/learning/admin/paths/${P1}`, 'ADMIN')).json.data;
    const payload: Row = { ...loaded, prerequisiteRules: loaded.prerequisiteRules || [] };
    for (const k of ['id', 'createdAt', 'updatedAt', 'createdBy', 'enrollmentCount', 'totalDurationMinutes']) delete payload[k];
    payload.courseIds = [...payload.courseIds, C2];
    assert.equal((await call('PUT', `/api/learning/admin/paths/${P1}`, 'ADMIN', payload)).status, 200);
    const createForm = {
      title: 'Data path', slug: '', description: 'd', shortDescription: '', category: '', difficulty: 'ALL', imageUrl: '', bannerUrl: '',
      careerGoal: '', skills: [], courseIds: [C3], prerequisiteRules: [], completionRule: 'ALL_COURSES', recommended: false, status: 'DRAFT',
      certificateConfig: { title: '', subtitle: '', description: '', signerName: '', signerTitle: '', organizationName: '', skills: [] },
    };
    const created = await call('POST', '/api/learning/admin/paths', 'ADMIN', createForm);
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.data.slug, 'data-path');
  });

  // =============================================================================================== learners / final project
  it('9. learners still read a learning path through the learner route', async () => {
    const r = await call('GET', `/api/learning/paths/${P1}`, 'STUDENT');
    assert.equal(r.status, 200, r.text);
    assert.ok(r.text.includes(C1));
  });

  it('12. final-project flows on a learning path keep working: ADMIN creates it, a learner reads it', async () => {
    const created = await call('POST', `/api/learning/final-project/${P1}`, 'ADMIN', { title: 'Capstone P1', description: 'build it' });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.data.learningPathId, P1);
    const read = await call('GET', `/api/learning/final-project/${P2}`, 'STUDENT');
    assert.equal(read.status, 200);
    assert.equal(read.json.data.title, 'Capstone');
    assert.equal((await call('POST', `/api/learning/final-project/${P1}`, 'INSTRUCTOR', { title: 'x' })).status, 403);
  });

  it('10b. route table: exactly the 7 admin path routes reach AdminPathController, each guarded by authenticateToken + requireRole', () => {
    const app = require('../src/app').default;
    const { AdminPathController } = require('../src/controllers/admin-path.controller');
    const { authenticateToken } = require('../src/middleware/auth.middleware');
    const handlers = Object.getOwnPropertyNames(AdminPathController).map((k) => (AdminPathController as any)[k]).filter((f) => typeof f === 'function');
    const reaching = (app._router.stack as any[]).filter((l) => l.route && l.route.stack.some((s: any) => handlers.includes(s.handle)));
    assert.equal(reaching.length, 7);
    for (const l of reaching) {
      assert.match(l.route.path, /^\/api\/learning\/admin\/paths/);
      assert.equal(l.route.stack.length, 3, l.route.path);
      assert.equal(l.route.stack[0].handle, authenticateToken, l.route.path);
      assert.ok(String(l.route.stack[1].handle).includes('roles.includes'), `${l.route.path}: requireRole before the controller`);
    }
  });
});
