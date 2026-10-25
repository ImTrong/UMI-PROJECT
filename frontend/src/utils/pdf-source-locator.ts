import { indexSegments, locateSnippet, toSegmentRange, LocateResult, TextSegment } from './source-locator';
import type { RagSource } from '../services/rag-chat.service';

/**
 * RAG-PDF-05 — locate a PDF citation: which lesson file, which page, which passage of that page.
 *
 * What the API gives (RAG-PDF-01/02): `location = { fileKey, fileName, fileType: 'PDF', page }` and `snippet` = the first 200
 * characters of the cited chunk. The chunk text is the page text as the backend's pdfjs extracted it - each text item's `str`,
 * a "\n" after an item that ends a line (`hasEOL`), NFC - then cleaned (whitespace runs shortened) and chunked (a chunk may
 * start with an overlap of the previous chunk of the same page).
 * What the page shows: the pdfjs text layer of that page - one <span> per non-empty item, a <br> after an item that ends a
 * line. So the displayed text is the same item sequence: the <br> is a word break, like the "\n" of the backend.
 *
 * Both sides are folded the same way (Unicode NFKC per character cluster - a base character and its combining marks, so a
 * decomposed "ệ" equals the composed one and the "ﬁ" ligature equals "fi" -, soft hyphens dropped) and then matched by the
 * locator of RAG-MVP-05D: EXACT canonical match, unique on the page, at least MIN_MATCH_CHARS when leading words are dropped.
 * Only the cited page is searched. Nothing fuzzy: a near-identical passage is never highlighted.
 * Stricter than the lesson text on one point: a match that drops leading words of the snippet must keep most of it
 * (PDF_MIN_PARTIAL_CHARS and half the snippet). A chunk's overlap comes from the same page, right before it, so the whole
 * snippet normally matches; a short tail that also happens to be on the page is not taken for the citation.
 */
export const PDF_MIN_PARTIAL_CHARS = 80;

/** Bucket of the course files the backend indexes (ai-service lesson-file.service DOWNLOAD_BUCKET) and its key format. */
export const COURSE_FILES_BUCKET = 'courses';
const KEY_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export interface PdfCitation {
  fileKey: string;
  fileName?: string;
  page: number;
  snippet: string;
}

/** The PDF location of a citation, or null when it is not a usable PDF location (then the lesson-text mechanism applies). */
export function pdfCitationOf(source: Pick<RagSource, 'location' | 'snippet'>): PdfCitation | null {
  const location = source.location;
  if (!location || typeof location.fileType !== 'string' || location.fileType.toUpperCase() !== 'PDF') return null;
  const { fileKey, page } = location;
  if (typeof fileKey !== 'string' || !KEY_FORMAT.test(fileKey) || fileKey.includes('..')) return null;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return null;
  return { fileKey, fileName: location.fileName, page, snippet: typeof source.snippet === 'string' ? source.snippet : '' };
}

/** bucket / key of a course-service download URL ("/api/courses/files/download?bucket=..&key=.."), else null. */
export function parseDownloadRef(url: unknown): { bucket: string; key: string } | null {
  if (typeof url !== 'string' || !url.includes('/api/courses/files/download')) return null;
  const query = url.split('?')[1];
  if (!query) return null;
  const params = new URLSearchParams(query.split('#')[0]);
  const bucket = params.get('bucket');
  const key = params.get('key');
  return bucket && key ? { bucket, key } : null;
}

/**
 * The URL - one the lesson itself already refers to (main file or a resource) - of the course file `fileKey`, or null.
 * The client never builds a URL or picks a bucket from a citation: the file is opened only if this lesson lists it, through the
 * existing download route (course-service checks access again).
 */
export function lessonFileUrlForKey(lessonUrls: Array<unknown>, fileKey: string): string | null {
  for (const url of lessonUrls) {
    const ref = parseDownloadRef(url);
    if (ref && ref.bucket === COURSE_FILES_BUCKET && ref.key === fileKey) return url as string;
  }
  return null;
}

// ==================== text folding ====================

export interface Folded {
  text: string;
  /** rawStart[i] / rawEnd[i] = the input range [start, end) of the character cluster folded character i comes from */
  rawStart: number[];
  rawEnd: number[];
}

const COMBINING = /\p{M}/u;

/** NFKC per character cluster (base + combining marks), soft hyphens removed; keeps the way back to the input offsets. */
export function foldPdfText(input: string): Folded {
  const out: Folded = { text: '', rawStart: [], rawEnd: [] };
  let i = 0;
  while (i < input.length) {
    const start = i;
    i += input.codePointAt(i)! > 0xffff ? 2 : 1;
    while (i < input.length && COMBINING.test(String.fromCodePoint(input.codePointAt(i)!))) {
      i += input.codePointAt(i)! > 0xffff ? 2 : 1;
    }
    const folded = input.slice(start, i).normalize('NFKC').replace(/­/g, '');
    for (const ch of folded) {
      for (let k = 0; k < ch.length; k++) {
        out.text += ch[k];
        out.rawStart.push(start);
        out.rawEnd.push(i);
      }
    }
  }
  return out;
}

/** The snippet folded like the page text (the "…" the list view may add is not part of the source). */
export function foldSnippet(snippet: string): string {
  return foldPdfText(snippet.replace(/…\s*$/, '')).text;
}

// ==================== locate on one page ====================

export interface PdfTextRange {
  startSeg: number;
  startOffset: number;
  endSeg: number;
  /** exclusive */
  endOffset: number;
}

export type PdfLocateResult =
  | ({ status: 'found'; matched: string } & PdfTextRange)
  | { status: Exclude<LocateResult['status'], 'found'> | 'no-text'; reason: string };

/**
 * Locate `snippet` in the text items of ONE page (segments in display order; a `block` change = a line break). The range is
 * in raw segment offsets (what a DOM Range over the text layer needs).
 */
export function locatePdfSnippet(segments: TextSegment[], snippet: string): PdfLocateResult {
  if (!segments.some((s) => s.text.trim())) return { status: 'no-text', reason: 'the page has no text layer' };
  const folded = segments.map((s) => foldPdfText(s.text));
  const index = indexSegments(segments.map((s, i) => ({ text: folded[i].text, block: s.block })));
  const needle = foldSnippet(snippet);
  const found = locateSnippet(index.canonical.text, needle);
  if (found.status !== 'found') return found;
  if (found.droppedPrefix && found.matched.length < Math.max(PDF_MIN_PARTIAL_CHARS, needle.trim().length / 2)) {
    return { status: 'not-found', reason: 'only a short tail of the snippet is on this page' };
  }
  const r = toSegmentRange(index, found.start, found.end);
  if (!r) return { status: 'not-found', reason: 'the match does not map back to the page text' };
  return {
    status: 'found',
    matched: found.matched,
    startSeg: r.startSeg,
    startOffset: folded[r.startSeg].rawStart[r.startOffset],
    endSeg: r.endSeg,
    endOffset: folded[r.endSeg].rawEnd[r.endOffset - 1],
  };
}
