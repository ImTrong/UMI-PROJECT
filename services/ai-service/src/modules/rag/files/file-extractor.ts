import path from 'path';
import { pathToFileURL } from 'url';
import mammoth from 'mammoth';
import { RAGError } from '../errors';

/**
 * RAG-PDF-01 — text extraction from lesson files (PDF, DOCX) for the existing ingestion pipeline.
 *
 * Output = ordered segments, each with the location it comes from, so a chunk can later point back to its file / page /
 * paragraph:
 *   PDF   one segment per page that has text; location.page = the page number in the file (1-based, pages without text skipped)
 *   DOCX  consecutive paragraphs grouped up to `groupChars` characters, a heading starting a new group;
 *         location.paragraphStart / paragraphEnd = 1-based paragraph indexes in document order, location.heading = the
 *         current section heading
 * Not supported (explicit errors, never a silent empty document): scanned PDF without a text layer (no OCR), password
 * protected PDF, corrupt files, other formats, files over the size / page limits.
 */
export type FileKind = 'PDF' | 'DOCX';

export interface SegmentLocation {
  page?: number;
  paragraphStart?: number;
  paragraphEnd?: number;
  heading?: string;
}

export interface ExtractedSegment {
  text: string;
  location: SegmentLocation;
}

export interface ExtractedFile {
  kind: FileKind;
  segments: ExtractedSegment[];
  stats: { pages?: number; pagesWithText?: number; paragraphs?: number; characters: number };
}

export const maxFileBytes = () => parseInt(process.env.RAG_MAX_FILE_BYTES || String(20 * 1024 * 1024), 10);
export const maxPdfPages = () => parseInt(process.env.RAG_MAX_FILE_PAGES || '300', 10);
/** A PDF whose pages all have fewer non-space characters than this has no usable text layer (scan). */
export const MIN_PAGE_TEXT_CHARS = 20;

/** The real format, from the file's bytes (the declared name / MIME type are not trusted). */
export function sniffKind(bytes: Uint8Array): FileKind | 'ZIP' | null {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'PDF';
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'ZIP'; // DOCX is a zip: confirmed by the parser
  return null;
}

const nonSpaceLength = (s: string) => s.replace(/\s+/g, '').length;

export async function extractFile(bytes: Uint8Array, options: { groupChars?: number } = {}): Promise<ExtractedFile> {
  if (bytes.byteLength === 0) throw new RAGError('FILE_EMPTY', 'zero-byte file');
  if (bytes.byteLength > maxFileBytes()) throw new RAGError('FILE_TOO_LARGE', `${bytes.byteLength} bytes`);
  const kind = sniffKind(bytes);
  if (kind === 'PDF') return extractPdf(bytes);
  if (kind === 'ZIP') return extractDocx(bytes, options.groupChars ?? 600);
  throw new RAGError('UNSUPPORTED_FILE_TYPE', 'neither a PDF nor a DOCX file');
}

// ==================== PDF (pdfjs-dist, legacy build for Node) ====================

// pdfjs-dist 4 is ESM-only; this CommonJS service loads it with a real dynamic import (not rewritten into require by tsc)
const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
let pdfjsPromise: Promise<any> | null = null;

function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = importEsm(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedFile> {
  const pdfjs = await loadPdfjs();
  const standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
  let doc: any;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes), // pdfjs takes ownership of (detaches) the buffer it is given
      isEvalSupported: false, // never compile font programs to JS (CVE-2024-4367 class of issues)
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl,
      verbosity: 0,
    }).promise;
  } catch (error: any) {
    if (error?.name === 'PasswordException') throw new RAGError('FILE_ENCRYPTED');
    throw new RAGError('FILE_CORRUPT', error?.message);
  }

  try {
    if (doc.numPages > maxPdfPages()) throw new RAGError('FILE_TOO_LARGE', `${doc.numPages} pages`);
    const segments: ExtractedSegment[] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      page.cleanup();
      text = text.normalize('NFC').replace(/[ \t]+\n/g, '\n').trim();
      if (nonSpaceLength(text) < MIN_PAGE_TEXT_CHARS) continue; // blank / image-only page
      characters += text.length;
      segments.push({ text, location: { page: pageNumber } });
    }
    if (segments.length === 0) {
      throw new RAGError('PDF_NO_TEXT_LAYER', `${doc.numPages} page(s) without extractable text`);
    }
    return { kind: 'PDF', segments, stats: { pages: doc.numPages, pagesWithText: segments.length, characters } };
  } catch (error: any) {
    if (error instanceof RAGError) throw error;
    throw new RAGError('FILE_CORRUPT', error?.message);
  } finally {
    await doc.destroy();
  }
}

