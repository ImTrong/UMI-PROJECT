/**
 * RAG-P0 — access control of the RAG routes (/api/ai/rag/search, /rag/chat, /rag/chat/new, /rag/index/*, /rag/documents).
 *
 * The decision comes from the course-service (course, instructorId, lessons) and the learning-service (enrollment), asked with
 * the caller's own token - both are a loopback stub here (tests/helpers/rag-harness.ts). Qdrant, embeddings, the LLM and MongoDB
 * are fakes: nothing is written, no paid API is called.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  Harness, chunk, oid,
  ADMIN, INSTR1, INSTR2, STUDENT_A, STUDENT_B, EXPIRED_TOKEN,
  C1, C2, C_DRAFT, L1, L1_VIDEO, L2,
} from './helpers/rag-harness';

const h = new Harness();

/** No retrieval, no generation, nothing persisted. */
function assertNothingRetrieved() {
  assert.equal(h.embed.calls, 0, 'no query embedding');
  assert.equal(h.qdrant.queries.length, 0, 'no vector search');
  assert.equal(h.llm.calls.length, 0, 'no LLM call');
  assert.equal(h.llm.titles, 0, 'no title LLM call');
  assert.equal(h.db.messages.length, 0, 'no message saved');
  assert.equal(h.db.conversations.length, 0, 'no conversation created');
}

function assertNoSecretInLogs() {
  const all = h.logs.join('\n');
  for (const secret of h.secrets()) assert.ok(!all.includes(secret), 'a token reached the logs');
}

