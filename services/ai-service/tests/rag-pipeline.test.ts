/**
 * RAG-P0 — retrieval / generation behaviour of the RAG chat, with mocked Qdrant, embeddings and LLM (no quota used):
 *   - the RelevanceGate applies RETRIEVAL_SCORE_THRESHOLD (0.56 by default and in docker-compose.yml);
 *   - no chunk above the threshold -> fixed Vietnamese "not found" answer, the LLM is NOT called (not even for the title);
 *   - citations = exactly the chunks put in the prompt;
 *   - the prompt forbids general knowledge presented as course content;
 *   - Qdrant / embedding / LLM failures are explicit errors (never success: true), leave no orphan message or conversation,
 *     and no token reaches the logs.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Harness, chunk, oid, STUDENT_A, EXPIRED_TOKEN, C1, L1 } from './helpers/rag-harness';

const h = new Harness();
const NOT_FOUND_PREFIX = 'Mình chưa tìm thấy thông tin liên quan trong tài liệu của khóa học này';

const askNew = (message = 'Middleware là gì?') =>
  h.call('POST', '/api/ai/rag/chat/new', { token: STUDENT_A.token, body: { message, courseId: C1 } });

describe('RAG-P0 retrieval gate, generation and errors', () => {
  // MAX_CONTEXT_TOKENS small enough that the context builder keeps only part of the accepted chunks (citation test)
  before(async () => { await h.start({ MAX_CONTEXT_TOKENS: '300' }); });
  after(async () => { await h.stop(); });
  beforeEach(() => h.reset());

  // ==================== threshold configuration ====================

  it('docker-compose.yml sets RETRIEVAL_SCORE_THRESHOLD to 0.56 for the ai-service (0.0 disabled the gate)', () => {
    const compose = fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8');
    const aiService = compose.slice(compose.indexOf('\n  ai-service:'), compose.indexOf('\n  qdrant:'));
    assert.match(aiService, /RETRIEVAL_SCORE_THRESHOLD: "0\.56"/);
  });

  it('loadRAGConfig: unset -> 0.56 (gate on), explicit value kept, invalid value refused', () => {
    const { loadRAGConfig } = require('../src/modules/rag/rag.config');
    const saved = process.env.RETRIEVAL_SCORE_THRESHOLD;
    try {
      delete process.env.RETRIEVAL_SCORE_THRESHOLD;
      assert.equal(loadRAGConfig().retrievalScoreThreshold, 0.56);
      process.env.RETRIEVAL_SCORE_THRESHOLD = '0.7';
      assert.equal(loadRAGConfig().retrievalScoreThreshold, 0.7);
      for (const bad of ['abc', '-0.1', '1.5']) {
        process.env.RETRIEVAL_SCORE_THRESHOLD = bad;
        assert.throws(() => loadRAGConfig(), /RETRIEVAL_SCORE_THRESHOLD/);
      }
    } finally {
      if (saved === undefined) delete process.env.RETRIEVAL_SCORE_THRESHOLD; else process.env.RETRIEVAL_SCORE_THRESHOLD = saved;
    }
  });

  it('the running RelevanceGate rejects 0.55 and keeps 0.57 (the store does not filter: the gate does)', async () => {
    h.qdrant.points = [chunk(C1, L1, 0.57, 'KEEP middleware'), chunk(C1, L1, 0.55, 'DROP noise')];
    const r = await h.call('POST', '/api/ai/rag/search', { token: STUDENT_A.token, body: { query: 'middleware', courseId: C1 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.chunks.map((c: any) => c.content), ['KEEP middleware']);
  });

  // ==================== no context -> no LLM ====================

  it('no chunk above the threshold: fixed Vietnamese answer, grounded=false, no sources, the LLM is never called', async () => {
    h.qdrant.points = [chunk(C1, L1, 0.55, 'gần đủ'), chunk(C1, L1, 0.3, 'xa')];
    const r = await askNew('Cách triển khai Kubernetes trên AWS?');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.success, true);
    assert.ok(r.body.data.message.startsWith(NOT_FOUND_PREFIX));
    assert.equal(r.body.data.grounded, false);
    assert.deepEqual(r.body.data.sources, []);
    assert.equal(h.embed.calls, 1, 'retrieval did run');
    assert.equal(h.llm.calls.length, 0, 'no answer generation');
    assert.equal(h.llm.titles, 0, 'no title generation either');
    // the honest answer is a real turn of the conversation
    assert.deepEqual(h.db.messages.map((m) => m.role), ['USER', 'ASSISTANT']);
    assert.equal(r.body.data.conversationTitle, 'Cách triển khai Kubernetes trên AWS?');
  });

  it('an empty course (no vector at all) behaves the same: not found, no LLM', async () => {
    const r = await askNew();
    assert.equal(r.status, 200);
    assert.equal(r.body.data.grounded, false);
    assert.equal(h.llm.calls.length, 0);
  });

  // ==================== citations ====================

  it('citations are exactly the chunks put in the prompt - gated-out and budget-trimmed chunks are neither sent nor cited', async () => {
    const body = (tag: string) => `${tag} ` + 'nội dung bài học về middleware '.repeat(10); // ~300 chars ~ 120 tokens
    h.qdrant.points = [
      chunk(C1, L1, 0.91, body('ALPHA')),
      chunk(C1, L1, 0.85, body('BRAVO')),
      chunk(C1, L1, 0.80, body('CHARLIE')), // passes the gate, dropped by the 300-token budget
      chunk(C1, L1, 0.40, body('DELTA')),   // rejected by the gate
    ];
    const r = await askNew();
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.grounded, true);
    assert.equal(h.llm.calls.length, 1);

    const prompt = h.llm.calls[0].systemPrompt;
    const inPrompt = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'].filter((t) => prompt.includes(`${t} nội dung`));
    assert.deepEqual(inPrompt, ['ALPHA', 'BRAVO']);

    const sources = r.body.data.sources;
    assert.deepEqual(sources.map((s: any) => s.snippet.split(' ')[0]), ['ALPHA', 'BRAVO']);
    assert.deepEqual(sources.map((s: any) => s.sourceIndex), [1, 2]);
    for (const s of sources) {
      assert.ok(prompt.includes(`[Nguồn ${s.sourceIndex}] ${s.title}`), 'each citation is a numbered source of the prompt');
      assert.equal(s.courseId, C1);
      assert.equal(s.lessonId, L1);
    }
    assert.equal(h.llm.titles, 1, 'grounded first answer: title generated');
  });

  it('the prompt restricts the model to the course documents (no general knowledge passed off as UMI content)', async () => {
    h.qdrant.points = [chunk(C1, L1, 0.9, 'middleware')];
    await askNew();
    const prompt = h.llm.calls[0].systemPrompt;
    assert.match(prompt, /Không dùng kiến thức bên ngoài/);
    assert.match(prompt, /Không trình bày kiến thức chung như thể lấy từ tài liệu UMI/);
    assert.ok(prompt.includes(NOT_FOUND_PREFIX));
    assert.doesNotMatch(prompt, /có thể bổ sung kiến thức/i);
  });

  // ==================== failures ====================

  for (const [name, arrange, status, code] of [
    ['embedding (quota)', () => { h.embed.fail = true; }, 503, 'EMBEDDING_FAILED'],
    ['Qdrant', () => { h.qdrant.fail = true; }, 503, 'VECTOR_STORE_FAILED'],
    ['LLM', () => { h.llm.fail = true; }, 502, 'LLM_FAILED'],
  ] as const) {
    it(`${name} failure: ${status} ${code}, never success, no orphan message / conversation`, async () => {
      h.qdrant.points = [chunk(C1, L1, 0.9, 'middleware')];
      arrange();
      const created = await askNew();
      assert.equal(created.status, status, created.text);
      assert.equal(created.body.success, false);
      assert.equal(created.body.error, code);
      assert.equal(typeof created.body.message, 'string');
      assert.ok(!created.text.includes('ECONNREFUSED') && !created.text.includes('quota'), 'no internal detail to the client');
      assert.equal(h.db.conversations.length, 0, 'chat/new created no conversation');

      // an existing conversation keeps no unanswered user message
      const conv = await h.db.conversation.create({ data: { userId: STUDENT_A.id, title: 't' } });
      const next = await h.call('POST', '/api/ai/rag/chat', { token: STUDENT_A.token, body: { conversationId: conv.id, message: 'tiếp?', courseId: C1 } });
      assert.equal(next.status, status);
      assert.equal(h.db.messages.length, 0);
    });
  }

  it('Qdrant down at startup and still down: 503 RAG_UNAVAILABLE (re-tried on use), not an empty "not found" answer', async () => {
    h.rag.initialized = false;
    const original = h.qdrant.getCollections;
    h.qdrant.getCollections = async () => { throw new Error('connect ECONNREFUSED'); };
    try {
      const r = await askNew();
      assert.equal(r.status, 503);
      assert.equal(r.body.error, 'RAG_UNAVAILABLE');
      assert.equal(h.llm.calls.length, 0);

      // back up: the next request initializes and works
      h.qdrant.getCollections = original;
      h.qdrant.points = [chunk(C1, L1, 0.9, 'middleware')];
      const ok = await askNew();
      assert.equal(ok.status, 200, ok.text);
      assert.equal(ok.body.data.grounded, true);
    } finally {
      h.qdrant.getCollections = original;
      h.rag.initialized = true;
    }
  });

  it('a conversation of another user is 404, nothing retrieved for it', async () => {
    const conv = await h.db.conversation.create({ data: { userId: oid(), title: 'not yours' } });
    h.qdrant.points = [chunk(C1, L1, 0.9, 'middleware')];
    const r = await h.call('POST', '/api/ai/rag/chat', { token: STUDENT_A.token, body: { conversationId: conv.id, message: 'q', courseId: C1 } });
    assert.equal(r.status, 404);
    assert.equal(h.llm.calls.length, 0);
    assert.equal(h.db.messages.length, 0);
  });

  // ==================== logs ====================

  it('no token in the logs: refused login, failures and the axios errors of upstream calls', async () => {
    // refused login (the auth-service answers 401 for an expired token)
    await h.call('POST', '/api/ai/rag/chat/new', { token: EXPIRED_TOKEN, body: { message: 'q', courseId: C1 } });
    // failing pipeline + failing upstream
    h.llm.fail = true;
    h.qdrant.points = [chunk(C1, L1, 0.9, 'middleware')];
    await askNew();
    h.courseServiceDown = true;
    await askNew();

    // any code that would still hand a raw axios error / headers to the logger is masked by the logger itself
    const axios = require('axios');
    try {
      await axios.post(`${h.base.replace(/:\d+$/, ':9')}/nowhere`, { token: STUDENT_A.token }, { headers: { Authorization: `Bearer ${STUDENT_A.token}` }, timeout: 500 });
    } catch (error) {
      h.logger.error('raw axios error:', error);
      h.logger.warn('raw meta', { error, headers: { authorization: `Bearer ${STUDENT_A.token}` }, note: `token=${STUDENT_A.token}` });
    }
    h.logger.error(`api key AIza${'x'.repeat(35)} and body {"token":"opaque-non-jwt-secret"}`);
    await new Promise((r) => setTimeout(r, 50));

    const all = h.logs.join('\n');
    assert.ok(all.length > 0, 'logs were captured');
    for (const secret of [...h.secrets(), 'opaque-non-jwt-secret', `AIza${'x'.repeat(35)}`]) {
      assert.ok(!all.includes(secret), `secret leaked: ${secret.slice(0, 8)}...`);
    }
    assert.match(all, /Authentication refused by auth-service \(HTTP 401\)/);
    assert.match(all, /\[REDACTED\]/);
  });
});
