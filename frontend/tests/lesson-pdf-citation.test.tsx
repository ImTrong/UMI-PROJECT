/**
 * RAG-PDF-05 — a citation of a lesson PDF opens that PDF at its page and highlights the cited passage.
 *  - the fixture is a REAL PDF built in memory (Vietnamese text, lines wrapped, an image-only page); its text items are read
 *    with the frontend's own pdfjs-dist (3.11, as react-pdf uses it);
 *  - the snippet is built the way the backend builds it (RAG-PDF-01: item str + "\n" after hasEOL, NFC, cleaner, chunk overlap,
 *    first 200 characters); the "text layer" is built the way pdfjs builds it (a <span> per non-empty item, a <br> after hasEOL),
 *    on a minimal fake DOM (no jsdom in this project);
 *  - matching is exact and unique on the cited page only: a near-identical or absent passage is never highlighted.
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';

(globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

import {
  COURSE_FILES_BUCKET,
  foldPdfText,
  lessonFileUrlForKey,
  locatePdfSnippet,
  parseDownloadRef,
  pdfCitationOf,
} from '../src/utils/pdf-source-locator';
import { collectTextLayerSegments, highlightPdfSnippet, textLayerOf } from '../src/utils/pdf-source-highlight';
import { HIGHLIGHT_NAME } from '../src/utils/source-highlight';
import { JUMP_MESSAGES, SourcesBlock, jumpMessage } from '../src/components/learning/LessonChatPanel';
import { splitSources } from '../src/utils/lesson-chat';
import type { RagSource } from '../src/services/rag-chat.service';

const root = process.cwd();

// ==================== a real PDF, built in memory ====================

function wrap(line: string, width = 70): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current && (current + ' ' + word).length > width) {
      out.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out;
}

/** PDF 1.4, Helvetica (not embedded), non-ASCII characters through /Differences uniXXXX glyph names (pdfjs maps them back). */
function buildPdf(rawPages: Array<string[] | null>): Uint8Array {
  const pages = rawPages.map((p) => (p ? p.flatMap((l) => wrap(l)) : null));
  const extra = [...new Set(pages.flatMap((p) => (p ?? []).join('')).join('').split('').filter((c) => c.charCodeAt(0) > 126))];
  if (extra.length > 128) throw new Error('too many distinct non-ASCII characters');
  const codeOf = new Map(extra.map((c, i) => [c, 128 + i]));
  const encode = (line: string) =>
    line.split('').map((c) => (codeOf.has(c) ? `\\${codeOf.get(c)!.toString(8).padStart(3, '0')}` : c === '(' || c === ')' || c === '\\' ? `\\${c}` : c)).join('');
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const differences = extra.map((c) => `/uni${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
  const catalog = add('');
  const pagesObj = add('');
  const encoding = add(`<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [128 ${differences}] >>`);
  const font = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${encoding} 0 R >>`);
  const kids: number[] = [];
  for (const lines of pages) {
    const stream = lines ? `BT /F1 12 Tf 50 780 Td 16 TL ${lines.map((l) => `(${encode(l)}) Tj T*`).join(' ')} ET` : '0.2 0.4 0.8 rg 60 300 480 400 re f';
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

const REPEATED = 'Lưu ý: luôn kiểm tra phiên bản Docker Engine trước khi cài đặt các công cụ bổ trợ cho môi trường phát triển.';
const PAGES: Array<string[] | null> = [
  [
    'Bài 1: Tổng quan về Docker và Container',
    'Docker là nền tảng giúp đóng gói ứng dụng cùng thư viện và cấu hình vào một đơn vị chạy được ở mọi nơi, giảm lỗi do khác biệt môi trường giữa máy phát triển và máy chủ.',
    REPEATED,
    'Docker Image là bản mẫu dùng để tạo container. Image chứa hệ thống tệp, ứng dụng, thư viện và cấu hình cần thiết để khởi chạy ứng dụng một cách nhất quán.',
    REPEATED,
  ],
  [
    'Docker Container là một thực thể đang chạy được tạo từ image. Khi khởi chạy một image, Docker tạo container với trạng thái và lớp ghi riêng biệt.',
    'Docker Image là bản mẫu dùng để tạo container. Image chứa hệ thống tệp, ứng dụng, thư viện và cấu hình cần thiết để khởi chạy dịch vụ web.',
  ],
  null, // image-only page
];

type Item = { str: string; hasEOL: boolean };
let pageItems: Item[][] = [];

before(async () => {
  const doc = await (pdfjs as any).getDocument({ data: buildPdf(PAGES), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pageItems.push(content.items.filter((i: any) => typeof i.str === 'string').map((i: any) => ({ str: i.str, hasEOL: !!i.hasEOL })));
  }
});

// ==================== backend side: page text -> chunk -> snippet (RAG-PDF-01) ====================

/** file-extractor.ts + document-cleaner.ts whitespace rules */
function backendPageText(items: Item[]): string {
  let text = '';
  for (const item of items) text += item.str + (item.hasEOL ? '\n' : '');
  return text.normalize('NFC').replace(/[ \t]+\n/g, '\n').trim().replace(/[^\S\n]{3,}/g, '  ').replace(/[ \t]+$/gm, '');
}

/** snippet of a chunk starting at `from` (rounded back to a word start), optionally with an overlap of earlier text */
function snippetAt(page: number, startsWith: string, overlap = ''): string {
  const text = backendPageText(pageItems[page - 1]);
  const from = text.indexOf(startsWith);
  assert.ok(from >= 0, `fixture page ${page} has "${startsWith}"`);
  return (overlap + text.slice(from)).slice(0, 200);
}

// ==================== pdfjs-like text layer on a fake DOM ====================

class FakeNode {
  childNodes: FakeNode[] = [];
  parentElement: FakeNode | null = null;
  scrolled = 0;
  constructor(public nodeType: number, public tagName: string, public data: string, public ownerDocument: any, public className = '') {}
  append(child: FakeNode) { child.parentElement = this; this.childNodes.push(child); return child; }
  scrollIntoView() { this.scrolled++; }
  querySelector(selector: string): FakeNode | null {
    const cls = selector.replace(/^\./, '');
    for (const c of this.childNodes) {
      if (c.nodeType === 1 && c.className.split(' ').includes(cls)) return c;
      const deep = c.nodeType === 1 ? c.querySelector(selector) : null;
      if (deep) return deep;
    }
    return null;
  }
}
const fakeDocument: any = {
  createRange() {
    return {
      startContainer: null as any, startOffset: 0, endContainer: null as any, endOffset: 0,
      setStart(n: any, o: number) { this.startContainer = n; this.startOffset = o; },
      setEnd(n: any, o: number) { this.endContainer = n; this.endOffset = o; },
    };
  },
};
const el = (tag: string, className = '') => new FakeNode(1, tag, '', fakeDocument, className);
const txt = (data: string) => new FakeNode(3, '', data, fakeDocument);

/** pdfjs TextLayer: a <span> per non-empty item, a <br> after an item that ends a line; react-pdf adds div.endOfContent */
function textLayer(items: Item[], options: { markedContent?: boolean; form?: 'NFC' | 'NFD' } = {}): FakeNode {
  const layer = el('DIV', 'react-pdf__Page__textContent textLayer');
  const container = options.markedContent ? layer.append(el('SPAN', 'markedContent')) : layer;
  for (const item of items) {
    if (item.str !== '') container.append(el('SPAN')).append(txt(options.form ? item.str.normalize(options.form) : item.str));
    if (item.hasEOL) container.append(el('BR'));
  }
  layer.append(el('DIV', 'endOfContent'));
  return layer;
}

/** The text a Range over the fake text layer covers (a <br> between two nodes = a line break). */
function rangeText(range: any, layer: FakeNode): string {
  const { nodes, segments } = collectTextLayerSegments(layer as any);
  const a = nodes.indexOf(range.startContainer);
  const b = nodes.indexOf(range.endContainer);
  assert.ok(a >= 0 && b >= a, 'the Range lies in the text layer');
  let out = '';
  for (let i = a; i <= b; i++) {
    const d = (nodes[i] as any).data as string;
    if (i > a && segments[i].block !== segments[i - 1].block) out += '\n';
    out += d.slice(i === a ? range.startOffset : 0, i === b ? range.endOffset : d.length);
  }
  return out;
}

const highlights = new Map<string, any>();
(globalThis as any).CSS = { highlights };
(globalThis as any).Highlight = class { ranges: any[]; constructor(...r: any[]) { this.ranges = r; } };

const SOURCE = (over: Partial<RagSource> = {}): RagSource => ({
  sourceIndex: 1, documentId: 'd1', chunkId: 'c1', chunkIndex: 0, courseId: 'course-1', lessonId: 'lesson-1',
  title: 'Bài 1 (PDF)', score: 0.8, snippet: 'x',
  location: { fileKey: '1730000000000-abc.pdf', fileName: 'Bài 1 (PDF)', fileType: 'PDF', page: 2 },
  ...over,
});

// ==================== citation -> PDF location ====================

describe('RAG-PDF-05 citation -> lesson PDF and page', () => {
  it('a PDF location (fileType PDF, page >= 1, valid key) is a PDF citation; anything else uses the lesson-text mechanism', () => {
    assert.deepEqual(pdfCitationOf(SOURCE({ snippet: 'abc' })), { fileKey: '1730000000000-abc.pdf', fileName: 'Bài 1 (PDF)', page: 2, snippet: 'abc' });
    assert.equal(pdfCitationOf(SOURCE({ location: { fileKey: 'k.pdf', fileType: 'pdf', page: 1 } }))?.page, 1, 'case-insensitive type');
    const notPdf: Array<RagSource['location']> = [
      undefined,
      { fileKey: 'k.docx', fileType: 'DOCX', paragraphStart: 1, paragraphEnd: 3 },
      { fileKey: 'k.docx', fileType: 'DOCX', page: 2 },
      { fileKey: 'k.pdf', page: 2 },
      { fileKey: 'k.pdf', fileType: 'PDF' },
      { fileKey: 'k.pdf', fileType: 'PDF', page: 0 },
      { fileKey: 'k.pdf', fileType: 'PDF', page: 1.5 },
      { fileKey: 'k.pdf', fileType: 'PDF', page: '2' as any },
      { fileKey: '../etc/passwd', fileType: 'PDF', page: 1 },
      { fileKey: 'a/b.pdf', fileType: 'PDF', page: 1 },
      { fileKey: 'https://evil.example/x.pdf', fileType: 'PDF', page: 1 },
    ];
    for (const location of notPdf) assert.equal(pdfCitationOf(SOURCE({ location })), null, JSON.stringify(location));
  });

  it('only a course-file URL the lesson itself lists is opened - never a URL or bucket built from the citation', () => {
    const own = `/api/courses/files/download?bucket=${COURSE_FILES_BUCKET}&key=1730000000000-abc.pdf`;
    const resource = `/api/courses/files/download?bucket=${COURSE_FILES_BUCKET}&key=slides.pdf`;
    const urls = [own, undefined, { not: 'a url' }, resource];
    assert.equal(lessonFileUrlForKey(urls, '1730000000000-abc.pdf'), own);
    assert.equal(lessonFileUrlForKey(urls, 'slides.pdf'), resource);
    assert.equal(lessonFileUrlForKey(urls, 'other.pdf'), null, 'a key the lesson does not list');
    assert.equal(lessonFileUrlForKey(['/api/courses/files/download?bucket=avatars&key=slides.pdf'], 'slides.pdf'), null, 'other bucket');
    assert.equal(lessonFileUrlForKey(['https://cdn.example.com/slides.pdf'], 'slides.pdf'), null, 'not the download route');
    assert.deepEqual(parseDownloadRef(own), { bucket: 'courses', key: '1730000000000-abc.pdf' });
  });

  it('the Learning page opens a PDF citation through these checks and keeps the lesson-text path for other sources', () => {
    const page = readFileSync(path.join(root, 'src/pages/Learning.tsx'), 'utf8');
    const handler = page.slice(page.indexOf('const handleSourceSelect'), page.indexOf('const handlePdfJumpResult'));
    assert.match(handler, /source\.lessonId !== currentLesson\.id/, 'a source of another lesson is refused first');
    assert.match(handler, /const pdf = pdfCitationOf\(source\);\s*if \(!pdf\) return jumpToSource\(\[lessonTextRef\.current, lessonInfoRef\.current\], source\.snippet\);/);
    assert.match(handler, /if \(!lessonFileUrlForKey\(lessonFileUrls\(currentLesson\), pdf\.fileKey\)\) return \{ status: 'pdf-unavailable', reason: 'not-a-lesson-file' \}/);
    assert.match(handler, /setLessonType\('PDF'\);\s*setPdfTarget\(\{ id, page: pdf\.page, snippet: pdf\.snippet \}\)/);
    assert.ok(!/fetch\(|window\.open|location\.href/.test(handler), 'the handler itself never loads a URL');
    // the PDF shown is the cited file of THIS lesson, else the lesson's own PDF; fetched through the existing route
    assert.match(page, /\(citedPdfKey && lessonFileUrlForKey\(lessonFileUrls\(lesson\), citedPdfKey\)\) \|\| getLessonPdfUrl\(lesson\)/);
    assert.match(page, /<SecurePDFViewer key=\{pdfBlobUrl\} url=\{pdfBlobUrl\} target=\{pdfTarget\} onTargetResult=\{handlePdfJumpResult\} \/>/);
  });

  it('the viewer gives a text layer to the cited page only, not selectable; the highlight is translucent over the canvas', () => {
    const viewer = readFileSync(path.join(root, 'src/components/learning/SecurePDFViewer.tsx'), 'utf8');
    assert.match(viewer, /renderTextLayer=\{target\?\.page === index \+ 1\}/);
    assert.match(viewer, /renderAnnotationLayer=\{false\}/);
    const css = readFileSync(path.join(root, 'src/index.css'), 'utf8');
    assert.match(css, /\.secure-pdf-viewer \.textLayer \{[^}]*user-select: none/);
    assert.match(css, /\.secure-pdf-viewer \.textLayer span::highlight\(rag-source\) \{[^}]*rgba\(/);
  });
});

// ==================== locating the passage on the cited page ====================

describe('RAG-PDF-05 locating the cited passage in the page text layer', () => {
  beforeEach(() => highlights.clear());

  it('fixture sanity: page 1 lines are wrapped (several hasEOL items), page 3 has no text', () => {
    assert.ok(pageItems[0].filter((i) => i.hasEOL).length >= 6);
    assert.equal(pageItems[2].filter((i) => i.str.trim()).length, 0);
  });

  it('a snippet that runs over line breaks is located and highlighted exactly (Range = the passage, line by line)', () => {
    const snippet = snippetAt(1, 'Docker Image là bản mẫu');
    assert.match(snippet, /\n/, 'the snippet crosses a line break');
    const layer = textLayer(pageItems[0]);
    const outcome = highlightPdfSnippet(layer as any, snippet);
    assert.equal(outcome.status, 'highlighted');
    const range = highlights.get(HIGHLIGHT_NAME).ranges[0];
    const shown = rangeText(range, layer).replace(/\s+/g, ' ');
    assert.equal(shown, snippet.replace(/\s+/g, ' ').trim(), 'exactly the cited 200 characters, nothing around them');
    assert.equal(range.startContainer.parentElement.scrolled, 1, 'scrolled to the passage');
  });

  it('a chunk overlap (text right before it on the page) is part of the highlighted passage; inside marked content too', () => {
    const snippet = snippetAt(1, 'Docker Image là bản mẫu', 'cho môi trường phát triển.\n');
    const layer = textLayer(pageItems[0], { markedContent: true });
    assert.equal(highlightPdfSnippet(layer as any, snippet).status, 'highlighted');
    assert.match(rangeText(highlights.get(HIGHLIGHT_NAME).ranges[0], layer), /^cho môi trường phát triển\.\nDocker Image là bản mẫu/);
  });

  it('a head that is not on the page (a heading the chunker prepended) is dropped when most of the snippet matches', () => {
    const snippet = snippetAt(1, 'Docker Image là bản mẫu', 'Phần 2: Khái niệm cốt lõi của Docker\n');
    const layer = textLayer(pageItems[0]);
    assert.equal(highlightPdfSnippet(layer as any, snippet).status, 'highlighted');
    assert.match(rangeText(highlights.get(HIGHLIGHT_NAME).ranges[0], layer), /^Docker Image là bản mẫu/);
  });

  it('a text layer in decomposed Unicode (NFD) matches the NFC snippet; the Range ends on whole characters', () => {
    const snippet = snippetAt(2, 'Docker Container là');
    const layer = textLayer(pageItems[1], { form: 'NFD' });
    assert.equal(highlightPdfSnippet(layer as any, snippet).status, 'highlighted');
    const shown = rangeText(highlights.get(HIGHLIGHT_NAME).ranges[0], layer).normalize('NFC').replace(/\s+/g, ' ');
    assert.equal(shown, snippet.replace(/\s+/g, ' ').trim());
  });

  it('an absent passage, a near-identical one, or a passage of ANOTHER page is not highlighted - and the old highlight is removed', () => {
    highlights.set(HIGHLIGHT_NAME, { ranges: ['previous'] });
    const page1 = textLayer(pageItems[0]);
    const cases: Array<[string, string]> = [
      ['Kubernetes điều phối nhiều container trên một cụm máy chủ và tự động khôi phục dịch vụ khi một nút gặp sự cố.', 'not-found'],
      // page 2's sentence differs from page 1's only at its end ("dịch vụ web" vs "ứng dụng một cách nhất quán")
      [snippetAt(2, 'Docker Image là bản mẫu'), 'not-found'],
      // page 2's snippet ENDS with ~50 characters also printed on page 1: a short tail is not taken for the citation
      [snippetAt(2, 'Docker Container là'), 'not-found'],
    ];
    for (const [snippet, reason] of cases) {
      const outcome = highlightPdfSnippet(page1 as any, snippet);
      assert.deepEqual(outcome, { status: 'not-located', reason }, snippet.slice(0, 40));
      assert.equal(highlights.has(HIGHLIGHT_NAME), false);
    }
    const scrolled = collectTextLayerSegments(page1 as any).nodes.some((n: any) => n.parentElement.scrolled > 0);
    assert.equal(scrolled, false, 'nothing scrolled for a passage that is not located');
  });

  it('a passage printed twice on the page is ambiguous: no highlight rather than the wrong one', () => {
    const snippet = REPEATED;
    assert.deepEqual(highlightPdfSnippet(textLayer(pageItems[0]) as any, snippet), { status: 'not-located', reason: 'ambiguous' });
    assert.equal(highlights.has(HIGHLIGHT_NAME), false);
  });

  it('a page without text (image-only) and a too-short snippet are "not located", never a guess', () => {
    assert.deepEqual(locatePdfSnippet(collectTextLayerSegments(textLayer(pageItems[2]) as any).segments, snippetAt(1, 'Docker là')), {
      status: 'no-text', reason: 'the page has no text layer',
    });
    assert.equal(locatePdfSnippet(collectTextLayerSegments(textLayer(pageItems[0]) as any).segments, 'Docker Image').status, 'empty');
  });

  it('without CSS highlight support the passage is still located and scrolled to ("scrolled-only")', () => {
    const saved = (globalThis as any).CSS;
    (globalThis as any).CSS = {};
    try {
      assert.equal(highlightPdfSnippet(textLayer(pageItems[0]) as any, snippetAt(1, 'Docker là nền tảng')).status, 'scrolled-only');
    } finally {
      (globalThis as any).CSS = saved;
    }
  });

  it('folding: NFKC per character cluster with the way back to raw offsets; soft hyphens dropped', () => {
    const f = foldPdfText('ﬁle ệ a­b');
    assert.equal(f.text, 'file ệ ab');
    assert.deepEqual([f.rawStart[0], f.rawEnd[0], f.rawStart[1], f.rawEnd[1]], [0, 1, 0, 1], 'both "f" and "i" come from the ligature');
    const e = f.text.indexOf('ệ');
    assert.deepEqual([f.rawStart[e], f.rawEnd[e]], [4, 7], 'the composed "ệ" covers the base and its two marks');
  });

  it('the text layer element is the react-pdf one inside the page element', () => {
    const pageEl = el('DIV', 'react-pdf__Page');
    const layer = pageEl.append(textLayer(pageItems[0]));
    assert.equal(textLayerOf(pageEl as any), layer);
    assert.equal(textLayerOf(el('DIV') as any), null);
  });
});

// ==================== what the learner sees in the assistant ====================

describe('RAG-PDF-05 assistant messages', () => {
  it('a PDF source says it opens the PDF at its page; a lesson-text source keeps "Xem trong bài học"', () => {
    const pdf = SOURCE({ sourceIndex: 1, snippet: 'Docker Image là bản mẫu' });
    const lessonText = SOURCE({ sourceIndex: 2, location: undefined, snippet: 'Docker là nền tảng' });
    const split = splitSources('Theo [Nguồn 1] và [Nguồn 2].', [pdf, lessonText]);
    const html = renderToStaticMarkup(<SourcesBlock split={split} onOpen={() => undefined} activeCitation={null} />);
    assert.ok(html.includes('Xem trong PDF (trang 2)'));
    assert.ok(html.includes('Xem trong bài học'));
  });

  it('each outcome has its own message; "page only" says the passage was not identified', () => {
    assert.equal(jumpMessage({ status: 'pdf-highlighted', page: 3, matched: 'x' }), 'Đã mở PDF tới trang 3 và tô sáng đoạn nguồn.');
    assert.match(jumpMessage({ status: 'pdf-page-only', page: 3, reason: 'not-found' }), /trang 3.*chưa xác định được đoạn trích dẫn chính xác/);
    assert.match(jumpMessage({ status: 'pdf-unavailable', reason: 'page-out-of-range' }), /không có trang/);
    assert.match(jumpMessage({ status: 'pdf-unavailable', reason: 'not-a-lesson-file' }), /không còn thuộc bài học/);
    assert.equal(jumpMessage({ status: 'pdf-opening' }), JUMP_MESSAGES['pdf-opening']);
    assert.equal(jumpMessage({ status: 'highlighted', matched: 'x' }), JUMP_MESSAGES.highlighted, 'lesson-text messages unchanged');
    const split = splitSources('Theo [Nguồn 1].', [SOURCE()]);
    const html = renderToStaticMarkup(
      <SourcesBlock split={split} onOpen={() => undefined} activeCitation={{ turnId: 't', sourceIndex: 1, jump: { status: 'pdf-page-only', page: 2, reason: 'not-found' } }} />
    );
    assert.match(html, /data-jump="pdf-page-only"/);
    assert.match(html, /text-amber-700/);
  });

  it('the panel shows only the latest click: a PDF outcome arriving after another click (or lesson) is dropped', () => {
    const panel = readFileSync(path.join(root, 'src/components/learning/LessonChatPanel.tsx'), 'utf8');
    assert.match(panel, /if \(openSeq\.current === seq\) show\(jump\);/);
    assert.match(panel, /openSeq\.current\+\+;\s*setActive\(\{\}\);/);
  });
});