describe('RAG-P0 access control', () => {
  before(async () => { await h.start(); });
  after(async () => { await h.stop(); });
  beforeEach(() => {
    h.reset();
    h.qdrant.points = [
      chunk(C1, L1, 0.9, 'C1 SECRET: middleware chạy theo thứ tự'),
      chunk(C2, L2, 0.95, 'C2 SECRET: decorator bọc một hàm'),
    ];
  });
  after(() => assertNoSecretInLogs());

  it('without a valid login every RAG route answers 401 and nothing is retrieved, indexed or listed', async () => {
    const routes: Array<[string, string, unknown]> = [
      ['POST', '/api/ai/rag/search', { query: 'middleware', courseId: C1 }],
      ['POST', '/api/ai/rag/chat', { conversationId: oid(), message: 'middleware?', courseId: C1 }],
      ['POST', '/api/ai/rag/chat/new', { message: 'middleware?', courseId: C1 }],
      ['POST', '/api/ai/rag/index/document', { sourceType: 'DOCUMENT', sourceId: 'x', content: 'x', courseId: C1 }],
      ['POST', '/api/ai/rag/index/lesson', { courseId: C1, lessonId: L1 }],
      ['DELETE', `/api/ai/rag/index/document/${oid()}`, undefined],
      ['GET', '/api/ai/rag/documents', undefined],
    ];
    for (const token of [undefined, EXPIRED_TOKEN]) {
      for (const [method, path, body] of routes) {
        const r = await h.call(method, path, { token, body });
        assert.equal(r.status, 401, `${method} ${path} with ${token ? 'an expired' : 'no'} token`);
      }
    }
    assertNothingRetrieved();
    assert.equal(h.docs.ingestCalls.length + h.docs.deleteCalls.length + h.docs.listCalls.length, 0);
    assert.equal(h.calls.filter((c) => c.url.startsWith('/api/courses') || c.url.startsWith('/api/learning')).length, 0);
  });

  it('a learner NOT enrolled in the course gets 403 on chat / search - no embedding, no vector search, no LLM', async () => {
    for (const [path, body] of [
      ['/api/ai/rag/chat/new', { message: 'middleware là gì?', courseId: C1 }],
      ['/api/ai/rag/search', { query: 'middleware', courseId: C1 }],
    ] as const) {
      const r = await h.call('POST', path, { token: STUDENT_B.token, body });
      assert.equal(r.status, 403, path);
      assert.equal(r.body.error, 'COURSE_ACCESS_DENIED');
      assert.ok(!r.text.includes('SECRET'));
    }
    assertNothingRetrieved();
    // decided with the learner's own token on both upstream services
    assert.ok(h.calls.some((c) => c.url === `/api/courses/${C1}` && c.authorization === `Bearer ${STUDENT_B.token}`));
    assert.ok(h.calls.some((c) => c.url === `/api/learning/progress/course/${C1}` && c.authorization === `Bearer ${STUDENT_B.token}`));
  });

  it('an enrolled learner cannot reach another course: courseId of a course they do not have -> 403, no retrieval', async () => {
    const r = await h.call('POST', '/api/ai/rag/chat/new', { token: STUDENT_A.token, body: { message: 'decorator?', courseId: C2 } });
    assert.equal(r.status, 403);
    assertNothingRetrieved();
  });

  it('an enrolled learner is searched INSIDE the verified course only, whatever else the filter says', async () => {
    const r = await h.call('POST', '/api/ai/rag/chat/new', {
      token: STUDENT_A.token,
      body: { message: 'middleware là gì?', filter: { courseId: C1, sourceType: 'PDF', learningPathId: 'x', skills: ['a'] } },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(h.qdrant.queries.length, 1);
    assert.deepEqual(h.qdrant.queries[0].filter, { must: [{ key: 'courseId', match: { value: C1 } }] });
    assert.ok(r.body.data.sources.every((s: any) => s.courseId === C1));
    assert.ok(!JSON.stringify(h.llm.calls).includes('C2 SECRET'));
  });

  it('body courseId and filter.courseId that disagree are refused (400), not resolved in favour of either', async () => {
    const r = await h.call('POST', '/api/ai/rag/search', { token: STUDENT_A.token, body: { query: 'q', courseId: C1, filter: { courseId: C2 } } });
    assert.equal(r.status, 400);
    assertNothingRetrieved();
  });

  it('courseId is mandatory (400), malformed (400) or unknown (404) - never a search over every course', async () => {
    for (const [body, status] of [
      [{ message: 'middleware?' }, 400],
      [{ message: 'middleware?', courseId: 'not-an-id' }, 400],
      [{ message: 'middleware?', courseId: oid() }, 404],
    ] as const) {
      const r = await h.call('POST', '/api/ai/rag/chat/new', { token: ADMIN.token, body });
      assert.equal(r.status, status, JSON.stringify(body));
    }
    assertNothingRetrieved();
  });

  it('a lessonId of ANOTHER course is refused (404 LESSON_NOT_IN_COURSE); a lesson of the course narrows the filter', async () => {
    const bad = await h.call('POST', '/api/ai/rag/search', { token: STUDENT_A.token, body: { query: 'q', courseId: C1, lessonId: L2 } });
    assert.equal(bad.status, 404);
    assert.equal(bad.body.error, 'LESSON_NOT_IN_COURSE');
    assertNothingRetrieved();

    const ok = await h.call('POST', '/api/ai/rag/search', { token: STUDENT_A.token, body: { query: 'q', courseId: C1, lessonId: L1 } });
    assert.equal(ok.status, 200);
    assert.deepEqual(h.qdrant.queries[0].filter.must, [
      { key: 'courseId', match: { value: C1 } },
      { key: 'lessonId', match: { value: L1 } },
    ]);
  });

  it('defense in depth: a vector store that ignores the filter still cannot leak another course\'s chunk', async () => {
    h.qdrant.leaky = true;
    const search = await h.call('POST', '/api/ai/rag/search', { token: STUDENT_A.token, body: { query: 'q', courseId: C1 } });
    assert.equal(search.status, 200);
    assert.ok(!search.text.includes('C2 SECRET'));
    assert.deepEqual(search.body.data.chunks.map((c: any) => c.metadata.courseId), [C1]);

    const chat = await h.call('POST', '/api/ai/rag/chat/new', { token: STUDENT_A.token, body: { message: 'q', courseId: C1 } });
    assert.equal(chat.status, 200);
    assert.ok(!chat.text.includes(C2));
    assert.ok(!h.llm.calls[0].systemPrompt.includes('C2 SECRET'));
  });

  it('the course instructor and ADMIN may read the course; an unpublished course is hidden from other instructors', async () => {
    for (const user of [INSTR1, ADMIN]) {
      const r = await h.call('POST', '/api/ai/rag/search', { token: user.token, body: { query: 'q', courseId: C1 } });
      assert.equal(r.status, 200, user.email);
    }
    const r = await h.call('POST', '/api/ai/rag/search', { token: INSTR2.token, body: { query: 'q', courseId: C_DRAFT } });
    assert.equal(r.status, 403);
  });

  it('search ignores a client scoreThreshold (the RelevanceGate stays) and caps topK', async () => {
    h.qdrant.points = [chunk(C1, L1, 0.9, 'good'), chunk(C1, L1, 0.1, 'noise')];
    const r = await h.call('POST', '/api/ai/rag/search', { token: STUDENT_A.token, body: { query: 'q', courseId: C1, scoreThreshold: 0, topK: 1000 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.chunks.map((c: any) => c.content), ['good']);
    assert.equal(h.qdrant.queries[0].limit, 10);
    assert.equal(h.qdrant.queries[0].score_threshold, 0.56);
  });

  it('an upstream outage is fail-closed: 503 ACCESS_CHECK_FAILED, nothing retrieved', async () => {
    h.courseServiceDown = true;
    let r = await h.call('POST', '/api/ai/rag/search', { token: ADMIN.token, body: { query: 'q', courseId: C1 } });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'ACCESS_CHECK_FAILED');
    h.courseServiceDown = false;
    h.learningServiceDown = true;
    r = await h.call('POST', '/api/ai/rag/search', { token: STUDENT_A.token, body: { query: 'q', courseId: C1 } });
    assert.equal(r.status, 503);
    assert.notEqual(r.body.success, true);
    assertNothingRetrieved();
  });

  // ==================== index / delete / list ====================

  it('a learner cannot index, delete or list (403 from requireAdmin)', async () => {
    const doc = { id: oid(), sourceType: 'DOCUMENT', sourceId: 'd', status: 'ACTIVE', metadata: { courseId: C1 } };
    h.docs.byId.set(doc.id, doc);
    assert.equal((await h.call('POST', '/api/ai/rag/index/document', { token: STUDENT_A.token, body: { sourceType: 'DOCUMENT', sourceId: 'x', content: 'x', courseId: C1 } })).status, 403);
    assert.equal((await h.call('DELETE', `/api/ai/rag/index/document/${doc.id}`, { token: STUDENT_A.token })).status, 403);
    assert.equal((await h.call('GET', `/api/ai/rag/documents?courseId=${C1}`, { token: STUDENT_A.token })).status, 403);
    assert.equal(h.docs.ingestCalls.length + h.docs.deleteCalls.length + h.docs.listCalls.length, 0);
  });

  it('an instructor cannot index into a course they do not teach (403) and nothing is ingested', async () => {
    for (const body of [
      { sourceType: 'DOCUMENT', sourceId: 'notes-1', content: 'abc', courseId: C2 },
      { sourceType: 'DOCUMENT', sourceId: 'notes-1', content: 'abc', metadata: { courseId: C2 } },
    ]) {
      const r = await h.call('POST', '/api/ai/rag/index/document', { token: INSTR1.token, body });
      assert.equal(r.status, 403);
    }
    const lesson = await h.call('POST', '/api/ai/rag/index/lesson', { token: INSTR1.token, body: { courseId: C2, lessonId: L2 } });
    assert.equal(lesson.status, 403);
    assert.equal(h.docs.ingestCalls.length, 0);
  });

  it('an instructor indexes their own course; the stored metadata is the VERIFIED scope, extra keys dropped', async () => {
    const r = await h.call('POST', '/api/ai/rag/index/document', {
      token: INSTR1.token,
      body: { sourceType: 'DOCUMENT', sourceId: 'notes-1', content: 'abc', title: 'Notes', metadata: { courseId: C1, learningPathId: 'evil', skills: ['express'], role: 'ADMIN' } },
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(h.docs.ingestCalls.length, 1);
    const [sourceType, sourceId, content, title, metadata] = h.docs.ingestCalls[0];
    assert.deepEqual([sourceType, sourceId, content, title], ['DOCUMENT', 'notes-1', 'abc', 'Notes']);
    assert.deepEqual(metadata, { courseId: C1, skills: ['express'] });
  });

  it('a lesson of another course cannot be attached to your course (index/document and index/lesson)', async () => {
    const asDoc = await h.call('POST', '/api/ai/rag/index/document', { token: INSTR1.token, body: { sourceType: 'LESSON', sourceId: L2, content: 'x', courseId: C1 } });
    assert.equal(asDoc.status, 404);
    const withLesson = await h.call('POST', '/api/ai/rag/index/document', { token: INSTR1.token, body: { sourceType: 'DOCUMENT', sourceId: 'x', content: 'x', courseId: C1, lessonId: L2 } });
    assert.equal(withLesson.status, 404);
    const asLesson = await h.call('POST', '/api/ai/rag/index/lesson', { token: INSTR1.token, body: { courseId: C1, lessonId: L2 } });
    assert.equal(asLesson.status, 404);
    assert.equal(h.docs.ingestCalls.length, 0);
  });

  it('re-indexing a source that belongs to another course is refused (409) - it would archive that course\'s document', async () => {
    const theirs = { id: oid(), sourceType: 'DOCUMENT', sourceId: 'shared-name', status: 'ACTIVE', metadata: { courseId: C2 } };
    h.docs.byId.set(theirs.id, theirs);
    const r = await h.call('POST', '/api/ai/rag/index/document', { token: INSTR1.token, body: { sourceType: 'DOCUMENT', sourceId: 'shared-name', content: 'x', courseId: C1 } });
    assert.equal(r.status, 409);
    assert.equal(h.docs.ingestCalls.length, 0);
  });

  it('index/lesson builds the content from the lesson the course-service returned (never from a broken endpoint); video-only -> 422', async () => {
    const ok = await h.call('POST', '/api/ai/rag/index/lesson', { token: INSTR1.token, body: { courseId: C1, lessonId: L1 } });
    assert.equal(ok.status, 201, ok.text);
    const [sourceType, sourceId, content, title, metadata] = h.docs.ingestCalls[0];
    assert.deepEqual([sourceType, sourceId, title, metadata], ['LESSON', L1, 'Middleware', { courseId: C1, lessonId: L1 }]);
    assert.match(content, /Middleware trong ExpressJS/);

    const video = await h.call('POST', '/api/ai/rag/index/lesson', { token: INSTR1.token, body: { courseId: C1, lessonId: L1_VIDEO } });
    assert.equal(video.status, 422);
    assert.equal(h.docs.ingestCalls.length, 1);
    assert.ok(!h.calls.some((c) => c.url.startsWith('/api/courses/lessons/')));
  });

  it('delete: only ADMIN or the instructor of the document\'s course; a course-less document is ADMIN only', async () => {
    const ofC1 = { id: oid(), sourceType: 'DOCUMENT', sourceId: 'a', status: 'ACTIVE', metadata: { courseId: C1 } };
    const legacy = { id: oid(), sourceType: 'DOCUMENT', sourceId: 'b', status: 'ACTIVE', metadata: {} };
    h.docs.byId.set(ofC1.id, ofC1);
    h.docs.byId.set(legacy.id, legacy);

    assert.equal((await h.call('DELETE', `/api/ai/rag/index/document/${ofC1.id}`, { token: INSTR2.token })).status, 403);
    assert.equal((await h.call('DELETE', `/api/ai/rag/index/document/${legacy.id}`, { token: INSTR1.token })).status, 403);
    assert.equal((await h.call('DELETE', `/api/ai/rag/index/document/${oid()}`, { token: ADMIN.token })).status, 404);
    assert.deepEqual(h.docs.deleteCalls, []);

    assert.equal((await h.call('DELETE', `/api/ai/rag/index/document/${ofC1.id}`, { token: INSTR1.token })).status, 200);
    assert.equal((await h.call('DELETE', `/api/ai/rag/index/document/${legacy.id}`, { token: ADMIN.token })).status, 200);
    assert.deepEqual(h.docs.deleteCalls, [ofC1.id, legacy.id]);
  });

  it('list: an instructor must name a course they teach and sees only its documents; ADMIN may list all', async () => {
    h.docs.byId.set('d1', { id: 'd1', metadata: { courseId: C1 } });
    h.docs.byId.set('d2', { id: 'd2', metadata: { courseId: C2 } });

    assert.equal((await h.call('GET', '/api/ai/rag/documents', { token: INSTR1.token })).status, 400);
    assert.equal((await h.call('GET', `/api/ai/rag/documents?courseId=${C2}`, { token: INSTR1.token })).status, 403);
    const own = await h.call('GET', `/api/ai/rag/documents?courseId=${C1}`, { token: INSTR1.token });
    assert.equal(own.status, 200);
    assert.deepEqual(own.body.data.documents.map((d: any) => d.id), ['d1']);

    const all = await h.call('GET', '/api/ai/rag/documents', { token: ADMIN.token });
    assert.equal(all.status, 200);
    assert.equal(all.body.data.total, 2);
  });
});
