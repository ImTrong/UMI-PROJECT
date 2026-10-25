/**
 * RAG-MVP-05D — Markdown rendering of the lesson text / assistant answers, and "click a citation -> scroll to and highlight
 * the source passage".
 *  - the locator matches EXACTLY (canonical form shared by both sides) and only a unique passage; never fuzzy, never keywords;
 *  - snippets are built the way the backend builds them (title heading prepended, chunk overlap - sometimes doubled -,
 *    200-character cut in the middle of a word or of a Markdown marker);
 *  - the DOM side runs on a minimal fake DOM (no jsdom in this project): TreeWalker + Range + CSS.highlights.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

import { canonicalize, indexSegments, locateSnippet, toSegmentRange, TextSegment, MIN_MATCH_CHARS } from '../src/utils/source-locator';
import { collectSegments, jumpToSource, clearSourceHighlight, HIGHLIGHT_NAME } from '../src/utils/source-highlight';
import { AnswerMarkdown, LessonMarkdown, linkCitations, restoreMarkdownBreaks } from '../src/components/learning/MarkdownContent';
import { ChatTurnView, JUMP_MESSAGES, LessonChatView, SourcesBlock } from '../src/components/learning/LessonChatPanel';
import { emptyThread, splitSources } from '../src/utils/lesson-chat';
import type { RagSource } from '../src/services/rag-chat.service';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');

// ==================== lesson fixture (same structure as the indexed "Bài 1") ====================

const LESSON = [
  '# Bài 1: Tổng quan về Docker và Container',
  '',
  '## 1. Mục tiêu bài học',
  'Sau bài học này, người học có thể hiểu Docker là gì, phân biệt image và container, nắm được lợi ích của việc đóng gói ứng dụng bằng Docker.',
  '',
  '## 2. Docker là gì?',
  'Docker là nền tảng giúp đóng gói ứng dụng cùng thư viện và cấu hình vào một đơn vị chạy được ở mọi nơi, giảm lỗi do khác biệt môi trường.',
  '',
  '## 3. Phân biệt Docker Image và Docker Container',
  '**Docker Image** là bản mẫu dùng để tạo container. Image chứa hệ thống tệp, ứng dụng, thư viện và cấu hình cần thiết để khởi chạy ứng dụng.',
  '',
  '**Docker Container** là một thực thể đang chạy hoặc đã được tạo từ image. Khi khởi chạy một image, Docker tạo container với trạng thái và lớp ghi riêng. Từ một image, người dùng có thể tạo nhiều container độc lập.',
  '',
  '## 4. Các thành phần Docker thường gặp',
  '- **Dockerfile:** tệp mô tả các bước để xây dựng một image từ mã nguồn.',
  '- **Docker Registry:** nơi lưu trữ và phân phối image, ví dụ Docker Hub.',
  '',
  '## 5. Quy trình làm việc cơ bản',
  '1. Viết mã nguồn ứng dụng và tạo Dockerfile.',
  '2. Xây dựng image rồi chạy container.',
  '',
  'Ví dụ, lệnh `docker run -d --name web-demo -p 8080:80 nginx` tạo và chạy một container Nginx ở chế độ nền.',
].join('\n');

/** what the ingestion indexes: "# <lesson title>\n\n" + description (DocumentLoader.extractLessonContent) */
const INDEXED = `# Bài 1\n\n${LESSON}`;
const snippetAt = (needle: string, length = 200) => {
  const at = INDEXED.indexOf(needle);
  assert.ok(at >= 0, `fixture contains ${needle}`);
  return INDEXED.slice(at, at + length);
};

// ==================== HTML -> fake DOM (for the DOM side, and segments as a browser would give them) ====================

const BLOCK = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'ul', 'ol', 'div']);
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

