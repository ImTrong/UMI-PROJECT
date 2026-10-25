/**
 * RAG-PDF-02 — the lesson PDF uploaded with the EXISTING lesson form (LessonManager stores it in `videoUrl`, key
 * "<timestamp>-<uuid>.pdf") can be indexed by POST /api/ai/rag/index/lesson-file and its chunks answer lesson questions
 * with a page-level citation. Real ai-service app over the loopback stubs of tests/helpers/rag-harness.ts; mocked Qdrant,
 * embeddings, LLM and MongoDB.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, oid, chunk, ADMIN, INSTR1, INSTR2, STUDENT_A, C1, L1_PDF, L1_DOCX, PDF_KEY, DOCX_KEY } from './helpers/rag-harness';
import { buildPdf, buildDocx } from './helpers/file-fixtures';
import { findLessonFile, lessonFileKeys } from '../src/modules/rag/files/lesson-file.service';

const h = new Harness();
const ROUTE = '/api/ai/rag/index/lesson-file';
const downloads = () => h.calls.filter((c) => c.url.startsWith('/api/courses/files/download'));
const body = { courseId: C1, lessonId: L1_PDF, fileKey: PDF_KEY };

describe('RAG-PDF-02 lesson PDF from the existing upload', () => {
  before(async () => { await h.start(); });
  after(async () => { await h.stop(); });
  beforeEach(() => {
    h.reset();
    h.files.set(PDF_KEY, buildPdf([['Docker Image là bản mẫu dùng để tạo container.'], null, ['Container có trạng thái và lớp ghi riêng.']]));
  });
  after(() => {
    const all = h.logs.join('\n');
    for (const secret of h.secrets()) assert.ok(!all.includes(secret), 'a token reached the logs');
  });

  it('the PDF kept in videoUrl is indexed: one document per file, original page numbers, readable name from the lesson title', async () => {
    const r = await h.call('POST', ROUTE, { token: INSTR1.token, body });
    assert.equal(r.status, 201, r.text);
    assert.equal(downloads().length, 1);
    assert.equal(new URLSearchParams(downloads()[0].url.split('?')[1]).get('key'), PDF_KEY);
    const [sourceType, sourceId, title, metadata, segments] = h.docs.ingestFileCalls[0];
    assert.deepEqual([sourceType, sourceId, title], ['PDF', `${L1_PDF}:${PDF_KEY}`, 'Bài 1 (PDF)']);
    assert.deepEqual(metadata, { courseId: C1, lessonId: L1_PDF, fileKey: PDF_KEY, fileName: 'Bài 1 (PDF)', fileType: 'PDF', pageCount: 3 });
    assert.deepEqual(segments.map((s: any) => s.metadata.page), [1, 3]);
    assert.deepEqual(r.body.data.removedStaleDocuments, []);
  });

  it('findLessonFile / lessonFileKeys: the lesson upload counts only when stored in the course bucket', () => {
    const lesson = (videoUrl: string) => ({ id: L1_PDF, title: 'Bài 1', videoUrl, resources: [] });
    const ref = (bucket: string, key: string) => `/api/courses/files/download?bucket=${bucket}&key=${key}`;
    assert.equal(findLessonFile(lesson(ref('courses', PDF_KEY)), PDF_KEY).fileName, 'Bài 1 (PDF)');
    assert.throws(() => findLessonFile(lesson(ref('avatars', PDF_KEY)), PDF_KEY), (e: any) => e.code === 'RESOURCE_NOT_FOUND');
    assert.throws(() => findLessonFile(lesson(`https://cdn.example.com/${PDF_KEY}`), PDF_KEY), (e: any) => e.code === 'RESOURCE_NOT_FOUND');
    assert.deepEqual(lessonFileKeys({ ...lesson(ref('courses', PDF_KEY)), resources: [{ fileUrl: ref('courses', 'r.pdf') }, { url: ref('avatars', 'a.pdf') }] }), [PDF_KEY, 'r.pdf']);
  });

  it('only the caller who manages the course, only a file of that lesson', async () => {
    assert.equal((await h.call('POST', ROUTE, { token: INSTR2.token, body })).status, 403);
    assert.equal((await h.call('POST', ROUTE, { token: STUDENT_A.token, body })).status, 403);
    const otherLessonsFile = await h.call('POST', ROUTE, { token: INSTR1.token, body: { ...body, lessonId: L1_DOCX } });
    assert.deepEqual([otherLessonsFile.status, otherLessonsFile.body.error], [404, 'RESOURCE_NOT_FOUND'], "the PDF key is not Bài 3's file");
    assert.equal(downloads().length, 0);
    assert.equal(h.docs.ingestFileCalls.length, 0);
  });

  it('DOCX is refused: by its stored name before any download, and by its bytes when named .pdf', async () => {
    const byName = await h.call('POST', ROUTE, { token: ADMIN.token, body: { courseId: C1, lessonId: L1_DOCX, fileKey: DOCX_KEY } });
    assert.deepEqual([byName.status, byName.body.error], [415, 'ONLY_PDF_SUPPORTED']);
    assert.match(byName.body.message, /PDF/);
    assert.equal(downloads().length, 0);

    h.files.set(PDF_KEY, await buildDocx([{ text: 'Một tệp Word đặt tên .pdf' }]));
    const byBytes = await h.call('POST', ROUTE, { token: ADMIN.token, body });
    assert.deepEqual([byBytes.status, byBytes.body.error], [415, 'ONLY_PDF_SUPPORTED']);
    assert.equal(h.docs.ingestFileCalls.length, 0);
  });

  it('a scanned PDF (no text layer) is a clear 422, nothing indexed, no OCR pretended', async () => {
    h.files.set(PDF_KEY, buildPdf([null, null]));
    const r = await h.call('POST', ROUTE, { token: INSTR1.token, body });
    assert.deepEqual([r.status, r.body.error], [422, 'PDF_NO_TEXT_LAYER']);
    assert.match(r.body.message, /OCR/);
    assert.equal(h.docs.ingestFileCalls.length, 0);
  });

  it('re-upload: documents of files the lesson no longer refers to are removed after the new one is indexed - nothing else', async () => {
    const stale = { id: oid(), sourceType: 'PDF', sourceId: `${L1_PDF}:old-upload.pdf`, status: 'ACTIVE', metadata: { courseId: C1, lessonId: L1_PDF, fileKey: 'old-upload.pdf' } };
    const description = { id: oid(), sourceType: 'LESSON', sourceId: L1_PDF, status: 'ACTIVE', metadata: { courseId: C1, lessonId: L1_PDF } };
    const otherLesson = { id: oid(), sourceType: 'PDF', sourceId: `${L1_DOCX}:x.pdf`, status: 'ACTIVE', metadata: { courseId: C1, lessonId: L1_DOCX, fileKey: 'x.pdf' } };
    for (const d of [stale, description, otherLesson]) h.docs.byId.set(d.id, d);

    const r = await h.call('POST', ROUTE, { token: INSTR1.token, body });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(h.docs.deleteCalls, [stale.id]);
    assert.deepEqual(r.body.data.removedStaleDocuments, [stale.id]);
  });

  it('a nothing-is-deleted guarantee when indexing fails', async () => {
    const stale = { id: oid(), sourceType: 'PDF', sourceId: `${L1_PDF}:old-upload.pdf`, status: 'ACTIVE', metadata: { courseId: C1, lessonId: L1_PDF, fileKey: 'old-upload.pdf' } };
    h.docs.byId.set(stale.id, stale);
    h.files.set(PDF_KEY, buildPdf([null]));
    await h.call('POST', ROUTE, { token: INSTR1.token, body });
    assert.deepEqual(h.docs.deleteCalls, [], 'the old answers stay until a new file is really indexed');
  });

  it('a lesson question answered from the PDF cites the file AND the page (for opening the right page later)', async () => {
    const pdfChunk = (page: number, score: number, content: string) => {
      const c = chunk(C1, L1_PDF, score, content);
      Object.assign(c.payload, { title: 'Bài 1 (PDF)', sourceType: 'PDF', fileKey: PDF_KEY, fileName: 'Bài 1 (PDF)', fileType: 'PDF', page });
      return c;
    };
    h.qdrant.points = [pdfChunk(3, 0.9, 'Container có trạng thái và lớp ghi riêng.'), pdfChunk(1, 0.8, 'Docker Image là bản mẫu dùng để tạo container.')];
    h.llm.answer = 'Container có lớp ghi riêng [Nguồn 1], còn image là bản mẫu [Nguồn 2].';
    const r = await h.call('POST', '/api/ai/rag/chat/new', { token: STUDENT_A.token, body: { message: 'Image và container khác nhau thế nào?', courseId: C1, lessonId: L1_PDF } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.data.sources.map((s: any) => [s.sourceIndex, s.location]), [
      [1, { fileKey: PDF_KEY, fileName: 'Bài 1 (PDF)', fileType: 'PDF', page: 3 }],
      [2, { fileKey: PDF_KEY, fileName: 'Bài 1 (PDF)', fileType: 'PDF', page: 1 }],
    ]);
    assert.equal(r.body.data.sources[0].title, 'Bài 1 (PDF)');
    assert.deepEqual(h.qdrant.queries[0].filter.must, [
      { key: 'courseId', match: { value: C1 } },
      { key: 'lessonId', match: { value: L1_PDF } },
    ]);
  });
});
