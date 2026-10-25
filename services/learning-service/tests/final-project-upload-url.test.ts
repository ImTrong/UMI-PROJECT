/**
 * FIX-INS-13: POST /api/learning/final-project/:projectId/upload-url (:projectId = a FinalProject id) hands out a presigned upload
 * URL only to a learner who may submit to THAT final project right now - the same gates as the submit routes: the project
 * exists, its learning path is visible to the learner (FIX-INS-12: PUBLISHED, or ARCHIVED for a learner already enrolled; never
 * DRAFT) and unlocked for them (enrollment + course certificates), deadline not passed, not yet passed, attempts left.
 * The caller comes from authenticateToken; nothing in the request counts. Every refusal happens BEFORE storage is called.
 *
 * The REAL express app runs on an ephemeral port with the in-memory Prisma fake and a recording storage fake.
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
const writes: string[] = [];
const cond = (actual: any, v: any): boolean => {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
    if ('in' in v) return v.in.includes(actual);
    if ('gte' in v) return actual >= v.gte;
    return false;
  }
  return actual === v;
};
const match = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
  if (k === 'userId_learningPathId') return row.userId === v.userId && row.learningPathId === v.learningPathId;
  return cond(row[k], v);
});
const model = (table: string) => ({
  findUnique: async ({ where }: any) => { const r = tables[table].find((x) => match(x, where)); return r ? { ...r } : null; },
  findFirst: async ({ where }: any = {}) => { const r = tables[table].find((x) => match(x, where)); return r ? { ...r } : null; },
  findMany: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).map((r) => ({ ...r })),
  count: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).length,
  create: async () => { writes.push(`${table}.create`); return {}; },
  update: async () => { writes.push(`${table}.update`); return {}; },
});
Object.assign((FakePrismaClient as any).prototype, {
  learningPath: model('learningPath'), userPathEnrollment: model('userPathEnrollment'), finalProject: model('finalProject'),
  finalProjectSubmission: model('finalProjectSubmission'), certificate: model('certificate'),
});
installFakePrisma();

// ---------------------------------------------------------------- recording storage fake
const storageCalls: any[] = [];
class FakeFileStorageService {
  async getPresignedUploadUrl(opts: any) {
    storageCalls.push(opts);
    const ext = String(opts.fileName).split('.').pop();
    return { uploadUrl: `https://minio.test/assignments/upload-${storageCalls.length}`, fileKey: `1700000000000-key${storageCalls.length}.${ext}` };
  }
  async getPresignedDownloadUrl() { return 'https://minio.test/download'; }
  async ensureBucket() { /* */ }
  async uploadFile() { return {}; }
  async deleteFile() { /* */ }
}
const storagePath = require.resolve('@umi/file-storage');
require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: { FileStorageService: FakeFileStorageService, fileStorage: new FakeFileStorageService(), minioConfig: {} } } as any;

// ---------------------------------------------------------------- identities and data
const id = (c: string) => c.repeat(12);
const USERS: Record<string, { userId: string; role: string }> = {
  LEARNER: { userId: id('a1'), role: 'STUDENT' },     // enrolled + certified on PUB, ARCH, DRAFT
  OTHER: { userId: id('a2'), role: 'STUDENT' },       // enrolled nowhere
  UNCERT: { userId: id('a3'), role: 'STUDENT' },      // enrolled on PUB, course not certified
  INSTRUCTOR: { userId: id('b1'), role: 'INSTRUCTOR' },
  ADMIN: { userId: id('c1'), role: 'ADMIN' },
};
const C1 = id('d1');
const PUB = id('71');
const ARCH = id('72');
const DRAFT = id('73');
const FP_PUB = id('81');
const FP_ARCH = id('82');
const FP_DRAFT = id('83');
const MISSING = id('99');
const COURSE_LEARNING_TOKEN = randomBytes(32).toString('hex');