class FakeText { nodeType = 3; constructor(public data: string, public parentElement: FakeElement) {} }
class FakeElement {
  nodeType = 1;
  children: Array<FakeElement | FakeText> = [];
  scrolled = 0;
  constructor(public tagName: string, public parentElement: FakeElement | null, public ownerDocument: any) {}
  scrollIntoView() { this.scrolled++; }
}

function fakeDocument() {
  const doc: any = {
    createTreeWalker(root: FakeElement) {
      const texts: FakeText[] = [];
      const walk = (el: FakeElement) => el.children.forEach((c) => (c instanceof FakeText ? texts.push(c) : walk(c)));
      walk(root);
      let i = -1;
      return { nextNode: () => texts[++i] ?? null };
    },
    createRange() {
      return {
        startContainer: null as any, startOffset: 0, endContainer: null as any, endOffset: 0,
        setStart(n: any, o: number) { this.startContainer = n; this.startOffset = o; },
        setEnd(n: any, o: number) { this.endContainer = n; this.endOffset = o; },
      };
    },
  };
  return doc;
}

function parseHtml(html: string): FakeElement {
  const doc = fakeDocument();
  const root = new FakeElement('ROOT', null, doc);
  let current = root;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)[^>]*?(\/?)>|([^<]+)/g)) {
    if (m[4] !== undefined) current.children.push(new FakeText(decode(m[4]), current));
    else if (m[1] === '/') current = current.parentElement ?? root;
    else {
      const el = new FakeElement(m[2].toUpperCase(), current, doc);
      current.children.push(el);
      if (m[3] !== '/' && !['br', 'hr', 'img'].includes(m[2])) current = el;
    }
  }
  return root;
}

/** The text of the passage a SegmentRange covers. */
function passage(segments: TextSegment[], r: NonNullable<ReturnType<typeof toSegmentRange>>) {
  let out = '';
  for (let s = r.startSeg; s <= r.endSeg; s++) {
    const t = segments[s].text;
    out += t.slice(s === r.startSeg ? r.startOffset : 0, s === r.endSeg ? r.endOffset : t.length);
    if (s < r.endSeg && segments[s + 1].block !== segments[s].block) out += ' ';
  }
  return out;
}

const lessonRoot = () => parseHtml(renderToStaticMarkup(<LessonMarkdown content={LESSON} />));
const locate = (snippet: string, root = lessonRoot()) => {
  const { segments } = collectSegments(root as any);
  const index = indexSegments(segments);
  const found = locateSnippet(index.canonical.text, snippet);
  return { found, segments, range: found.status === 'found' ? toSegmentRange(index, found.start, found.end) : null };
};

// fake CSS Custom Highlight API
const highlights = new Map<string, any>();
(globalThis as any).CSS = { highlights };
(globalThis as any).Highlight = class { ranges: any[]; constructor(...r: any[]) { this.ranges = r; } };
(globalThis as any).NodeFilter = { SHOW_TEXT: 4 };

// ==================== Markdown rendering ====================

