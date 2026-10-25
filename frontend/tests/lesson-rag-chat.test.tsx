/**
 * RAG-MVP-05A — lesson chat ("Hỏi về bài học") on the learning page.
 *  - requests: /api/ai/rag/chat/new for the first question, /api/ai/rag/chat with that conversation afterwards, always with the
 *    courseId / lessonId of the open lesson and the learner's own token - nothing else (no role, filter, secret);
 *  - one thread per lesson: switching lesson never continues the previous lesson's conversation, a late answer lands in the
 *    lesson that asked;
 *  - citations: only sources whose "[Nguồn n]" appears in the answer are shown as used, the others apart;
 *  - states: answering, not found (grounded=false), 401 / 403 (blocked, no retry), 503 (retry), conversation gone, network.
 * The HTTP layer is the project's own aiApi with a recording adapter - no network, no Gemini, no conversation created.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const storage: Record<string, string> = { accessToken: 'learner-access-token', refreshToken: 'learner-refresh-token' };
(globalThis as any).localStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
};
(globalThis as any).window = { location: { pathname: '/learning/c', href: '' } };

import axios from 'axios';
import { aiApi } from '../src/services/api';
import { ragChatService, RagChatError, RagSource } from '../src/services/rag-chat.service';
import {
  askLesson, emptyThread, extractCitedIndexes, lessonChatReducer, scopeKeyOf, splitSources, threadOf,
  LessonChatAction, ThreadsState,
} from '../src/utils/lesson-chat';
import { ChatTurnView, LessonChatView, SourcesBlock } from '../src/components/learning/LessonChatPanel';

const COURSE = '6adca354c844ec0018eabe6e';
const LESSON_A = '6adcf29b1fc7d9e53afc8bfc';
const LESSON_B = '6adcf3771fc7d9e53afc8bfd';
const A = { courseId: COURSE, lessonId: LESSON_A };
const B = { courseId: COURSE, lessonId: LESSON_B };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const noop = () => undefined;

const source = (n: number, chunkIndex = n): RagSource => ({
  sourceIndex: n, documentId: 'doc1', chunkId: `doc1_chunk_${chunkIndex}`, chunkIndex, courseId: COURSE, lessonId: LESSON_A,
  title: 'Bài 1', score: 0.9 - n / 100, snippet: `đoạn trích ${n}`,
});

// ==================== recording adapter ====================

interface Call { url: string; body: any; headers: Record<string, unknown> }
let calls: Call[] = [];
type Reply = { status: number; data: any } | 'network' | (() => Promise<{ status: number; data: any }>);
let replies: Reply[] = [];

const httpError = (config: any, status: number, data: any) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { config, isAxiosError: true, response: { status, data, headers: {}, config } });

aiApi.defaults.adapter = (async (config: any) => {
  calls.push({ url: config.url, body: JSON.parse(config.data || '{}'), headers: { ...config.headers } });
  let reply = replies.shift();
  if (!reply) throw new Error('no reply queued');
  if (reply === 'network') throw Object.assign(new Error('Network Error'), { config, isAxiosError: true, code: 'ERR_NETWORK' });
  if (typeof reply === 'function') reply = await reply();
  if (reply.status >= 400) throw httpError(config, reply.status, reply.data);
  return { data: reply.data, status: reply.status, statusText: 'OK', headers: {}, config };
}) as any;
// the refresh-token call of the shared 401 interceptor goes through the default axios instance: the refresh is refused too
const refreshCalls: string[] = [];
axios.defaults.adapter = (async (config: any) => {
  refreshCalls.push(config.url);
  throw httpError(config, 401, { error: 'Invalid refresh token' });
}) as any;

const ok = (over: Record<string, unknown> = {}) => ({
  status: 200,
  data: {
    success: true,
    data: {
      message: 'Image là bản mẫu [Nguồn 1]; container có lớp ghi riêng [Nguồn 3].',
      messageId: 'm1', conversationId: 'conv-A', conversationTitle: 'Image và Container', grounded: true,
      sources: [source(1, 3), source(2, 0), source(3, 4)],
      retrievalStats: { totalChunksRetrieved: 3, topScore: 0.84, query: 'q' },
      ...over,
    },
  },
});
const ragError = (status: number, error: string, message: string) => ({ status, data: { success: false, error, message } });

beforeEach(() => {
  calls = [];
  replies = [];
  refreshCalls.length = 0;
  storage.accessToken = 'learner-access-token';
  storage.refreshToken = 'learner-refresh-token';
});

/** A tiny store around the real reducer, as the panel's useReducer would be. */
function store() {
  let state: ThreadsState = {};
  const dispatch = (a: LessonChatAction) => { state = lessonChatReducer(state, a); };
  return {
    get: (scope = A) => threadOf(state, scopeKeyOf(scope)),
    ask: (scope: typeof A, q: string) => askLesson(scope, threadOf(state, scopeKeyOf(scope)), q, dispatch, ragChatService.ask),
    dispatch,
  };
}