// ==================== DOCX (mammoth) ====================

interface DocxParagraph {
  index: number; // 1-based, document order
  text: string;
  headingLevel?: number;
  listItem?: boolean;
}

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Paragraphs of mammoth's HTML in document order: every h1-h6 / p / li / table cell is one paragraph. */
export function htmlToParagraphs(html: string): DocxParagraph[] {
  const paragraphs: DocxParagraph[] = [];
  let current: { text: string; headingLevel?: number; listItem?: boolean } | null = null;
  const flush = () => {
    if (current) {
      const text = decodeEntities(current.text).replace(/\s+/g, ' ').trim().normalize('NFC');
      if (text) paragraphs.push({ index: paragraphs.length + 1, text, headingLevel: current.headingLevel, listItem: current.listItem });
    }
    current = null;
  };
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)[^>]*>|([^<]+)/g)) {
    if (m[3] !== undefined) {
      if (!current) current = { text: '' };
      current.text += m[3];
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (/^(h[1-6]|p|li|td|th)$/.test(tag)) {
      flush();
      if (!closing) current = { text: '', headingLevel: tag.startsWith('h') ? Number(tag[1]) : undefined, listItem: tag === 'li' };
    } else if (tag === 'br' && current) {
      current.text += ' ';
    }
  }
  flush();
  return paragraphs;
}

export async function extractDocx(bytes: Uint8Array, groupChars: number): Promise<ExtractedFile> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      // images are dropped (no base64 payload in the text); mammoth >= 1.11 refuses external file references by default
      { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) },
    );
    html = result.value;
  } catch (error: any) {
    const message = String(error?.message || '');
    // a zip that is not a Word document (xlsx, pptx, plain zip...)
    if (/main document part|word\/document\.xml|end of central directory/i.test(message)) {
      throw new RAGError(/central directory/i.test(message) ? 'FILE_CORRUPT' : 'UNSUPPORTED_FILE_TYPE', message);
    }
    throw new RAGError('FILE_CORRUPT', message);
  }

  const paragraphs = htmlToParagraphs(html);
  if (paragraphs.length === 0) throw new RAGError('FILE_EMPTY', 'no paragraph with text');

  // group consecutive paragraphs (a heading opens a new group) so each chunk keeps a precise paragraph range
  const segments: ExtractedSegment[] = [];
  let heading: string | undefined;
  let group: DocxParagraph[] = [];
  const flushGroup = () => {
    if (group.length === 0) return;
    segments.push({
      text: group.map((p) => (p.headingLevel ? `${'#'.repeat(p.headingLevel)} ${p.text}` : p.listItem ? `- ${p.text}` : p.text)).join('\n\n'),
      location: { paragraphStart: group[0].index, paragraphEnd: group[group.length - 1].index, ...(heading ? { heading } : {}) },
    });
    group = [];
  };
  for (const p of paragraphs) {
    if (p.headingLevel) {
      flushGroup();
      heading = p.text;
    } else if (group.length > 0 && group.reduce((n, q) => n + q.text.length + 2, 0) + p.text.length > groupChars) {
      flushGroup();
    }
    group.push(p);
  }
  flushGroup();

  const characters = paragraphs.reduce((n, p) => n + p.text.length, 0);
  return { kind: 'DOCX', segments, stats: { paragraphs: paragraphs.length, characters } };
}
