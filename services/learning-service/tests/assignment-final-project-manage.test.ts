/**
 * FIX-INS-10: who may create / edit an Assignment or a Final Project.
 *
 *   Assignment     POST /api/learning/assignment/:lessonId        ADMIN, or the INSTRUCTOR owning the lesson's course
 *                  PUT  /api/learning/assignment/:assignmentId    the INSTRUCTOR owning the course of the assignment's lesson, or
 *                                                                 an ADMIN on an assignment they created (existing policy)
 *                  The course is derived from the lesson by the course-service internal route
 *                  GET /api/courses/internal/lessons/:lessonId/owner (COURSE_LEARNING_TOKEN, any course status). courseId /
 *                  lessonId / createdBy from the client are never stored; a mismatching courseId / lessonId is a 400; an
 *                  assignment never moves. Unknown and forbidden assignment ids give the same 403.
 *   Final project  POST /api/learning/final-project/:pathId, PUT /api/learning/final-project/:projectId    ADMIN only
 *                  (learning paths are admin-managed; creating a project would make its author a grader). learningPathId never
 *                  changes, createdBy is the caller.
 *
 * Course A is NOT published: the public course GET of the stub answers 404 for it (like the real one does for others), so its
 * owner keeps access only through the internal route. The REAL express app runs on an ephemeral port with the in-memory Prisma
 * fake; the auth-, user- and course-services are one loopback stub.
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
const tables: Record<string, Row[]> = { assignment: [], assignmentSubmission: [], finalProject: [], learningPath: [] };
const writes: Array<{ table: string; op: string; data: any }> = [];
const match = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
let seq = 0;
const model = (table: string) => ({
  findUnique: async ({ where }: any) => { const r = tables[table].find((x) => match(x, where)); return r ? { ...r } : null; },
  findMany: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).map((r) => ({ ...r })),
  count: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).length,
  create: async ({ data }: any) => {
    writes.push({ table, op: 'create', data: { ...data } });
    const row = { id: (++seq).toString(16).padStart(24, '0'), ...data };
    tables[table].push(row);
    return { ...row };
  },
  update: async ({ where, data }: any) => {
    const r = tables[table].find((x) => match(x, where));
    writes.push({ table, op: 'update', data: { ...data } });
    for (const [k, v] of Object.entries(data)) if (v !== undefined) r![k] = v;
    return { ...r };
  },
});
Object.assign((FakePrismaClient as any).prototype, {
  assignment: model('assignment'), assignmentSubmission: model('assignmentSubmission'),
  finalProject: model('finalProject'), learningPath: model('learningPath'),
});
installFakePrisma();
(require.cache[require.resolve('@prisma/client')] as any).exports.SubmissionStatus = { SUBMITTED: 'SUBMITTED', GRADING: 'GRADING', GRADED: 'GRADED', RETURNED: 'RETURNED' };

// ---------------------------------------------------------------- identities and data
const id = (c: string) => c.repeat(12);
const USERS: Record<string, { userId: string; role: string }> = {
  L1: { userId: id('a1'), role: 'STUDENT' },
  T_A: { userId: id('b1'), role: 'INSTRUCTOR' },   // owns course A (unpublished)
  T_B: { userId: id('b2'), role: 'INSTRUCTOR' },   // owns course B (published)
  ADMIN: { userId: id('c1'), role: 'ADMIN' },
  ADMIN2: { userId: id('c2'), role: 'ADMIN' },
};
const COURSE_A = id('d1');
const COURSE_B = id('d2');
const LA1 = id('e1');
const LA2 = id('e2');
const LB1 = id('e3');
const LB2 = id('e4');
const MISSING_LESSON = id('e9');
const X = id('f1');   // course A / LA1, created by T_A
const W = id('f2');   // course A / LA2, created by T_B before FIX-INS-10 (no ownership check then)
const Z = id('f3');   // lesson LA2 of course A but courseId = course B (forged link), created by T_B
const AD = id('f4');  // course B / LB2, created by ADMIN
const MISSING = id('99');
const PATH_1 = id('71');
const PATH_2 = id('72');
const PROJECT = id('81');
const LESSON_COURSE: Record<string, string> = { [LA1]: COURSE_A, [LA2]: COURSE_A, [LB1]: COURSE_B, [LB2]: COURSE_B };
const COURSE_OWNER: Record<string, string> = { [COURSE_A]: USERS.T_A.userId, [COURSE_B]: USERS.T_B.userId };
const COURSE_LEARNING_TOKEN = randomBytes(32).toString('hex');

describe('FIX-INS-10: create / edit Assignment and Final Project', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let tmp = '';
  const ownerCalls: Array<{ lessonId: string; token: unknown }> = [];

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
        const owner = url.match(/^\/api\/courses\/internal\/lessons\/([0-9a-f]{24})\/owner$/);
        if (owner) {
          ownerCalls.push({ lessonId: owner[1], token: req.headers['x-internal-service-token'] });
          if (req.headers['x-internal-service-token'] !== COURSE_LEARNING_TOKEN) { res.statusCode = 403; return res.end('{}'); }
          const courseId = LESSON_COURSE[owner[1]];
          if (!courseId) { res.statusCode = 404; return res.end('{}'); }
          return res.end(JSON.stringify({ data: { lessonId: owner[1], courseId, instructorId: COURSE_OWNER[courseId] } }));
        }
        // the old sources (public course GET + lesson list): course A is unpublished, so the public GET hides it
        const lessons = url.match(/^\/api\/courses\/internal\/([0-9a-f]{24})\/lessons$/);
        if (lessons) {
          if (req.headers['x-internal-service-token'] !== COURSE_LEARNING_TOKEN) { res.statusCode = 403; return res.end('{}'); }
          return res.end(JSON.stringify({ data: Object.keys(LESSON_COURSE).filter((l) => LESSON_COURSE[l] === lessons[1]).map((l) => ({ id: l })) }));
        }
        if (url === `/api/courses/${COURSE_B}`) return res.end(JSON.stringify({ data: { id: COURSE_B, published: true, price: 100, instructorId: USERS.T_B.userId } }));
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins10-'));
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

  beforeEach(() => {
    writes.length = 0;
    ownerCalls.length = 0;
    process.env.COURSE_LEARNING_TOKEN = COURSE_LEARNING_TOKEN;
    const a = (aid: string, courseId: string, lessonId: string, by: string) => ({ id: aid, courseId, lessonId, createdBy: USERS[by].userId, title: `T-${aid.slice(0, 2)}`, description: 'd', maxScore: 100 });
    tables.assignment = [a(X, COURSE_A, LA1, 'T_A'), a(W, COURSE_A, LA2, 'T_B'), a(Z, COURSE_B, LA2, 'T_B'), a(AD, COURSE_B, LB2, 'ADMIN')];
    tables.assignmentSubmission = [{ id: id('11'), assignmentId: X, userId: USERS.L1.userId, courseId: COURSE_A, content: 'work of L1', status: 'SUBMITTED', submittedAt: new Date('2026-01-01') }];
    tables.learningPath = [{ id: PATH_1, title: 'Path 1', courseIds: [COURSE_A], status: 'PUBLISHED' }, { id: PATH_2, title: 'Path 2', courseIds: [COURSE_B], status: 'PUBLISHED' }];
    tables.finalProject = [{ id: PROJECT, learningPathId: PATH_1, createdBy: USERS.ADMIN.userId, title: 'Capstone', passingScore: 80 }];
  });

  const call = async (method: string, url: string, token?: string, payload?: unknown) => {
    const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const aCreate = (lessonId: string) => `/api/learning/assignment/${lessonId}`;
  const aUpdate = (assignmentId: string) => `/api/learning/assignment/${assignmentId}`;
  const fpCreate = (pathId: string) => `/api/learning/final-project/${pathId}`;
  const fpUpdate = (projectId: string) => `/api/learning/final-project/${projectId}`;
  const body = (extra: Row = {}) => ({ title: 'Homework', description: 'Do it', maxScore: 50, allowedFileTypes: ['pdf'], ...extra });
  const nothingWritten = (label: string) => assert.deepEqual(writes, [], `${label}: nothing written`);
  const row = (aid: string) => tables.assignment.find((r) => r.id === aid)!;

  // =============================================================================================== assignment: create
  it('1. not signed in: 401 on create / update of assignments and final projects', async () => {
    for (const [m, u] of [['POST', aCreate(LB1)], ['PUT', aUpdate(X)], ['POST', fpCreate(PATH_2)], ['PUT', fpUpdate(PROJECT)]] as const) {
      assert.equal((await call(m, u, undefined, body())).status, 401, `${m} ${u}`);
    }
    nothingWritten('anonymous');
  });

  it('2. a learner can neither create nor update an assignment', async () => {
    assert.equal((await call('POST', aCreate(LB1), 'L1', body())).status, 403);
    assert.equal((await call('PUT', aUpdate(X), 'L1', { title: 'hacked' })).status, 403);
    nothingWritten('learner');
    assert.equal(row(X).title, 'T-f1');
  });

  it('3. instructor B cannot create an assignment in course A - whatever courseId / createdBy / instructorId the body claims', async () => {
    for (const extra of [{}, { courseId: COURSE_B }, { courseId: COURSE_A }, { createdBy: USERS.T_A.userId, instructorId: USERS.T_A.userId, userId: USERS.T_A.userId }]) {
      assert.equal((await call('POST', aCreate(LA2), 'T_B', body(extra))).status, 403, JSON.stringify(extra));
    }
    nothingWritten('foreign course');
    // the decision came from the course-service internal route, with the credential
    assert.ok(ownerCalls.length > 0 && ownerCalls.every((c) => c.lessonId === LA2 && c.token === COURSE_LEARNING_TOKEN));
  });

  it('4. a forged courseId (own lesson, other course) or a lessonId differing from the route is refused (400)', async () => {
    const r1 = await call('POST', aCreate(LB1), 'T_B', body({ courseId: COURSE_A }));
    assert.equal(r1.status, 400);
    assert.match(r1.json.error, /courseId/);
    const r2 = await call('POST', aCreate(LB1), 'T_B', body({ lessonId: LA1 }));
    assert.equal(r2.status, 400);
    nothingWritten('forged ids');
  });

  it('5. a lesson the course-service does not know (or a malformed id) is a 404 - nothing written', async () => {
    assert.equal((await call('POST', aCreate(MISSING_LESSON), 'T_B', body())).status, 404);
    assert.equal((await call('POST', aCreate('not-an-id'), 'ADMIN', body())).status, 404);
    nothingWritten('missing lesson');
  });

  it('6. the owner creates: courseId derived from the lesson, createdBy = caller, only allowlisted fields stored', async () => {
    const r = await call('POST', aCreate(LB1), 'T_B', body({ createdBy: USERS.T_A.userId, id: MISSING, submissions: [], score: 100, gradedBy: USERS.T_A.userId }));
    assert.equal(r.status, 201, r.text);
    assert.equal(writes.length, 1);
    const stored = writes[0].data;
    assert.equal(stored.courseId, COURSE_B);
    assert.equal(stored.lessonId, LB1);
    assert.equal(stored.createdBy, USERS.T_B.userId);
    assert.equal(stored.title, 'Homework');
    assert.equal(stored.maxScore, 50);
    for (const k of ['id', 'submissions', 'score', 'gradedBy']) assert.ok(!(k in stored), `${k} must not be stored`);
    // a matching courseId (what the frontend sends) is accepted too
    tables.assignment = tables.assignment.filter((a) => a.lessonId !== LB1);
    assert.equal((await call('POST', aCreate(LB1), 'T_B', body({ courseId: COURSE_B, lessonId: LB1 }))).status, 201);
  });

  it('7. the owner of an UNPUBLISHED course creates in it; ADMIN creates in any course', async () => {
    tables.assignment = tables.assignment.filter((a) => a.id !== W && a.id !== Z);
    const r = await call('POST', aCreate(LA2), 'T_A', body({ courseId: COURSE_A }));
    assert.equal(r.status, 201, r.text);
    assert.equal(writes[0].data.courseId, COURSE_A);
    tables.assignment = tables.assignment.filter((a) => a.id !== AD);
    const ra = await call('POST', aCreate(LB2), 'ADMIN', body());
    assert.equal(ra.status, 201, ra.text);
    assert.equal(writes[1].data.courseId, COURSE_B);
    assert.equal(writes[1].data.createdBy, USERS.ADMIN.userId);
  });

  // =============================================================================================== assignment: update
  it('8. the course owner updates; courseId / lessonId never move, createdBy never changes', async () => {
    const ok = await call('PUT', aUpdate(X), 'T_A', { title: 'New title', courseId: COURSE_A, lessonId: LA1, createdBy: USERS.T_B.userId });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(row(X).title, 'New title');
    assert.equal(row(X).createdBy, USERS.T_A.userId);
    for (const k of ['courseId', 'lessonId', 'createdBy']) assert.ok(!(k in writes[0].data), `${k} is not written`);
    writes.length = 0;
    assert.equal((await call('PUT', aUpdate(X), 'T_A', { title: 'moved', courseId: COURSE_B })).status, 400);
    assert.equal((await call('PUT', aUpdate(X), 'T_A', { title: 'moved', lessonId: LB1 })).status, 400);
    nothingWritten('move');
    assert.equal(row(X).courseId, COURSE_A);
    assert.equal(row(X).lessonId, LA1);
  });

  it('9. authorship alone grants nothing: B cannot edit X, nor W / Z which he wrote into course A; A (owner) edits W', async () => {
    for (const aid of [X, W, Z]) assert.equal((await call('PUT', aUpdate(aid), 'T_B', { title: 'hacked' })).status, 403, aid);
    // a forged link (Z: lesson of course A, courseId B) is not editable by A either
    assert.equal((await call('PUT', aUpdate(Z), 'T_A', { title: 'x' })).status, 403);
    nothingWritten('foreign');
    assert.equal((await call('PUT', aUpdate(W), 'T_A', { title: 'fixed by owner' })).status, 200);
    assert.equal(row(W).title, 'fixed by owner');
  });

  it('10. an unknown assignment id gives the same 403 as a forbidden one', async () => {
    const unknown = await call('PUT', aUpdate(MISSING), 'T_A', { title: 'x' });
    const foreign = await call('PUT', aUpdate(X), 'T_B', { title: 'x' });
    assert.equal(unknown.status, 403);
    assert.deepEqual(unknown.json, foreign.json);
    nothingWritten('unknown');
  });

  it('11. ADMIN edits the assignments they created (existing policy), not another admin\'s / instructor\'s', async () => {
    assert.equal((await call('PUT', aUpdate(AD), 'ADMIN', { title: 'admin edit' })).status, 200);
    writes.length = 0;
    assert.equal((await call('PUT', aUpdate(AD), 'ADMIN2', { title: 'x' })).status, 403);
    assert.equal((await call('PUT', aUpdate(X), 'ADMIN', { title: 'x' })).status, 403);
    nothingWritten('admin');
  });

  // =============================================================================================== internal route
  it('12. without (or with a wrong) COURSE_LEARNING_TOKEN nothing is decided: create 503, update / grading refused, nothing written', async () => {
    delete process.env.COURSE_LEARNING_TOKEN;
    assert.equal((await call('POST', aCreate(LA2), 'T_A', body())).status, 503);
    assert.equal((await call('PUT', aUpdate(X), 'T_A', { title: 'x' })).status, 503);
    assert.equal((await call('GET', `${aUpdate(X)}/submissions`, 'T_A')).status, 403);
    assert.equal(ownerCalls.length, 0, 'no request sent without a usable token');
    process.env.COURSE_LEARNING_TOKEN = randomBytes(32).toString('hex');
    assert.equal((await call('POST', aCreate(LA2), 'T_A', body())).status, 503);
    assert.equal((await call('GET', `${aUpdate(X)}/submissions`, 'T_A')).status, 403);
    assert.ok(ownerCalls.length > 0 && ownerCalls.every((c) => c.token !== COURSE_LEARNING_TOKEN), 'the course-service refused the wrong token');
    nothingWritten('no token');
  });

  it('13. the owner of an unpublished course keeps grading access (internal route); another instructor gains none from it', async () => {
    const own = await call('GET', `${aUpdate(X)}/submissions`, 'T_A');
    assert.equal(own.status, 200, own.text);
    assert.equal(own.json.data.length, 1);
    const other = await call('GET', `${aUpdate(X)}/submissions`, 'T_B');
    assert.equal(other.status, 403);
    assert.ok(!other.text.includes('work of'));
  });

  // =============================================================================================== final project
  it('14. a learner cannot create or update a final project', async () => {
    assert.equal((await call('POST', fpCreate(PATH_2), 'L1', { title: 'mine' })).status, 403);
    assert.equal((await call('PUT', fpUpdate(PROJECT), 'L1', { title: 'mine' })).status, 403);
    nothingWritten('learner');
  });

  it('15. an instructor cannot create a final project (it would make them its grader) nor edit one', async () => {
    for (const t of ['T_A', 'T_B']) {
      assert.equal((await call('POST', fpCreate(PATH_2), t, { title: 'self-grant', createdBy: USERS.ADMIN.userId })).status, 403, t);
      assert.equal((await call('PUT', fpUpdate(PROJECT), t, { title: 'x' })).status, 403, t);
    }
    nothingWritten('instructor');
    assert.equal(tables.finalProject.length, 1);
  });

  it('16. ADMIN creates: learningPathId from the route, createdBy = caller, allowlisted fields only; path must exist', async () => {
    assert.equal((await call('POST', fpCreate(PATH_2), 'ADMIN', { title: 'P', learningPathId: PATH_1 })).status, 400);
    assert.equal((await call('POST', fpCreate(MISSING), 'ADMIN', { title: 'P' })).status, 404);
    nothingWritten('bad path');
    const r = await call('POST', fpCreate(PATH_2), 'ADMIN', { title: 'Capstone 2', passingScore: 70, createdBy: USERS.T_B.userId, id: MISSING, submissions: [] });
    assert.equal(r.status, 201, r.text);
    const stored = writes[0].data;
    assert.equal(stored.learningPathId, PATH_2);
    assert.equal(stored.createdBy, USERS.ADMIN.userId);
    assert.equal(stored.passingScore, 70);
    for (const k of ['id', 'submissions']) assert.ok(!(k in stored), `${k} must not be stored`);
  });

  it('17. ADMIN updates the existing record; a final project never moves to another path; unknown id 404', async () => {
    assert.equal((await call('PUT', fpUpdate(PROJECT), 'ADMIN', { title: 'x', learningPathId: PATH_2 })).status, 400);
    assert.equal((await call('PUT', fpUpdate(MISSING), 'ADMIN', { title: 'x' })).status, 404);
    nothingWritten('move');
    const r = await call('PUT', fpUpdate(PROJECT), 'ADMIN2', { title: 'Renamed', learningPathId: PATH_1, createdBy: USERS.T_A.userId });
    assert.equal(r.status, 200, r.text);
    const p = tables.finalProject[0];
    assert.equal(p.title, 'Renamed');
    assert.equal(p.learningPathId, PATH_1);
    assert.equal(p.createdBy, USERS.ADMIN.userId);
    assert.ok(!('learningPathId' in writes[0].data) && !('createdBy' in writes[0].data));
  });

  it('18. learner flow unchanged: a learner still reads the final project of a path', async () => {
    const r = await call('GET', fpCreate(PATH_1), 'L1');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.id, PROJECT);
  });
});
