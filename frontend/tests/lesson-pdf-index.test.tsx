/**
 * RAG-PDF-02 — "Lập chỉ mục cho Trợ lý AI" on the existing lesson list (LessonManager): only for a lesson whose uploaded file
 * (videoUrl) is a PDF of the course bucket; sends only { courseId, lessonId, fileKey }; shows the backend's Vietnamese errors.
 * The HTTP layer is the project's aiApi with a recording adapter - no network, no embedding.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).localStorage = { getItem: (k: string) => (k === 'accessToken' ? 'instructor-token' : null), setItem: () => undefined, removeItem: () => undefined };

import { aiApi } from '../src/services/api';
import { lessonPdfKey, ragIndexService, LessonIndexError } from '../src/services/rag-index.service';
import { LessonPdfIndexButton, LessonPdfIndexView } from '../src/components/course/LessonPdfIndexButton';

const KEY = '1792868080737-0f3c2a1e-9d4b-4c8e-8a51-2b7c9e6d4f10.pdf';
const ref = (key: string, bucket = 'courses') => `/api/courses/files/download?bucket=${bucket}&key=${key}`;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

let calls: Array<{ url: string; body: any; auth: unknown }> = [];
let reply: { status: number; data: any } = { status: 201, data: {} };
aiApi.defaults.adapter = (async (config: any) => {
  calls.push({ url: config.url, body: JSON.parse(config.data || '{}'), auth: config.headers.Authorization });
  if (reply.status >= 400) {
    throw Object.assign(new Error('Request failed'), { config, isAxiosError: true, response: { status: reply.status, data: reply.data, headers: {}, config } });
  }
  return { data: reply.data, status: reply.status, statusText: 'OK', headers: {}, config };
}) as any;

beforeEach(() => { calls = []; });

describe('RAG-PDF-02 lesson PDF indexing action', () => {
  it('lessonPdfKey: only a PDF stored in the course bucket by the lesson upload', () => {
    assert.equal(lessonPdfKey(ref(KEY)), KEY);
    assert.equal(lessonPdfKey(ref('1792-abc.mp4')), null, 'video lesson');
    assert.equal(lessonPdfKey(ref('1792-abc.docx')), null, 'DOCX postponed');
    assert.equal(lessonPdfKey(ref(KEY, 'avatars')), null, 'other bucket');
    assert.equal(lessonPdfKey('https://example.com/lesson.pdf'), null, 'external URL');
    assert.equal(lessonPdfKey(ref('../secret.pdf')), null, 'malformed key');
    assert.equal(lessonPdfKey(''), null);
  });

  it('sends exactly { courseId, lessonId, fileKey } with the signed-in user token, and reads the result', async () => {
    reply = { status: 201, data: { success: true, data: { chunkCount: 12, version: 1, file: { pages: 9, pagesWithText: 8 } } } };
    const result = await ragIndexService.indexLessonPdf('c1', 'l1', KEY);
    assert.deepEqual(calls, [{ url: '/api/ai/rag/index/lesson-file', body: { courseId: 'c1', lessonId: 'l1', fileKey: KEY }, auth: 'Bearer instructor-token' }]);
    assert.deepEqual(result, { chunkCount: 12, version: 1, pages: 9, pagesWithText: 8 });
  });

  it('errors: the backend Vietnamese message (scan, DOCX, size), never an English technical text', async () => {
    reply = { status: 422, data: { success: false, error: 'PDF_NO_TEXT_LAYER', message: 'PDF không có lớp văn bản (có thể là bản scan). Hệ thống chưa hỗ trợ OCR.' } };
    await assert.rejects(ragIndexService.indexLessonPdf('c1', 'l1', KEY), (e: LessonIndexError) => e.code === 'PDF_NO_TEXT_LAYER' && /OCR/.test(e.message));
    reply = { status: 400, data: { error: 'lessonId is required' } };
    await assert.rejects(ragIndexService.indexLessonPdf('c1', 'l1', KEY), (e: LessonIndexError) => !/required/.test(e.message));
  });

  it('the button exists only for PDF lessons; its states are shown', () => {
    assert.equal(renderToStaticMarkup(<LessonPdfIndexButton courseId="c1" lessonId="l1" videoUrl={ref('1792-abc.mp4')} />), '');
    assert.match(text(renderToStaticMarkup(<LessonPdfIndexButton courseId="c1" lessonId="l1" videoUrl={ref(KEY)} />)), /Lập chỉ mục cho Trợ lý AI/);
    const done = text(renderToStaticMarkup(<LessonPdfIndexView state={{ status: 'done', chunkCount: 12, pages: 9, pagesWithText: 8 }} onIndex={() => undefined} />));
    assert.match(done, /Đã lập chỉ mục 12 đoạn từ 8\/9 trang có chữ/);
    assert.match(done, /Lập chỉ mục lại/);
    const busy = renderToStaticMarkup(<LessonPdfIndexView state={{ status: 'indexing' }} onIndex={() => undefined} />);
    assert.match(busy, /disabled=""/);
    const failed = renderToStaticMarkup(<LessonPdfIndexView state={{ status: 'error', message: 'PDF không có lớp văn bản' }} onIndex={() => undefined} />);
    assert.match(failed, /role="alert"/);
  });

  it('reuses the existing lesson list; the upload input (video + PDF) is unchanged', () => {
    const manager = readFileSync(path.resolve('src/components/course/LessonManager.tsx'), 'utf8');
    assert.match(manager, /<LessonPdfIndexButton courseId=\{courseId\} lessonId=\{lesson\.id\} videoUrl=\{lesson\.videoUrl\} \/>/);
    assert.match(manager, /accept="video\/\*,application\/pdf"/);
    assert.equal((manager.match(/type="file"/g) || []).length, 1, 'no new upload input');
  });
});
