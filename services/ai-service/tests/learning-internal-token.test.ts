/**
 * FIX-INS-05 - ai-service side of the AI -> Learning credential AI_LEARNING_TOKEN.
 *
 *   LearningContextService.fetchSkillProfile    -> GET /api/learning/internal/skill-profile/:userId
 *   LearningContextService.fetchLearnerAnalysis -> GET /api/learning/internal/learner-analysis/:userId
 * both send AI_LEARNING_TOKEN in X-Internal-Service-Token - and nothing at all without a usable value (no fallback to
 * INTERNAL_SERVICE_TOKEN, a default or ""). Either way the response contract to the AI code is unchanged: the data, or null.
 * The userId they send is the signed-in user (ai.controller -> req.user.userId), checked statically below.
 *
 * The learning-service is a loopback stub that answers like the real routes (403 unless the right token) and records every call.
 * Every token is random per run; the public default is read from docker-compose.yml.
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

const TOKEN = randomBytes(32).toString('hex');      // AI_LEARNING_TOKEN
const SHARED = randomBytes(32).toString('hex');     // INTERNAL_SERVICE_TOKEN - never sent here
const ALICE = 'a1'.repeat(12);
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));

describe('FIX-INS-05 ai-service: AI_LEARNING_TOKEN on the learning-service internal routes', () => {
  let stub: http.Server;
  let LCS: any;
  const calls: Array<{ url: string; token: unknown; authorization: unknown }> = [];
  const logs: string[] = [];
  let accepted = TOKEN;

  before(async () => {
    stub = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        calls.push({ url: req.url || '', token: req.headers['x-internal-service-token'], authorization: req.headers.authorization });
        res.setHeader('content-type', 'application/json');
        if (req.headers['x-internal-service-token'] !== accepted) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'Forbidden: Invalid internal service token' })); }
        if ((req.url || '').includes('/skill-profile/')) return res.end(JSON.stringify({ data: { userId: ALICE, overallLevel: 'INTERMEDIATE' } }));
        return res.end(JSON.stringify({ success: true, data: { userId: ALICE, currentLevel: 'BEGINNER' } }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, { LEARNING_SERVICE_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`, AI_LEARNING_TOKEN: TOKEN, INTERNAL_SERVICE_TOKEN: SHARED });
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack} ${JSON.stringify((a as any).config || {})}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        return original(...args);
      };
    }
    ({ LearningContextService: LCS } = require('../src/services/learning-context.service'));
    LCS.initialize();
  });

  after(async () => { await new Promise((resolve) => stub.close(resolve)); });

  beforeEach(() => {
    calls.length = 0;
    logs.length = 0;
    accepted = TOKEN;
    process.env.AI_LEARNING_TOKEN = TOKEN;
  });

  it('fetchLearnerAnalysis sends AI_LEARNING_TOKEN (not INTERNAL_SERVICE_TOKEN, no user Authorization) and returns data (unchanged contract)', async () => {
    const data = await LCS.fetchLearnerAnalysis(ALICE);
    assert.deepEqual(data, { userId: ALICE, currentLevel: 'BEGINNER' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `/api/learning/internal/learner-analysis/${ALICE}`);
    assert.equal(calls[0].token, TOKEN);
    assert.equal(calls[0].authorization, undefined);
    assert.ok(!JSON.stringify(calls[0]).includes(SHARED));
  });

  it('fetchSkillProfile sends AI_LEARNING_TOKEN and returns data (unchanged contract)', async () => {
    const data = await LCS.fetchSkillProfile(ALICE);
    assert.deepEqual(data, { userId: ALICE, overallLevel: 'INTERMEDIATE' });
    assert.deepEqual(calls.map((c) => [c.url, c.token]), [[`/api/learning/internal/skill-profile/${ALICE}`, TOKEN]]);
  });

  it('WITHOUT a usable AI_LEARNING_TOKEN (unset, empty, short, spaces, the public default) nothing is sent and both return null - no fallback', async () => {
    for (const configured of [undefined, '', '   ', 'too-short-value', `${TOKEN.slice(0, 20)} ${TOKEN.slice(20)}`, ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.AI_LEARNING_TOKEN;
      else process.env.AI_LEARNING_TOKEN = configured;
      assert.equal(await LCS.fetchLearnerAnalysis(ALICE), null);
      assert.equal(await LCS.fetchSkillProfile(ALICE), null);
    }
    assert.equal(calls.length, 0, 'no request at all');
    assert.ok(logs.some((l) => l.includes('AI_LEARNING_TOKEN')));
  });

  it('a refused call (the learning-service expects another value) degrades to null and the token never reaches the logs', async () => {
    accepted = randomBytes(32).toString('hex');
    assert.equal(await LCS.fetchLearnerAnalysis(ALICE), null);
    assert.equal(await LCS.fetchSkillProfile(ALICE), null);
    assert.equal(calls.length, 2);
    assert.ok(!logs.some((l) => l.includes(TOKEN)));
  });

  it('the userId of both calls comes from the signed-in user (static check of the call chain)', () => {
    const src = (f: string) => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
    const ctrl = src('controllers/ai.controller.ts');
    assert.match(ctrl, /const userId = req\.user\?\.userId;[\s\S]*?CompetencyAnalysisService\.generateFullAnalysis\(userId, token\)/);
    assert.match(src('services/competency-analysis.service.ts'), /LearningContextService\.fetchLearnerAnalysis\(userId\)/);
    assert.match(src('services/learning-context.service.ts'), /this\.fetchSkillProfile\(userId\)/);
    // the only places building these URLs
    const builders = ['services/learning-context.service.ts'];
    for (const f of builders) assert.equal((src(f).match(/\/api\/learning\/internal\/(skill-profile|learner-analysis)\/\$\{/g) || []).length, 2);
  });
});
