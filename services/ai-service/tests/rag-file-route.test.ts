/**
 * RAG-PDF-01 — POST /api/ai/rag/index/lesson-file on the real ai-service app (tests/helpers/rag-harness.ts): the course-service
 * (course + lesson resources + the file download route with its access rule) and the learning-service are a loopback stub;
 * RAGService.ingestFile is recorded instead of writing to MongoDB / Qdrant; no Gemini call.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, oid, ADMIN, INSTR1, INSTR2, STUDENT_A, C1, L1_FILES, L2 } from './helpers/rag-harness';
import { buildPdf, buildDocx } from './helpers/file-fixtures';

const h = new Harness();
const ROUTE = '/api/ai/rag/index/lesson-file';
const downloads = () => h.calls.filter((c) => c.url.startsWith('/api/courses/files/download'));

describe('RAG-PDF-01 index a lesson file', () => {
  before(async () => { await h.start(); });
  after(async () => { await h.stop(); });
  beforeEach(() => {
    h.reset();
    h.files.set('slides-1.pdf', buildPdf([['Trang 1: Docker Image là bản mẫu dùng để tạo container.'], null, ['Trang 3: Container có lớp ghi riêng.']]));
    h.files.set('scan-1.pdf', buildPdf([null]));
    h.files.set('image-1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  });
  after(() => {
    const all = h.logs.join('\n');
    for (const secret of h.secrets()) assert.ok(!all.includes(secret), 'a token reached the logs');
  });

  it('the course instructor indexes a PDF: downloaded from the course-service as the caller, one document per file, pages kept', async () => {
    const r = await h.call('POST', ROUTE, { token: INSTR1.token, body: { courseId: C1, lessonId: L1_FILES, fileKey: 'slides-1.pdf' } });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.body.data.file, { fileKey: 'slides-1.pdf', fileName: 'Slide bài giảng.pdf', fileType: 'PDF', pages: 3, pagesWithText: 2, characters: r.body.data.file.characters, segments: 2 });

    assert.equal(downloads().length, 1);
    const d = downloads()[0];
    assert.equal(d.authorization, `Bearer ${INSTR1.token}`, 'the caller token, never a service credential');
    const params = new URLSearchParams(d.url.split('?')[1]);
    assert.deepEqual([params.get('bucket'), params.get('key'), params.get('courseId')], ['courses', 'slides-1.pdf', C1]);

    assert.equal(h.docs.ingestFileCalls.length, 1);
    const [sourceType, sourceId, title, metadata, segments] = h.docs.ingestFileCalls[0];
    assert.deepEqual([sourceType, sourceId, title], ['PDF', `${L1_FILES}:slides-1.pdf`, 'Slide bài giảng.pdf']);
    assert.deepEqual(metadata, { courseId: C1, lessonId: L1_FILES, fileKey: 'slides-1.pdf', fileName: 'Slide bài giảng.pdf', fileType: 'PDF', pageCount: 3 });
    assert.deepEqual(segments.map((s: any) => s.metadata), [{ page: 1 }, { page: 3 }]);
    assert.match(segments[0].text, /Docker Image là bản mẫu/);
    assert.equal(h.docs.ingestCalls.length, 0, 'the lesson description document is not touched');
  });

  // RAG-PDF-02: DOCX is postponed in the business flow (it was indexed here in RAG-PDF-01): refused, before any download
  it('a DOCX resource of the lesson is refused (PDF only for now) without being downloaded', async () => {
    h.files.set('notes-1.docx', await buildDocx([{ heading: 1, text: 'Ghi chú Docker' }, { text: 'Image là bản mẫu chỉ đọc.' }]));
    const r = await h.call('POST', ROUTE, { token: ADMIN.token, body: { courseId: C1, lessonId: L1_FILES, fileKey: 'notes-1.docx' } });
    assert.deepEqual([r.status, r.body.error], [415, 'ONLY_PDF_SUPPORTED']);
    assert.equal(downloads().length, 0);
    assert.equal(h.docs.ingestFileCalls.length, 0);
  });

  it('only a file stored for THIS lesson in the course bucket can be named; nothing else is downloaded', async () => {
    for (const [fileKey, status, error] of [
      ['outside.pdf', 404, 'RESOURCE_NOT_FOUND'],          // an external link of the lesson
      ['other-1.pdf', 404, 'RESOURCE_NOT_FOUND'],          // stored in another bucket
      ['c2-only.pdf', 404, 'RESOURCE_NOT_FOUND'],          // a file of another course's lesson
      ['../../etc/passwd', 400, 'INVALID_FILE_KEY'],
      ['https://example.com/x.pdf', 400, 'INVALID_FILE_KEY'],
      [undefined, 400, 'INVALID_FILE_KEY'],
    ] as const) {
      const r = await h.call('POST', ROUTE, { token: INSTR1.token, body: { courseId: C1, lessonId: L1_FILES, fileKey, url: 'https://example.com/x.pdf', fileUrl: '/api/courses/files/download?bucket=courses&key=c2-only.pdf' } });
      assert.equal(r.status, status, String(fileKey));
      assert.equal(r.body.error, error, String(fileKey));
    }
    assert.equal(downloads().length, 0);
    assert.equal(h.docs.ingestFileCalls.length, 0);
  });

  it('access: a learner (requireAdmin), another instructor, a lesson of another course - refused before any download', async () => {
    assert.equal((await h.call('POST', ROUTE, { token: STUDENT_A.token, body: { courseId: C1, lessonId: L1_FILES, fileKey: 'slides-1.pdf' } })).status, 403);
    assert.equal((await h.call('POST', ROUTE, { token: INSTR2.token, body: { courseId: C1, lessonId: L1_FILES, fileKey: 'slides-1.pdf' } })).status, 403);
    assert.equal((await h.call('POST', ROUTE, { token: INSTR1.token, body: { courseId: C1, lessonId: L2, fileKey: 'c2-only.pdf' } })).status, 404);
    assert.equal((await h.call('POST', ROUTE, { body: { courseId: C1, lessonId: L1_FILES, fileKey: 'slides-1.pdf' } })).status, 401);
    assert.equal(downloads().length, 0);
    assert.equal(h.docs.ingestFileCalls.length, 0);
  });

  it('download refused / failing, scan without text, unsupported format, too large: explicit errors, nothing indexed', async () => {
    const body = { courseId: C1, lessonId: L1_FILES, fileKey: 'slides-1.pdf' };
    h.downloadStatus = 403;
    assert.equal((await h.call('POST', ROUTE, { token: INSTR1.token, body })).body.error, 'COURSE_ACCESS_DENIED');
    h.downloadStatus = 500;
    const failed = await h.call('POST', ROUTE, { token: INSTR1.token, body });
    assert.deepEqual([failed.status, failed.body.error], [502, 'FILE_DOWNLOAD_FAILED']);
    h.downloadStatus = 200;

    const scan = await h.call('POST', ROUTE, { token: INSTR1.token, body: { ...body, fileKey: 'scan-1.pdf' } });
    assert.deepEqual([scan.status, scan.body.error], [422, 'PDF_NO_TEXT_LAYER']);
    assert.match(scan.body.message, /OCR/);
    const png = await h.call('POST', ROUTE, { token: INSTR1.token, body: { ...body, fileKey: 'image-1.png' } });
    assert.deepEqual([png.status, png.body.error], [415, 'UNSUPPORTED_FILE_TYPE']);

    process.env.RAG_MAX_FILE_BYTES = '100';
    try {
      const big = await h.call('POST', ROUTE, { token: INSTR1.token, body });
      assert.deepEqual([big.status, big.body.error], [413, 'FILE_TOO_LARGE']);
    } finally {
      delete process.env.RAG_MAX_FILE_BYTES;
    }
    assert.equal(h.docs.ingestFileCalls.length, 0);
  });

  it('a file source already indexed for another course is not re-indexed over it (409)', async () => {
    const foreign = { id: oid(), sourceType: 'PDF', sourceId: `${L1_FILES}:slides-1.pdf`, status: 'ACTIVE', metadata: { courseId: oid() } };
    h.docs.byId.set(foreign.id, foreign);
    const r = await h.call('POST', ROUTE, { token: INSTR1.token, body: { courseId: C1, lessonId: L1_FILES, fileKey: 'slides-1.pdf' } });
    assert.deepEqual([r.status, r.body.error], [409, 'SOURCE_BELONGS_TO_OTHER_COURSE']);
    assert.equal(h.docs.ingestFileCalls.length, 0);
  });
});
