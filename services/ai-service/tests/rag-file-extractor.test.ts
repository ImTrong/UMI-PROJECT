/**
 * RAG-PDF-01 — PDF / DOCX text extraction (src/modules/rag/files/file-extractor.ts).
 * Fixtures are generated in memory (tests/helpers/file-fixtures.ts): no binary file, no private data, no network.
 *
 * Run: npm test
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, buildDocx } from './helpers/file-fixtures';
import { extractFile, sniffKind, htmlToParagraphs } from '../src/modules/rag/files/file-extractor';

const code = (error: any) => error?.code;
const PAGE1 = ['Bài 1: Tổng quan về Docker', 'Docker Image là bản mẫu dùng để tạo container.', 'Ký tự đặc biệt: ă â đ ê ô ơ ư ạ ả ấ ầ ẩ ẫ ậ ệ ộ ợ ự ỹ.'];
const PAGE3 = ['Container khác máy ảo như thế nào?', 'Container chia sẻ nhân hệ điều hành với máy chủ.'];

afterEach(() => {
  delete process.env.RAG_MAX_FILE_BYTES;
  delete process.env.RAG_MAX_FILE_PAGES;
});

describe('PDF', () => {
  it('extracts each page with its ORIGINAL page number; Vietnamese text is exact (NFC); a blank page is skipped, not renumbered', async () => {
    const result = await extractFile(buildPdf([PAGE1, null, PAGE3]));
    assert.equal(result.kind, 'PDF');
    assert.deepEqual(result.segments.map((s) => s.location), [{ page: 1 }, { page: 3 }]);
    assert.equal(result.segments[0].text, PAGE1.join('\n'));
    assert.equal(result.segments[1].text, PAGE3.join('\n'));
    assert.equal(result.segments[0].text, result.segments[0].text.normalize('NFC'));
    assert.deepEqual({ pages: result.stats.pages, pagesWithText: result.stats.pagesWithText }, { pages: 3, pagesWithText: 2 });
  });

  it('a PDF with no text layer (scan / images only) is reported as such - no OCR is pretended', async () => {
    await assert.rejects(extractFile(buildPdf([null, null])), (e) => code(e) === 'PDF_NO_TEXT_LAYER' && (e as any).status === 422);
  });

  it('corrupt, empty, unsupported, too large (bytes or pages)', async () => {
    await assert.rejects(extractFile(Buffer.from('%PDF-1.4\nthis is not a pdf body at all\n%%EOF')), (e) => code(e) === 'FILE_CORRUPT');
    await assert.rejects(extractFile(Buffer.alloc(0)), (e) => code(e) === 'FILE_EMPTY');
    await assert.rejects(extractFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), (e) => code(e) === 'UNSUPPORTED_FILE_TYPE' && (e as any).status === 415);
    await assert.rejects(extractFile(Buffer.from('Văn bản thuần, không phải PDF hay DOCX')), (e) => code(e) === 'UNSUPPORTED_FILE_TYPE');

    const pdf = buildPdf([PAGE1, PAGE3]);
    process.env.RAG_MAX_FILE_BYTES = String(pdf.length - 1);
    await assert.rejects(extractFile(pdf), (e) => code(e) === 'FILE_TOO_LARGE' && (e as any).status === 413);
    delete process.env.RAG_MAX_FILE_BYTES;
    process.env.RAG_MAX_FILE_PAGES = '1';
    await assert.rejects(extractFile(pdf), (e) => code(e) === 'FILE_TOO_LARGE');
  });

  it('the format comes from the bytes, not from a name or MIME type', () => {
    assert.equal(sniffKind(buildPdf([PAGE1])), 'PDF');
    assert.equal(sniffKind(Buffer.from('PK\x03\x04rest', 'latin1')), 'ZIP');
    assert.equal(sniffKind(Buffer.from('<html>')), null);
  });
});

describe('DOCX', () => {
  const blocks = [
    { heading: 1 as const, text: 'Bài 2: Viết Dockerfile' },
    { text: 'Dockerfile là tệp mô tả các bước xây dựng một image.' },
    { text: 'Lệnh FROM chọn image nền; lệnh COPY sao chép mã nguồn vào image.' },
    { heading: 2 as const, text: 'Ví dụ thực hành' },
    { text: 'Chạy docker build -t web-demo . để tạo image từ thư mục hiện tại.' },
    { text: 'Sau đó dùng docker run -p 8080:80 web-demo để khởi chạy container.' },
  ];

  it('keeps paragraph order, headings and 1-based paragraph indexes; Vietnamese text exact', async () => {
    const result = await extractFile(await buildDocx(blocks));
    assert.equal(result.kind, 'DOCX');
    assert.equal(result.stats.paragraphs, 6);
    assert.deepEqual(result.segments.map((s) => s.location), [
      { paragraphStart: 1, paragraphEnd: 3, heading: 'Bài 2: Viết Dockerfile' },
      { paragraphStart: 4, paragraphEnd: 6, heading: 'Ví dụ thực hành' },
    ]);
    assert.equal(result.segments[0].text, '# Bài 2: Viết Dockerfile\n\nDockerfile là tệp mô tả các bước xây dựng một image.\n\nLệnh FROM chọn image nền; lệnh COPY sao chép mã nguồn vào image.');
    assert.match(result.segments[1].text, /^## Ví dụ thực hành\n\nChạy docker build -t web-demo \. để tạo image/);
  });

  it('long sections are split into groups whose paragraph ranges are exact and contiguous', async () => {
    const result = await extractFile(await buildDocx(blocks), { groupChars: 80 });
    const ranges = result.segments.map((s) => [s.location.paragraphStart, s.location.paragraphEnd]);
    let next = 1;
    for (const [start, end] of ranges) {
      assert.equal(start, next, 'no paragraph skipped or repeated');
      next = (end as number) + 1;
    }
    assert.equal(next, 7);
    assert.ok(ranges.length > 2);
    assert.ok(result.segments.every((s) => s.location.heading), 'each group knows its section');
  });

  it('a zip that is not a Word document, a corrupt zip and an empty document are refused explicitly', async () => {
    await assert.rejects(extractFile(await buildDocx(blocks, { withoutDocumentXml: true })), (e) => code(e) === 'UNSUPPORTED_FILE_TYPE');
    await assert.rejects(extractFile(Buffer.from('PK\x03\x04 broken zip content', 'latin1')), (e) => code(e) === 'FILE_CORRUPT');
    await assert.rejects(extractFile(await buildDocx([])), (e) => code(e) === 'FILE_EMPTY');
  });

  it('htmlToParagraphs: entities decoded, inline markup ignored, list items and table cells are paragraphs', () => {
    const p = htmlToParagraphs('<h1>A &amp; B</h1><p>x <strong>y</strong></p><ul><li>một</li><li>hai</li></ul><table><tr><td>ô 1</td></tr></table>');
    assert.deepEqual(p.map((x) => [x.index, x.text, x.headingLevel ?? null, !!x.listItem]), [
      [1, 'A & B', 1, false], [2, 'x y', null, false], [3, 'một', null, true], [4, 'hai', null, true], [5, 'ô 1', null, false],
    ]);
  });
});
