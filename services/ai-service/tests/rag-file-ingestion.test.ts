/**
 * RAG-PDF-01 — file documents through the EXISTING ingestion pipeline (DocumentCleaner, RecursiveChunker, embeddings,
 * versioning, Qdrant point payloads), with an in-memory KnowledgeDocument / DocumentChunk store, a fake embedding service and
 * the real QdrantVectorStore over a fake Qdrant client. No MongoDB, Qdrant or Gemini.
 *
 * Run: npm test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const logger = require('../src/utils/logger').default;
logger.transports.forEach((t: any) => { t.silent = true; });

import { IngestionService } from '../src/modules/rag/ingestion/ingestion.service';
import { QdrantVectorStore } from '../src/modules/rag/vector-store/qdrant-vector-store';
import { loadRAGConfig } from '../src/modules/rag/rag.config';
import { buildPdf } from './helpers/file-fixtures';
import { extractFile } from '../src/modules/rag/files/file-extractor';
import { RecursiveChunker } from '../src/modules/rag/chunking/recursive-chunker';
import { DocumentCleaner } from '../src/modules/rag/ingestion/document-cleaner';

const COURSE = 'c'.repeat(24);
const LESSON = 'a'.repeat(24);

class FakeDb {
  docs: any[] = [];
  chunks: any[] = [];
  private seq = 0;
  private id() { this.seq++; return this.seq.toString(16).padStart(24, '0'); }
  private matches(d: any, where: any) {
    return Object.entries(where).every(([k, v]: [string, any]) => (v && typeof v === 'object' && 'in' in v ? v.in.includes(d[k]) : d[k] === v));
  }
  knowledgeDocument = {
    findFirst: async ({ where }: any) => this.docs.filter((d) => this.matches(d, where)).sort((a, b) => b.version - a.version)[0] ?? null,
    findUnique: async ({ where }: any) => this.docs.find((d) => d.id === where.id) ?? null,
    create: async ({ data }: any) => { const d = { id: this.id(), ...data }; this.docs.push(d); return d; },
    update: async ({ where, data }: any) => Object.assign(this.docs.find((d) => d.id === where.id), data),
    delete: async ({ where }: any) => { this.docs = this.docs.filter((d) => d.id !== where.id); },
  };
  documentChunk = {
    create: async ({ data }: any) => { this.chunks.push({ id: this.id(), ...data }); return data; },
    deleteMany: async ({ where }: any) => { this.chunks = this.chunks.filter((c) => c.documentId !== where.documentId); },
  };
}

function setup() {
  const config = loadRAGConfig();
  const points = new Map<string, any>();
  const store = new QdrantVectorStore(config);
  (store as any).client = {
    upsert: async (_c: string, { points: batch }: any) => { for (const p of batch) points.set(p.id, p); },
    delete: async (_c: string, { filter }: any) => {
      const docId = filter.must[0].match.value;
      for (const [id, p] of points) if (p.payload.documentId === docId) points.delete(id);
    },
    query: async () => ({ points: [...points.values()].map((p) => ({ score: 0.9, payload: p.payload })) }),
  };
  let embedCalls = 0;
  const embedding = {
    embedDocument: async () => new Array(768).fill(0.1),
    embedQuery: async () => new Array(768).fill(0.1),
    embedDocuments: async (texts: string[]) => { embedCalls += texts.length; return texts.map(() => new Array(768).fill(0.1)); },
    getDimension: () => 768,
    getModelName: () => 'fake',
  };
  const db = new FakeDb();
  const ingestion = new IngestionService(config, embedding as any, store, db as any);
  return { ingestion, db, points, store, embedCalls: () => embedCalls };
}

const LONG = (n: number) => `Đoạn ${n}: ` + 'Docker đóng gói ứng dụng cùng thư viện và cấu hình để chạy giống nhau ở mọi môi trường. '.repeat(9);

async function pdfSegments() {
  const extracted = await extractFile(buildPdf([[LONG(1)], null, [LONG(3)]]));
  return extracted.segments.map((s) => ({ text: s.text, metadata: { ...s.location } }));
}

const fileMeta = (key: string, type = 'PDF') => ({ courseId: COURSE, lessonId: LESSON, fileKey: key, fileName: `${key} name`, fileType: type });

describe('file documents in the ingestion pipeline', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it('each chunk carries its page; chunk indexes run across the document; Qdrant payload and Mongo chunk keep the location', async () => {
    const segments = await pdfSegments();
    const doc = await t.ingestion.ingestDocument('PDF', `${LESSON}:slides.pdf`, undefined, 'Slide bài giảng.pdf', fileMeta('slides.pdf'), segments);
    assert.equal(doc.status, 'ACTIVE');
    // exactly what the existing cleaner + chunker produce page by page (a chunk never spans two pages)
    const config = loadRAGConfig();
    const chunker = new RecursiveChunker(config.chunkSize, config.chunkOverlap);
    const perPage = segments.map((s) => chunker.chunk(DocumentCleaner.clean(s.text), 'd', 't', 'PDF', 1, {}).length);
    assert.ok(perPage.every((n) => n >= 2), `each long page is split (${perPage})`);
    assert.equal(doc.chunkCount, perPage[0] + perPage[1]);
    assert.deepEqual(t.db.chunks.map((c) => c.metadata.page), [...Array(perPage[0]).fill(1), ...Array(perPage[1]).fill(3)]);
    assert.deepEqual(t.db.chunks.map((c) => c.chunkIndex), [...Array(doc.chunkCount).keys()]);
    const pages = t.db.chunks.map((c) => c.metadata.page);
    assert.ok(pages.includes(1) && pages.includes(3) && !pages.includes(2));
    assert.deepEqual([...pages].sort(), pages, 'page order kept');
    for (const c of t.db.chunks) {
      assert.equal(c.metadata.fileKey, 'slides.pdf');
      assert.equal(c.metadata.courseId, COURSE);
      assert.equal(c.metadata.lessonId, LESSON);
      assert.ok(c.content.trim().length > 0);
    }
    const payloads = [...t.points.values()].map((p) => p.payload);
    assert.equal(payloads.length, doc.chunkCount);
    assert.ok(payloads.every((p) => p.fileKey === 'slides.pdf' && p.fileType === 'PDF' && typeof p.page === 'number' && p.lessonId === LESSON));
    assert.equal(t.embedCalls(), doc.chunkCount, 'one embedding per chunk, nothing else');
  });

  it('retrieved chunks expose the location (citations can open the file / page)', async () => {
    await t.ingestion.ingestDocument('PDF', `${LESSON}:slides.pdf`, undefined, 'Slide.pdf', fileMeta('slides.pdf'), await pdfSegments());
    const [hit] = await t.store.search(new Array(768).fill(0.1), { topK: 1 });
    assert.equal(hit.metadata.fileKey, 'slides.pdf');
    assert.equal(hit.metadata.fileType, 'PDF');
    assert.ok([1, 3].includes(hit.metadata.page as number));
    assert.equal(hit.metadata.paragraphStart, undefined, 'absent fields are not invented');
  });

  it('DOCX paragraph ranges and heading reach the chunks', async () => {
    const segments = [
      { text: '# Dockerfile\n\nTệp mô tả các bước xây dựng image.', metadata: { paragraphStart: 1, paragraphEnd: 2, heading: 'Dockerfile' } },
      { text: 'Lệnh FROM chọn image nền.', metadata: { paragraphStart: 3, paragraphEnd: 3, heading: 'Dockerfile' } },
    ];
    await t.ingestion.ingestDocument('DOCX', `${LESSON}:notes.docx`, undefined, 'Ghi chú.docx', fileMeta('notes.docx', 'DOCX'), segments);
    assert.deepEqual(t.db.chunks.map((c) => [c.metadata.paragraphStart, c.metadata.paragraphEnd, c.metadata.heading]), [[1, 2, 'Dockerfile'], [3, 3, 'Dockerfile']]);
    assert.ok([...t.points.values()].every((p) => p.payload.fileType === 'DOCX' && p.payload.page === undefined));
  });

  it('two files of one lesson are two documents; the lesson description is a third one - nothing overwritten', async () => {
    await t.ingestion.ingestDocument('PDF', `${LESSON}:a.pdf`, undefined, 'a.pdf', fileMeta('a.pdf'), await pdfSegments());
    await t.ingestion.ingestDocument('PDF', `${LESSON}:b.pdf`, undefined, 'b.pdf', fileMeta('b.pdf'), await pdfSegments());
    await t.ingestion.ingestDocument('LESSON', LESSON, 'Mô tả bài học đủ dài để được lập chỉ mục như một tài liệu riêng.', 'Bài 1', { courseId: COURSE, lessonId: LESSON });
    assert.deepEqual(t.db.docs.map((d) => [d.sourceType, d.sourceId, d.status]).sort(), [
      ['LESSON', LESSON, 'ACTIVE'], ['PDF', `${LESSON}:a.pdf`, 'ACTIVE'], ['PDF', `${LESSON}:b.pdf`, 'ACTIVE'],
    ].sort());
  });

  it('same file again = no-op; changed pages = new version, the old one archived and its vectors removed', async () => {
    const first = await t.ingestion.ingestDocument('PDF', `${LESSON}:s.pdf`, undefined, 's.pdf', fileMeta('s.pdf'), await pdfSegments());
    const embedsAfterFirst = t.embedCalls();
    const again = await t.ingestion.ingestDocument('PDF', `${LESSON}:s.pdf`, undefined, 's.pdf', fileMeta('s.pdf'), await pdfSegments());
    assert.equal(again.id, first.id);
    assert.equal(t.embedCalls(), embedsAfterFirst, 'no embedding for an unchanged file');

    // same text, but now on page 2 instead of page 3: a different document for citations
    const moved = (await pdfSegments()).map((s) => (s.metadata.page === 3 ? { ...s, metadata: { page: 2 } } : s));
    const second = await t.ingestion.ingestDocument('PDF', `${LESSON}:s.pdf`, undefined, 's.pdf', fileMeta('s.pdf'), moved);
    assert.equal(second.version, 2);
    assert.equal(t.db.docs.find((d) => d.id === first.id).status, 'ARCHIVED');
    assert.ok([...t.points.values()].every((p) => p.payload.documentId === second.id));
    assert.ok(t.db.chunks.every((c) => c.documentId === second.id));
  });

  it('segments that are empty after cleaning are refused (no empty document indexed)', async () => {
    await assert.rejects(
      t.ingestion.ingestDocument('PDF', `${LESSON}:e.pdf`, undefined, 'e.pdf', fileMeta('e.pdf'), [{ text: '   \n ', metadata: { page: 1 } }]),
      /empty after cleaning/,
    );
    assert.equal(t.db.docs.length, 0);
  });
});
