/**
 * FIX-INS-14: learning-path images (imageUrl / bannerUrl) are uploaded and served by the learning-service.
 *
 *   POST /api/learning/admin/paths/upload-url    ADMIN only; image types only; bucket learning-path-assets (server-side)
 *   GET  /api/learning/path-images/:key          no session (<img>): PUBLISHED path image -> anyone; otherwise HMAC-signed URL only
 *   GET  /api/learning/path-images/legacy/:key   images stored before as /api/courses/files/download?bucket=courses&key=...,
 *                                                read from the courses bucket ONLY when a learning path references them
 *   Paths returned to an allowed caller carry displayable URLs (signed unless PUBLISHED); the admin form's display URLs are stored
 *   back in their stable form. Refusals never touch storage.
 *
 * The REAL express app runs on an ephemeral port with the in-memory Prisma fake and an in-memory storage fake.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { installFakePrisma, FakePrismaClient } from './helpers/fake-prisma';

// ---------------------------------------------------------------- models on the shared fake
type Row = Record<string, any>;
const tables: Record<string, Row[]> = { learningPath: [], userPathEnrollment: [], finalProject: [], courseProgress: [] };
const cond = (actual: any, v: any): boolean => {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
    if ('in' in v) return v.in.includes(actual);
    return false;
  }
  return actual === v;
};
const match = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
  if (k === 'userId_learningPathId') return row.userId === v.userId && row.learningPathId === v.learningPathId;
  if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
  if (k === 'NOT') return !match(row, v);
  return cond(row[k], v);
});
const withInclude = (row: Row, include: any) => (include?.learningPath ? { ...row, learningPath: tables.learningPath.find((p) => p.id === row.learningPathId) ?? null } : { ...row });
const model = (table: string) => ({
  findUnique: async ({ where, include }: any) => { const r = tables[table].find((x) => match(x, where)); return r ? withInclude(r, include) : null; },
  findFirst: async ({ where }: any = {}) => { const r = tables[table].find((x) => match(x, where)); return r ? { ...r } : null; },
  findMany: async ({ where, include }: any = {}) => tables[table].filter((x) => match(x, where)).map((r) => withInclude(r, include)),
  count: async ({ where }: any = {}) => tables[table].filter((x) => match(x, where)).length,
  update: async ({ where, data }: any) => { const r = tables[table].find((x) => match(x, where))!; Object.assign(r, data); return { ...r }; },
  create: async ({ data }: any) => { const r = { id: randomBytes(12).toString('hex'), ...data }; tables[table].push(r); return { ...r }; },
});
Object.assign((FakePrismaClient as any).prototype, {
  learningPath: model('learningPath'), userPathEnrollment: model('userPathEnrollment'), finalProject: model('finalProject'),
});
installFakePrisma();

// ---------------------------------------------------------------- in-memory storage
const objects = new Map<string, string>();   // `${bucket}/${key}` -> content
const storageCalls: string[] = [];
let uploadSeq = 0;
class FakeFileStorageService {
  async getPresignedUploadUrl(opts: any) {
    storageCalls.push(`presign:${opts.bucket}:${opts.fileName}:${opts.mimeType}`);
    const key = `17000000000${String(++uploadSeq).padStart(2, '0')}-0b1c2d3e-aaaa-bbbb-cccc-0000000000${String(uploadSeq).padStart(2, '0')}.${String(opts.fileName).split('.').pop()}`;
    objects.set(`${opts.bucket}/${key}`, `uploaded ${key}`);
    return { uploadUrl: `https://minio.test/${opts.bucket}/${key}?X-Amz-Signature=up`, fileKey: key, publicUrl: '' };
  }
  async getFileStream(bucket: string, key: string) {
    storageCalls.push(`read:${bucket}:${key}`);
    const body = objects.get(`${bucket}/${key}`);
    if (body === undefined) throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
    return Readable.from([Buffer.from(body)]);
  }
  async getPresignedDownloadUrl() { return 'https://minio.test/download'; }
  async ensureBucket() { /* */ }
}
const storagePath = require.resolve('@umi/file-storage');
require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: { FileStorageService: FakeFileStorageService, fileStorage: new FakeFileStorageService(), minioConfig: {} } } as any;

