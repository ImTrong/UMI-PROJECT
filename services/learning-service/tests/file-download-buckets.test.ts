/**
 * GET /api/learning/files/download - FIX-INS-07 (buckets) + FIX-INS-08 (per-resource access, IDOR).
 *
 *   FIX-INS-07  only the buckets the learning-service writes (`assignments`, `quiz-attachments`) with a plain key; course
 *               content and other services' buckets are never reachable here.
 *   FIX-INS-08  a file is served only when this service's records reference exactly that bucket + key and the signed-in
 *               caller may read EVERY referencing record:
 *                 assignment submission    submitter / assignment author / course instructor / ADMIN
 *                 final-project submission submitter / final-project author / ADMIN
 *                 quiz-attachments         no record references it today -> refused
 *               "No such file" and "not yours" are the same 404; nothing about the storage is disclosed.
 *
 * The REAL express app runs on an ephemeral port with the in-memory Prisma fake (extended here with the submission models);
 * @umi/file-storage is a stand-in that records every read; the auth-, user- and course-services are one loopback stub.
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
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { installFakePrisma, FakePrismaClient } from './helpers/fake-prisma';

// ---------------------------------------------------------------- the submission models, on the shared fake
type Row = Record<string, any>;
const tables: Record<string, Row[]> = { assignment: [], assignmentSubmission: [], finalProject: [], finalProjectSubmission: [] };
const dbReads: string[] = [];
const match = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
  if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
  if (v && typeof v === 'object' && 'contains' in v) return typeof row[k] === 'string' && row[k].includes((v as Row).contains);
  return row[k] === v;
});
const model = (name: string) => ({
  findMany: async ({ where }: any = {}) => { dbReads.push(`${name}.findMany`); return tables[name].filter((r) => match(r, where)).map((r) => ({ ...r })); },
  findUnique: async ({ where }: any) => { dbReads.push(`${name}.findUnique`); const r = tables[name].find((x) => match(x, where)); return r ? { ...r } : null; },
  findRaw: async ({ filter }: any) => {
    dbReads.push(`${name}.findRaw`);
    const ors: Row[] = filter?.$or || [];
    return tables[name].filter((row) => ors.some((cond) => Object.entries(cond).some(([p, c]: [string, any]) => {
      const field = p.split('.')[1];
      return Array.isArray(row.submissionData) && row.submissionData.some((i: Row) =>
        typeof c === 'string' ? i?.[field] === c : typeof i?.[field] === 'string' && new RegExp(c.$regex).test(i[field]));
    }))).map((r) => ({ _id: { $oid: r.id }, userId: { $oid: r.userId }, finalProjectId: { $oid: r.finalProjectId }, submissionData: r.submissionData }));
  },
});
Object.assign((FakePrismaClient as any).prototype, {
  assignment: model('assignment'), assignmentSubmission: model('assignmentSubmission'),
  finalProject: model('finalProject'), finalProjectSubmission: model('finalProjectSubmission'),
});
installFakePrisma();

// ---------------------------------------------------------------- storage stand-in
const objects: Record<string, string> = {};
const storageReads: string[] = [];
class FakeFileStorageService {
  async getFileStream(bucket: string, key: string) {
    storageReads.push(`${bucket}/${key}`);
    const content = objects[`${bucket}/${key}`];
    if (content === undefined) throw Object.assign(new Error(`NoSuchKey ${bucket}/${key}`), { code: 'NoSuchKey' });
    return Readable.from([Buffer.from(content)]);
  }
  async getPresignedUploadUrl() { return { uploadUrl: '', fileKey: '', publicUrl: '' }; }
  async downloadFile() { /* not used here */ }
}
const storagePath = require.resolve('@umi/file-storage');
require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: { FileStorageService: FakeFileStorageService, fileStorage: new FakeFileStorageService(), minioConfig: {} } } as any;

