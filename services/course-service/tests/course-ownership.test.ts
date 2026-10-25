/**
 * FIX-INS-02 (AUDIT 01: S4, S5, S10 + course deletion): course ownership and mass assignment in the Course Service.
 *
 *   S4   POST/PUT /api/courses write ONLY content fields; instructorId comes from the token; published / approvalStatus /
 *        rating / enrolledCount / moderation fields cannot be set by an instructor. ADMIN moderation (/approve, /reject) works.
 *   S5   POST /api/courses/:courseId/lessons needs the caller to OWN the course (same rule as update / delete / reorder).
 *   S10  POST /api/courses/:courseId/upload-url needs the caller to own the course, checked before any storage call.
 *   DEL  DELETE /api/courses/:courseId is refused (409) while the course has learners (stored counter + learning service),
 *        and refused (503) when that cannot be verified. Nothing from the request is consulted.
 *
 * The REAL express app runs on an ephemeral port (real routing, validators, middleware, controllers and services). Replaced:
 *   - the database client: an in-memory stand-in that records every write;
 *   - the auth-service / user-service / learning-service: one local HTTP stub (identity, role from the user's profile,
 *     enrollment records per course - or an outage);
 *   - @umi/file-storage: a stand-in that counts storage clients and presigned URLs.
 * Every identity is synthetic. Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const id = (c: string) => c.repeat(24);
const OWNER = id('a');      // instructor who owns C1, C3, C4
const OTHER = id('b');      // instructor who owns C2
const STUDENT = id('c');
const ADMIN = id('d');
const C1 = id('1');         // OWNER, no learners, 2 lessons
const C2 = id('2');         // OTHER, no learners, 1 lesson
const C3 = id('3');         // OWNER, enrolledCount 3
const C4 = id('4');         // OWNER, enrolledCount 0 but the learning service knows 2 learners
const MISSING = id('9');
const L1 = id('5');
const L2 = id('6');
const L3 = id('7');         // belongs to C2
const SIGNATURE = 'X-Amz-Signature=do-not-log-this-signature';

// ---------------------------------------------------------------- in-memory Prisma stand-in
type Row = Record<string, any>;
let courses: Row[] = [];
let lessons: Row[] = [];
const writes: Array<{ model: string; op: string; where?: any; data?: any }> = [];
let idSeq = 0;
const newId = () => (++idSeq).toString(16).padStart(24, 'f');

const course = (cid: string, instructorId: string, over: Row = {}): Row => ({
  id: cid, title: `Course ${cid[0]}`, slug: `course-${cid[0]}`, description: 'A long enough description', instructorId, price: 100000,
  thumbnail: null, categoryId: null, level: 'BEGINNER', language: 'Vietnamese', whatYouWillLearn: null, requirements: [], targetAudience: [],
  published: false, approvalStatus: 'DRAFT', rejectionReason: null, approvedAt: null, approvedBy: null, rating: 0, totalReviews: 0,
  enrolledCount: 0, certificateConfig: null, createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01'), ...over,
});
const lesson = (lid: string, courseId: string, order: number): Row => ({
  id: lid, courseId, title: `Lesson ${lid[0]}`, description: null, videoUrl: 'https://cdn.umi.test/v.mp4', duration: 60, order,
  isPreview: false, resources: [], createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01'),
});
const seed = () => {
  courses = [course(C1, OWNER), course(C2, OTHER), course(C3, OWNER, { enrolledCount: 3, published: true, approvalStatus: 'APPROVED' }), course(C4, OWNER)];
  lessons = [lesson(L1, C1, 0), lesson(L2, C1, 1), lesson(L3, C2, 0)];
};

const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
  if (k === 'courseId_order') return row.courseId === v.courseId && row.order === v.order;
  if (v && typeof v === 'object' && !(v instanceof Date) && 'in' in v) return (v.in as any[]).includes(row[k]);
  if (v && typeof v === 'object' && !(v instanceof Date) && 'notIn' in v) return !(v.notIn as any[]).includes(row[k]);
  if (v && typeof v === 'object' && !(v instanceof Date) && 'contains' in v) return typeof row[k] === 'string' && row[k].includes(v.contains);
  return row[k] === v;
});
const withIncludes = (row: Row, args: any = {}) => {
  const out: Row = { ...row };
  if (args.include?.lessons) out.lessons = lessons.filter((l) => l.courseId === row.id).sort((a, b) => a.order - b.order);
  if (args.include?.category) out.category = null;
  if (args.include?.reviews) out.reviews = [];
  if (args.include?._count) out._count = { lessons: lessons.filter((l) => l.courseId === row.id).length, reviews: 0 };
  return out;
};
const sortBy = (rows: Row[], orderBy: any) => {
  if (!orderBy) return rows;
  const [[key, dir]] = Object.entries(orderBy) as [string, string][];
  return [...rows].sort((a, b) => (a[key] > b[key] ? 1 : -1) * (dir === 'desc' ? -1 : 1));
};
const reads: string[] = [];   // every read of the database (FIX-INS-06: a refused internal call must read nothing)
let lastFindManyArgs: any = null;
const model = (name: 'course' | 'lesson') => {
  const store = () => (name === 'course' ? courses : lessons);
  return {
    findUnique: async (args: any) => { reads.push(`${name}.findUnique`); const r = store().find((x) => matches(x, args.where)); return r ? withIncludes(r, args) : null; },
    findFirst: async (args: any) => { reads.push(`${name}.findFirst`); const r = sortBy(store().filter((x) => matches(x, args.where)), args.orderBy)[0]; return r ? withIncludes(r, args) : null; },
    findMany: async (args: any = {}) => {
      reads.push(`${name}.findMany`);
      lastFindManyArgs = args;
      const rows = sortBy(store().filter((x) => matches(x, args.where)), args.orderBy).map((r) => withIncludes(r, args));
      return args.take ? rows.slice(0, args.take) : rows;
    },
    count: async (args: any = {}) => store().filter((x) => matches(x, args.where)).length,
    // MongoDB raw find, as the real client answers it (extended JSON ids); only the resources regex filter is supported
    findRaw: async (args: any) => {
      reads.push(`${name}.findRaw`);
      const ors: any[] = args.filter?.$or || [];
      const res = store().filter((row) => ors.some((cond) => Object.entries(cond).some(([path, c]: [string, any]) => {
        const field = path.split('.')[1];
        return Array.isArray(row.resources) && row.resources.some((r: Row) => typeof r?.[field] === 'string' && new RegExp(c.$regex).test(r[field]));
      })));
      return res.map((r) => ({ _id: { $oid: r.id }, courseId: { $oid: r.courseId }, isPreview: r.isPreview, resources: r.resources }));
    },
    create: async (args: any) => {
      writes.push({ model: name, op: 'create', data: { ...args.data } });
      const row = name === 'course' ? course(newId(), args.data.instructorId, args.data) : { ...lesson(newId(), args.data.courseId, args.data.order), ...args.data };
      store().push(row);
      return withIncludes(row, args);
    },
    update: async (args: any) => {
      const r = store().find((x) => matches(x, args.where));
      if (!r) throw new Error('Record to update not found');
      writes.push({ model: name, op: 'update', where: args.where, data: { ...args.data } });
      for (const [k, v] of Object.entries(args.data)) r[k] = v && typeof v === 'object' && 'increment' in (v as any) ? r[k] + (v as any).increment : v;
      return withIncludes(r, args);
    },
    delete: async (args: any) => {
      writes.push({ model: name, op: 'delete', where: args.where });
      const i = store().findIndex((x) => matches(x, args.where));
      const [r] = store().splice(i, 1);
      if (name === 'course') lessons = lessons.filter((l) => l.courseId !== r.id); // onDelete: Cascade
      return r;
    },
  };
};
class FakePrismaClient {
  course = model('course');
  lesson = model('lesson');
  review = {
    aggregate: async () => ({ _avg: { rating: 0 }, _count: 0 }),
    findUnique: async () => null,
    create: async (args: any) => { writes.push({ model: 'review', op: 'create', data: { ...args.data } }); return { id: newId(), ...args.data }; },
  };
  async $disconnect() { /* nothing */ }
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient, Level: { BEGINNER: 'BEGINNER', INTERMEDIATE: 'INTERMEDIATE', ADVANCED: 'ADVANCED' } },
} as any;

// ---------------------------------------------------------------- @umi/file-storage stand-in
let storageClients = 0;
let presigned: any[] = [];
const storageObjects: Record<string, string> = {};   // `${bucket}/${key}` -> content
const storageReads: string[] = [];
class FakeFileStorageService {
  constructor() { storageClients++; }
  async getFileStream(bucket: string, key: string) {
    storageReads.push(`${bucket}/${key}`);
    const content = storageObjects[`${bucket}/${key}`];
    if (content === undefined) throw Object.assign(new Error(`The specified key does not exist: ${bucket}/${key}`), { code: 'NoSuchKey' });
    return require('node:stream').Readable.from([Buffer.from(content)]);
  }
  async getPresignedUploadUrl(opts: any) {
    presigned.push(opts);
    return { uploadUrl: `http://minio.umi.test/courses/k1?${SIGNATURE}`, fileKey: 'k1' };
  }
}
const storagePath = require.resolve('@umi/file-storage');
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: { FileStorageService: FakeFileStorageService, fileStorage: new (class { async getPresignedUploadUrl() { return {}; } })(), minioConfig: {} },
} as any;