// ---------------------------------------------------------------- identities and data
const id = (c: string) => c.repeat(12);
const USERS: Record<string, { userId: string; role: string }> = {
  STUDENT: { userId: id('a1'), role: 'STUDENT' },
  MEMBER: { userId: id('a2'), role: 'STUDENT' },     // enrolled in the archived path
  INSTRUCTOR: { userId: id('b1'), role: 'INSTRUCTOR' },
  ADMIN: { userId: id('c1'), role: 'ADMIN' },
};
const key = (n: string, ext = 'png') => `1699999999${n}-11111111-2222-3333-4444-5555555555${n}.${ext}`;
const K_PUB = key('01');
const K_DRAFT = key('02');
const K_ARCH = key('03');
const K_ORPHAN = key('04');
const LK_PUB = key('05', 'jpg');        // legacy (courses bucket) banner of the published path
const LK_DRAFT = key('06', 'jpg');      // legacy image of the draft path
const LK_COURSE = key('07', 'png');     // a course file in the courses bucket, referenced by no learning path
const CUR = (k: string) => `/api/learning/path-images/${k}`;
const LEGACY_STORED = (k: string) => `/api/courses/files/download?bucket=courses&key=${k}`;
const PUB = id('71');
const DRAFT = id('72');
const ARCH = id('73');
const C1 = id('d1');
const COURSE_LEARNING_TOKEN = randomBytes(32).toString('hex');
const SIGNING_SECRET = randomBytes(32).toString('hex');   // this test's own PATH_IMAGE_SIGNING_SECRET

