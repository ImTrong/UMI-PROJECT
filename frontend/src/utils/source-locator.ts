/**
 * RAG-MVP-05D — find, in the lesson text as displayed, the passage a RAG citation points to.
 *
 * What the API gives: `snippet` = the first 200 characters of the cited chunk, i.e. of the lesson's Markdown source after the
 * ingestion cleaner. The chunker may prepend an overlap (the tail of the previous chunk, sometimes twice), the title heading and
 * may cut a word in two. What the page shows: the same Markdown rendered by ReactMarkdown (no `#`, `**`, backticks, list markers).
 *
 * Matching is EXACT on a canonical form applied identically to both sides (Markdown punctuation dropped, standalone list / number
 * markers dropped, whitespace collapsed). A match counts only if it occurs exactly once in the displayed text:
 *   1. the whole canonical snippet; else
 *   2. the longest suffix starting at a word boundary (the overlap / title prefix removed) of at least MIN_MATCH_CHARS.
 * No fuzzy matching, no keyword search: when nothing qualifies (or a match is not unique) the result says so and the caller
 * must not scroll anywhere.
 */
export const MIN_MATCH_CHARS = 40;

export interface Canonical {
  text: string;
  /** map[i] = index in the input string of canonical character i */
  map: number[];
}

const MARKDOWN_PUNCT = new Set(['*', '`', '#']);
const DROPPED_TOKEN = /^(?:[-+•]|\d+[.)])$/;

/** Canonical form shared by the displayed text and the snippet. */
export function canonicalize(input: string): Canonical {
  // 1. characters, without Markdown punctuation
  const chars: Array<{ ch: string; at: number }> = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (!MARKDOWN_PUNCT.has(ch)) chars.push({ ch, at: i });
  }
  // 2. tokens (split on whitespace), without standalone list / ordered-list markers
  const tokens: Array<Array<{ ch: string; at: number }>> = [];
  let current: Array<{ ch: string; at: number }> = [];
  for (const c of chars) {
    if (/\s/.test(c.ch)) {
      if (current.length) tokens.push(current);
      current = [];
    } else {
      current.push(c);
    }
  }
  if (current.length) tokens.push(current);
  const kept = tokens.filter((t) => !DROPPED_TOKEN.test(t.map((c) => c.ch).join('')));
  // 3. joined with single spaces (a space maps to the input position right after the previous token)
  let text = '';
  const map: number[] = [];
  kept.forEach((token, i) => {
    if (i > 0) {
      text += ' ';
      map.push(kept[i - 1][kept[i - 1].length - 1].at + 1);
    }
    for (const c of token) {
      text += c.ch;
      map.push(c.at);
    }
  });
  return { text, map };
}

/** Snippet-only clean-up of Markdown constructs whose rendered text differs from their source. */
export function snippetSource(snippet: string): string {
  return snippet
    .normalize('NFC')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // image -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link -> its text
    .replace(/__/g, '') // __bold__
    .replace(/…$/, '');
}

function occurrences(haystack: string, needle: string, limit = 2): number[] {
  const found: number[] = [];
  let from = 0;
  while (found.length < limit) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    found.push(at);
    from = at + 1;
  }
  return found;
}

export type LocateResult =
  | { status: 'found'; start: number; end: number; matched: string; droppedPrefix: string }
  | { status: 'not-found' | 'ambiguous' | 'empty'; reason: string };

/** Locate the snippet in a canonical document text. start / end are canonical indexes (end exclusive). */
export function locateSnippet(docCanonical: string, snippet: string, minChars = MIN_MATCH_CHARS): LocateResult {
  const needle = canonicalize(snippetSource(snippet)).text.trim();
  if (needle.length < minChars) return { status: 'empty', reason: 'snippet too short to be located exactly' };

  // the 200-character cut may end inside a Markdown marker ("\n1" of "1."): the last token may be dropped as well
  const lastSpace = needle.lastIndexOf(' ');
  const candidates = lastSpace > 0 ? [needle, needle.slice(0, lastSpace)] : [needle];

  for (const candidate of candidates) {
    const whole = occurrences(docCanonical, candidate);
    if (whole.length === 1) return { status: 'found', start: whole[0], end: whole[0] + candidate.length, matched: candidate, droppedPrefix: '' };
    if (whole.length > 1) return { status: 'ambiguous', reason: 'snippet occurs more than once' };

    // drop leading words (chunk overlap, title heading, a word cut in two) - longest suffix first
    for (let k = candidate.indexOf(' '); k > 0 && candidate.length - k - 1 >= minChars; k = candidate.indexOf(' ', k + 1)) {
      const suffix = candidate.slice(k + 1);
      const at = occurrences(docCanonical, suffix);
      if (at.length === 1) return { status: 'found', start: at[0], end: at[0] + suffix.length, matched: suffix, droppedPrefix: candidate.slice(0, k) };
      if (at.length > 1) return { status: 'ambiguous', reason: 'the longest matching part occurs more than once' };
    }
  }
  return { status: 'not-found', reason: 'no exact passage of the snippet in the displayed text' };
}

// ==================== text segments (one per DOM text node) ====================

export interface TextSegment {
  text: string;
  /** identifier of the block element (p, li, h2...) containing the text; a change inserts a word break */
  block: number;
}

export interface SegmentIndex {
  canonical: Canonical;
  /** raw[i] -> segment / offset, null for the virtual space inserted between blocks */
  positions: Array<{ seg: number; offset: number } | null>;
}

export function indexSegments(segments: TextSegment[]): SegmentIndex {
  let raw = '';
  const positions: SegmentIndex['positions'] = [];
  segments.forEach((s, i) => {
    if (i > 0 && s.block !== segments[i - 1].block) {
      raw += ' ';
      positions.push(null);
    }
    for (let o = 0; o < s.text.length; o++) {
      raw += s.text[o];
      positions.push({ seg: i, offset: o });
    }
  });
  return { canonical: canonicalize(raw), positions };
}

export interface SegmentRange {
  startSeg: number;
  startOffset: number;
  endSeg: number;
  /** exclusive */
  endOffset: number;
}

/** Canonical [start, end) -> text segment offsets (both ends are real characters: a match never starts / ends with a space). */
export function toSegmentRange(index: SegmentIndex, start: number, end: number): SegmentRange | null {
  const first = index.positions[index.canonical.map[start]];
  const last = index.positions[index.canonical.map[end - 1]];
  if (!first || !last) return null;
  return { startSeg: first.seg, startOffset: first.offset, endSeg: last.seg, endOffset: last.offset + 1 };
}