// ---------------------------------------------------------------- auth / user / learning stub
const tokens: Record<string, { userId: string; email: string; role: string }> = {
  OWNER: { userId: OWNER, email: 'owner@umi.test', role: 'INSTRUCTOR' },
  OTHER: { userId: OTHER, email: 'other@umi.test', role: 'INSTRUCTOR' },
  STUDENT: { userId: STUDENT, email: 'student@umi.test', role: 'STUDENT' },
  ADMIN: { userId: ADMIN, email: 'admin@umi.test', role: 'ADMIN' },
};
let learningMode: 'ok' | 'down' | 'garbage' = 'ok';
let learnersByCourse: Record<string, number> = {};
let learningCalls: string[] = [];
// FIX-INS-03: the learning stub behaves like the real routes - only COURSE_LEARNING_TOKEN in X-Internal-Service-Token passes
const COURSE_LEARNING_TOKEN = randomBytes(32).toString('hex');
const ORDER_COURSE_TOKEN = randomBytes(32).toString('hex');
let learningRefused = 0;
const enrolledIn: Record<string, string[]> = {};   // courseId -> learner ids known to the learning stub (detail route)

describe('FIX-INS-02: course ownership, mass assignment, upload authorization and course deletion', () => {
  let server: http.Server;
  let stub: http.Server;
  let base = '';
  const logs: string[] = [];

  before(async () => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const url = req.url || '';
        if (url === '/api/auth/verify-token') {
          let token = '';
          try { token = JSON.parse(raw).token; } catch { /* ignore */ }
          const u = tokens[token];
          return res.end(JSON.stringify(u ? { valid: true, user: { userId: u.userId, email: u.email } } : { valid: false }));
        }
        const user = url.match(/^\/api\/users\/([0-9a-f]{24})$/);
        if (user) {
          const u = Object.values(tokens).find((t) => t.userId === user[1]);
          return res.end(JSON.stringify({ data: { userId: user[1], role: u?.role || 'STUDENT' } }));
        }
        // a learner's own enrollment (course-service forwards the USER's token): GET /api/learning/progress/course/:courseId
        const own = url.match(/^\/api\/learning\/progress\/course\/([0-9a-f]{24})$/);
        if (own) {
          learningCalls.push(`own:${own[1]}`);
          const user = Object.values(tokens).find((t) => req.headers.authorization === `Bearer ${Object.keys(tokens).find((k) => tokens[k] === t)}`);
          if (user && (enrolledIn[own[1]] || []).includes(user.userId)) return res.end(JSON.stringify({ data: { userId: user.userId, courseId: own[1] } }));
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Progress not found' }));
        }
        if (url.startsWith('/api/learning/progress/course/') && req.headers['x-internal-service-token'] !== COURSE_LEARNING_TOKEN) {
          learningRefused++;
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: 'Forbidden: Invalid internal service token' }));
        }
        const detail = url.match(/^\/api\/learning\/progress\/course\/([0-9a-f]{24})\/students\/([0-9a-f]{24})$/);
        if (detail) {
          learningCalls.push(`${detail[1]}/${detail[2]}`);
          if (!(enrolledIn[detail[1]] || []).includes(detail[2])) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'Progress not found' })); }
          return res.end(JSON.stringify({ data: { userId: detail[2], courseId: detail[1], progressPercentage: 40, completedLessons: 1, totalLessons: 2, lessons: [] } }));
        }
        if (url === '/api/users/batch') return res.end(JSON.stringify({ data: [] }));
        const students = url.match(/^\/api\/learning\/progress\/course\/([0-9a-f]{24})\/students$/);
        if (students) {
          learningCalls.push(students[1]);
          if (learningMode === 'down') { res.statusCode = 503; return res.end(JSON.stringify({ error: 'down' })); }
          if (learningMode === 'garbage') return res.end(JSON.stringify({ data: { not: 'a list' } }));
          const n = learnersByCourse[students[1]] || 0;
          return res.end(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ userId: id(String(i)), courseId: students[1] })) }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    process.env.AUTH_SERVICE_URL = stubUrl;
    process.env.USER_SERVICE_URL = stubUrl;
    process.env.LEARNING_SERVICE_URL = stubUrl;
    process.env.RATE_LIMIT_MAX_REQUESTS = '100000';
    process.env.COURSE_LEARNING_TOKEN = COURSE_LEARNING_TOKEN;
    process.env.ORDER_COURSE_TOKEN = ORDER_COURSE_TOKEN;

    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        return original(...args);
      };
    }
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => stub.close(resolve));
  });

  beforeEach(() => {
    seed();
    writes.length = 0;
    storageClients = 0;
    presigned = [];
    learningMode = 'ok';
    learnersByCourse = { [C4]: 2 };
    learningCalls = [];
    learningRefused = 0;
    for (const k of Object.keys(enrolledIn)) delete enrolledIn[k];
    reads.length = 0;
    lastFindManyArgs = null;
    process.env.COURSE_LEARNING_TOKEN = COURSE_LEARNING_TOKEN;
    process.env.ORDER_COURSE_TOKEN = ORDER_COURSE_TOKEN;
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
  const courseRow = (cid: string) => courses.find((c) => c.id === cid);
  const noWrites = (label: string) => assert.deepEqual(writes, [], `${label}: nothing may be written`);
  // exactly what CreateCourse.tsx sends (CourseForm with requirements / targetAudience; thumbnail goes through upload + update)
  const validCreate = () => ({
    title: 'Node.js from scratch', description: 'A long enough course description', price: 199000, level: 'BEGINNER',
    whatYouWillLearn: 'Everything', requirements: ['A laptop'], targetAudience: ['Beginners'],
  });
  const MODERATION_FIELDS = ['id', 'slug', 'instructorId', 'published', 'approvalStatus', 'rejectionReason', 'approvedAt', 'approvedBy', 'rating', 'totalReviews', 'enrolledCount', 'createdAt', 'updatedAt'];

  // =========================================================================================== S4: create
  describe('S4 - POST /api/courses (create)', () => {
    it('an instructor sending approvalStatus APPROVED: 400, nothing created', async () => {
      const res = await call('POST', '/api/courses', 'OWNER', { ...validCreate(), approvalStatus: 'APPROVED' });
      assert.equal(res.status, 400);
      assert.deepEqual(res.json.fields, ['approvalStatus']);
      assert.match(res.json.error, /approvalStatus/);
      noWrites('approvalStatus');
    });

    it('an instructor sending published: true: 400, nothing created', async () => {
      const res = await call('POST', '/api/courses', 'OWNER', { ...validCreate(), published: true });
      assert.equal(res.status, 400);
      noWrites('published');
    });

    it('an instructor forging the instructorId of someone else: 400, nothing created', async () => {
      const res = await call('POST', '/api/courses', 'OWNER', { ...validCreate(), instructorId: OTHER });
      assert.equal(res.status, 400);
      noWrites('instructorId');
      assert.equal(courses.filter((c) => c.instructorId === OTHER).length, 1, 'OTHER still owns exactly C2');
    });

    it('rating, enrolledCount and every other moderation / statistics / identity field is refused one by one', async () => {
      const extras: Array<[string, unknown]> = [
        ['rating', 5], ['totalReviews', 1000], ['enrolledCount', 999], ['rejectionReason', 'x'], ['approvedAt', '2024-01-01'],
        ['approvedBy', ADMIN], ['slug', 'nice-slug'], ['id', id('8')], ['createdAt', '2020-01-01'], ['updatedAt', '2020-01-01'],
        ['lessons', [{ title: 'x' }]], ['reviews', []], ['category', { connect: { id: id('8') } }], ['ownerId', OTHER], ['userId', OTHER],
      ];
      for (const [k, v] of extras) {
        const res = await call('POST', '/api/courses', 'OWNER', { ...validCreate(), [k]: v });
        assert.equal(res.status, 400, k);
      }
      noWrites('moderation fields');
    });

    it('__proto__ / a body that is not an object are refused', async () => {
      for (const raw of ['{"title":"Node.js from scratch","__proto__":{"published":true}}', '[1]', '"x"']) {
        assert.equal((await call('POST', '/api/courses', 'OWNER', undefined, raw)).status, 400, raw);
      }
      noWrites('odd bodies');
    });

    it('wrongly typed content is refused (arrays for strings, string lists of objects, a 5 KB certificateConfig)', async () => {
      for (const over of [{ title: ['a', 'b'] }, { price: [1] }, { price: 'abc' }, { level: ['BEGINNER'] }, { requirements: 'x' },
        { requirements: [{ a: 1 }] }, { thumbnail: ['x'] }, { certificateConfig: { big: 'z'.repeat(5000) } }, { certificateConfig: 'x' }]) {
        const res = await call('POST', '/api/courses', 'OWNER', { ...validCreate(), ...over });
        assert.equal(res.status, 400, JSON.stringify(over).slice(0, 60));
      }
      noWrites('bad types');
    });

    it('the valid payload of the create page works: owner = caller, DRAFT, unpublished, zero statistics', async () => {
      const res = await call('POST', '/api/courses', 'OWNER', validCreate());
      assert.equal(res.status, 201);
      const created = writes.find((w) => w.model === 'course' && w.op === 'create')!;
      assert.equal(created.data.instructorId, OWNER);
      for (const k of MODERATION_FIELDS.filter((f) => f !== 'instructorId' && f !== 'slug')) assert.ok(!(k in created.data), `${k} not written`);
      assert.equal(res.json.data.instructorId, OWNER);
      assert.equal(res.json.data.published, false);
      assert.equal(res.json.data.approvalStatus, 'DRAFT');
      assert.equal(res.json.data.rating, 0);
      assert.equal(res.json.data.enrolledCount, 0);
    });

    it('optional content fields (language, certificateConfig, categoryId) are still accepted', async () => {
      const res = await call('POST', '/api/courses', 'OWNER', { ...validCreate(), language: 'English', categoryId: id('8'), certificateConfig: { title: 'Certificate' } });
      assert.equal(res.status, 201);
    });

    it('a STUDENT cannot create a course (403); no token: 401', async () => {
      assert.equal((await call('POST', '/api/courses', 'STUDENT', validCreate())).status, 403);
      assert.equal((await call('POST', '/api/courses', undefined, validCreate())).status, 401);
      noWrites('student / anonymous');
    });

    it('defense in depth: CourseService.createCourse itself drops published / approvalStatus / rating / enrolledCount', async () => {
      const { CourseService } = require('../src/services/course.service');
      await CourseService.createCourse({ ...validCreate(), instructorId: OWNER, published: true, approvalStatus: 'APPROVED', rating: 5, enrolledCount: 999, approvedBy: ADMIN } as any);
      const created = writes.find((w) => w.op === 'create')!;
      for (const k of ['published', 'approvalStatus', 'rating', 'enrolledCount', 'approvedBy']) assert.ok(!(k in created.data), k);
      assert.equal(created.data.instructorId, OWNER);
    });
  });

  // =========================================================================================== S4: update
  describe('S4 - PUT /api/courses/:courseId (update)', () => {
    // exactly what EditCourse.tsx sends (CourseForm initialData + thumbnail); categoryId comes back as null when unset
    const editPayload = () => ({
      title: 'Course 1 renamed', description: 'A long enough description', price: 150000, level: 'INTERMEDIATE', categoryId: null,
      whatYouWillLearn: 'Things', requirements: ['x'], targetAudience: ['y'], thumbnail: '/api/courses/files/download?bucket=courses&key=k1',
    });

    it('the owner updates with the payload of the edit page: 200, only content fields (+ the new slug) are written', async () => {
      const res = await call('PUT', `/api/courses/${C1}`, 'OWNER', editPayload());
      assert.equal(res.status, 200);
      const w = writes.find((x) => x.op === 'update')!;
      assert.deepEqual(w.where, { id: C1 });
      assert.deepEqual(Object.keys(w.data).sort(), [...Object.keys(editPayload()), 'slug'].sort());
      assert.equal(courseRow(C1)!.title, 'Course 1 renamed');
      assert.equal(courseRow(C1)!.published, false);
      assert.equal(courseRow(C1)!.approvalStatus, 'DRAFT');
    });

    it('the thumbnail-only update sent after an upload works', async () => {
      const res = await call('PUT', `/api/courses/${C1}`, 'OWNER', { thumbnail: '/api/courses/files/download?bucket=courses&key=k2' });
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(writes[0].data), ['thumbnail']);
    });

    it('the owner sending published / approvalStatus / rating / enrolledCount / instructorId: 400, nothing written', async () => {
      for (const over of [{ published: true }, { approvalStatus: 'APPROVED' }, { rating: 5 }, { enrolledCount: 0 }, { instructorId: OTHER }, { approvedBy: OWNER }, { rejectionReason: null }]) {
        const res = await call('PUT', `/api/courses/${C1}`, 'OWNER', { title: 'Course 1 renamed', ...over });
        assert.equal(res.status, 400, JSON.stringify(over));
      }
      noWrites('owner moderation fields');
      assert.equal(courseRow(C1)!.title, 'Course 1');
    });

    it('another instructor cannot update the course (403), even with a valid body', async () => {
      const res = await call('PUT', `/api/courses/${C1}`, 'OTHER', { title: 'Hijacked title' });
      assert.equal(res.status, 403);
      noWrites('other instructor');
    });

    it('an ADMIN does not edit an instructor\'s content through this route (existing rule: owner only, 403)', async () => {
      assert.equal((await call('PUT', `/api/courses/${C1}`, 'ADMIN', { title: 'Admin title' })).status, 403);
      noWrites('admin edit');
    });

    it('a published course stays published / approved after a content update (the update cannot touch moderation)', async () => {
      const res = await call('PUT', `/api/courses/${C3}`, 'OWNER', { price: 1 });
      assert.equal(res.status, 200);
      assert.equal(courseRow(C3)!.approvalStatus, 'APPROVED');
      assert.deepEqual(Object.keys(writes[0].data), ['price']);
    });

    it('defense in depth: CourseService.updateCourse itself drops published / approvalStatus / enrolledCount', async () => {
      const { CourseService } = require('../src/services/course.service');
      await CourseService.updateCourse(C1, OWNER, { price: 2, published: true, approvalStatus: 'APPROVED', enrolledCount: 9 } as any);
      assert.deepEqual(Object.keys(writes[0].data), ['price']);
      assert.equal(courseRow(C1)!.published, false);
    });
  });

  // =========================================================================================== moderation still works
  describe('ADMIN moderation and the publish flow are unchanged', () => {
    it('owner submits for review -> PENDING_REVIEW; ADMIN approves -> APPROVED + published; an instructor cannot approve', async () => {
      assert.equal((await call('POST', `/api/courses/${C1}/publish`, 'OWNER')).status, 200);
      assert.equal(courseRow(C1)!.approvalStatus, 'PENDING_REVIEW');
      assert.equal((await call('POST', `/api/courses/${C1}/approve`, 'OWNER')).status, 403);
      assert.equal((await call('POST', `/api/courses/${C1}/approve`, 'OTHER')).status, 403);
      const ok = await call('POST', `/api/courses/${C1}/approve`, 'ADMIN');
      assert.equal(ok.status, 200);
      assert.equal(courseRow(C1)!.approvalStatus, 'APPROVED');
      assert.equal(courseRow(C1)!.published, true);
      assert.equal(courseRow(C1)!.approvedBy, ADMIN);
    });

    it('ADMIN rejects with a reason; the owner can unpublish an approved course', async () => {
      await call('POST', `/api/courses/${C1}/publish`, 'OWNER');
      const rej = await call('POST', `/api/courses/${C1}/reject`, 'ADMIN', { reason: 'Needs work' });
      assert.equal(rej.status, 200);
      assert.equal(courseRow(C1)!.approvalStatus, 'REJECTED');
      assert.equal(courseRow(C1)!.rejectionReason, 'Needs work');
      const unpub = await call('POST', `/api/courses/${C3}/publish`, 'OWNER');
      assert.equal(unpub.status, 200);
      assert.equal(courseRow(C3)!.published, false);
    });
  });

  // =========================================================================================== S5: lessons
  describe('S5 - lessons: only the course owner writes them', () => {
    const validLesson = () => ({ title: 'Intro lesson', description: 'd', videoUrl: '/api/courses/files/download?bucket=courses&key=v1', duration: 120, isPreview: false, order: 3 });

    it('the owner creates a lesson in their course: 201, stored in that course with content fields only', async () => {
      const res = await call('POST', `/api/courses/${C1}/lessons`, 'OWNER', validLesson());
      assert.equal(res.status, 201);
      const w = writes.find((x) => x.model === 'lesson' && x.op === 'create')!;
      assert.equal(w.data.courseId, C1);
      assert.deepEqual(Object.keys(w.data).sort(), ['courseId', 'description', 'duration', 'isPreview', 'order', 'title', 'videoUrl']);
    });

    it('the owner can omit the order: it is appended after the last lesson', async () => {
      const { order, ...noOrder } = validLesson();
      const res = await call('POST', `/api/courses/${C1}/lessons`, 'OWNER', noOrder);
      assert.equal(res.status, 201);
      assert.equal(res.json.data.order, 2);
    });

    it('another instructor cannot create a lesson in that course: 403, nothing created', async () => {
      const before = lessons.length;
      const res = await call('POST', `/api/courses/${C1}/lessons`, 'OTHER', validLesson());
      assert.equal(res.status, 403);
      noWrites('foreign lesson');
      assert.equal(lessons.length, before);
    });

    it('forged owner ids / another courseId in the body are refused (400) - for the owner and for another instructor', async () => {
      for (const [token, over] of [['OTHER', { instructorId: OWNER }], ['OTHER', { ownerId: OWNER }], ['OTHER', { userId: OWNER }], ['OWNER', { courseId: C2 }], ['OTHER', { role: 'ADMIN' }], ['OWNER', { id: id('8') }]] as const) {
        const res = await call('POST', `/api/courses/${C1}/lessons`, token, { ...validLesson(), ...over });
        assert.equal(res.status, 400, `${token} ${JSON.stringify(over)}`);
      }
      noWrites('forged owner');
    });

    it('defense in depth: LessonService.createLesson ignores a body instructorId and checks the CALLER', async () => {
      const { LessonService } = require('../src/services/lesson.service');
      await assert.rejects(() => LessonService.createLesson(OTHER, { ...validLesson(), courseId: C1, instructorId: OWNER } as any), /permission/);
      noWrites('service-level forged owner');
      await LessonService.createLesson(OWNER, { ...validLesson(), courseId: C1, instructorId: OTHER, id: id('8') } as any);
      assert.ok(!('instructorId' in writes[0].data) && !('id' in writes[0].data));
    });

    it('unknown course: 404; malformed course id: 400; no token: 401; a STUDENT: 403; an ADMIN: 403 (owner-only rule)', async () => {
      assert.equal((await call('POST', `/api/courses/${MISSING}/lessons`, 'OWNER', validLesson())).status, 404);
      assert.equal((await call('POST', '/api/courses/nope/lessons', 'OWNER', validLesson())).status, 400);
      assert.equal((await call('POST', `/api/courses/${C1}/lessons`, undefined, validLesson())).status, 401);
      assert.equal((await call('POST', `/api/courses/${C1}/lessons`, 'STUDENT', validLesson())).status, 403);
      assert.equal((await call('POST', `/api/courses/${C1}/lessons`, 'ADMIN', validLesson())).status, 403);
      noWrites('refused lesson creations');
    });

    it('update: the owner updates a lesson (content only); the body cannot move it to another course; another instructor gets 403', async () => {
      const body = { title: 'Lesson renamed', description: 'x', videoUrl: '/v2', duration: 30, isPreview: true };
      const ok = await call('PUT', `/api/courses/${C1}/lessons/${L1}`, 'OWNER', body);
      assert.equal(ok.status, 200);
      assert.deepEqual(Object.keys(writes[0].data).sort(), Object.keys(body).sort());
      writes.length = 0;
      assert.equal((await call('PUT', `/api/courses/${C1}/lessons/${L1}`, 'OWNER', { ...body, courseId: C2 })).status, 400);
      assert.equal((await call('PUT', `/api/courses/${C1}/lessons/${L1}`, 'OTHER', body)).status, 403);
      noWrites('refused lesson updates');
      assert.equal(lessons.find((l) => l.id === L1)!.courseId, C1);
    });

    it('defense in depth: LessonService.updateLesson drops courseId / id', async () => {
      const { LessonService } = require('../src/services/lesson.service');
      await LessonService.updateLesson(L1, C1, OWNER, { title: 'T2', courseId: C2, id: id('8') } as any);
      assert.deepEqual(Object.keys(writes[0].data), ['title']);
      assert.equal(lessons.find((l) => l.id === L1)!.courseId, C1);
    });

    it('delete: another instructor 403; the owner deletes and the remaining lessons are renumbered', async () => {
      assert.equal((await call('DELETE', `/api/courses/${C1}/lessons/${L1}`, 'OTHER')).status, 403);
      noWrites('foreign delete');
      assert.equal((await call('DELETE', `/api/courses/${C1}/lessons/${L1}`, 'OWNER')).status, 200);
      assert.deepEqual(lessons.filter((l) => l.courseId === C1).map((l) => [l.id, l.order]), [[L2, 0]]);
    });

    it('reorder: the owner reorders their lessons; another instructor 403; a lesson of ANOTHER course in the list: 400, nothing updated', async () => {
      const ok = await call('POST', `/api/courses/${C1}/lessons/reorder`, 'OWNER', { lessonOrders: [{ id: L1, order: 2 }, { id: L2, order: 1 }] });
      assert.equal(ok.status, 200);
      assert.equal(lessons.find((l) => l.id === L1)!.order, 2);
      writes.length = 0;
      assert.equal((await call('POST', `/api/courses/${C1}/lessons/reorder`, 'OTHER', { lessonOrders: [{ id: L1, order: 5 }] })).status, 403);
      const foreign = await call('POST', `/api/courses/${C1}/lessons/reorder`, 'OWNER', { lessonOrders: [{ id: L1, order: 0 }, { id: L3, order: 9 }] });
      assert.equal(foreign.status, 400);
      assert.equal(lessons.find((l) => l.id === L3)!.order, 0, 'the other course\'s lesson is untouched');
      for (const bad of [{ lessonOrders: 'x' }, { lessonOrders: [] }, { lessonOrders: [{ id: 'x', order: 1 }] }, { lessonOrders: [{ id: L1, order: -1 }] }, { lessonOrders: [{ id: L1, order: 1, courseId: C2 }] }, { lessonOrders: [{ id: L1, order: 1 }, { id: L1, order: 2 }] }]) {
        assert.equal((await call('POST', `/api/courses/${C1}/lessons/reorder`, 'OWNER', bad)).status, 400, JSON.stringify(bad));
      }
      noWrites('refused reorders');
    });
  });

  // =========================================================================================== S10: upload URL
  describe('S10 - POST /api/courses/:courseId/upload-url', () => {
    const body = { fileName: 'cover.png', contentType: 'image/png' };

    it('the owner gets an upload URL and the download path of the file (unchanged contract)', async () => {
      const res = await call('POST', `/api/courses/${C1}/upload-url`, 'OWNER', body);
      assert.equal(res.status, 200);
      assert.ok(res.json.data.uploadUrl.includes('X-Amz-Signature'));
      assert.equal(res.json.data.fileUrl, '/api/courses/files/download?bucket=courses&key=k1');
      assert.equal(presigned.length, 1);
      assert.deepEqual(presigned[0], { bucket: 'courses', fileName: 'cover.png', mimeType: 'image/png' });
    });

    it('another instructor: 403 and the storage is never touched (no client, no presigned URL)', async () => {
      const res = await call('POST', `/api/courses/${C1}/upload-url`, 'OTHER', body);
      assert.equal(res.status, 403);
      assert.equal(storageClients, 0);
      assert.equal(presigned.length, 0);
      assert.ok(!res.text.includes('X-Amz'));
    });

    it('no token (401), unknown course (404), malformed id (400), STUDENT (403), ADMIN (403, owner-only rule): no storage side effect', async () => {
      assert.equal((await call('POST', `/api/courses/${C1}/upload-url`, undefined, body)).status, 401);
      assert.equal((await call('POST', `/api/courses/${MISSING}/upload-url`, 'OWNER', body)).status, 404);
      assert.equal((await call('POST', '/api/courses/nope/upload-url', 'OWNER', body)).status, 400);
      assert.equal((await call('POST', `/api/courses/${C1}/upload-url`, 'STUDENT', body)).status, 403);
      assert.equal((await call('POST', `/api/courses/${C1}/upload-url`, 'ADMIN', body)).status, 403);
      assert.equal(storageClients, 0);
      assert.equal(presigned.length, 0);
    });

    it('missing / wrongly typed file info or extra fields: 400, no storage side effect', async () => {
      for (const b of [{}, { fileName: 'a.png' }, { contentType: 'image/png' }, { fileName: ['a.png'], contentType: 'image/png' }, { ...body, bucket: 'avatars' }, { ...body, courseId: C2 }]) {
        assert.equal((await call('POST', `/api/courses/${C1}/upload-url`, 'OWNER', b)).status, 400, JSON.stringify(b));
      }
      assert.equal(storageClients, 0);
      assert.equal(presigned.length, 0);
    });

    it('the signed URL never reaches the logs', async () => {
      await call('POST', `/api/courses/${C1}/upload-url`, 'OWNER', body);
      await call('POST', `/api/courses/${C1}/upload-url`, 'OTHER', body);
      assert.ok(!logs.some((l) => l.includes('do-not-log-this-signature')));
    });
  });

  // =========================================================================================== deletion
  describe('DELETE /api/courses/:courseId while the course has learners', () => {
    it('a course without learners is deleted by its owner (unchanged); the learning service was asked', async () => {
      const res = await call('DELETE', `/api/courses/${C1}`, 'OWNER');
      assert.equal(res.status, 200);
      assert.equal(courseRow(C1), undefined);
      assert.deepEqual(learningCalls, [C1]);
    });

    it('a course with enrolledCount > 0: 409 COURSE_HAS_LEARNERS, nothing deleted (lessons kept)', async () => {
      lessons.push(lesson(id('e'), C3, 0));
      const res = await call('DELETE', `/api/courses/${C3}`, 'OWNER');
      assert.equal(res.status, 409);
      assert.equal(res.json.code, 'COURSE_HAS_LEARNERS');
      assert.equal(res.json.learners, 3);
      assert.match(res.json.error, /học viên/);
      assert.ok(courseRow(C3));
      assert.equal(lessons.filter((l) => l.courseId === C3).length, 1);
      noWrites('delete with learners');
    });

    it('enrolledCount 0 but the learning service has enrollment records: 409, nothing deleted', async () => {
      const res = await call('DELETE', `/api/courses/${C4}`, 'OWNER');
      assert.equal(res.status, 409);
      assert.equal(res.json.learners, 2);
      assert.ok(courseRow(C4));
      noWrites('learning-service learners');
    });

    it('a forged learner count in the body or query is ignored: still 409', async () => {
      const res = await call('DELETE', `/api/courses/${C3}?enrolledCount=0&learners=0&force=true`, 'OWNER', { enrolledCount: 0, learners: 0, force: true });
      assert.equal(res.status, 409);
      assert.ok(courseRow(C3));
      noWrites('forged count');
    });

    it('when the learners cannot be verified (learning service down / unexpected answer): 503, nothing deleted', async () => {
      for (const mode of ['down', 'garbage'] as const) {
        learningMode = mode;
        const res = await call('DELETE', `/api/courses/${C1}`, 'OWNER');
        assert.equal(res.status, 503, mode);
        assert.equal(res.json.code, 'ENROLLMENT_CHECK_UNAVAILABLE');
        assert.ok(courseRow(C1));
      }
      noWrites('unverifiable');
    });

    it('ADMIN: deletes another instructor\'s course without learners (unchanged), but not one with learners (409)', async () => {
      assert.equal((await call('DELETE', `/api/courses/${C3}`, 'ADMIN')).status, 409);
      assert.ok(courseRow(C3));
      const ok = await call('DELETE', `/api/courses/${C2}`, 'ADMIN');
      assert.equal(ok.status, 200);
      assert.equal(courseRow(C2), undefined);
    });

    it('another instructor: 403 before any learner lookup (no information leak); unknown course: 404; STUDENT: 403', async () => {
      assert.equal((await call('DELETE', `/api/courses/${C1}`, 'OTHER')).status, 403);
      assert.equal((await call('DELETE', `/api/courses/${C3}`, 'OTHER')).status, 403);
      assert.deepEqual(learningCalls, []);
      assert.equal((await call('DELETE', `/api/courses/${MISSING}`, 'OWNER')).status, 404);
      assert.equal((await call('DELETE', `/api/courses/${C1}`, 'STUDENT')).status, 403);
      noWrites('refused deletes');
    });
  });

  // =========================================================================================== FIX-INS-03: course -> learning
  describe('FIX-INS-03 - every course -> learning student-progress call carries COURSE_LEARNING_TOKEN', () => {
    it('course-deletion guard: sends the token (the stub refuses anything else) and still deletes a course without learners', async () => {
      assert.equal((await call('DELETE', `/api/courses/${C1}`, 'OWNER')).status, 200);
      assert.deepEqual(learningCalls, [C1]);
      assert.equal(learningRefused, 0);
    });

    it('course-deletion guard WITHOUT a usable COURSE_LEARNING_TOKEN: nothing is sent, 503, the course is kept', async () => {
      for (const configured of [undefined, '', 'too-short']) {
        if (configured === undefined) delete process.env.COURSE_LEARNING_TOKEN;
        else process.env.COURSE_LEARNING_TOKEN = configured;
        const res = await call('DELETE', `/api/courses/${C1}`, 'OWNER');
        assert.equal(res.status, 503);
        assert.equal(res.json.code, 'ENROLLMENT_CHECK_UNAVAILABLE');
      }
      assert.deepEqual(learningCalls, [], 'no request at all without a usable token');
      assert.ok(courseRow(C1));
      noWrites('no token configured');
    });

    it('instructor student list: the owner gets the learners through the token; without a token configured, an empty list and no request', async () => {
      learnersByCourse[C1] = 2;
      const res = await call('GET', `/api/courses/instructor/${C1}/students`, 'OWNER');
      assert.equal(res.status, 200);
      assert.equal(res.json.data.students.length, 2);
      assert.equal(learningRefused, 0);
      delete process.env.COURSE_LEARNING_TOKEN;
      learningCalls = [];
      const degraded = await call('GET', `/api/courses/instructor/${C1}/students`, 'OWNER');
      assert.equal(degraded.status, 200);
      assert.deepEqual(degraded.json.data.students, []);
      assert.deepEqual(learningCalls, []);
    });

    it('instructor student detail: the owner sees their learner; ANOTHER instructor cannot (no lookup is even made); a STUDENT cannot', async () => {
      enrolledIn[C1] = [STUDENT];
      const ok = await call('GET', `/api/courses/instructor/${C1}/students/${STUDENT}`, 'OWNER');
      assert.equal(ok.status, 200);
      assert.equal(ok.json.data.progress.progressPercentage, 40);
      learningCalls = [];
      const other = await call('GET', `/api/courses/instructor/${C1}/students/${STUDENT}`, 'OTHER');
      assert.notEqual(other.status, 200);
      assert.ok(!other.text.includes('progressPercentage'));
      assert.equal((await call('GET', `/api/courses/instructor/${C1}/students/${STUDENT}`, 'STUDENT')).status, 403);
      assert.deepEqual(learningCalls, [], 'the learning-service is never asked for a course the caller does not own');
    });

    it('review: the enrollment check uses the token and the REVIEWER from the token - a body userId cannot borrow someone else\'s enrollment', async () => {
      enrolledIn[C3] = [STUDENT];
      const ok = await call('POST', `/api/courses/${C3}/reviews`, 'STUDENT', { rating: 5, comment: 'Great' });
      assert.equal(ok.status, 201);
      assert.deepEqual(learningCalls, [`${C3}/${STUDENT}`]);
      const borrowed = await call('POST', `/api/courses/${C3}/reviews`, 'OTHER', { rating: 1, comment: 'x', userId: STUDENT });
      assert.equal(borrowed.status, 403, 'OTHER is not enrolled - the body userId is ignored');
      assert.equal(writes.filter((w) => w.model === 'review').length, 1);
    });

    it('review WITHOUT a usable COURSE_LEARNING_TOKEN: refused (500 as before for an unverifiable check), nothing written, nothing sent', async () => {
      enrolledIn[C3] = [STUDENT];
      delete process.env.COURSE_LEARNING_TOKEN;
      const res = await call('POST', `/api/courses/${C3}/reviews`, 'STUDENT', { rating: 5 });
      assert.equal(res.status, 500);
      assert.deepEqual(learningCalls, []);
      assert.equal(writes.filter((w) => w.model === 'review').length, 0);
    });
  });

  // =========================================================================================== FIX-INS-03: increment-enrollment
  describe('FIX-INS-03 - POST /api/courses/:courseId/increment-enrollment needs ORDER_COURSE_TOKEN', () => {
    const URL = `/api/courses/${C1}/increment-enrollment`;
    const post = async (headers: Record<string, string> = {}, url = URL) => {
      const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, text, json };
    };
    const withToken = (t: string) => ({ 'x-internal-service-token': t });

    it('a public client (no token, a user JWT, an ADMIN JWT): 403 and enrolledCount does not move', async () => {
      for (const headers of [{}, { authorization: 'Bearer STUDENT' }, { authorization: 'Bearer ADMIN' }, { 'x-internal-service': 'true' }]) {
        const res = await post(headers);
        assert.equal(res.status, 403, JSON.stringify(headers));
        assert.deepEqual(res.json, { error: 'Forbidden: Invalid internal service token' });
      }
      assert.equal(courseRow(C1)!.enrolledCount, 0);
      noWrites('public increment');
    });

    it('a wrong token (off by one, other case, empty, the COURSE_LEARNING_TOKEN, query string / Bearer placement): 403, no write', async () => {
      const attempts: Array<[Record<string, string>, string]> = [
        [withToken(`${ORDER_COURSE_TOKEN}0`), URL], [withToken(ORDER_COURSE_TOKEN.slice(0, -1)), URL], [withToken(ORDER_COURSE_TOKEN.toUpperCase()), URL],
        [withToken(''), URL], [withToken(COURSE_LEARNING_TOKEN), URL], [{ authorization: `Bearer ${ORDER_COURSE_TOKEN}` }, URL],
        [{}, `${URL}?x-internal-service-token=${ORDER_COURSE_TOKEN}`],
      ];
      for (const [headers, url] of attempts) assert.equal((await post(headers, url)).status, 403);
      assert.equal(courseRow(C1)!.enrolledCount, 0);
      noWrites('wrong token');
    });

    it('the order-service with the right token: 200 { message } and enrolledCount + 1 (unchanged contract)', async () => {
      const res = await post(withToken(ORDER_COURSE_TOKEN));
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, { message: 'Enrollment incremented' });
      assert.equal(courseRow(C1)!.enrolledCount, 1);
      assert.deepEqual(writes.map((w) => [w.model, w.op, w.where]), [['course', 'update', { id: C1 }]]);
    });

    it('server WITHOUT a usable ORDER_COURSE_TOKEN (unset, short, the public default): 500 fail-closed, no write', async () => {
      // the publicly known default(s): every `${...TOKEN:-<default>}` in docker-compose.yml (not repeated in the source)
      const compose = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../../docker-compose.yml'), 'utf8');
      const publicDefaults = Array.from(new Set(Array.from(compose.matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m: any) => m[1] as string)));
      assert.ok(publicDefaults.length > 0);
      for (const configured of [undefined, '', 'too-short-value', ...publicDefaults]) {
        if (configured === undefined) delete process.env.ORDER_COURSE_TOKEN;
        else process.env.ORDER_COURSE_TOKEN = configured;
        for (const headers of [{}, withToken(ORDER_COURSE_TOKEN), withToken(configured ?? '')]) {
          const res = await post(headers);
          assert.equal(res.status, 500, `configured ${configured}`);
          assert.deepEqual(res.json, { error: 'Internal service authentication not configured' });
        }
      }
      assert.equal(courseRow(C1)!.enrolledCount, 0);
      noWrites('not configured');
    });

    it('trailing slash / upper case hit the same check; a malformed id is refused (400) only after the token check', async () => {
      assert.equal((await post({}, `${URL}/`)).status, 403);
      assert.equal((await post({}, URL.toUpperCase().replace(C1.toUpperCase(), C1))).status, 403);
      assert.equal((await post({}, '/api/courses/nope/increment-enrollment')).status, 403);
      assert.equal((await post(withToken(ORDER_COURSE_TOKEN), '/api/courses/nope/increment-enrollment')).status, 400);
      noWrites('spellings');
    });

    it('route table: the only route reaching incrementEnrollment runs requireServiceToken(ORDER_COURSE_TOKEN) first; tokens never reach the logs', async () => {
      const app = require('../src/app').default;
      const { CourseController } = require('../src/controllers/course.controller');
      const layers = (app._router.stack as any[]).filter((l) => l.route && l.route.stack.some((s: any) => s.handle === CourseController.incrementEnrollment));
      assert.equal(layers.length, 1);
      assert.deepEqual(layers[0].route.methods, { post: true });
      assert.equal(layers[0].route.stack[0].handle.name, 'requireServiceToken(ORDER_COURSE_TOKEN)');
      await post(withToken(ORDER_COURSE_TOKEN));
      await post(withToken(`${ORDER_COURSE_TOKEN}x`));
      assert.ok(!logs.some((l) => l.includes(ORDER_COURSE_TOKEN) || l.includes(COURSE_LEARNING_TOKEN)));
    });
  });

  // =========================================================================================== FIX-INS-06: internal lessons
  describe('FIX-INS-06 - GET /api/courses/internal/:courseId/lessons[/:lessonId] (every videoUrl) needs COURSE_LEARNING_TOKEN', () => {
    const LIST = `/api/courses/internal/${C1}/lessons`;
    const ONE = `/api/courses/internal/${C1}/lessons/${L1}`;
    const get = async (url: string, headers: Record<string, string> = {}) => {
      const res = await fetch(`${base}${url}`, { headers });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, text, json };
    };
    const withToken = (t: string) => ({ 'x-internal-service-token': t });
    const compose = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../../docker-compose.yml'), 'utf8');
    const publicDefaults: string[] = Array.from(new Set(Array.from(compose.matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m: any) => m[1] as string)));

    it('no token, a wrong token, ORDER_COURSE_TOKEN, the shared default, a user / instructor / admin session, x-internal-service: true -> 403, nothing read', async () => {
      const attempts: Array<Record<string, string>> = [
        {}, withToken(`${COURSE_LEARNING_TOKEN}0`), withToken(COURSE_LEARNING_TOKEN.slice(0, -1)), withToken(COURSE_LEARNING_TOKEN.toUpperCase()), withToken(''),
        withToken(ORDER_COURSE_TOKEN), ...publicDefaults.map(withToken), { authorization: 'Bearer STUDENT' }, { authorization: 'Bearer OTHER' },
        { authorization: 'Bearer ADMIN' }, { authorization: 'Bearer OWNER' }, { 'x-internal-service': 'true' },
      ];
      for (const headers of attempts) {
        for (const url of [LIST, ONE]) {
          const res = await get(url, headers);
          assert.equal(res.status, 403, `${url} ${JSON.stringify(Object.keys(headers))}`);
          assert.ok(!res.text.includes('videoUrl') && !res.text.includes('v.mp4'));
        }
      }
      assert.deepEqual(reads, [], 'the database is not even read');
    });

    it('the token counts only in X-Internal-Service-Token (query string ?token= and Bearer do not); other spellings hit the same check', async () => {
      assert.equal((await get(`${LIST}?token=${COURSE_LEARNING_TOKEN}&x-internal-service-token=${COURSE_LEARNING_TOKEN}`)).status, 403);
      assert.equal((await get(LIST, { authorization: `Bearer ${COURSE_LEARNING_TOKEN}` })).status, 403);
      assert.equal((await get(`${LIST}/`)).status, 403);
      assert.equal((await get(LIST.replace('/internal/', '/INTERNAL/'))).status, 403);
      assert.deepEqual(reads, []);
    });

    it('server WITHOUT a usable COURSE_LEARNING_TOKEN: 500 fail-closed, nothing read', async () => {
      for (const configured of [undefined, '', 'too-short-value', ...publicDefaults]) {
        if (configured === undefined) delete process.env.COURSE_LEARNING_TOKEN;
        else process.env.COURSE_LEARNING_TOKEN = configured;
        for (const headers of [{}, withToken(COURSE_LEARNING_TOKEN), withToken(configured ?? '')]) {
          const res = await get(LIST, headers);
          assert.equal(res.status, 500);
          assert.deepEqual(res.json, { error: 'Internal service authentication not configured' });
        }
      }
      assert.deepEqual(reads, []);
    });

    it('the learning-service with the right token: 200 { data: [lessons WITH videoUrl] } / { data: lesson } - unchanged contract', async () => {
      const list = await get(LIST, withToken(COURSE_LEARNING_TOKEN));
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.data.map((l: Row) => [l.id, l.order, l.videoUrl]), [[L1, 0, 'https://cdn.umi.test/v.mp4'], [L2, 1, 'https://cdn.umi.test/v.mp4']]);
      const one = await get(ONE, withToken(COURSE_LEARNING_TOKEN));
      assert.equal(one.status, 200);
      assert.equal(one.json.data.id, L1);
      assert.equal((await get(`/api/courses/internal/${MISSING}/lessons`, withToken(COURSE_LEARNING_TOKEN))).status, 404);
      assert.equal((await get(`/api/courses/internal/${C1}/lessons/${L3}`, withToken(COURSE_LEARNING_TOKEN))).status, 404, 'a lesson of ANOTHER course is not found under this course');
      assert.equal((await get('/api/courses/internal/nope/lessons', withToken(COURSE_LEARNING_TOKEN))).status, 400);
      assert.equal((await get('/api/courses/internal/nope/lessons')).status, 403, 'id validation only after the token check');
    });
  });

  // =========================================================================================== FIX-INS-10: lesson owner
  describe('FIX-INS-10 - GET /api/courses/internal/lessons/:lessonId/owner (who may manage / grade an assignment) needs COURSE_LEARNING_TOKEN', () => {
    const OWNER_URL = (lid: string) => `/api/courses/internal/lessons/${lid}/owner`;
    const get = async (url: string, headers: Record<string, string> = {}) => {
      const res = await fetch(`${base}${url}`, { headers });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, text, json };
    };
    const withToken = (t: string) => ({ 'x-internal-service-token': t });

    it('no token, a wrong token, ORDER_COURSE_TOKEN, a user / instructor / admin session, x-internal-service: true -> 403, nothing read', async () => {
      const attempts: Array<Record<string, string>> = [
        {}, withToken(`${COURSE_LEARNING_TOKEN}0`), withToken(COURSE_LEARNING_TOKEN.slice(0, -1)), withToken(''), withToken(ORDER_COURSE_TOKEN),
        withToken('internal_secret_token_umi'), { authorization: 'Bearer OWNER' }, { authorization: 'Bearer OTHER' }, { authorization: 'Bearer ADMIN' },
        { authorization: `Bearer ${COURSE_LEARNING_TOKEN}` }, { 'x-internal-service': 'true' },
      ];
      for (const headers of attempts) {
        const res = await get(OWNER_URL(L1), headers);
        assert.equal(res.status, 403, JSON.stringify(headers));
        assert.ok(!res.text.includes(OWNER) && !res.text.includes(C1), 'no ownership data');
      }
      assert.equal((await get(`${OWNER_URL(L1)}?token=${COURSE_LEARNING_TOKEN}`)).status, 403);
      assert.deepEqual(reads, [], 'the database is not even read');
    });

    it('server WITHOUT a usable COURSE_LEARNING_TOKEN: 500 fail-closed, nothing read', async () => {
      for (const configured of [undefined, '', 'too-short-value', 'internal_secret_token_umi']) {
        if (configured === undefined) delete process.env.COURSE_LEARNING_TOKEN;
        else process.env.COURSE_LEARNING_TOKEN = configured;
        const res = await get(OWNER_URL(L1), withToken(configured ?? COURSE_LEARNING_TOKEN));
        assert.equal(res.status, 500);
        assert.ok(!res.text.includes(OWNER));
      }
      assert.deepEqual(reads, []);
    });

    it('with the token: exactly { lessonId, courseId, instructorId } - also for an unpublished DRAFT course; unknown 404, malformed 400', async () => {
      assert.equal(courses.find((c) => c.id === C1)!.published, false, 'C1 is an unpublished draft');
      const own = await get(OWNER_URL(L1), withToken(COURSE_LEARNING_TOKEN));
      assert.equal(own.status, 200);
      assert.deepEqual(own.json, { data: { lessonId: L1, courseId: C1, instructorId: OWNER } });
      const other = await get(OWNER_URL(L3), withToken(COURSE_LEARNING_TOKEN));
      assert.deepEqual(other.json.data, { lessonId: L3, courseId: C2, instructorId: OTHER }, 'a lesson always reports its own course');
      assert.ok(!own.text.includes('videoUrl') && !own.text.includes('price') && !own.text.includes('title'));
      assert.equal((await get(OWNER_URL(MISSING), withToken(COURSE_LEARNING_TOKEN))).status, 404);
      lessons.push(lesson(id('8'), MISSING, 0));
      assert.equal((await get(OWNER_URL(id('8')), withToken(COURSE_LEARNING_TOKEN))).status, 404, 'a lesson whose course is gone has no owner');
      assert.equal((await get('/api/courses/internal/lessons/nope/owner', withToken(COURSE_LEARNING_TOKEN))).status, 400);
      assert.equal((await get('/api/courses/internal/lessons/nope/owner')).status, 403, 'id validation only after the token check');
    });
  });

  // =========================================================================================== FIX-INS-06: user-facing lessons
  describe('FIX-INS-06 - the user-facing lesson routes keep the purchase / preview rules (no paid videoUrl without access)', () => {
    const list = async (token?: string, courseId = C3) => {
      const res = await fetch(`${base}/api/courses/${courseId}/lessons`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const one = async (lessonId: string, token?: string, courseId = C3) => {
      const res = await fetch(`${base}/api/courses/${courseId}/lessons/${lessonId}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const PAID = id('e');
    const PREVIEW = id('f');
    beforeEach(() => {
      lessons.push({ ...lesson(PAID, C3, 0), videoUrl: '/api/courses/files/download?bucket=courses&key=paid' });
      lessons.push({ ...lesson(PREVIEW, C3, 1), videoUrl: '/api/courses/files/download?bucket=courses&key=preview', isPreview: true });
    });
    const urls = (r: any) => Object.fromEntries(r.json.data.map((l: Row) => [l.id, l.videoUrl]));

    it('anonymous, a student who has not bought it, and ANOTHER instructor: every lesson listed, but only the preview has a videoUrl', async () => {
      for (const token of [undefined, 'STUDENT', 'OTHER']) {
        const r = await list(token);
        assert.equal(r.status, 200, String(token));
        assert.deepEqual(urls(r), { [PAID]: '', [PREVIEW]: '/api/courses/files/download?bucket=courses&key=preview' }, String(token));
      }
    });

    it('the enrolled learner, the course owner and an ADMIN get every videoUrl', async () => {
      enrolledIn[C3] = [STUDENT];
      for (const token of ['STUDENT', 'OWNER', 'ADMIN']) {
        const r = await list(token);
        assert.equal(urls(r)[PAID], '/api/courses/files/download?bucket=courses&key=paid', token);
      }
    });

    it('one lesson: the paid lesson is refused (403) to anonymous / a non-buyer / another instructor; the preview is open; the buyer, owner and admin get it', async () => {
      for (const token of [undefined, 'STUDENT', 'OTHER']) assert.equal((await one(PAID, token)).status, 403, String(token));
      for (const token of [undefined, 'STUDENT', 'OTHER']) assert.equal((await one(PREVIEW, token)).json.data.videoUrl, '/api/courses/files/download?bucket=courses&key=preview');
      enrolledIn[C3] = [STUDENT];
      for (const token of ['STUDENT', 'OWNER', 'ADMIN']) assert.equal((await one(PAID, token)).json.data.videoUrl, '/api/courses/files/download?bucket=courses&key=paid', token);
    });
  });

  // =========================================================================================== FIX-INS-06: recommendations
  describe('FIX-INS-06 - POST /api/courses/recommendations/batch needs COURSE_LEARNING_TOKEN and a bounded body', () => {
    const URL = '/api/courses/recommendations/batch';
    const post = async (payload: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(`${base}${URL}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, text, json };
    };
    const withToken = (t: string) => ({ 'x-internal-service-token': t });

    it('no token, a wrong token, ORDER_COURSE_TOKEN, a user session, x-internal-service: true -> 403 and no query', async () => {
      for (const headers of [{}, withToken(`${COURSE_LEARNING_TOKEN}x`), withToken(ORDER_COURSE_TOKEN), { authorization: 'Bearer STUDENT' }, { authorization: 'Bearer ADMIN' }, { 'x-internal-service': 'true' }]) {
        const res = await post({ sortBy: 'rating', limit: 10 }, headers);
        assert.equal(res.status, 403, JSON.stringify(Object.keys(headers)));
        assert.ok(!res.text.includes('Course 3'));
      }
      assert.deepEqual(reads, []);
    });

    it('the learning-service with the right token: 200 { data: [published + approved courses] }, sorted and limited as asked (unchanged contract)', async () => {
      courses.push(course(id('8'), OTHER, { title: 'Course 8', published: true, approvalStatus: 'APPROVED', rating: 4.9, enrolledCount: 1, level: 'INTERMEDIATE', categoryId: id('7') }));
      const res = await post({ sortBy: 'rating', limit: 10 }, withToken(COURSE_LEARNING_TOKEN));
      assert.equal(res.status, 200);
      assert.deepEqual(res.json.data.map((c: Row) => c.id), [id('8'), C3], 'rating desc; drafts are never returned');
      assert.ok('category' in res.json.data[0]);
      const filtered = await post({ categoryIds: [id('7')], excludeIds: [C3], levels: ['INTERMEDIATE'], sortBy: 'enrolledCount', limit: 5 }, withToken(COURSE_LEARNING_TOKEN));
      assert.deepEqual(filtered.json.data.map((c: Row) => c.id), [id('8')]);
      assert.equal((await post({ excludeIds: [], limit: 1 }, withToken(COURSE_LEARNING_TOKEN))).json.data.length, 1, 'the by-ids helper body still works');
      assert.equal(lastFindManyArgs.take, 1);
    });

    it('out-of-scope bodies are refused with 400 and nothing is queried: huge / non-integer limits, operator objects, oversized lists, unknown levels / sort keys / fields', async () => {
      const bad: unknown[] = [
        { limit: 100000 }, { limit: 0 }, { limit: '5' }, { limit: 2.5 },
        { categoryIds: [{ $ne: null }] }, { categoryIds: 'all' }, { categoryIds: [null] }, { excludeIds: Array.from({ length: 501 }, () => C1) }, { excludeIds: ['x'] },
        { levels: ['EXPERT'] }, { levels: 'BEGINNER' }, { sortBy: 'price' }, { sortBy: { $gt: '' } },
        { where: { published: false } }, { include: { lessons: true } }, { approvalStatus: 'DRAFT' }, [1, 2],
      ];
      for (const body of bad) {
        const res = await post(body, withToken(COURSE_LEARNING_TOKEN));
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      }
      assert.deepEqual(reads, []);
    });

    it('route table: every /internal route and recommendations/batch start with a per-pair service token (never INTERNAL_SERVICE_TOKEN)', () => {
      const app = require('../src/app').default;
      const guarded = (app._router.stack as any[]).filter((l) => l.route && (/\/internal\//.test(l.route.path) || l.route.path === URL));
      assert.deepEqual(guarded.map((l) => [l.route.path, l.route.stack[0].handle.name]).sort(), [
        ['/api/courses/internal/:courseId/lessons', 'requireServiceToken(COURSE_LEARNING_TOKEN)'],
        ['/api/courses/internal/:courseId/lessons/:lessonId', 'requireServiceToken(COURSE_LEARNING_TOKEN)'],
        ['/api/courses/internal/lessons/:lessonId/owner', 'requireServiceToken(COURSE_LEARNING_TOKEN)'],   // FIX-INS-10
        [URL, 'requireServiceToken(COURSE_LEARNING_TOKEN)'],
      ]);
      // no other route reaches the internal controllers
      const { LessonController } = require('../src/controllers/lesson.controller');
      const { CourseController } = require('../src/controllers/course.controller');
      const internalHandlers = [LessonController.getCourseLessonsInternal, LessonController.getLessonByIdInternal, LessonController.getLessonOwnerInternal, CourseController.getRecommendationBatch];
      const reaching = (app._router.stack as any[]).filter((l) => l.route && l.route.stack.some((s: any) => internalHandlers.includes(s.handle)));
      assert.equal(reaching.length, 4);
    });
  });

  // =========================================================================================== FIX-INS-07: file download
  describe('FIX-INS-07 - GET /api/courses/files/download serves a file only after resolving, server-side, whose it is', () => {
    const k = (name: string) => `1700000000000-${name}.mp4`;
    const THUMB = '1700000000000-thumb.png';
    const DRAFT_THUMB = '1700000000000-draftthumb.png';
    const PAID = k('paid');
    const PREVIEW = k('preview');
    const DRAFT_PREVIEW = k('draftpreview');
    const RESOURCE = '1700000000000-slides.pdf';
    const ORPHAN = k('orphan');
    const STOLEN = k('stolen');     // a paid lesson video of C3 that OTHER also set as the thumbnail of C2
    const GONE = k('gone');         // referenced by a paid lesson but missing in the storage
    const ref = (key: string, bucket = 'courses') => `/api/courses/files/download?bucket=${bucket}&key=${key}`;
    const ids = { paid: '1a'.repeat(12), preview: '2a'.repeat(12), draftPreview: '3a'.repeat(12), resource: '4a'.repeat(12), stolen: '5a'.repeat(12), gone: '6a'.repeat(12) };

    beforeEach(() => {
      for (const key of Object.keys(storageObjects)) delete storageObjects[key];
      storageReads.length = 0;
      for (const key of [THUMB, DRAFT_THUMB, PAID, PREVIEW, DRAFT_PREVIEW, RESOURCE, ORPHAN, STOLEN]) storageObjects[`courses/${key}`] = `content-of-${key}`;
      storageObjects['avatars/secret.png'] = 'someone-elses-avatar';
      storageObjects['assignments/submission.zip'] = 'someone-elses-homework';
      storageObjects['course-videos/hls.m3u8'] = 'hls';
      courseRow(C3)!.thumbnail = ref(THUMB);                       // published course (OWNER)
      courseRow(C1)!.thumbnail = ref(DRAFT_THUMB);                 // draft course (OWNER)
      courseRow(C2)!.thumbnail = ref(STOLEN);                      // OTHER points his thumbnail at a paid video of C3
      lessons.push({ ...lesson(ids.paid, C3, 0), videoUrl: ref(PAID) });
      lessons.push({ ...lesson(ids.preview, C3, 1), videoUrl: ref(PREVIEW), isPreview: true });
      lessons.push({ ...lesson(ids.resource, C3, 2), videoUrl: 'https://cdn.umi.test/x.mp4', resources: [{ title: 'Slides', fileUrl: ref(RESOURCE) }] });
      lessons.push({ ...lesson(ids.stolen, C3, 3), videoUrl: ref(STOLEN) });
      lessons.push({ ...lesson(ids.gone, C3, 4), videoUrl: ref(GONE) });
      lessons.push({ ...lesson(ids.draftPreview, C1, 9), videoUrl: ref(DRAFT_PREVIEW), isPreview: true });
      logs.length = 0;
    });

    const download = async (query: string, token?: string, viaQuery = false) => {
      const url = `/api/courses/files/download?${query}${viaQuery && token ? `&token=${token}` : ''}`;
      const res = await fetch(`${base}${url}`, { headers: token && !viaQuery ? { authorization: `Bearer ${token}` } : {} });
      return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
    };
    const q = (key: string, extra = '') => `bucket=courses&key=${key}${extra}`;
    const noStorageRead = (label: string) => assert.deepEqual(storageReads, [], `${label}: the storage is not even read`);
    const leaksNothing = (r: { text: string }, key: string) => {
      assert.ok(!r.text.includes(key) && !r.text.includes('bucket') && !r.text.includes('courses/') && !r.text.toLowerCase().includes('minio'), r.text);
    };

    it('1. no credentials: a paid lesson video and a paid lesson resource are refused (401), nothing is read from the storage', async () => {
      for (const key of [PAID, RESOURCE]) {
        const r = await download(q(key));
        assert.equal(r.status, 401, key);
        assert.ok(!r.text.includes('content-of'));
        leaksNothing(r, key);
      }
      noStorageRead('anonymous');
    });

    it('2/4. leaving courseId out does not skip the check, and a forged courseId grants nothing', async () => {
      enrolledIn[C2] = [STUDENT];                                  // enrolled in ANOTHER course
      assert.equal((await download(q(PAID), 'STUDENT')).status, 403, 'no courseId: still checked');
      assert.equal((await download(q(PAID, `&courseId=${C3}`), 'STUDENT')).status, 403, 'the right courseId: still not enrolled');
      const forged = await download(q(PAID, `&courseId=${C2}`), 'STUDENT');
      assert.equal(forged.status, 404, 'a courseId the file does not belong to: refused');
      leaksNothing(forged, PAID);
      assert.equal((await download(q(PAID, '&courseId=nope'), 'STUDENT')).status, 404);
      noStorageRead('forged courseId');
    });

    it('3. another bucket, a path in the key, or an object nobody references: 404 - even for an ADMIN, nothing read', async () => {
      for (const query of ['bucket=avatars&key=secret.png', 'bucket=assignments&key=submission.zip', 'bucket=course-videos&key=hls.m3u8',
        `bucket=COURSES&key=${PAID}`, `bucket=courses&key=../avatars/secret.png`, `bucket=courses&key=avatars/secret.png`, `bucket=courses&key=${ORPHAN}`,
        `bucket=courses&key=${PAID.slice(0, -1)}`, `bucket[]=courses&key=${PAID}`, `bucket=courses&key[]=${PAID}`]) {
        for (const token of [undefined, 'ADMIN']) {
          const r = await download(query, token);
          assert.equal(r.status === 400 ? 404 : r.status, 404, `${query} as ${token}`);
          assert.ok(!r.text.includes('someone-elses') && !r.text.includes('content-of'));
        }
      }
      noStorageRead('foreign objects');
    });

    it('5. the enrolled learner downloads the paid video and the paid resource - with the token in the header or in ?token= (players)', async () => {
      enrolledIn[C3] = [STUDENT];
      for (const [key, viaQuery] of [[PAID, false], [PAID, true], [RESOURCE, false], [RESOURCE, true]] as const) {
        const r = await download(q(key), 'STUDENT', viaQuery);
        assert.equal(r.status, 200, `${key} ${viaQuery}`);
        assert.equal(r.text, `content-of-${key}`);
      }
      assert.equal((await download(q(RESOURCE), 'STUDENT')).type, 'application/pdf');
    });

    it('6. a learner who has not bought the course and ANOTHER instructor cannot download the paid video or document (403)', async () => {
      for (const token of ['STUDENT', 'OTHER']) {
        for (const key of [PAID, RESOURCE]) {
          const r = await download(q(key), token);
          assert.equal(r.status, 403, `${token} ${key}`);
          leaksNothing(r, key);
        }
      }
      noStorageRead('non-buyers');
    });

    it('7. preview: the preview lesson of a PUBLISHED course is open to everyone; a preview of a DRAFT course is not public (owner only)', async () => {
      for (const token of [undefined, 'STUDENT', 'OTHER']) {
        const r = await download(q(PREVIEW), token);
        assert.equal(r.status, 200, String(token));
        assert.equal(r.text, `content-of-${PREVIEW}`);
      }
      assert.equal((await download(q(DRAFT_PREVIEW))).status, 401);
      assert.equal((await download(q(DRAFT_PREVIEW), 'STUDENT')).status, 403);
      assert.equal((await download(q(DRAFT_PREVIEW), 'OWNER')).status, 200);
    });

    it('8. course thumbnails stay public (rendered by <img>): published and draft courses alike', async () => {
      for (const key of [THUMB, DRAFT_THUMB]) {
        const r = await download(q(key));
        assert.equal(r.status, 200, key);
        assert.equal(r.type, 'image/png');
      }
    });

    it('9. the course owner and an ADMIN keep their access to every file of the course', async () => {
      for (const token of ['OWNER', 'ADMIN']) {
        for (const key of [PAID, RESOURCE, PREVIEW, DRAFT_PREVIEW]) assert.equal((await download(q(key), token)).status, 200, `${token} ${key}`);
      }
      assert.deepEqual(learningCalls.filter((c) => c.startsWith('own:')), [], 'owner / admin need no enrollment lookup');
    });

    it('10. a key used by several resources is only as open as the MOST restrictive one: a paid video re-used as another course thumbnail stays paid', async () => {
      const anon = await download(q(STOLEN));
      assert.equal(anon.status, 401, 'not public although it is C2\'s thumbnail');
      assert.equal((await download(q(STOLEN), 'OTHER')).status, 403, 'the owner of C2 does not own the C3 lesson that references it');
      enrolledIn[C3] = [STUDENT];
      assert.equal((await download(q(STOLEN), 'STUDENT')).status, 200, 'the C3 learner still gets it');
      assert.equal((await download(q(ORPHAN), 'OWNER')).status, 404, 'an unreferenced object is refused');
    });

    it('11. a referenced file missing in the storage answers 404 without storage details; no key, bucket or URL in the logs either', async () => {
      const r = await download(q(GONE), 'OWNER');
      assert.equal(r.status, 404);
      assert.deepEqual(JSON.parse(r.text), { error: 'File not found' });
      leaksNothing(r, GONE);
      await download(q(PAID));
      await download('bucket=avatars&key=secret.png');
      assert.ok(!logs.some((l) => l.includes(GONE) || l.includes(PAID) || l.includes('secret.png') || l.includes('does not exist')), logs.join('\n'));
    });

    it('12. route table: the download route is the only one reaching the controller and keeps authenticateOptional (the ?token= of players still works)', () => {
      const app = require('../src/app').default;
      const { FileController } = require('../src/controllers/file.controller');
      const layers = (app._router.stack as any[]).filter((l) => l.route && l.route.stack.some((s: any) => s.handle === FileController.downloadFile));
      assert.deepEqual(layers.map((l) => [Object.keys(l.route.methods), l.route.path, l.route.stack[0].handle.name]), [[['get'], '/api/courses/files/download', 'authenticateOptional']]);
    });
  });
});