// ==================== requests ====================

describe('requests: scope of the open lesson, learner token, new then continue', () => {
  it('the first question creates the conversation with exactly { message, courseId, lessonId } and the learner token', async () => {
    replies = [ok()];
    const result = await ragChatService.ask(A, 'Image và Container khác nhau thế nào?');
    assert.deepEqual(calls.map((c) => c.url), ['/api/ai/rag/chat/new']);
    assert.deepEqual(calls[0].body, { message: 'Image và Container khác nhau thế nào?', courseId: COURSE, lessonId: LESSON_A });
    assert.equal(calls[0].headers.Authorization, 'Bearer learner-access-token');
    assert.equal(result.conversationId, 'conv-A');
    assert.equal(result.grounded, true);
  });

  it('next questions continue that conversation on /api/ai/rag/chat with the same lesson scope', async () => {
    const s = store();
    replies = [ok(), ok({ messageId: 'm2' })];
    await s.ask(A, 'câu 1');
    await s.ask(A, 'câu 2');
    assert.deepEqual(calls.map((c) => c.url), ['/api/ai/rag/chat/new', '/api/ai/rag/chat']);
    assert.deepEqual(calls[1].body, { conversationId: 'conv-A', message: 'câu 2', courseId: COURSE, lessonId: LESSON_A });
    assert.deepEqual(s.get().turns.map((t) => t.role), ['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
  });

  it('nothing but the lesson scope is sent: no role, filter, sourceType, service token or key', async () => {
    replies = [ok()];
    await ragChatService.ask(A, 'q');
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['courseId', 'lessonId', 'message']);
    const headerNames = Object.keys(calls[0].headers).map((h) => h.toLowerCase());
    assert.ok(!headerNames.some((h) => h.includes('internal') || h.includes('api-key')));
    for (const f of ['src/services/rag-chat.service.ts', 'src/utils/lesson-chat.ts', 'src/components/learning/LessonChatPanel.tsx']) {
      const src = readFileSync(path.resolve(f), 'utf8');
      assert.doesNotMatch(src, /GEMINI|API_KEY|INTERNAL_SERVICE|SERVICE_TOKEN|isAdmin|'ADMIN'/, f);
    }
  });

  it('the learning page passes the displayed course and lesson to the panel (no client-chosen document)', () => {
    const page = readFileSync(path.resolve('src/pages/Learning.tsx'), 'utf8');
    // RAG-MVP-05D: + onSourceSelect (citation -> lesson text); the scope props are unchanged
    assert.match(page, /<LessonChatPanel courseId=\{course\.id\} lessonId=\{currentLesson\.id\} lessonTitle=\{currentLesson\.title\} onSourceSelect=\{handleSourceSelect\} \/>/);
    assert.equal((page.match(/<LessonChatPanel /g) || []).length, 1);
  });
});

// ==================== threads per lesson ====================

describe('one thread per lesson', () => {
  it('switching to another lesson starts a NEW conversation scoped to that lesson; coming back continues the first one', async () => {
    const s = store();
    replies = [ok(), ok({ conversationId: 'conv-B', message: 'B [Nguồn 1]' }), ok({ messageId: 'm3' })];
    await s.ask(A, 'câu về bài A');
    await s.ask(B, 'câu về bài B');
    await s.ask(A, 'quay lại bài A');
    assert.deepEqual(calls.map((c) => [c.url, c.body.lessonId, c.body.conversationId]), [
      ['/api/ai/rag/chat/new', LESSON_A, undefined],
      ['/api/ai/rag/chat/new', LESSON_B, undefined],
      ['/api/ai/rag/chat', LESSON_A, 'conv-A'],
    ]);
    assert.equal(s.get(A).conversationId, 'conv-A');
    assert.equal(s.get(B).conversationId, 'conv-B');
    assert.equal(s.get(B).turns.length, 2);
  });

  it('an answer that arrives after the learner moved to another lesson is written to the lesson that asked', async () => {
    const s = store();
    let release!: () => void;
    const slow = () => new Promise<{ status: number; data: any }>((resolve) => { release = () => resolve(ok()); });
    replies = [slow, ok({ conversationId: 'conv-B' })];
    const pendingA = s.ask(A, 'câu chậm của bài A');
    await new Promise((r) => setImmediate(r));
    assert.equal(s.get(A).pending, true);
    await s.ask(B, 'câu của bài B');            // the learner is now on lesson B
    assert.equal(s.get(B).pending, false);
    release();
    await pendingA;
    assert.equal(s.get(A).pending, false);
    assert.equal(s.get(A).conversationId, 'conv-A');
    assert.deepEqual(s.get(A).turns.map((t) => t.content), ['câu chậm của bài A', 'Image là bản mẫu [Nguồn 1]; container có lớp ghi riêng [Nguồn 3].']);
    assert.equal(s.get(B).conversationId, 'conv-B');
    assert.equal(s.get(B).turns.length, 2, 'lesson B got nothing from lesson A');
  });

  it('a conversation that is gone (404) is dropped: the retry starts a new conversation for the same lesson', async () => {
    const s = store();
    replies = [ok(), { status: 404, data: { error: 'Conversation not found' } }, ok({ conversationId: 'conv-A2' })];
    await s.ask(A, 'câu 1');
    await s.ask(A, 'câu 2');
    assert.equal(s.get().error?.kind, 'CONVERSATION_GONE');
    assert.equal(s.get().conversationId, null);
    await s.ask(A, s.get().error!.question);
    assert.deepEqual(calls.map((c) => c.url), ['/api/ai/rag/chat/new', '/api/ai/rag/chat', '/api/ai/rag/chat/new']);
    assert.equal(s.get().conversationId, 'conv-A2');
  });
});

// ==================== errors ====================

describe('errors', () => {
  it('403 (not enrolled): the backend message, thread blocked, no retry, the failed question not kept as sent', async () => {
    const s = store();
    replies = [ragError(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền truy cập tài liệu của khóa học này.')];
    await s.ask(A, 'q');
    const t = s.get();
    assert.equal(t.error?.kind, 'ACCESS_DENIED');
    assert.equal(t.error?.message, 'Bạn không có quyền truy cập tài liệu của khóa học này.');
    assert.equal(t.error?.retryable, false);
    assert.equal(t.blocked, true);
    assert.equal(t.turns.length, 0);
    const html = renderToStaticMarkup(<LessonChatView lessonTitle="Bài 1" thread={t} draft="" onDraftChange={noop} onSend={noop} onRetry={noop} onDismissError={noop} />);
    assert.match(html, /data-error-kind="ACCESS_DENIED"/);
    assert.doesNotMatch(html, /data-action="retry"/);
    assert.match(html, /data-state="blocked"/);
    assert.doesNotMatch(html, /<textarea/, 'no input while access is refused');
  });

  it('401: the shared interceptor tries the refresh token once; refused -> session expired, blocked, redirected to login', async () => {
    const s = store();
    replies = [{ status: 401, data: { error: 'Unauthorized' } }];
    await s.ask(A, 'q');
    assert.equal(refreshCalls.length, 1);
    assert.match(refreshCalls[0], /\/api\/auth\/refresh-token$/);
    assert.equal(s.get().error?.kind, 'SESSION_EXPIRED');
    assert.equal(s.get().blocked, true);
    assert.equal((globalThis as any).window.location.href, '/login');
    assert.equal(storage.accessToken, undefined, 'tokens cleared by the interceptor');
  });

  it('503 (Gemini / embedding / Qdrant down): the backend message with a retry that resends the same question', async () => {
    const s = store();
    replies = [ragError(503, 'EMBEDDING_FAILED', 'Không thể xử lý câu hỏi để tra cứu tài liệu lúc này. Vui lòng thử lại sau.'), ok()];
    await s.ask(A, 'Image là gì?');
    const t = s.get();
    assert.equal(t.error?.kind, 'UNAVAILABLE');
    assert.equal(t.error?.retryable, true);
    assert.equal(t.error?.question, 'Image là gì?');
    assert.equal(t.blocked, false);
    assert.equal(t.turns.length, 0);
    const html = renderToStaticMarkup(<LessonChatView lessonTitle="Bài 1" thread={t} draft="" onDraftChange={noop} onSend={noop} onRetry={noop} onDismissError={noop} />);
    assert.match(text(html), /Không thể xử lý câu hỏi để tra cứu tài liệu lúc này/);
    assert.match(html, /data-action="retry"/);
    await s.ask(A, t.error!.question);
    assert.deepEqual(calls.map((c) => c.body.message), ['Image là gì?', 'Image là gì?']);
    assert.equal(s.get().error, null);
    assert.equal(s.get().turns.length, 2);
  });

  it('network failure, rate limit and a malformed 200 are errors too, never an empty answer', async () => {
    const s = store();
    replies = ['network', { status: 429, data: { error: 'Too many requests, please try again later.' } }, { status: 200, data: { success: true } }];
    await s.ask(A, 'q1');
    assert.equal(s.get().error?.kind, 'NETWORK');
    await s.ask(A, 'q2');
    assert.equal(s.get().error?.kind, 'RATE_LIMITED');
    assert.match(s.get().error!.message, /quá nhanh/);
    await s.ask(A, 'q3');
    assert.equal(s.get().error?.kind, 'UNAVAILABLE');
    assert.equal(s.get().turns.length, 0);
  });

  it('toRagChatError never shows an English technical body as the message', async () => {
    replies = [{ status: 400, data: { error: 'conversationId and message are required' } }];
    await assert.rejects(ragChatService.ask(A, 'q', 'c'), (e: RagChatError) => e.kind === 'INVALID_REQUEST' && !/required/.test(e.message));
  });
});

// ==================== citations and rendering ====================

describe('citations', () => {
  it('extractCitedIndexes reads "[Nguồn n]", grouped and decomposed-Unicode markers', () => {
    assert.deepEqual(extractCitedIndexes('a [Nguồn 1], b [Nguồn 3] c [Nguồn 1]'), [1, 3]);
    assert.deepEqual(extractCitedIndexes('x [Nguồn 2, 4] y [nguồn 5 và 6]'), [2, 4, 5, 6]);
    assert.deepEqual(extractCitedIndexes('[Nguồn 7]'.normalize('NFD')), [7]);
    assert.deepEqual(extractCitedIndexes('không trích dẫn'), []);
  });

  it('splitSources: cited = used, the rest apart, markers without a source reported', () => {
    const split = splitSources('[Nguồn 3] rồi [Nguồn 1] và [Nguồn 9]', [source(1), source(2), source(3)]);
    assert.deepEqual(split.used.map((s) => s.sourceIndex), [1, 3]);
    assert.deepEqual(split.unused.map((s) => s.sourceIndex), [2]);
    assert.deepEqual(split.unknownMarkers, [9]);
  });

  it('only cited sources are rendered as used; uncited ones are inside a separate, labelled group', () => {
    const html = renderToStaticMarkup(<SourcesBlock split={splitSources('A [Nguồn 1]. B [Nguồn 3].', [source(1, 3), source(2, 0), source(3, 4)])} />);
    const used = html.slice(html.indexOf('data-group="used"'), html.indexOf('data-group="unused"'));
    const unused = html.slice(html.indexOf('data-group="unused"'));
    assert.deepEqual([...used.matchAll(/data-source-index="(\d+)"/g)].map((m) => m[1]), ['1', '3']);
    assert.deepEqual([...unused.matchAll(/data-source-index="(\d+)"/g)].map((m) => m[1]), ['2']);
    assert.match(text(html), /Nguồn được trích dẫn/);
    assert.match(text(html), /Đoạn được truy xuất nhưng không được trích dẫn \(1\)/);
    assert.match(text(used), /đoạn trích 1/);
  });

  it('a grounded answer with no marker does not present its sources as used', () => {
    const t = text(renderToStaticMarkup(<SourcesBlock split={splitSources('Không có ký hiệu nguồn.', [source(1), source(2)])} />));
    assert.match(t, /Câu trả lời không trích dẫn nguồn cụ thể/);
    assert.doesNotMatch(t, /Nguồn được trích dẫn/);
  });

  it('not found (grounded=false): the backend answer with a "not found" label and no source block', async () => {
    const s = store();
    replies = [ok({ grounded: false, sources: [], message: 'Mình chưa tìm thấy thông tin liên quan trong tài liệu của khóa học này để trả lời câu hỏi của bạn.' })];
    await s.ask(A, 'Cách nấu phở bò?');
    const answer = s.get().turns[1];
    const html = renderToStaticMarkup(<ChatTurnView turn={answer} />);
    assert.match(html, /data-grounded="false"/);
    assert.match(text(html), /Chưa tìm thấy nội dung phù hợp trong bài học/);
    assert.doesNotMatch(html, /data-testid="sources"/);
  });

  it('a grounded answer renders its markdown (no raw HTML injection) and the pending state is visible', () => {
    const turn = { id: 'x', role: 'ASSISTANT' as const, content: '**Image** là bản mẫu <img src=x onerror=alert(1)> [Nguồn 1]', grounded: true, sources: splitSources('[Nguồn 1]', [source(1)]) };
    const html = renderToStaticMarkup(<ChatTurnView turn={turn} />);
    // RAG-MVP-05D: explicit element styles (no typography plugin) -> <strong class="...">
    assert.match(html, /<strong[^>]*>Image<\/strong>/);
    assert.doesNotMatch(html, /<img/);
    const pending = renderToStaticMarkup(<LessonChatView lessonTitle="Bài 1" thread={{ ...emptyThread(), pending: true }} draft="" onDraftChange={noop} onSend={noop} onRetry={noop} onDismissError={noop} />);
    assert.match(pending, /data-state="pending"/);
    assert.match(text(pending), /Đang tìm trong tài liệu bài học/);
    assert.match(text(pending), /Trợ lý chỉ trả lời dựa trên tài liệu của bài học này/);
  });
});