// ---------------------------------------------------------------- identities
const id = (c: string) => c.repeat(12);
const USERS: Record<string, { userId: string; role: string }> = {
  A: { userId: id('a1'), role: 'STUDENT' },
  B: { userId: id('b1'), role: 'STUDENT' },
  AUTHOR: { userId: id('c1'), role: 'INSTRUCTOR' },      // wrote the assignment, but does NOT own its course (FIX-INS-09: no grader)
  TEACHER: { userId: id('c2'), role: 'INSTRUCTOR' },     // instructor of the assignment's course (did not write it)
  STRANGER: { userId: id('c3'), role: 'INSTRUCTOR' },    // an instructor of nothing here
  PROJECT_AUTHOR: { userId: id('c4'), role: 'INSTRUCTOR' },
  ADMIN: { userId: id('d1'), role: 'ADMIN' },
};
const COURSE = id('e1');
const ASSIGNMENT = id('f1');
const LESSON = id('f9');
const COURSE_LEARNING_TOKEN = randomBytes(32).toString('hex');
const PROJECT = id('f2');
const k = (name: string) => `1700000000000-${name}.zip`;
const ref = (key: string, bucket = 'assignments') => `/api/learning/files/download?bucket=${bucket}&key=${key}`;
const A_SUB = k('a-assignment');
const B_SUB = k('b-assignment');
const A_PROJECT = k('a-project');
const A_PROJECT_PART = '1700000000000-a-report.pdf';
const B_PROJECT = k('b-project');
const COPIED = k('copied');        // A's file whose key B pasted into his own submission
const ORPHAN = k('orphan');
const QUIZ = '1700000000000-quiz.pdf';