describe('FIX-INS-13: final-project upload URL only for a learner who may submit to that project', () => {
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
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins13-'));
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

  const lp = (pid: string, status: string) => ({ id: pid, title: `Path ${status}`, status, courseIds: [C1] });
  const enr = (u: string, pid: string) => ({ id: `${pid.slice(0, 20)}${USERS[u].userId.slice(0, 4)}`, userId: USERS[u].userId, learningPathId: pid, status: 'IN_PROGRESS' });
  const fp = (fid: string, pid: string, over: Row = {}) => ({ id: fid, learningPathId: pid, title: 'P', maxAttempts: 3, passingScore: 80, deadline: null, createdBy: USERS.ADMIN.userId, ...over });
  beforeEach(() => {
    storageCalls.length = 0;
    writes.length = 0;
    tables.learningPath = [lp(PUB, 'PUBLISHED'), lp(ARCH, 'ARCHIVED'), lp(DRAFT, 'DRAFT')];
    tables.userPathEnrollment = [enr('LEARNER', PUB), enr('LEARNER', ARCH), enr('LEARNER', DRAFT), enr('UNCERT', PUB)];
    tables.finalProject = [fp(FP_PUB, PUB), fp(FP_ARCH, ARCH), fp(FP_DRAFT, DRAFT)];
    tables.finalProjectSubmission = [];
    tables.certificate = [{ id: id('91'), userId: USERS.LEARNER.userId, courseId: C1, type: 'COURSE_COMPLETION' }];
  });

  const upload = async (projectId: string, token?: string, body: unknown = { fileName: 'report.pdf', contentType: 'application/pdf' }, q = '', headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}/api/learning/final-project/${projectId}/upload-url${q}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const noUrl = (r: { status: number; text: string }, status: number, label: string) => {
    assert.equal(r.status, status, label);
    assert.ok(!r.text.includes('uploadUrl') && !r.text.includes('minio.test'), `${label}: no URL`);
    assert.equal(storageCalls.length, 0, `${label}: storage not called`);
  };

  it('1. not signed in: 401, storage not called', async () => {
    noUrl(await upload(FP_PUB), 401, 'anonymous');
  });

  it('2. a learner not enrolled in the path gets nothing for that project (nor INSTRUCTOR / ADMIN without enrollment)', async () => {
    for (const t of ['OTHER', 'INSTRUCTOR', 'ADMIN']) noUrl(await upload(FP_PUB, t), 403, t);
  });

  it('3. forged userId / enrollment / role in body, query or headers grants nothing', async () => {
    const forged = { fileName: 'x.pdf', contentType: 'application/pdf', userId: USERS.LEARNER.userId, enrolled: true, unlocked: true, role: 'ADMIN', learningPathId: PUB };
    noUrl(await upload(FP_PUB, 'OTHER', forged, `?userId=${USERS.LEARNER.userId}&role=ADMIN`, { 'x-user-id': USERS.LEARNER.userId, 'x-internal-service': 'true' }), 403, 'forged');
  });

  it('4. ids: unknown project, a learning-path id instead of a project id, a malformed id -> 404', async () => {
    for (const pid of [MISSING, PUB, 'not-an-id']) noUrl(await upload(pid, 'LEARNER'), 404, pid);
  });

  it('5. FIX-INS-12 statuses: DRAFT never (even enrolled); ARCHIVED only for the learner already enrolled', async () => {
    noUrl(await upload(FP_DRAFT, 'LEARNER'), 404, 'draft, enrolled');
    noUrl(await upload(FP_ARCH, 'OTHER'), 404, 'archived, never enrolled');
    const ok = await upload(FP_ARCH, 'LEARNER');
    assert.equal(ok.status, 200, ok.text);
    assert.equal(storageCalls.length, 1);
  });

  it('6. enrolled but not unlocked (course not certified), deadline passed, already passed, attempts used up -> 403', async () => {
    noUrl(await upload(FP_PUB, 'UNCERT'), 403, 'not certified');
    tables.finalProject[0].deadline = new Date('2020-01-01');
    noUrl(await upload(FP_PUB, 'LEARNER'), 403, 'deadline');
    tables.finalProject[0].deadline = null;
    tables.finalProjectSubmission = [{ id: id('61'), finalProjectId: FP_PUB, userId: USERS.LEARNER.userId, status: 'GRADED', totalScore: 95 }];
    noUrl(await upload(FP_PUB, 'LEARNER'), 403, 'already passed');
    tables.finalProjectSubmission = [1, 2, 3].map((n) => ({ id: id(`6${n}`), finalProjectId: FP_PUB, userId: USERS.LEARNER.userId, status: 'GRADED', totalScore: 10 }));
    noUrl(await upload(FP_PUB, 'LEARNER'), 403, 'attempts used up');
    // another learner's attempts do not count against this one
    tables.finalProjectSubmission = [1, 2, 3].map((n) => ({ id: id(`6${n}`), finalProjectId: FP_PUB, userId: USERS.OTHER.userId, status: 'GRADED', totalScore: 10 }));
    assert.equal((await upload(FP_PUB, 'LEARNER')).status, 200);
  });

  it('7. the eligible learner still gets { uploadUrl, fileUrl, fileKey } (unchanged contract); nothing is written to the DB', async () => {
    const r = await upload(FP_PUB, 'LEARNER');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.json.data).sort(), ['fileKey', 'fileUrl', 'uploadUrl']);
    assert.equal(r.json.data.fileUrl, `/api/learning/files/download?bucket=assignments&key=${r.json.data.fileKey}`);
    assert.equal(storageCalls.length, 1);
    assert.equal(storageCalls[0].bucket, 'assignments');
    assert.equal(storageCalls[0].fileName, 'final-projects/report.pdf');
    assert.deepEqual(writes, []);
  });

  it('8. a malformed body is a 400 before anything else; storage not called', async () => {
    for (const body of [{}, { fileName: '', contentType: 'application/pdf' }, { fileName: 'a.pdf' }, { fileName: ['a.pdf'], contentType: 'x' }]) {
      noUrl(await upload(FP_PUB, 'LEARNER', body), 400, JSON.stringify(body));
    }
  });
});
