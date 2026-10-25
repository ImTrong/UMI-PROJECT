/**
 * FIX-INS-05: the learning-service's remaining internal per-learner routes accept ONLY the AI -> Learning credential.
 *
 *   GET  /api/learning/internal/skill-profile/:userId                 a learner's skill profile            (read)
 *   GET  /api/learning/internal/learner-analysis/:userId              a learner's competency profile       (read; BUILDS + CACHES on a miss)
 *   POST /api/learning/internal/learner-analysis/:userId/invalidate   invalidates that cached profile      (write)
 *
 * HTTP callers: the ai-service only (LearningContextService.fetchSkillProfile / fetchLearnerAnalysis, always for the signed-in
 * user); nothing calls /invalidate over HTTP. In-process callers (progress / quiz / skill-profile / evaluation code calling
 * LearnerAnalysisService and SkillProfileService directly) never touch these routes and must keep working without any token.
 * All three now require AI_LEARNING_TOKEN in X-Internal-Service-Token (constant-time, fail-closed: no INTERNAL_SERVICE_TOKEN,
 * no user token, no public default).
 *
 * The REAL express app (all routes and middleware) runs on an ephemeral port against the in-memory Prisma fake, extended here with
 * the two models these services use. LearnerAnalysisService.getProfile (which would build a profile from many sources) is replaced
 * by a recorder, so the test sees exactly whether - and for whom - the data was read; the other two services run for real.
 * Every token is random per run; the public default is read from docker-compose.yml.
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

// the two models of these services, on the shared fake (prototype: every PrismaClient instance of the app sees them)
type Row = Record<string, any>;
const skillProfiles: Row[] = [];
const analysisWrites: Array<{ op: string; where: any; data?: any }> = [];
const analysisReads: string[] = [];
Object.assign((FakePrismaClient as any).prototype, {
  userSkillProfile: {
    findUnique: async ({ where }: any) => { analysisReads.push(`skill:${where.userId}`); return skillProfiles.find((p) => p.userId === where.userId) ?? null; },
  },
  learnerAnalysis: {
    updateMany: async ({ where, data }: any) => { analysisWrites.push({ op: 'updateMany', where, data }); return { count: 1 }; },
    findUnique: async ({ where }: any) => { analysisReads.push(`analysis:${where.userId}`); return null; },
    upsert: async ({ where }: any) => { analysisWrites.push({ op: 'upsert', where }); return {}; },
  },
});
installFakePrisma();

const TOKEN = randomBytes(32).toString('hex');            // AI_LEARNING_TOKEN
const INTERNAL = randomBytes(32).toString('hex');         // INTERNAL_SERVICE_TOKEN - must not work here
const OTHERS = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')]; // COURSE_LEARNING / ORDER_LEARNING
const ALICE = 'a1'.repeat(12);
const BOB = 'b2'.repeat(12);
const SKILL = (u: string) => `/api/learning/internal/skill-profile/${u}`;
const ANALYSIS = (u: string) => `/api/learning/internal/learner-analysis/${u}`;
const INVALIDATE = (u: string) => `/api/learning/internal/learner-analysis/${u}/invalidate`;
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));

describe('FIX-INS-05: internal skill-profile / learner-analysis routes need AI_LEARNING_TOKEN', () => {
  let server: http.Server;
  let app: any;
  let base = '';
  let tmp = '';
  let LearnerAnalysisService: any;
  let SkillProfileService: any;
  const builtFor: string[] = [];
  const logs: string[] = [];

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-ins05-'));
    for (const v of ['ZIP_UPLOAD_DIR', 'ZIP_EXTRACT_DIR', 'VIDEO_UPLOAD_DIR', 'HLS_TEMP_DIR']) process.env[v] = path.join(tmp, v.toLowerCase());
    Object.assign(process.env, {
      AI_LEARNING_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: INTERNAL, COURSE_LEARNING_TOKEN: OTHERS[0], ORDER_LEARNING_TOKEN: OTHERS[1],
      RATE_LIMIT_MAX_REQUESTS: '100000', BLOCKCHAIN_ENABLED: 'false',
    });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        return original(...args);
      };
    }
    ({ LearnerAnalysisService } = require('../src/services/learner-analysis.service'));
    ({ SkillProfileService } = require('../src/services/skill-profile.service'));
    // building a full profile needs many other sources; record the call and answer a fixed profile for that learner
    mock.method(LearnerAnalysisService, 'getProfile', async (userId: string) => { builtFor.push(userId); return { userId, currentLevel: 'BEGINNER', acquiredSkills: [] }; });
    app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    process.env.AI_LEARNING_TOKEN = TOKEN;
    skillProfiles.length = 0;
    skillProfiles.push({ userId: ALICE, skills: [{ skill: 'React', level: 'INTERMEDIATE' }], overallLevel: 'INTERMEDIATE' });
    skillProfiles.push({ userId: BOB, skills: [{ skill: 'Go', level: 'ADVANCED' }], overallLevel: 'ADVANCED' });
    analysisWrites.length = 0;
    analysisReads.length = 0;
    builtFor.length = 0;
  });

  const call = async (method: string, url: string, headers: Record<string, string> = {}, payload?: unknown) => {
    const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  const withToken = (t: string) => ({ 'x-internal-service-token': t });
  const ROUTES: Array<[string, (u: string) => string]> = [['GET', SKILL], ['GET', ANALYSIS], ['POST', INVALIDATE]];
  const untouched = (label: string) => {
    assert.deepEqual(analysisReads, [], `${label}: no learner data read`);
    assert.deepEqual(analysisWrites, [], `${label}: nothing written / invalidated`);
    assert.deepEqual(builtFor, [], `${label}: no profile built`);
  };
  const FORBIDDEN = { error: 'Forbidden: Invalid internal service token' };

  // ---------------------------------------------------------------------------------------------- refused
  it('1. no token: 403 on all three routes, nothing read, built or invalidated', async () => {
    for (const [method, route] of ROUTES) {
      const res = await call(method, route(ALICE), {}, method === 'POST' ? { event: 'MANUAL_REFRESH' } : undefined);
      assert.equal(res.status, 403, `${method} ${route(ALICE)}`);
      assert.deepEqual(res.json, FORBIDDEN);
      assert.ok(!res.text.includes('React'));
    }
    untouched('no token');
  });

  it('2. a wrong token (off by one, shorter, longer, other case, empty, 10 000 chars) and the OTHER pair tokens: 403', async () => {
    const wrong = [`${TOKEN[0] === 'a' ? 'b' : 'a'}${TOKEN.slice(1)}`, TOKEN.slice(0, -1), `${TOKEN}0`, TOKEN.toUpperCase(), '', 'z'.repeat(10_000), ...OTHERS];
    for (const t of wrong) {
      for (const [method, route] of ROUTES) assert.equal((await call(method, route(ALICE), withToken(t))).status, 403, `${method} len ${t.length}`);
    }
    untouched('wrong tokens');
  });

  it('3. the old INTERNAL_SERVICE_TOKEN (configured) and its public docker-compose default cannot pass', async () => {
    assert.ok(PUBLIC_DEFAULTS.length > 0);
    for (const t of [INTERNAL, ...PUBLIC_DEFAULTS]) {
      for (const [method, route] of ROUTES) assert.equal((await call(method, route(ALICE), withToken(t))).status, 403, `${method} ${route('x')}`);
    }
    untouched('shared / public default token');
  });

  it('3b. server WITHOUT a usable AI_LEARNING_TOKEN (unset, empty, short, spaces, the public default): 500 - INTERNAL_SERVICE_TOKEN never stands in', async () => {
    for (const configured of [undefined, '', '   ', 'too-short-value', `${TOKEN.slice(0, 20)} ${TOKEN.slice(20)}`, ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.AI_LEARNING_TOKEN;
      else process.env.AI_LEARNING_TOKEN = configured;
      for (const headers of [{}, withToken(TOKEN), withToken(INTERNAL), withToken(configured ?? '')]) {
        for (const [method, route] of ROUTES) {
          const res = await call(method, route(ALICE), headers);
          assert.equal(res.status, 500);
          assert.deepEqual(res.json, { error: 'Internal service authentication not configured' });
        }
      }
    }
    untouched('not configured');
  });

  it('5/6. a browser / signed-in user cannot read or invalidate anyone by changing userId - not another learner, not even themselves', async () => {
    const userHeaders = { authorization: 'Bearer alice-session', cookie: 'token=alice-session', 'x-user-id': ALICE, 'x-user-role': 'ADMIN', 'x-internal-service': 'true' };
    for (const target of [ALICE, BOB]) {
      for (const [method, route] of ROUTES) {
        const res = await call(method, `${route(target)}?userId=${ALICE}&role=ADMIN`, userHeaders, method === 'POST' ? { event: 'MANUAL_REFRESH', userId: ALICE } : undefined);
        assert.equal(res.status, 403, `${method} ${target}`);
        assert.ok(!res.text.includes('React') && !res.text.includes('"Go"'));
      }
    }
    untouched('user requests');
  });

  it('the token counts only in X-Internal-Service-Token (query string, body, Authorization: Bearer do not); duplicate header refused', async () => {
    assert.equal((await call('GET', `${SKILL(ALICE)}?x-internal-service-token=${TOKEN}`)).status, 403);
    assert.equal((await call('GET', ANALYSIS(ALICE), { authorization: `Bearer ${TOKEN}` })).status, 403);
    assert.equal((await call('POST', INVALIDATE(ALICE), {}, { token: TOKEN, 'x-internal-service-token': TOKEN })).status, 403);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${base}${SKILL(ALICE)}`, { headers: { 'x-internal-service-token': [TOKEN, TOKEN] } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode || 0)); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
    untouched('token elsewhere');
  });

  it('other spellings of the paths hit the same check (trailing slash, upper case) - no unprotected twin', async () => {
    assert.equal((await call('GET', `${SKILL(ALICE)}/`)).status, 403);
    assert.equal((await call('GET', ANALYSIS(ALICE).replace('/internal/', '/INTERNAL/'))).status, 403);
    assert.equal((await call('POST', `${INVALIDATE(ALICE)}/`)).status, 403);
    untouched('spellings');
  });

  // ---------------------------------------------------------------------------------------------- allowed, contract unchanged
  it('4/7. the ai-service with the right token: skill profile 200 { data } of exactly the requested learner', async () => {
    const res = await call('GET', SKILL(ALICE), withToken(TOKEN));
    assert.equal(res.status, 200);
    assert.equal(res.json.data.userId, ALICE);
    assert.equal(res.json.data.overallLevel, 'INTERMEDIATE');
    assert.deepEqual(analysisReads, [`skill:${ALICE}`]);
    const none = await call('GET', SKILL('c3'.repeat(12)), withToken(TOKEN));
    assert.equal(none.status, 200);
    assert.equal(none.json.data, null, 'unchanged contract: no profile = data null (the ai-service maps it to null)');
  });

  it('4/7. learner analysis with the right token: 200 { success: true, data } built for exactly that learner', async () => {
    const res = await call('GET', ANALYSIS(BOB), withToken(TOKEN));
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.userId, BOB);
    assert.deepEqual(builtFor, [BOB]);
  });

  it('4/7. invalidate with the right token: 200 { success, message }, invalidates only that learner; unknown events refused', async () => {
    const ok = await call('POST', INVALIDATE(ALICE), withToken(TOKEN), { event: 'COURSE_COMPLETED' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.success, true);
    assert.deepEqual(analysisWrites, [{ op: 'updateMany', where: { userId: ALICE }, data: analysisWrites[0].data }]);
    assert.ok(analysisWrites[0].data.invalidatedAt instanceof Date);
    const noEvent = await call('POST', INVALIDATE(ALICE), withToken(TOKEN));
    assert.equal(noEvent.status, 200, 'event is optional (MANUAL_REFRESH)');
    analysisWrites.length = 0;
    for (const event of ['DROP TABLE', 'x\nINJECTED LOG LINE', 42, { $ne: 1 }]) {
      assert.equal((await call('POST', INVALIDATE(ALICE), withToken(TOKEN), { event })).status, 400, JSON.stringify(event));
    }
    assert.deepEqual(analysisWrites, [], 'nothing invalidated for a refused event');
  });

  it('malformed userId: 400 after the token check (an anonymous caller learns nothing)', async () => {
    for (const [method, route] of ROUTES) {
      assert.equal((await call(method, route('not-an-id'), withToken(TOKEN))).status, 400);
      assert.equal((await call(method, route('not-an-id'))).status, 403);
    }
    untouched('malformed ids');
  });

  // ---------------------------------------------------------------------------------------------- in-process callers
  it('8. in-process callers (no HTTP) keep working without any token: invalidateCache and the skill profile lookup', async () => {
    delete process.env.AI_LEARNING_TOKEN;
    await LearnerAnalysisService.invalidateCache(BOB, 'QUIZ_COMPLETED');
    assert.deepEqual(analysisWrites.map((w) => [w.op, w.where]), [['updateMany', { userId: BOB }]]);
    const profile = await SkillProfileService.getProfile(ALICE);
    assert.equal(profile.userId, ALICE);
    // the in-process invalidation sites call the service directly, never one of these HTTP routes
    const srcDir = path.resolve(__dirname, '../src');
    const listTs = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listTs(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
    const httpCallers = listTs(srcDir).filter((f) => /internal\/(skill-profile|learner-analysis)/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith('app.ts') && !f.includes('controllers'));
    assert.deepEqual(httpCallers, [], 'no learning-service code calls these routes over HTTP');
  });

  it('the token never reaches the logs', async () => {
    await call('GET', SKILL(ALICE), withToken(TOKEN));
    await call('GET', ANALYSIS(ALICE), withToken(`${TOKEN}x`));
    assert.ok(!logs.some((l) => l.includes(TOKEN)));
  });

  // ---------------------------------------------------------------------------------------------- route table
  it('route table: every route reaching these controllers runs requireServiceToken(AI_LEARNING_TOKEN) FIRST; no /internal route is left without a service token', () => {
    const { FinalProjectController } = require('../src/controllers/final-project.controller');
    const { LearnerAnalysisController } = require('../src/controllers/learner-analysis.controller');
    const guarded = [FinalProjectController.getSkillProfileInternal, LearnerAnalysisController.getProfileInternal, LearnerAnalysisController.invalidateCacheInternal];
    const layers = (app._router.stack as any[]).filter((l) => l.route && l.route.stack.some((s: any) => guarded.includes(s.handle)));
    assert.deepEqual(layers.map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`).sort(), [
      'GET /api/learning/internal/learner-analysis/:userId', 'GET /api/learning/internal/skill-profile/:userId', 'POST /api/learning/internal/learner-analysis/:userId/invalidate',
    ]);
    for (const l of layers) assert.equal(l.route.stack[0].handle.name, 'requireServiceToken(AI_LEARNING_TOKEN)', l.route.path);
    // every /internal route of the service now starts with a per-pair service token
    const internal = (app._router.stack as any[]).filter((l) => l.route && /\/internal\//.test(l.route.path));
    assert.ok(internal.length >= 4);
    for (const l of internal) assert.match(l.route.stack[0].handle.name, /^requireServiceToken\([A-Z_]+_TOKEN\)$/, l.route.path);
    assert.ok(!internal.some((l) => l.route.stack[0].handle.name === 'requireServiceToken(INTERNAL_SERVICE_TOKEN)'));
  });
});