describe('GET /api/learning/files/download: per-resource access (FIX-INS-08) on the learning-service buckets (FIX-INS-07)', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  let tmp = '';
  const logs: string[] = [];

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
        // course-service internal lesson-owner route (FIX-INS-09/10 grader rule: the lesson's real course and its instructor)
        if (url === `/api/courses/internal/lessons/${LESSON}/owner`) {
          if (req.headers['x-internal-service-token'] !== COURSE_LEARNING_TOKEN) { res.statusCode = 403; return res.end('{}'); }
          return res.end(JSON.stringify({ data: { lessonId: LESSON, courseId: COURSE, instructorId: USERS.TEACHER.userId } }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins08-'));
    for (const v of ['ZIP_UPLOAD_DIR', 'ZIP_EXTRACT_DIR', 'VIDEO_UPLOAD_DIR', 'HLS_TEMP_DIR']) process.env[v] = path.join(tmp, v.toLowerCase());
    Object.assign(process.env, { AUTH_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, COURSE_LEARNING_TOKEN, RATE_LIMIT_MAX_REQUESTS: '100000', BLOCKCHAIN_ENABLED: 'false', INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex') });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => { logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); return original(...args); };
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
    for (const key of Object.keys(objects)) delete objects[key];
    storageReads.length = 0;
    dbReads.length = 0;
    logs.length = 0;
    for (const key of [A_SUB, B_SUB, A_PROJECT, A_PROJECT_PART, B_PROJECT, COPIED, ORPHAN]) objects[`assignments/${key}`] = `content-of-${key}`;
    // an object under the OTHER bucket with the same key as B's submission: a bucket mix-up would serve it
    objects[`quiz-attachments/${B_SUB}`] = 'a-different-object';
    Object.assign(objects, { [`quiz-attachments/${QUIZ}`]: 'quiz-file', 'courses/1700000000000-paid.mp4': 'paid-video', 'course-videos/hls.m3u8': 'hls', 'avatars/me.png': 'avatar', 'certificates/c.pdf': 'cert', 'project-submissions/x.zip': 'zip' });
    tables.assignment = [{ id: ASSIGNMENT, courseId: COURSE, lessonId: LESSON, createdBy: USERS.AUTHOR.userId }];
    tables.assignmentSubmission = [
      { id: id('11'), assignmentId: ASSIGNMENT, courseId: COURSE, userId: USERS.A.userId, fileUrl: ref(A_SUB), fileKey: null },
      { id: id('12'), assignmentId: ASSIGNMENT, courseId: COURSE, userId: USERS.B.userId, fileUrl: null, fileKey: B_SUB },
      // B pasted A's key into his own submission (the field comes from the request body)
      { id: id('13'), assignmentId: ASSIGNMENT, courseId: COURSE, userId: USERS.B.userId, fileUrl: ref(COPIED), fileKey: null },
      { id: id('14'), assignmentId: ASSIGNMENT, courseId: COURSE, userId: USERS.A.userId, fileUrl: ref(COPIED), fileKey: null },
    ];
    tables.finalProject = [{ id: PROJECT, createdBy: USERS.PROJECT_AUTHOR.userId }];
    tables.finalProjectSubmission = [
      { id: id('21'), finalProjectId: PROJECT, userId: USERS.A.userId, fileUrl: ref(A_PROJECT), fileKey: null, submissionData: [{ type: 'FILE', label: 'Report', value: ref(A_PROJECT_PART), fileKey: A_PROJECT_PART }] },
      { id: id('22'), finalProjectId: PROJECT, userId: USERS.B.userId, fileUrl: null, fileKey: B_PROJECT, submissionData: null },
    ];
  });

  let requestNo = 0;
  const get = async (query: string, token?: string, viaQuery = false) => {
    const url = `/api/learning/files/download?${query}${viaQuery && token ? `&token=${token}` : ''}`;
    // a fresh client address per request: the route's own file limiter (20/min per IP) is not what is under test here
    const headers: Record<string, string> = { 'x-forwarded-for': `10.8.${(++requestNo >> 8) & 255}.${requestNo & 255}` };
    if (token && !viaQuery) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${url}`, { headers });
    return { status: res.status, text: await res.text() };
  };
  const q = (key: string, bucket = 'assignments', extra = '') => `bucket=${bucket}&key=${key}${extra}`;
  const refused = (r: { status: number; text: string }, label: string) => {
    assert.equal(r.status, 404, label);
    assert.deepEqual(JSON.parse(r.text), { error: 'File not found' }, label);
    assert.ok(!r.text.includes('content-of'), label);
  };

  // ------------------------------------------------------------------------------- FIX-INS-07: buckets
  it('13. course content and other services\' buckets / path keys are refused (404) before anything is read', async () => {
    // the access resolver itself must not even be consulted for an unsupported bucket (it has its own bucket guard too,
    // which would otherwise hide a broken request check)
    const { LearningFileAccessService } = require('../src/services/file-access.service');
    const consulted = mock.method(LearningFileAccessService, 'canDownload');
    for (const query of ['bucket=courses&key=1700000000000-paid.mp4', 'bucket=course-videos&key=hls.m3u8', 'bucket=avatars&key=me.png', 'bucket=certificates&key=c.pdf',
      'bucket=project-submissions&key=x.zip', `bucket=assignments&key=../courses/1700000000000-paid.mp4`, 'bucket=assignments&key=sub/dir.zip', `bucket[]=assignments&key=${A_SUB}`]) {
      for (const token of ['A', 'ADMIN']) refused(await get(query, token), `${query} as ${token}`);
    }
    assert.deepEqual(storageReads, []);
    assert.deepEqual(dbReads, [], 'not even the database is read');
    assert.equal(consulted.mock.callCount(), 0, 'refused by the request check, before the resolver');
    consulted.mock.restore();
  });

  // ------------------------------------------------------------------------------- FIX-INS-08
  it('1. no credentials: 401 for every private file (unchanged route guard)', async () => {
    for (const key of [A_SUB, A_PROJECT]) assert.equal((await get(q(key))).status, 401);
    assert.deepEqual(storageReads, []);
  });

  it('2. learner A downloads A\'s own assignment and final-project files (header token or ?token= from <a href>)', async () => {
    for (const [key, viaQuery] of [[A_SUB, false], [A_SUB, true], [A_PROJECT, false], [A_PROJECT_PART, true]] as const) {
      const r = await get(q(key), 'A', viaQuery);
      assert.equal(r.status, 200, `${key} ${viaQuery}`);
      assert.equal(r.text, `content-of-${key}`);
    }
  });

  it('3/4/6. learner A cannot download B\'s assignment or final-project file by knowing (or swapping to) its key', async () => {
    for (const key of [B_SUB, B_PROJECT]) refused(await get(q(key), 'A'), key);
    for (const key of [A_SUB, A_PROJECT, A_PROJECT_PART]) refused(await get(q(key), 'B'), key);
    refused(await get(q(B_SUB, 'quiz-attachments'), 'B'), 'own key under the other bucket');
    assert.deepEqual(storageReads, []);
  });

  it('5. a userId / submissionId / assignmentId / courseId / role in the query grants nothing', async () => {
    const forged = `&userId=${USERS.B.userId}&submissionId=${id('12')}&assignmentId=${ASSIGNMENT}&courseId=${COURSE}&role=ADMIN&ownerId=${USERS.A.userId}`;
    refused(await get(q(B_SUB, 'assignments', forged), 'A'), 'forged ids');
    assert.equal((await get(q(A_SUB, 'assignments', forged), 'A')).status, 200, 'and they do not break a legitimate download either');
  });

  it('7. the course instructor (owner of the course containing the assignment\'s lesson) can read the submissions they grade', async () => {
    // FIX-INS-09 (deliberate change): authoring the assignment is no longer enough - Assignment.createdBy comes from the creator's
    // request without a course-ownership check; the grader is the course's owner (course-service) or an ADMIN
    for (const key of [A_SUB, B_SUB]) assert.equal((await get(q(key), 'TEACHER')).status, 200, `TEACHER ${key}`);
    for (const key of [A_SUB, B_SUB]) refused(await get(q(key), 'AUTHOR'), `AUTHOR (not the course owner) ${key}`);
    assert.equal((await get(q(A_PROJECT), 'PROJECT_AUTHOR')).status, 200, 'the final project\'s author reads its submissions');
  });

  it('8. an instructor outside that scope cannot - another instructor, an assignment grader for a final project, a project author for an assignment', async () => {
    for (const key of [A_SUB, B_SUB, A_PROJECT, B_PROJECT]) refused(await get(q(key), 'STRANGER'), `STRANGER ${key}`);
    for (const key of [A_PROJECT, B_PROJECT]) refused(await get(q(key), 'AUTHOR'), `AUTHOR (assignment) on project ${key}`);
    for (const key of [A_SUB, B_SUB]) refused(await get(q(key), 'PROJECT_AUTHOR'), `PROJECT_AUTHOR on assignment ${key}`);
  });

  it('9. ADMIN keeps access to every referenced submission file', async () => {
    for (const key of [A_SUB, B_SUB, A_PROJECT, A_PROJECT_PART, B_PROJECT, COPIED]) assert.equal((await get(q(key), 'ADMIN')).status, 200, key);
  });

  it('10/11. quiz-attachments: no record references it today, so nothing there is public - not to learners, not to instructors', async () => {
    for (const token of ['A', 'AUTHOR', 'TEACHER', 'ADMIN']) refused(await get(q(QUIZ, 'quiz-attachments'), token), `quiz as ${token}`);
    assert.deepEqual(storageReads, []);
  });

  it('11. a learner\'s file stays private when another record copies its key: the most restrictive reference wins', async () => {
    refused(await get(q(COPIED), 'B'), 'B cannot open A\'s file through his pasted reference');
    refused(await get(q(COPIED), 'A'), 'and A cannot open it through B\'s record either (safe side)');
    assert.equal((await get(q(COPIED), 'TEACHER')).status, 200, 'a grader of both submissions can');
  });

  it('12. a file no record references is refused, even for an ADMIN; a referenced file missing in storage is the same 404', async () => {
    for (const token of ['A', 'ADMIN']) refused(await get(q(ORPHAN), token), `orphan ${token}`);
    delete objects[`assignments/${A_SUB}`];
    refused(await get(q(A_SUB), 'A'), 'missing object');
  });

  it('exact references only: a key that is a substring / prefix of a referenced one is refused', async () => {
    objects[`assignments/${A_SUB.slice(0, -4)}`] = 'prefix-object';
    for (const key of [A_SUB.slice(0, -4), A_SUB.slice(1), `${A_SUB}x`]) refused(await get(q(key), 'A'), key);
  });

  it('errors and logs never carry the key, the bucket path or storage details', async () => {
    const r = await get(q(B_SUB), 'A');
    assert.ok(!r.text.includes(B_SUB) && !r.text.includes('assignments'));
    delete objects[`assignments/${A_SUB}`];
    await get(q(A_SUB), 'A');
    // the storage's own message names `<bucket>/<key>`: only its error code may reach the log
    assert.ok(!logs.some((l) => l.includes(B_SUB) || l.includes(A_SUB) || l.includes('assignments/')), logs.join('\n'));
  });
});
