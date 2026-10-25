/**
 * FIX-INS-06 - learning-service side of the course-service's internal routes, now guarded by the Course <-> Learning credential
 * COURSE_LEARNING_TOKEN:
 *   GET  /api/courses/internal/:courseId/lessons        CourseAccessService.fetchCourseLessons, CourseClientService.getCourseMetadata,
 *                                                       ProgressService.getCurrentLessonCount, StreamService / HLSStreamService
 *                                                       (lesson lookup fallback)
 *   POST /api/courses/recommendations/batch             HomeRecommendationService.fetchCoursesBatch / fetchCoursesByIds
 * Every one sends COURSE_LEARNING_TOKEN in X-Internal-Service-Token - and nothing at all without a usable value (no fallback to
 * INTERNAL_SERVICE_TOKEN, a default or ""): each then fails exactly as it already did when the course-service was down.
 *
 * The course-service is a loopback stub that answers like the real routes (403 unless the right token) and records every call;
 * the database is the in-memory Prisma fake. Every token is random per run.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { installFakePrisma, db } from './helpers/fake-prisma';

installFakePrisma();

const TOKEN = randomBytes(32).toString('hex');     // COURSE_LEARNING_TOKEN
const SHARED = randomBytes(32).toString('hex');    // INTERNAL_SERVICE_TOKEN - never sent here
const COURSE = 'c1'.repeat(12);
const LESSON = 'l1'.repeat(12);
const LESSONS = [{ id: LESSON, title: 'Intro', duration: 120, videoUrl: '/api/courses/files/download?bucket=courses&key=v1', order: 0 }];

describe('FIX-INS-06 learning-service: every course-service internal call carries COURSE_LEARNING_TOKEN', () => {
  let stub: http.Server;
  let svc: Record<string, any> = {};
  const calls: Array<{ method: string; url: string; token: unknown }> = [];
  let accepted = TOKEN;

  before(async () => {
    stub = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const url = req.url || '';
        calls.push({ method: req.method || '', url, token: req.headers['x-internal-service-token'] });
        res.setHeader('content-type', 'application/json');
        const internal = url.startsWith('/api/courses/internal/') || url === '/api/courses/recommendations/batch';
        if (internal && req.headers['x-internal-service-token'] !== accepted) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'Forbidden: Invalid internal service token' })); }
        if (url === `/api/courses/internal/${COURSE}/lessons`) return res.end(JSON.stringify({ data: LESSONS }));
        if (url === '/api/courses/recommendations/batch') return res.end(JSON.stringify({ data: [{ id: COURSE, title: 'Course' }] }));
        if (url === `/api/courses/${COURSE}`) return res.end(JSON.stringify({ data: { id: COURSE, title: 'Course', published: true, price: 100 } }));
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, { COURSE_SERVICE_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`, COURSE_LEARNING_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    svc = {
      access: require('../src/services/course-access.service').CourseAccessService,
      client: require('../src/services/course-client.service').CourseClientService,
      progress: require('../src/services/progress.service').ProgressService,
      home: require('../src/services/home-recommendation.service').HomeRecommendationService,
      stream: require('../src/services/stream.service').StreamService,
      hls: require('../src/services/hls-stream.service').HLSStreamService,
    };
  });

  after(async () => { await new Promise((resolve) => stub.close(resolve)); });

  beforeEach(() => {
    calls.length = 0;
    accepted = TOKEN;
    process.env.COURSE_LEARNING_TOKEN = TOKEN;
    db.reset();
    db.seed('lessonProgress', { userId: 'u1'.repeat(12), courseId: COURSE, lessonId: LESSON });
    svc.client.cache?.clear?.();
  });

  const internalCalls = () => calls.filter((c) => c.url.startsWith('/api/courses/internal/') || c.url === '/api/courses/recommendations/batch');

  it('each caller sends the token and gets the unchanged contract', async () => {
    assert.deepEqual(await svc.access.fetchCourseLessons(COURSE), LESSONS);
    assert.equal(await svc.progress.getCurrentLessonCount(COURSE), 1);
    const meta = await svc.client.getCourseMetadata(COURSE);
    assert.equal(meta.id, COURSE);
    assert.deepEqual(await svc.home.fetchCoursesBatch({ sortBy: 'rating', limit: 10 }), [{ id: COURSE, title: 'Course' }]);
    assert.deepEqual(await svc.home.fetchCoursesByIds([COURSE]), [{ id: COURSE, title: 'Course' }]);
    assert.equal((await svc.stream.fetchLessonFromCourseService(LESSON)).id, LESSON);
    assert.equal((await svc.hls.fetchLesson(LESSON)).id, LESSON);
    const sent = internalCalls();
    assert.ok(sent.length >= 7);
    for (const c of sent) assert.equal(c.token, TOKEN, `${c.method} ${c.url}`);
    assert.ok(!sent.some((c) => c.token === SHARED), 'INTERNAL_SERVICE_TOKEN is never sent');
  });

  it('WITHOUT a usable COURSE_LEARNING_TOKEN nothing internal is sent and every caller fails as on a course-service outage', async () => {
    for (const configured of [undefined, '', 'too-short-value']) {
      if (configured === undefined) delete process.env.COURSE_LEARNING_TOKEN;
      else process.env.COURSE_LEARNING_TOKEN = configured;
      await assert.rejects(() => svc.access.fetchCourseLessons(COURSE), (e: any) => e.statusCode === 503, 'fails closed: 503, never a guessed list');
      assert.equal(await svc.progress.getCurrentLessonCount(COURSE), 0);
      assert.deepEqual(await svc.home.fetchCoursesBatch({ sortBy: 'rating', limit: 10 }), []);
      await assert.rejects(() => svc.stream.fetchLessonFromCourseService(LESSON));
      await assert.rejects(() => svc.hls.fetchLesson(LESSON));
    }
    assert.deepEqual(internalCalls(), [], 'no request to an internal course-service route');
  });

  it('a refused call (the course-service expects another value) is handled like an outage, not a crash', async () => {
    accepted = randomBytes(32).toString('hex');
    await assert.rejects(() => svc.access.fetchCourseLessons(COURSE), (e: any) => e.statusCode === 404 || e.statusCode === 503);
    assert.equal(await svc.progress.getCurrentLessonCount(COURSE), 0);
    assert.deepEqual(await svc.home.fetchCoursesBatch({ limit: 5 }), []);
  });

  it('static: every place that builds a course-service internal URL sends courseInternalHeaders() (except the PUT to a route that does not exist)', () => {
    const dir = path.resolve(__dirname, '../src');
    const listTs = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listTs(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
    const offenders: string[] = [];
    for (const f of listTs(dir)) {
      const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/\/api\/courses\/(internal\/|recommendations\/batch)/.test(line) || /^\s*(\*|\/\/)/.test(line)) return;
        const window = lines.slice(i, i + 4).join('\n');
        if (/axios\.put\(/.test(lines.slice(Math.max(0, i - 2), i + 1).join('\n'))) return; // hls-queue: PUT to a route the course-service does not have
        if (!/courseInternalHeaders\(\)/.test(window)) offenders.push(`${path.relative(dir, f)}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, []);
  });
});