describe('FIX-INS-14: learning-path images - upload (ADMIN) and display (published / signed)', () => {
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
        if (url.startsWith(`/api/courses/internal/${C1}/lessons`)) return res.end(JSON.stringify({ data: [] }));
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubBase = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins14-'));
    for (const v of ['ZIP_UPLOAD_DIR', 'ZIP_EXTRACT_DIR', 'VIDEO_UPLOAD_DIR', 'HLS_TEMP_DIR']) process.env[v] = path.join(tmp, v.toLowerCase());
    Object.assign(process.env, {
      AUTH_SERVICE_URL: stubBase, USER_SERVICE_URL: stubBase, COURSE_SERVICE_URL: stubBase, COURSE_LEARNING_TOKEN,
      RATE_LIMIT_MAX_REQUESTS: '100000', BLOCKCHAIN_ENABLED: 'false', INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'),
      PATH_IMAGE_SIGNING_SECRET: SIGNING_SECRET,
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

  const lp = (pid: string, status: string, imageUrl: string | null, bannerUrl: string | null = null): Row => ({
    id: pid, title: `Path ${status}`, description: 'd', slug: `p-${status.toLowerCase()}`, category: null, difficulty: 'ALL', imageUrl, bannerUrl,
    shortDescription: null, careerGoal: null, skills: [], prerequisiteRules: [], completionRule: 'ALL_COURSES', recommended: false, status,
    totalDurationMinutes: 0, enrollmentCount: 0, createdBy: USERS.ADMIN.userId, courseIds: [C1], certificateConfig: null,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  });
  beforeEach(() => {
    process.env.PATH_IMAGE_SIGNING_SECRET = SIGNING_SECRET;
    storageCalls.length = 0;
    objects.clear();
    for (const k of [K_PUB, K_DRAFT, K_ARCH, K_ORPHAN]) objects.set(`learning-path-assets/${k}`, `image ${k}`);
    for (const k of [LK_PUB, LK_DRAFT, LK_COURSE]) objects.set(`courses/${k}`, `legacy ${k}`);
    tables.learningPath = [
      lp(PUB, 'PUBLISHED', CUR(K_PUB), LEGACY_STORED(LK_PUB)),
      lp(DRAFT, 'DRAFT', CUR(K_DRAFT), LEGACY_STORED(LK_DRAFT)),
      lp(ARCH, 'ARCHIVED', CUR(K_ARCH)),
    ];
    tables.userPathEnrollment = [{ id: id('81'), userId: USERS.MEMBER.userId, learningPathId: ARCH, status: 'IN_PROGRESS', enrolledAt: new Date() }];
    tables.finalProject = [];
  });

  const call = async (method: string, url: string, token?: string, payload?: unknown) => {
    const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json, type: res.headers.get('content-type'), nosniff: res.headers.get('x-content-type-options') };
  };
  const img = (url: string) => call('GET', url);   // like an <img>: no Authorization header
  const UP = '/api/learning/admin/paths/upload-url';
  const png = { fileName: 'cover.png', contentType: 'image/png' };

  // =============================================================================================== upload
  it('1. upload URL: anonymous 401, STUDENT / INSTRUCTOR 403 (forged role too) - storage never called', async () => {
    assert.equal((await call('POST', UP, undefined, png)).status, 401);
    for (const t of ['STUDENT', 'INSTRUCTOR']) {
      assert.equal((await call('POST', UP, t, png)).status, 403, t);
      assert.equal((await call('POST', `${UP}?role=ADMIN`, t, { ...png, role: 'ADMIN', isAdmin: true })).status, 403, `${t} forged`);
    }
    assert.deepEqual(storageCalls, []);
  });

  it('2. ADMIN: only images, bucket fixed by the server (a bucket / key in the body is ignored); bad types never reach storage', async () => {
    for (const body of [{ fileName: 'x.svg', contentType: 'image/svg+xml' }, { fileName: 'x.pdf', contentType: 'application/pdf' }, { fileName: 'x.png', contentType: 'image/jpeg' }, { fileName: 'x', contentType: 'image/png' }, {}]) {
      assert.equal((await call('POST', UP, 'ADMIN', body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual(storageCalls, []);
    const r = await call('POST', UP, 'ADMIN', { ...png, bucket: 'courses', key: LK_COURSE });
    assert.equal(r.status, 200, r.text);
    assert.equal(storageCalls.length, 1);
    assert.match(storageCalls[0], /^presign:learning-path-assets:image\.png:image\/png$/);
    assert.deepEqual(Object.keys(r.json.data).sort(), ['fileKey', 'fileUrl', 'uploadUrl']);
    assert.match(r.json.data.fileUrl, new RegExp(`^/api/learning/path-images/${r.json.data.fileKey}\\?exp=\\d+&sig=[0-9a-f]{64}$`));
  });

  it('3. new image: preview works before saving; saving stores the stable URL; it shows again after reload', async () => {
    const up = (await call('POST', UP, 'ADMIN', png)).json.data;
    const preview = await img(up.fileUrl);
    assert.equal(preview.status, 200);
    assert.equal(preview.text, `uploaded ${up.fileKey}`);
    assert.equal(preview.type, 'image/png');
    assert.equal(preview.nosniff, 'nosniff');
    // the form sends back what it shows (the signed preview URL)
    const saved = await call('PUT', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN', { imageUrl: up.fileUrl });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(tables.learningPath.find((p) => p.id === DRAFT)!.imageUrl, CUR(up.fileKey), 'stored without signature');
    const reload = await call('GET', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN');
    assert.equal((await img(reload.json.data.imageUrl)).status, 200, 'shown again after reload');
  });

  // =============================================================================================== display
  it('4. a PUBLISHED path: its images (current and legacy) show for learners from the list and the detail, without signature', async () => {
    const list = await call('GET', '/api/learning/paths', 'STUDENT');
    const p = list.json.data.find((x: any) => x.id === PUB);
    assert.equal(p.imageUrl, CUR(K_PUB));
    assert.equal(p.bannerUrl, `/api/learning/path-images/legacy/${LK_PUB}`);
    assert.equal((await img(p.imageUrl)).text, `image ${K_PUB}`);
    const legacy = await img(p.bannerUrl);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.text, `legacy ${LK_PUB}`);
    assert.ok(storageCalls.includes(`read:courses:${LK_PUB}`), 'legacy image read from the courses bucket');
    const detail = await call('GET', `/api/learning/paths/${PUB}`, 'STUDENT');
    assert.equal((await img(detail.json.data.path.imageUrl)).status, 200);
  });

  it('5. DRAFT / ARCHIVED: unsigned URL refused; ADMIN gets signed URLs (list + detail); an enrolled member of the archived path too', async () => {
    for (const u of [CUR(K_DRAFT), CUR(K_ARCH), `/api/learning/path-images/legacy/${LK_DRAFT}`]) assert.equal((await img(u)).status, 404, u);
    const adminList = await call('GET', '/api/learning/admin/paths', 'ADMIN');
    for (const pid of [DRAFT, ARCH]) {
      const p = adminList.json.paths.find((x: any) => x.id === pid);
      assert.match(p.imageUrl, /\?exp=\d+&sig=/);
      assert.equal((await img(p.imageUrl)).status, 200, pid);
    }
    const draft = (await call('GET', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN')).json.data;
    assert.equal((await img(draft.bannerUrl)).text, `legacy ${LK_DRAFT}`);
    const member = await call('GET', `/api/learning/paths/${ARCH}`, 'MEMBER');
    assert.equal((await img(member.json.data.path.imageUrl)).status, 200);
    const mine = await call('GET', '/api/learning/paths/my-paths', 'MEMBER');
    assert.equal((await img(mine.json.data[0].pathImageUrl)).status, 200);
    assert.equal((await call('GET', `/api/learning/paths/${DRAFT}`, 'STUDENT')).status, 404, 'FIX-INS-12 unchanged');
  });

  it('6. arbitrary keys / buckets / forged or reused signatures read nothing', async () => {
    const signedDraft = (await call('GET', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN')).json.data.imageUrl as string;
    const qs = signedDraft.split('?')[1];
    storageCalls.length = 0;
    const attempts = [
      CUR(K_ORPHAN),                                                     // in the bucket, referenced by nothing
      `/api/learning/path-images/legacy/${LK_COURSE}`,                    // a course file, referenced by no learning path
      `/api/learning/path-images/legacy/${LK_COURSE}?${qs}`,              // ... with someone else's signature
      `${CUR(K_ORPHAN)}?${qs}`,                                          // signature of K_DRAFT reused for another key
      `/api/learning/path-images/legacy/${K_DRAFT}?${qs}`,               // signature of the current image reused on the legacy route
      `${CUR(K_DRAFT)}?${qs.replace(/sig=([0-9a-f])/, (m, c) => `sig=${c === '0' ? '1' : '0'}`)}`,   // tampered
      `${CUR(K_DRAFT)}?exp=1&sig=${'0'.repeat(64)}`,                      // expired
      `${CUR(K_DRAFT)}?exp=99999999999&sig=${qs.split('sig=')[1]}`,       // extended expiry
      `${CUR(K_PUB)}x`, '/api/learning/path-images/..%2F..%2Fcourses%2Fsecret.mp4', `/api/learning/path-images/${K_PUB.replace('.png', '.mp4')}`,
      `${CUR(K_ORPHAN)}?bucket=courses`,
    ];
    for (const u of attempts) assert.equal((await img(u)).status, 404, u);
    assert.deepEqual(storageCalls, [], 'storage never read for a refused image');
  });

  it('7. legacy URLs survive an admin round trip (form shows, sends back, stored value unchanged)', async () => {
    const loaded = (await call('GET', `/api/learning/admin/paths/${PUB}`, 'ADMIN')).json.data;
    const payload: Row = { ...loaded };
    for (const k of ['id', 'createdAt', 'updatedAt', 'createdBy', 'enrollmentCount', 'totalDurationMinutes']) delete payload[k];
    assert.equal((await call('PUT', `/api/learning/admin/paths/${PUB}`, 'ADMIN', payload)).status, 200);
    const stored = tables.learningPath.find((p) => p.id === PUB)!;
    assert.equal(stored.imageUrl, CUR(K_PUB));
    assert.equal(stored.bannerUrl, LEGACY_STORED(LK_PUB));
    const draftLoaded = (await call('GET', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN')).json.data;
    assert.equal((await call('PUT', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN', { imageUrl: draftLoaded.imageUrl, bannerUrl: draftLoaded.bannerUrl })).status, 200);
    assert.equal(tables.learningPath.find((p) => p.id === DRAFT)!.bannerUrl, LEGACY_STORED(LK_DRAFT));
    // an external URL typed by the admin is kept as typed
    assert.equal((await call('PUT', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN', { imageUrl: 'https://cdn.example.com/a.png' })).status, 200);
    assert.equal(tables.learningPath.find((p) => p.id === DRAFT)!.imageUrl, 'https://cdn.example.com/a.png');
    assert.equal((await call('PUT', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN', { imageUrl: '/api/learning/path-images/../x' })).status, 400);
  });

  it('9. a legacy (courses bucket) image needs a learning path referencing it even with a still-valid signature', async () => {
    const signedLegacy = (await call('GET', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN')).json.data.bannerUrl as string;
    assert.equal((await img(signedLegacy)).status, 200);
    tables.learningPath.find((p) => p.id === DRAFT)!.bannerUrl = null;   // the admin removed the banner
    storageCalls.length = 0;
    assert.equal((await img(signedLegacy)).status, 404);
    assert.deepEqual(storageCalls, []);
  });

  it('10. the bucket is the server\'s (a ?bucket= is ignored), a signature is bound to its route kind and expires', async () => {
    const { PathImageService } = require('../src/services/path-image.service');
    // same key in the courses bucket holding something else: ?bucket=courses must not switch to it
    objects.set(`courses/${K_PUB}`, 'SECRET course file');
    const pub = await img(`${CUR(K_PUB)}?bucket=courses`);
    assert.equal(pub.text, `image ${K_PUB}`);
    // a legacy signature reused on the current route (and the other way round) is refused
    objects.set(`learning-path-assets/${LK_DRAFT}`, 'should not be served');
    const legacySigned: string = (await call('GET', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN')).json.data.bannerUrl;
    assert.equal((await img(legacySigned.replace('/legacy/', '/'))).status, 404);
    // a correctly signed but expired URL is refused
    const expired = PathImageService.signedUrl('current', K_DRAFT, Date.now() - 60 * 60 * 1000);
    assert.equal((await img(expired)).status, 404);
    assert.equal((await img(PathImageService.signedUrl('current', K_DRAFT))).status, 200, 'the same URL, fresh, works');
  });

  it('11. no usable PATH_IMAGE_SIGNING_SECRET (unset, short, a public default, a service credential): fail-closed, no random fallback', async () => {
    const { readSigningSecret } = require('../src/services/path-image.service');
    const signedBefore: string = (await call('GET', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN')).json.data.imageUrl;
    for (const bad of [undefined, '', 'x'.repeat(31), 'internal_secret_token_umi', COURSE_LEARNING_TOKEN, `${'a'.repeat(30)} ${'b'.repeat(10)}`]) {
      if (bad === undefined) delete process.env.PATH_IMAGE_SIGNING_SECRET;
      else process.env.PATH_IMAGE_SIGNING_SECRET = bad;
      const label = bad === undefined ? 'unset' : JSON.stringify(bad.slice(0, 12));
      const check = readSigningSecret();
      assert.equal(check.ok, false, label);
      assert.match(check.reason, /PATH_IMAGE_SIGNING_SECRET/, `${label}: clear configuration error`);
      storageCalls.length = 0;
      const up = await call('POST', UP, 'ADMIN', png);
      assert.equal(up.status, 500, label);
      assert.deepEqual(up.json, { error: 'Image signing is not configured' });
      assert.deepEqual(storageCalls, [], `${label}: storage not called`);
      // nothing is signed or accepted: draft images unsigned -> refused, earlier signatures refused; the path itself still loads
      const draft = await call('GET', `/api/learning/admin/paths/${DRAFT}`, 'ADMIN');
      assert.equal(draft.status, 200);
      assert.equal(draft.json.data.imageUrl, CUR(K_DRAFT));
      assert.equal((await img(draft.json.data.imageUrl)).status, 404, label);
      assert.equal((await img(signedBefore)).status, 404, `${label}: old signature not accepted`);
      // published images do not depend on the secret
      assert.equal((await img(CUR(K_PUB))).status, 200, label);
    }
    process.env.PATH_IMAGE_SIGNING_SECRET = SIGNING_SECRET;
    assert.equal((await img(signedBefore)).status, 200, 'the configured secret back: the same URL works again');
  });

  it('12. signatures are stable across service instances / restarts with the same secret, and only with it', async () => {
    const modPath = require.resolve('../src/services/path-image.service');
    const first = require(modPath).PathImageService;
    const now = Date.now();
    const url: string = first.signedUrl('current', K_DRAFT, now);
    delete require.cache[modPath];                    // a fresh instance of the service (a restart / another replica)
    const second = require(modPath).PathImageService;
    assert.notEqual(second, first);
    assert.equal(second.signedUrl('current', K_DRAFT, now), url, 'same secret -> same signature');
    const [, exp, sig] = url.match(/exp=(\d+)&sig=([0-9a-f]+)/)!;
    assert.equal(second.verifySignature('current', K_DRAFT, exp, sig), true);
    assert.equal((await img(url)).status, 200, 'the running app accepts what another instance signed');
    process.env.PATH_IMAGE_SIGNING_SECRET = randomBytes(32).toString('hex');   // an instance configured with another secret
    assert.equal(second.verifySignature('current', K_DRAFT, exp, sig), false);
    assert.equal((await img(url)).status, 404);
  });

  it('8. the generic learning download stays as before: the learning-path bucket is not reachable through /files/download', async () => {
    const r = await call('GET', `/api/learning/files/download?bucket=learning-path-assets&key=${K_PUB}`, 'ADMIN');
    assert.equal(r.status, 404);
    assert.equal((await call('GET', `/api/learning/files/download?bucket=courses&key=${LK_PUB}`, 'ADMIN')).status, 404);
  });
});
