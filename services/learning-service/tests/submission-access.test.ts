/**
 * FIX-INS-09: who may list, grade and (re)evaluate Assignment / Final Project submissions - per object, not per role.
 *
 *   Assignment     GET  /api/learning/assignment/:assignmentId/submissions        grader only
 *                  PUT  /api/learning/assignment/submission/:submissionId/grade   grader only
 *                  grader = ADMIN, or the INSTRUCTOR who owns the course (course-service) that really contains the assignment's
 *                  lesson. Assignment.createdBy / courseId (written from the creator's request) grant nothing on their own.
 *   Final project  GET  /api/learning/final-project/:projectId/submissions        grader only
 *                  PUT  /api/learning/final-project/submission/:id/grade           grader only
 *                  POST /api/learning/final-project/:submissionId/evaluate         submitter or grader (it writes the result)
 *                  GET  .../submission/:id/status, .../context, POST .../retry-analysis   submitter or grader
 *                  grader = ADMIN, or the INSTRUCTOR who created that final project.
 *   An unknown id and a forbidden one give the same 403; a refused request changes nothing.
 *
 * The REAL express app runs on an ephemeral port with the in-memory Prisma fake (extended here with the submission models). The
 * auth-, user- and course-services are one loopback stub; the course-service internal lessons route checks COURSE_LEARNING_TOKEN
 * like the real one. The AI evaluation / analysis internals are replaced by recorders (only access is under test here).
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { installFakePrisma, FakePrismaClient } from './helpers/fake-prisma';

// ---------------------------------------------------------------- submission models on the shared fake
type Row = Record<string, any>;
const tables: Record<string, Row[]> = { assignment: [], assignmentSubmission: [], finalProject: [], finalProjectSubmission: [] };
const writes: Array<{ table: string; op: string; where: any; data: any }> = [];
const relation: Record<string, [string, string, string]> = { assignmentSubmission: ['assignment', 'assignment', 'assignmentId'], finalProjectSubmission: ['finalProject', 'finalProject', 'finalProjectId'] };
const match = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
const withInclude = (table: string, row: Row, include: any) => {
  const out = { ...row };
  const rel = relation[table];
  if (include && rel && include[rel[0]]) out[rel[0]] = tables[rel[1]].find((r) => r.id === row[rel[2]]) ?? null;
  return out;
};
const model = (table: string) => ({
  findUnique: async ({ where, include }: any) => { const r = tables[table].find((x) => match(x, where)); return r ? withInclude(table, r, include) : null; },
  findMany: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).map((r) => ({ ...r })),
  count: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).length,
  update: async ({ where, data }: any) => {
    const r = tables[table].find((x) => match(x, where));
    writes.push({ table, op: 'update', where, data: { ...data } });
    Object.assign(r!, data);
    return { ...r };
  },
});
Object.assign((FakePrismaClient as any).prototype, {
  assignment: model('assignment'), assignmentSubmission: model('assignmentSubmission'),
  finalProject: model('finalProject'), finalProjectSubmission: model('finalProjectSubmission'),
});
installFakePrisma();
// the shared fake exports only the quiz enum; AssignmentService.gradeSubmission reads SubmissionStatus from the client package
(require.cache[require.resolve('@prisma/client')] as any).exports.SubmissionStatus = { SUBMITTED: 'SUBMITTED', GRADING: 'GRADING', GRADED: 'GRADED', RETURNED: 'RETURNED' };

// ---------------------------------------------------------------- identities and data
const id = (c: string) => c.repeat(12);
const USERS: Record<string, { userId: string; role: string }> = {
  L1: { userId: id('a1'), role: 'STUDENT' },
  L2: { userId: id('a2'), role: 'STUDENT' },
  T_A: { userId: id('b1'), role: 'INSTRUCTOR' },        // owns course A
  T_B: { userId: id('b2'), role: 'INSTRUCTOR' },        // owns course B
  T_P: { userId: id('b3'), role: 'INSTRUCTOR' },        // created final project P
  STUDENT_CREATOR: { userId: id('a3'), role: 'STUDENT' }, // a student who created final project P2 (create has no role check)
  ADMIN: { userId: id('c1'), role: 'ADMIN' },
};
const COURSE_A = id('d1');
const COURSE_B = id('d2');
const LA1 = id('e1');
const LA2 = id('e2');
const LB1 = id('e3');
const X = id('f1');   // assignment on lesson LA1 of course A, created by T_A
const W = id('f2');   // assignment on lesson LA2 of course A, created by T_B (course A belongs to T_A)
const Z = id('f3');   // T_B: lesson LA2 of course A but courseId = his course B (forged link)
const P = id('f4');   // final project created by T_P
const P2 = id('f5');  // final project created by a student
const S1 = id('11');  // L1 on X
const S2 = id('12');  // L2 on X
const SW = id('13');  // L1 on W
const SZ = id('14');  // L1 on Z
const F1 = id('21');  // L1 on P
const F2 = id('22');  // L2 on P
const F3 = id('23');  // L1 on P2
const MISSING = id('99');
const COURSE_LEARNING_TOKEN = randomBytes(32).toString('hex');

describe('FIX-INS-09: per-object access to list, grade and evaluate submissions', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let tmp = '';
  let FinalProjectService: any;
  const aiCalls: string[] = [];

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
        // course-service internal lesson-owner route (FIX-INS-10): lesson -> its real course -> that course's instructor
        const owner = url.match(/^\/api\/courses\/internal\/lessons\/([0-9a-f]{24})\/owner$/);
        if (owner) {
          if (req.headers['x-internal-service-token'] !== COURSE_LEARNING_TOKEN) { res.statusCode = 403; return res.end('{}'); }
          const courseId = [LA1, LA2].includes(owner[1]) ? COURSE_A : owner[1] === LB1 ? COURSE_B : '';
          if (!courseId) { res.statusCode = 404; return res.end('{}'); }
          return res.end(JSON.stringify({ data: { lessonId: owner[1], courseId, instructorId: courseId === COURSE_A ? USERS.T_A.userId : USERS.T_B.userId } }));
        }
        if (url.startsWith('/api/users/internal/notifications')) return res.end('{}');
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins09-'));
    for (const v of ['ZIP_UPLOAD_DIR', 'ZIP_EXTRACT_DIR', 'VIDEO_UPLOAD_DIR', 'HLS_TEMP_DIR']) process.env[v] = path.join(tmp, v.toLowerCase());
    Object.assign(process.env, {
      AUTH_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, COURSE_LEARNING_TOKEN,
      RATE_LIMIT_MAX_REQUESTS: '100000', BLOCKCHAIN_ENABLED: 'false', INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'),
    });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    ({ FinalProjectService } = require('../src/services/final-project.service'));
    for (const m of ['evaluateSubmission', 'getSubmissionStatus', 'getProjectContext', 'retryAnalysis']) {
      mock.method(FinalProjectService, m, async (submissionId: string) => { aiCalls.push(`${m}:${submissionId}`); return { submissionId, ok: true }; });
    }
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
    aiCalls.length = 0;
    tables.assignment = [
      { id: X, courseId: COURSE_A, lessonId: LA1, createdBy: USERS.T_A.userId, maxScore: 100, title: 'X' },
      { id: W, courseId: COURSE_A, lessonId: LA2, createdBy: USERS.T_B.userId, maxScore: 100, title: 'W' },
      { id: Z, courseId: COURSE_B, lessonId: LA2, createdBy: USERS.T_B.userId, maxScore: 100, title: 'Z' },
    ];
    const sub = (sid: string, assignmentId: string, u: string) => ({ id: sid, assignmentId, userId: USERS[u].userId, courseId: COURSE_A, content: `work of ${u}`, status: 'SUBMITTED', score: null, feedback: null, gradedBy: null, submittedAt: new Date('2026-01-01') });
    tables.assignmentSubmission = [sub(S1, X, 'L1'), sub(S2, X, 'L2'), sub(SW, W, 'L1'), sub(SZ, Z, 'L1')];
    tables.finalProject = [
      { id: P, createdBy: USERS.T_P.userId, title: 'P', passingScore: 80 },
      { id: P2, createdBy: USERS.STUDENT_CREATOR.userId, title: 'P2', passingScore: 80 },
    ];
    const fsub = (sid: string, projectId: string, u: string) => ({ id: sid, finalProjectId: projectId, userId: USERS[u].userId, content: `project of ${u}`, status: 'SUBMITTED', score: null, feedback: null, gradedBy: null, submittedAt: new Date('2026-01-01') });
    tables.finalProjectSubmission = [fsub(F1, P, 'L1'), fsub(F2, P, 'L2'), fsub(F3, P2, 'L1')];
  });

  const call = async (method: string, url: string, token?: string, payload?: unknown) => {
    const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const aList = (assignmentId: string) => `/api/learning/assignment/${assignmentId}/submissions`;
  const aGrade = (submissionId: string) => `/api/learning/assignment/submission/${submissionId}/grade`;
  const pList = (projectId: string) => `/api/learning/final-project/${projectId}/submissions`;
  const pGrade = (submissionId: string) => `/api/learning/final-project/submission/${submissionId}/grade`;
  const forbidden = (r: { status: number; json: any; text: string }, label: string) => {
    assert.equal(r.status, 403, label);
    assert.ok(!r.text.includes('work of') && !r.text.includes('project of'), `${label}: no submission content`);
  };
  const unchanged = (label: string) => assert.deepEqual(writes, [], `${label}: nothing written`);

  // =============================================================================================== assignments
  it('1. not signed in: 401 on every list / grade / evaluate route', async () => {
    for (const [m, u] of [['GET', aList(X)], ['PUT', aGrade(S1)], ['GET', pList(P)], ['PUT', pGrade(F1)], ['POST', `/api/learning/final-project/${F1}/evaluate`]] as const) {
      assert.equal((await call(m, u, undefined, m === 'GET' ? undefined : { score: 90 })).status, 401, u);
    }
    unchanged('anonymous');
  });

  it('2. a learner cannot list the submissions of an assignment (not even one they submitted to)', async () => {
    for (const token of ['L1', 'L2']) forbidden(await call('GET', aList(X), token), token);
  });

  it('3/6. instructor B cannot list course A\'s submissions - not through W (he authored it) nor Z (forged courseId), nor with ids in the query', async () => {
    forbidden(await call('GET', aList(X), 'T_B'), 'X');
    forbidden(await call('GET', aList(W), 'T_B'), 'W: authorship of an assignment on someone else\'s course grants nothing');
    forbidden(await call('GET', aList(Z), 'T_B'), 'Z: his courseId, but the lesson belongs to course A');
    forbidden(await call('GET', `${aList(X)}?courseId=${COURSE_B}&instructorId=${USERS.T_B.userId}&createdBy=${USERS.T_B.userId}&role=ADMIN`, 'T_B'), 'forged query');
    // claiming to BE the real owner of course A (its instructorId / userId) in the query or body grants nothing
    forbidden(await call('GET', `${aList(X)}?instructorId=${USERS.T_A.userId}&userId=${USERS.T_A.userId}&graderId=${USERS.T_A.userId}`, 'T_B'), 'owner id in the query');
    assert.equal((await call('PUT', aGrade(S1), 'T_B', { score: 1, instructorId: USERS.T_A.userId, userId: USERS.T_A.userId, gradedBy: USERS.T_A.userId })).status, 403, 'owner id in the body');
    unchanged('forged owner ids');
    forbidden(await call('GET', aList(MISSING), 'T_B'), 'unknown id: the same 403');
  });

  it('4/13. the owner of course A lists its submissions (also of W, authored by someone else) - unchanged { data, pagination } contract', async () => {
    const r = await call('GET', aList(X), 'T_A');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.map((s: Row) => s.id).sort(), [S1, S2].sort());
    assert.equal(r.json.pagination.total, 2);
    assert.equal((await call('GET', aList(W), 'T_A')).status, 200);
    forbidden(await call('GET', aList(Z), 'T_A'), 'Z points at course B: course A\'s owner gets nothing through it either');
  });

  it('5/11. an instructor without the right cannot grade - and score, feedback and status stay as they were', async () => {
    for (const [token, sid] of [['T_B', S1], ['T_B', SW], ['T_B', SZ], ['T_P', S1], ['L1', S1], ['L2', S1], ['T_B', MISSING]] as const) {
      const r = await call('PUT', aGrade(sid), token, { score: 100, feedback: 'hacked', status: 'GRADED', gradedBy: USERS.T_B.userId });
      assert.equal(r.status, 403, `${token} -> ${sid}`);
    }
    unchanged('refused assignment grades');
    assert.ok(tables.assignmentSubmission.every((s) => s.score === null && s.feedback === null && s.status === 'SUBMITTED'));
  });

  it('4/10. the course owner grades; the grader recorded is the caller, never a gradedBy / userId from the body', async () => {
    const r = await call('PUT', aGrade(S1), 'T_A', { score: 88, feedback: 'Good', status: 'GRADED', gradedBy: USERS.T_B.userId, userId: USERS.L2.userId });
    assert.equal(r.status, 200);
    const s1 = tables.assignmentSubmission.find((s) => s.id === S1)!;
    assert.deepEqual([s1.score, s1.feedback, s1.status, s1.gradedBy], [88, 'Good', 'GRADED', USERS.T_A.userId]);
    assert.equal(tables.assignmentSubmission.find((s) => s.id === S2)!.score, null, 'only that submission');
    assert.equal((await call('PUT', aGrade(S1), 'T_A', { score: 101 })).status, 400, 'the existing score rule still applies');
  });

  // =============================================================================================== final projects
  it('7. a learner cannot list the submissions of a final project (their own work goes through /submission(s)/me)', async () => {
    for (const token of ['L1', 'L2']) forbidden(await call('GET', pList(P), token), token);
    const mine = await call('GET', `/api/learning/final-project/${P}/submissions/me`, 'L1');
    assert.equal(mine.status, 200, 'the learner endpoint is unchanged');
  });

  it('8. an instructor who is not this project\'s grader cannot list it - grading assignments grants nothing here', async () => {
    for (const token of ['T_A', 'T_B']) forbidden(await call('GET', pList(P), token), token);
    forbidden(await call('GET', pList(P2), 'STUDENT_CREATOR'), 'a student who created a final project is not a grader');
    forbidden(await call('GET', pList(MISSING), 'T_P'), 'unknown id: the same 403');
  });

  it('9/11. learners and unauthorised instructors cannot grade a final project; nothing changes', async () => {
    for (const [token, sid] of [['L1', F1], ['L2', F1], ['T_A', F1], ['T_B', F2], ['STUDENT_CREATOR', F3], ['T_P', F3], ['T_P', MISSING]] as const) {
      const r = await call('PUT', pGrade(sid), token, { score: 100, feedback: 'x', status: 'GRADED', gradedBy: USERS[token]?.userId });
      assert.equal(r.status, 403, `${token} -> ${sid}`);
    }
    unchanged('refused project grades');
    assert.ok(tables.finalProjectSubmission.every((s) => s.score === null && s.status === 'SUBMITTED'));
  });

  it('10. the project\'s grader lists and grades it; gradedBy is the caller and extra body fields are ignored', async () => {
    const list = await call('GET', pList(P), 'T_P');
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.data.map((s: Row) => s.id).sort(), [F1, F2].sort());
    const r = await call('PUT', pGrade(F1), 'T_P', { score: 91, feedback: 'Well done', status: 'RETURNED', gradedBy: USERS.L1.userId, userId: USERS.L2.userId, finalProjectId: P2 });
    assert.equal(r.status, 200);
    const f1 = tables.finalProjectSubmission.find((s) => s.id === F1)!;
    assert.deepEqual([f1.score, f1.totalScore, f1.feedback, f1.status, f1.gradedBy], [91, 91, 'Well done', 'RETURNED', USERS.T_P.userId]);
    const w = writes.find((x) => x.table === 'finalProjectSubmission')!;
    assert.deepEqual(Object.keys(w.data).sort(), ['feedback', 'gradedAt', 'gradedBy', 'score', 'status', 'totalScore']);
  });

  it('12. ADMIN keeps every right: lists and grades assignments and final projects', async () => {
    assert.equal((await call('GET', aList(X), 'ADMIN')).status, 200);
    assert.equal((await call('GET', aList(Z), 'ADMIN')).status, 200);
    assert.equal((await call('GET', pList(P2), 'ADMIN')).status, 200);
    assert.equal((await call('PUT', aGrade(S2), 'ADMIN', { score: 70 })).status, 200);
    assert.equal((await call('PUT', pGrade(F2), 'ADMIN', { score: 60 })).status, 200);
  });

  it('14. evaluate / status / context / retry-analysis: the submitter or the grader; another learner or instructor is refused before the service runs', async () => {
    const routes = (sid: string): Array<[string, string]> => [
      ['POST', `/api/learning/final-project/${sid}/evaluate`], ['GET', `/api/learning/final-project/submission/${sid}/status`],
      ['GET', `/api/learning/final-project/submission/${sid}/context`], ['POST', `/api/learning/final-project/submission/${sid}/retry-analysis`],
    ];
    for (const token of ['L2', 'T_A', 'T_B', 'STUDENT_CREATOR']) {
      for (const [m, u] of routes(F1)) forbidden(await call(m, u, token), `${token} ${u}`);
    }
    for (const [m, u] of routes(MISSING)) forbidden(await call(m, u, 'L1'), `unknown ${u}`);
    assert.deepEqual(aiCalls, [], 'the evaluation / analysis code never ran for a refused caller');
    for (const token of ['L1', 'T_P', 'ADMIN']) {
      for (const [m, u] of routes(F1)) assert.equal((await call(m, u, token)).status, 200, `${token} ${u}`);
    }
    assert.equal(aiCalls.length, 12);
    assert.ok(aiCalls.every((c) => c.endsWith(`:${F1}`)));
  });
});