describe('Markdown rendering (no Tailwind Typography, no raw HTML)', () => {
  it('the lesson text renders headings, paragraphs, bullet and numbered lists, bold and code - no "##" / "**" left', () => {
    const html = renderToStaticMarkup(<LessonMarkdown content={LESSON} />);
    assert.match(html, /<h1[^>]*>Bài 1: Tổng quan về Docker và Container<\/h1>/);
    assert.match(html, /<h2[^>]*>3\. Phân biệt Docker Image và Docker Container<\/h2>/);
    assert.match(html, /<ul class="list-disc[^"]*">\s*<li[^>]*><strong[^>]*>Dockerfile:<\/strong>/);
    assert.match(html, /<ol class="list-decimal[^"]*">\s*<li[^>]*>Viết mã nguồn/);
    assert.match(html, /<code[^>]*>docker run -d --name web-demo -p 8080:80 nginx<\/code>/);
    assert.doesNotMatch(text(html), /##|\*\*|`/);
    assert.doesNotMatch(html, /\bprose\b/);
    assert.match(html, /data-lesson-document="true"/);
  });

  it('a lesson text stored flattened on one line is shown as paragraphs and bullets, without "##" / "**" (display only)', () => {
    const flat = LESSON.replace(/\n+/g, ' ');
    const restored = restoreMarkdownBreaks(flat);
    assert.match(restored, /\n\n3\\\. Phân biệt/);
    const html = renderToStaticMarkup(<LessonMarkdown content={flat} />);
    assert.match(html, /<p[^>]*>2\. Docker là gì\? Docker là nền tảng/, 'a paragraph per section, its number kept as text');
    assert.match(html, /<li[^>]*><strong[^>]*>Docker Registry:<\/strong>/);
    assert.doesNotMatch(html, /<ol|<h2/, 'no numbered list or heading guessed');
    assert.doesNotMatch(text(html), /##|\*\*/);
    assert.equal(restoreMarkdownBreaks(LESSON), LESSON, 'a text with line breaks is untouched');
    assert.equal(restoreMarkdownBreaks('Một câu có ký tự # duy nhất'), 'Một câu có ký tự # duy nhất');
  });

  it('raw HTML / script in the lesson text or an answer is not rendered as HTML', () => {
    const evil = 'Đoạn <img src=x onerror="alert(1)"> và <script>alert(2)</script> [x](javascript:alert(3))';
    for (const html of [renderToStaticMarkup(<LessonMarkdown content={evil} />), renderToStaticMarkup(<AnswerMarkdown content={evil} citable={[]} />)]) {
      assert.doesNotMatch(html, /<img|<script|javascript:/i);
    }
  });

  it('answers: bullet / numbered lists, bold, code block styled without the typography plugin', () => {
    const html = renderToStaticMarkup(<AnswerMarkdown content={'**Image**:\n\n- bản mẫu [Nguồn 1]\n- chỉ đọc\n\n1. build\n2. run\n\n```\ndocker run nginx\n```'} citable={[1]} />);
    assert.match(html, /<strong[^>]*>Image<\/strong>/);
    assert.match(html, /<ul class="list-disc[^"]*">/);
    assert.match(html, /<ol class="list-decimal[^"]*">/);
    assert.match(html, /<pre[^>]*><code[^>]*>docker run nginx/);
  });

  it('citations stay where the model wrote them: one clickable chip per cited source, inert when not citable, untouched in code', () => {
    assert.equal(linkCitations('A [Nguồn 1], B [Nguồn 2, 3]. `[Nguồn 4]`'), 'A [Nguồn 1](#rag-source-1), B [Nguồn 2](#rag-source-2), [Nguồn 3](#rag-source-3). `[Nguồn 4]`');
    const html = renderToStaticMarkup(<AnswerMarkdown content={'Image là bản mẫu [Nguồn 1]; container [Nguồn 3] và [Nguồn 9].'} citable={[1, 3]} onCite={() => undefined} />);
    const t = text(html);
    assert.ok(t.indexOf('bản mẫu') < t.indexOf('[Nguồn 1]') && t.indexOf('[Nguồn 1]') < t.indexOf('container'), 'order kept');
    assert.deepEqual([...html.matchAll(/data-citation="(\d+)"/g)].map((m) => m[1]), ['1', '3']);
    assert.match(html, /data-citation-inert="9"/);
    assert.doesNotMatch(html, /href="#rag-source/, 'citations are buttons, not navigation links');
  });
});

// ==================== locator (pure) ====================

describe('locating the cited passage exactly', () => {
  it('canonical form: Markdown punctuation and list / number markers dropped, whitespace collapsed, map back to the input', () => {
    const c = canonicalize('## 3. Phân biệt\n**Docker Image** là\n- **Dockerfile:** tệp');
    assert.equal(c.text, 'Phân biệt Docker Image là Dockerfile: tệp');
    assert.equal('## 3. Phân biệt\n**Docker Image** là\n- **Dockerfile:** tệp'[c.map[c.text.indexOf('Docker Image')]], 'D');
  });

  it('a chunk start in section 3 (cut mid-word, with **bold**) is found and maps to exactly that passage', () => {
    const snippet = snippetAt('ẫu dùng để tạo container.');
    const { found, segments, range } = locate(snippet);
    assert.equal(found.status, 'found');
    const p = passage(segments, range!);
    assert.ok(p.startsWith('ẫu dùng để tạo container.'), p);
    assert.match(p, /Docker Container là một thực thể đang chạy/);
  });

  it('the first chunk ("# Bài 1" title prepended by the ingestion) is found without the title', () => {
    const { found, segments, range } = locate(INDEXED.slice(0, 200));
    assert.equal(found.status, 'found');
    assert.equal(found.status === 'found' && found.droppedPrefix, 'Bài 1');
    assert.ok(passage(segments, range!).startsWith('Bài 1: Tổng quan về Docker và Container'));
  });

  it('a chunk with a doubled overlap (tail of the previous chunk repeated) is found at the unique passage', () => {
    const sentence = 'tainer với trạng thái và lớp ghi riêng. Từ một image, người dùng có thể tạo nhiều container độc lập.';
    const snippet = `${sentence} ${sentence}`.slice(0, 200);
    const { found, segments, range } = locate(snippet);
    assert.equal(found.status, 'found');
    assert.ok(passage(segments, range!).startsWith('tainer với trạng thái và lớp ghi riêng.'));
  });

  it('a snippet ending inside a list marker ("\\n1" of "1.") or on inline code is still found exactly', () => {
    const from = INDEXED.indexOf('- **Docker Registry:**');
    const endAtMarker = INDEXED.slice(from, INDEXED.indexOf('\n1. ') + 2);
    assert.ok(endAtMarker.endsWith('\n1') && endAtMarker.length < 200);
    assert.equal(locate(endAtMarker).found.status, 'found');
    assert.equal(locate(snippetAt('Ví dụ, lệnh `docker run')).found.status, 'found');
    assert.equal(locate(snippetAt('- **Docker Registry:**')).found.status, 'found');
  });

  it('every 200-character window of the indexed text is located at the place it comes from', () => {
    const { segments } = collectSegments(lessonRoot() as any);
    const index = indexSegments(segments);
    let checked = 0;
    for (let at = 0; at + 120 < INDEXED.length; at += 37) {
      const snippet = INDEXED.slice(at, at + 200);
      const found = locateSnippet(index.canonical.text, snippet);
      assert.equal(found.status, 'found', `window at ${at}`);
      const p = passage(segments, toSegmentRange(index, (found as any).start, (found as any).end)!);
      assert.equal(canonicalize(p).text, (found as any).matched, `window at ${at}: the highlighted text is the matched text`);
      checked++;
    }
    assert.ok(checked > 20);
  });

  it('keywords of the lesson in another sentence, another lesson\'s text or a too short snippet: NOT located', () => {
    assert.equal(locate('Docker Image và Docker Container là hai khái niệm quan trọng mà người học cần nắm vững trong khóa học này.').found.status, 'not-found');
    assert.equal(locate('Decorator trong Python là một hàm nhận vào một hàm khác và trả về một hàm mới bao bọc hàm cũ.').found.status, 'not-found');
    assert.equal(locate('Docker Image').found.status, 'empty');
    assert.ok('Docker Image'.length < MIN_MATCH_CHARS);
  });

  it('adjacent blocks with no whitespace node between them (heading after paragraph) are still word-separated', () => {
    const segments: TextSegment[] = [
      { text: 'được xây dựng theo kiến trúc microservices.', block: 0 },
      { text: '3. Phân biệt Docker Image và Docker Container', block: 1 },
      { text: 'Docker Image', block: 2 },
      { text: ' là bản mẫu dùng để tạo container.', block: 2 },
    ];
    const index = indexSegments(segments);
    const found = locateSnippet(index.canonical.text, 'theo kiến trúc microservices. ## 3. Phân biệt Docker Image và Docker Container\n**Docker Image** là bản mẫu');
    assert.equal(found.status, 'found');
    const r = toSegmentRange(index, (found as any).start, (found as any).end)!;
    assert.deepEqual([r.startSeg, r.endSeg], [0, 3]);
    assert.equal(passage(segments, r), 'theo kiến trúc microservices. 3. Phân biệt Docker Image và Docker Container Docker Image là bản mẫu');
  });

  it('a passage present twice in the displayed text is ambiguous: no position is chosen', () => {
    const doubled = parseHtml(renderToStaticMarkup(<LessonMarkdown content={`${LESSON}\n\n${LESSON}`} />));
    assert.equal(locate(snippetAt('**Docker Container** là'), doubled).found.status, 'ambiguous');
  });
});

// ==================== DOM: scroll + highlight ====================

describe('clicking a citation: scroll to and highlight the passage', () => {
  beforeEach(() => highlights.clear());

  it('found: the passage is highlighted (CSS highlight, DOM untouched) and its block scrolled into view', () => {
    const root = lessonRoot();
    const before = JSON.stringify(root, (k, v) => (k === 'parentElement' || k === 'ownerDocument' ? undefined : v));
    const jump = jumpToSource(root as any, snippetAt('**Docker Image** là bản mẫu'));
    assert.equal(jump.status, 'highlighted');
    const range = highlights.get(HIGHLIGHT_NAME).ranges[0];
    assert.equal(range.startContainer.data.slice(range.startOffset).trim().startsWith('Docker Image') || range.startContainer.data.startsWith('Docker Image'), true);
    assert.equal(range.startContainer.parentElement.scrolled + (range.startContainer.parentElement.parentElement?.scrolled ?? 0) >= 1, true);
    const after = JSON.stringify(root, (k, v) => (k === 'parentElement' || k === 'ownerDocument' || k === 'scrolled' ? undefined : v));
    assert.equal(after, before.replace(/,"scrolled":0/g, ''), 'no node added, removed or changed');
  });

  it('another citation moves the highlight; a not-located one clears it and scrolls nowhere', () => {
    const root = lessonRoot();
    jumpToSource(root as any, snippetAt('**Docker Image** là bản mẫu'));
    const first = highlights.get(HIGHLIGHT_NAME).ranges[0];
    jumpToSource(root as any, snippetAt('- **Docker Registry:**'));
    const second = highlights.get(HIGHLIGHT_NAME).ranges[0];
    assert.notEqual(second.startContainer, first.startContainer);
    assert.match(second.startContainer.data, /Docker Registry/);

    const scrolledBefore = JSON.stringify(root, (k, v) => (k === 'parentElement' || k === 'ownerDocument' ? undefined : v)).match(/"scrolled":(\d+)/g);
    const miss = jumpToSource(root as any, 'Docker Image và Docker Container là hai khái niệm quan trọng mà người học cần nắm vững trong khóa học.');
    assert.deepEqual(miss, { status: 'not-located', reason: 'not-found' });
    assert.equal(highlights.has(HIGHLIGHT_NAME), false, 'old highlight removed');
    const scrolledAfter = JSON.stringify(root, (k, v) => (k === 'parentElement' || k === 'ownerDocument' ? undefined : v)).match(/"scrolled":(\d+)/g);
    assert.deepEqual(scrolledAfter, scrolledBefore, 'no scroll for a passage that is not located');
  });

  it('no lesson text on screen -> not located; clearSourceHighlight removes the highlight (lesson switch)', () => {
    assert.deepEqual(jumpToSource([null, null], snippetAt('**Docker Image** là')), { status: 'not-located', reason: 'no-document' });
    jumpToSource(lessonRoot() as any, snippetAt('**Docker Image** là'));
    assert.equal(highlights.has(HIGHLIGHT_NAME), true);
    clearSourceHighlight();
    assert.equal(highlights.has(HIGHLIGHT_NAME), false);
  });

  it('several containers: the first one that contains the passage is used', () => {
    const other = parseHtml(renderToStaticMarkup(<LessonMarkdown content={'Một tài liệu khác hoàn toàn, không liên quan tới Docker hay container nào cả trong khóa học.'} />));
    const lesson = lessonRoot();
    assert.equal(jumpToSource([other as any, lesson as any], snippetAt('**Docker Image** là')).status, 'highlighted');
    assert.equal(highlights.get(HIGHLIGHT_NAME).ranges[0].startContainer.parentElement.ownerDocument, lesson.ownerDocument);
  });

  it('a browser without CSS highlights still scrolls, and says it could not highlight', () => {
    const saved = (globalThis as any).CSS;
    (globalThis as any).CSS = {};
    try {
      assert.equal(jumpToSource(lessonRoot() as any, snippetAt('**Docker Image** là')).status, 'scrolled-only');
    } finally {
      (globalThis as any).CSS = saved;
    }
  });
});

// ==================== chat panel: sources, notices, layout ====================

const source = (n: number, snippet: string): RagSource => ({
  sourceIndex: n, documentId: 'd', chunkId: `d_chunk_${n}`, chunkIndex: n, courseId: 'c', lessonId: 'l', title: 'Bài 1', score: 0.8, snippet,
});

describe('chat panel: opening sources', () => {
  it('only cited sources are clickable ("Xem trong bài học"); uncited ones are plain text in their own group', () => {
    const split = splitSources('A [Nguồn 1]. B [Nguồn 3].', [source(1, 'a'), source(2, 'b'), source(3, 'c')]);
    const html = renderToStaticMarkup(<SourcesBlock split={split} onOpen={() => undefined} />);
    const used = html.slice(html.indexOf('data-group="used"'), html.indexOf('data-group="unused"'));
    const unused = html.slice(html.indexOf('data-group="unused"'));
    assert.equal((used.match(/Xem trong bài học/g) || []).length, 2);
    assert.doesNotMatch(unused, /<button|Xem trong bài học/);
  });

  it('the outcome of the last opened citation is shown under the sources, for each status', () => {
    const split = splitSources('A [Nguồn 1].', [source(1, 'a')]);
    for (const [jump, message] of [
      [{ status: 'highlighted', matched: 'x' }, JUMP_MESSAGES.highlighted],
      [{ status: 'not-located', reason: 'not-found' }, 'Không xác định được vị trí chính xác trong tài liệu đang hiển thị.'],
      [{ status: 'other-lesson' }, JUMP_MESSAGES['other-lesson']],
    ] as const) {
      const html = renderToStaticMarkup(<SourcesBlock split={split} onOpen={() => undefined} activeCitation={{ turnId: 't', sourceIndex: 1, jump: jump as any }} />);
      assert.match(text(html), new RegExp(message.replace(/[.()]/g, '\\$&')));
      assert.match(html, /data-active="true"/);
    }
  });

  it('a snippet with HTML / script is shown as text, never as markup', () => {
    const split = splitSources('A [Nguồn 1].', [source(1, '<img src=x onerror="alert(1)"><script>alert(2)</script>')]);
    const html = renderToStaticMarkup(<SourcesBlock split={split} onOpen={() => undefined} />);
    assert.doesNotMatch(html, /<img|<script/);
    assert.match(html, /&lt;img/);
  });

  it('an answer without citation and a not-found answer have no clickable source', () => {
    const noCite = { id: 'a', role: 'ASSISTANT' as const, content: 'Không có ký hiệu.', grounded: true, sources: splitSources('Không có ký hiệu.', [source(1, 'a')]) };
    assert.doesNotMatch(renderToStaticMarkup(<ChatTurnView turn={noCite} onOpenSource={() => undefined} />), /data-citation=|Xem trong bài học/);
    const notFound = { id: 'b', role: 'ASSISTANT' as const, content: 'Mình chưa tìm thấy [Nguồn 1]', grounded: false, sources: splitSources('', []) };
    assert.doesNotMatch(renderToStaticMarkup(<ChatTurnView turn={notFound} onOpenSource={() => undefined} />), /data-citation="/);
  });

  it('layout: history is its own scroll region, the composer is pinned under it (loading / error / result)', () => {
    const states = [
      { ...emptyThread(), pending: true },
      { ...emptyThread(), error: { kind: 'UNAVAILABLE' as const, message: 'x', retryable: true, question: 'q' } },
      { ...emptyThread(), turns: [{ id: 't', role: 'ASSISTANT' as const, content: 'A [Nguồn 1]', grounded: true, sources: splitSources('A [Nguồn 1]', [source(1, 'a')]) }] },
    ];
    for (const thread of states) {
      const html = renderToStaticMarkup(<LessonChatView lessonTitle="Bài 1" thread={thread} draft="" onDraftChange={() => undefined} onSend={() => undefined} onRetry={() => undefined} onDismissError={() => undefined} />);
      assert.match(html, /class="[^"]*\bh-full\b[^"]*\bmin-h-0\b[^"]*" data-testid="lesson-chat"/);
      assert.match(html, /class="flex-1 min-h-0 overflow-y-auto[^"]*" data-region="history"/);
      assert.match(html, /class="[^"]*flex-shrink-0[^"]*" data-region="composer"/);
      assert.ok(html.indexOf('data-region="history"') < html.indexOf('data-region="composer"'));
    }
  });
});

// ==================== learning page wiring ====================

describe('learning page wiring (static)', () => {
  const page = readFileSync(path.resolve('src/pages/Learning.tsx'), 'utf8');
  const css = readFileSync(path.resolve('src/index.css'), 'utf8');

  it('a citation is searched only for the open lesson, in the lesson text on screen; highlights cleared on lesson change', () => {
    assert.match(page, /source\.lessonId !== currentLesson\.id \|\| \(source\.courseId && source\.courseId !== course\.id\)/);
    assert.match(page, /return \{ status: 'other-lesson' \};/);
    assert.match(page, /jumpToSource\(\[lessonTextRef\.current, lessonInfoRef\.current\], source\.snippet\)/);
    assert.match(page, /useEffect\(\(\) => \{\s*clearSourceHighlight\(\);\s*\}, \[currentLesson\?\.id, lessonType\]\);/);
    assert.match(page, /<LessonMarkdown ref=\{lessonInfoRef\} content=\{currentLesson\.description\} \/>/);
    assert.match(page, /onSourceSelect=\{handleSourceSelect\}/);
  });

  it('layout: page fits under the header on large screens, stacks on small ones, video not squeezed, FAB moved, highlight style', () => {
    assert.match(page, /flex flex-col lg:flex-row lg:h-\[calc\(100dvh-65px\)\]/);
    assert.match(page, /w-full lg:w-96 h-\[85dvh\] lg:h-auto min-h-0/);
    assert.match(page, /<div className="shrink-0">\s*<HLSPlayer/);
    assert.match(page, /document\.body\.dataset\.lessonChat = 'open'/);
    assert.match(css, /::highlight\(rag-source\)\s*\{\s*background-color: #fef08a;/);
    assert.match(css, /body\[data-lesson-chat='open'\] #chat-widget-btn \{\s*right: calc\(24rem \+ 1\.5rem\);/);
    assert.match(readFileSync(path.resolve('src/components/realtime/ChatWidget.tsx'), 'utf8'), /id="chat-widget-btn"/);
  });
});
