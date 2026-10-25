/**
 * FIX-INS-12: what a learner may see / join on a learning path, by its stored status.
 *
 *   PUBLISHED   listed, readable, enrollable by every signed-in user.
 *   ARCHIVED    not listed, no NEW enrollment; a learner enrolled before (UserPathEnrollment of the authenticated user) keeps the
 *               detail, "my paths", the final project and its unlock status / submission.
 *   DRAFT       invisible to learners - detail, enroll, final project, unlock status, my paths - even to someone enrolled earlier.
 *   A hidden path answers exactly like a missing one (404). ADMIN reads every status through /api/learning/admin/paths*.
 *   status / userId / role from the request count for nothing; a refused request writes nothing.
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
const tables: Record<string, Row[]> = { learningPath: [], userPathEnrollment: [], finalProject: [], finalProjectSubmission: [], certificate: [] };
const writes: Array<{ table: string; op: string; data?: any }> = [];
const cond = (actual: any, v: any): boolean => {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
    if ('in' in v) return v.in.includes(actual);
    if ('not' in v) return actual !== v.not;
    if ('gte' in v) return actual >= v.gte;
    return false;
  }
  return actual === v;
};
const match = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
  if (k === 'userId_learningPathId') return row.userId === v.userId && row.learningPathId === v.learningPathId;
  if (k === 'NOT') return !match(row, v);
  return cond(row[k], v);
});
const withInclude = (row: Row, include: any) => (include?.learningPath ? { ...row, learningPath: tables.learningPath.find((p) => p.id === row.learningPathId) ?? null } : { ...row });
let seq = 0;
const model = (table: string) => ({
  findUnique: async ({ where, include }: any) => { const r = tables[table].find((x) => match(x, where)); return r ? withInclude(r, include) : null; },
  findFirst: async ({ where }: any = {}) => { const r = tables[table].find((x) => match(x, where)); return r ? { ...r } : null; },
  findMany: async ({ where, include }: any = {}) => tables[table].filter((x) => match(x, where)).map((r) => withInclude(r, include)),
  count: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).length,
  create: async ({ data }: any) => {
    writes.push({ table, op: 'create', data: { ...data } });
    const row = { id: (++seq).toString(16).padStart(24, '0'), createdAt: new Date(), ...(table === 'userPathEnrollment' ? { enrolledAt: new Date() } : {}), ...data };
    tables[table].push(row);
    return { ...row };
  },
  update: async ({ where, data }: any) => {
    const r = tables[table].find((x) => match(x, where));
    if (!r) throw new Error('Record to update not found');
    writes.push({ table, op: 'update', data: { ...data } });
    Object.assign(r, data);
    return { ...r };
  },
  delete: async ({ where }: any) => {
    writes.push({ table, op: 'delete' });
    tables[table] = tables[table].filter((x) => !match(x, where));
    return {};
  },
});
Object.assign((FakePrismaClient as any).prototype, {
  learningPath: model('learningPath'), userPathEnrollment: model('userPathEnrollment'), finalProject: model('finalProject'),
  finalProjectSubmission: model('finalProjectSubmission'), certificate: model('certificate'),
});
installFakePrisma();

// ---------------------------------------------------------------- identities and data
const id = (c: string) => c.repeat(12);
const USERS: Record<string, { userId: string; role: string }> = {
  NEW: { userId: id('a1'), role: 'STUDENT' },       // enrolled nowhere
  OLD: { userId: id('a2'), role: 'STUDENT' },       // enrolled in ARCH (and in DRAFT, from before it went back to draft)
  INSTRUCTOR: { userId: id('b1'), role: 'INSTRUCTOR' },
  ADMIN: { userId: id('c1'), role: 'ADMIN' },
};
const C1 = id('d1');
const PUB = id('71');
const ARCH = id('72');
const DRAFT = id('73');
const MISSING = id('79');
const FP_PUB = id('81');
const FP_ARCH = id('82');
const FP_DRAFT = id('83');
const COURSE_LEARNING_TOKEN = randomBytes(32).toString('hex');

describe('FIX-INS-12: learner access to a learning path by status', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let tmp = '';

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
        if (url === `/api/courses/${C1}`) return res.end(JSON.stringify({ data: { id: C1, title: 'Course 1', published: true, price: 0, totalLessons: 3 } }));
        if (url.startsWith('/api/users/internal/notifications')) return res.end('{}');
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins12-'));
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

  const lp = (pid: string, status: string): Row => ({
    id: pid, title: `Path ${status}`, description: `about ${status}`, slug: `path-${status.toLowerCase()}`, category: `Cat-${status}`, difficulty: 'ALL',
    skills: [], prerequisiteRules: [], completionRule: 'ALL_COURSES', recommended: false, status, totalDurationMinutes: 0, enrollmentCount: 0,
    createdBy: USERS.ADMIN.userId, courseIds: [C1], certificateConfig: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  });
  const enr = (u: string, pid: string) => ({ id: id(`e${pid[1]}`).slice(0, 22) + u.slice(-2), userId: USERS[u].userId, learningPathId: pid, status: 'IN_PROGRESS', enrolledAt: new Date('2026-02-01'), completedAt: null });
  const fp = (fid: string, pid: string) => ({ id: fid, learningPathId: pid, title: `Project of ${pid.slice(0, 2)}`, description: 'secret brief', objectives: [], maxScore: 100, passingScore: 80, maxAttempts: 3, deadline: null, createdBy: USERS.ADMIN.userId });
  const snapshot = () => JSON.stringify(tables);
  beforeEach(() => {
    writes.length = 0;
    tables.learningPath = [lp(PUB, 'PUBLISHED'), lp(ARCH, 'ARCHIVED'), lp(DRAFT, 'DRAFT')];
    tables.userPathEnrollment = [enr('OLD', ARCH), enr('OLD', DRAFT)];
    tables.finalProject = [fp(FP_PUB, PUB), fp(FP_ARCH, ARCH), fp(FP_DRAFT, DRAFT)];
    tables.finalProjectSubmission = [];
    tables.certificate = [{ id: id('91'), userId: USERS.OLD.userId, courseId: C1, type: 'COURSE_COMPLETION' }];
  });

  const call = async (method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const detail = (pid: string, t: string, q = '') => call('GET', `/api/learning/paths/${pid}${q}`, t);
  const enroll = (pid: string, t: string, body?: unknown, q = '') => call('POST', `/api/learning/paths/${pid}/enroll${q}`, t, body);
  const myPaths = async (t: string) => (await call('GET', '/api/learning/paths/my-paths', t)).json.data.map((p: any) => p.pathId ?? p.id ?? p.learningPathId);
  const hiddenLikeMissing = async (r: { status: number; json: any; text: string }, label: string) => {
    const missing = await detail(MISSING, 'NEW');
    assert.equal(r.status, 404, label);
    assert.deepEqual(r.json, missing.json, `${label}: same answer as a missing path`);
    assert.ok(!r.text.includes('about DRAFT') && !r.text.includes('about ARCHIVED') && !r.text.includes('secret brief'), `${label}: nothing leaks`);
  };

  // =============================================================================================== DRAFT
  it('1. a learner cannot read a DRAFT path by id - not even one enrolled before it went back to draft', async () => {
    for (const t of ['NEW', 'OLD', 'INSTRUCTOR']) await hiddenLikeMissing(await detail(DRAFT, t), `${t} draft`);
    assert.deepEqual(writes, []);
  });

  it('2. DRAFT (and ARCHIVED) are not in the learner list / categories; PUBLISHED is', async () => {
    const list = await call('GET', '/api/learning/paths', 'NEW');
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.data.map((p: any) => p.id), [PUB]);
    const cats = await call('GET', '/api/learning/paths/categories', 'NEW');
    assert.deepEqual(cats.json.data, ['Cat-PUBLISHED']);
  });

  it('3. a learner cannot enroll in a DRAFT path; nothing is written', async () => {
    for (const t of ['NEW', 'INSTRUCTOR', 'OLD']) await hiddenLikeMissing(await enroll(DRAFT, t), `${t} enroll draft`);
    assert.equal(tables.userPathEnrollment.length, 2);
    assert.deepEqual(writes, []);
  });

  // =============================================================================================== PUBLISHED
  it('4. PUBLISHED: readable and enrollable; the enrollment belongs to the caller (body userId ignored), re-enrolling is idempotent', async () => {
    const d = await detail(PUB, 'NEW');
    assert.equal(d.status, 200, d.text);
    assert.equal(d.json.data.path.id, PUB);
    const e = await enroll(PUB, 'NEW', { userId: USERS.OLD.userId, status: 'COMPLETED' });
    assert.equal(e.status, 201, e.text);
    assert.equal(e.json.data.userId, USERS.NEW.userId);
    assert.equal(e.json.data.status, 'IN_PROGRESS');
    assert.equal(tables.userPathEnrollment.filter((x) => x.learningPathId === PUB).length, 1);
    writes.length = 0;
    assert.equal((await enroll(PUB, 'NEW')).status, 201);
    assert.deepEqual(writes, [], 'existing enrollment returned, nothing new');
    assert.ok((await myPaths('NEW')).includes(PUB));
  });

  // =============================================================================================== ARCHIVED
  it('5. a learner who never joined cannot enroll in an ARCHIVED path (nor read it); nothing is written', async () => {
    await hiddenLikeMissing(await enroll(ARCH, 'NEW'), 'enroll archived');
    await hiddenLikeMissing(await detail(ARCH, 'NEW'), 'detail archived');
    assert.equal(tables.userPathEnrollment.length, 2);
    assert.deepEqual(writes, []);
  });

  it('6. a learner enrolled before ARCHIVED keeps: detail, enrollment (idempotent), my paths, final project, unlock status, submission', async () => {
    const d = await detail(ARCH, 'OLD');
    assert.equal(d.status, 200, d.text);
    assert.equal(d.json.data.enrollment.userId, USERS.OLD.userId);
    const again = await enroll(ARCH, 'OLD');
    assert.equal(again.status, 201);
    assert.equal(again.json.data.learningPathId, ARCH);
    assert.equal(tables.userPathEnrollment.length, 2, 'no duplicate');
    assert.deepEqual(await myPaths('OLD'), [ARCH], 'my paths: ARCHIVED kept, DRAFT hidden');
    const project = await call('GET', `/api/learning/final-project/${ARCH}`, 'OLD');
    assert.equal(project.status, 200);
    assert.equal(project.json.data.id, FP_ARCH);
    const unlock = await call('GET', `/api/learning/final-project/${ARCH}/unlock-status`, 'OLD');
    assert.equal(unlock.status, 200, unlock.text);
    assert.equal(unlock.json.data.unlocked, true);
    const sub = await call('POST', `/api/learning/final-project/${FP_ARCH}/submit`, 'OLD', { content: 'my work' });
    assert.equal(sub.status, 201, sub.text);
    assert.equal(tables.finalProjectSubmission.length, 1);
  });

  it('7/9. a forged userId / status / role in query or body opens nothing', async () => {
    const q = `?userId=${USERS.OLD.userId}&status=PUBLISHED&role=ADMIN`;
    await hiddenLikeMissing(await detail(ARCH, 'NEW', q), 'archived, forged query');
    await hiddenLikeMissing(await detail(DRAFT, 'NEW', q), 'draft, forged query');
    await hiddenLikeMissing(await enroll(ARCH, 'NEW', { userId: USERS.OLD.userId, status: 'PUBLISHED', role: 'ADMIN' }, q), 'enroll archived forged');
    await hiddenLikeMissing(await enroll(DRAFT, 'NEW', { status: 'PUBLISHED' }, q), 'enroll draft forged');
    assert.equal((await call('GET', `/api/learning/final-project/${ARCH}${q}`, 'NEW')).status, 404);
    assert.equal((await call('GET', `/api/learning/final-project/${DRAFT}/unlock-status${q}`, 'NEW')).status, 404);
    assert.deepEqual(writes, []);
    assert.equal(tables.learningPath.find((p) => p.id === DRAFT)!.status, 'DRAFT');
  });

  it('8. ADMIN still reads and manages DRAFT / ARCHIVED through the admin API (and reads their final project for the editor)', async () => {
    for (const pid of [DRAFT, ARCH]) {
      const r = await call('GET', `/api/learning/admin/paths/${pid}`, 'ADMIN');
      assert.equal(r.status, 200);
      assert.equal(r.json.data.id, pid);
      assert.equal((await call('GET', `/api/learning/final-project/${pid}`, 'ADMIN')).status, 200);
    }
    assert.equal((await call('PUT', `/api/learning/admin/paths/${DRAFT}/status`, 'ADMIN', { status: 'PUBLISHED' })).status, 200);
    assert.equal((await detail(DRAFT, 'NEW')).status, 200, 'once published, learners see it');
  });

  it('10. list, detail, enrollment and my paths agree for every learner', async () => {
    const listed = (await call('GET', '/api/learning/paths', 'NEW')).json.data.map((p: any) => p.id);
    for (const [t, readable] of [['NEW', [PUB]], ['OLD', [PUB, ARCH]]] as const) {
      for (const pid of [PUB, ARCH, DRAFT]) {
        const ok = (await detail(pid, t)).status === 200;
        assert.equal(ok, (readable as readonly string[]).includes(pid), `${t} detail ${pid}`);
      }
    }
    assert.deepEqual(listed, [PUB]);
    assert.deepEqual(await myPaths('NEW'), []);
    assert.deepEqual(await myPaths('OLD'), [ARCH]);
  });

  it('11. final-project flows: a learner cannot reach the project of a DRAFT path (read, unlock status, submit); PUBLISHED unchanged', async () => {
    const before = snapshot();
    for (const t of ['NEW', 'OLD']) {
      const r = await call('GET', `/api/learning/final-project/${DRAFT}`, t);
      assert.equal(r.status, 404, t);
      assert.ok(!r.text.includes('secret brief'));
      assert.equal((await call('GET', `/api/learning/final-project/${DRAFT}/unlock-status`, t)).status, 404, t);
      assert.notEqual((await call('POST', `/api/learning/final-project/${FP_DRAFT}/submit`, t, { content: 'x' })).status, 201, t);
    }
    assert.equal((await call('GET', `/api/learning/final-project/${ARCH}`, 'NEW')).status, 404, 'archived project: only former members');
    assert.equal(snapshot(), before);
    const pub = await call('GET', `/api/learning/final-project/${PUB}`, 'NEW');
    assert.equal(pub.status, 200);
    assert.equal(pub.json.data.id, FP_PUB);
    const unlock = await call('GET', `/api/learning/final-project/${PUB}/unlock-status`, 'NEW');
    assert.equal(unlock.status, 200);
    assert.equal(unlock.json.data.unlocked, false, 'not enrolled yet - unchanged rule');
  });

  it('12. refused requests change neither enrollments nor paths; unenrolling one\'s own (archived) enrollment still works', async () => {
    const before = snapshot();
    await enroll(DRAFT, 'NEW');
    await enroll(ARCH, 'NEW');
    await detail(DRAFT, 'OLD');
    await call('GET', `/api/learning/final-project/${DRAFT}`, 'OLD');
    assert.equal(snapshot(), before);
    assert.deepEqual(writes, []);
    assert.equal((await call('DELETE', `/api/learning/paths/${ARCH}/enroll`, 'OLD')).status, 200);
    assert.ok(!tables.userPathEnrollment.some((e) => e.userId === USERS.OLD.userId && e.learningPathId === ARCH));
  });
});
