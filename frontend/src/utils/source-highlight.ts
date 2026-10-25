import { indexSegments, locateSnippet, toSegmentRange, LocateResult, TextSegment } from './source-locator';

/**
 * RAG-MVP-05D — DOM side of "click a citation -> scroll to and highlight the source passage".
 *
 * The highlight uses the CSS Custom Highlight API (`CSS.highlights`): the rendered Markdown is NOT modified (no wrapper
 * element, no innerHTML), so its structure, event handlers and keyboard access are untouched, and nothing coming from a
 * snippet is ever inserted into the page. Style: `::highlight(rag-source)` in index.css.
 */
export const HIGHLIGHT_NAME = 'rag-source';

const BLOCK_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'TD', 'TH', 'DT', 'DD', 'DIV', 'UL', 'OL', 'TABLE']);

export type SourceJump =
  | { status: 'highlighted'; matched: string }
  | { status: 'scrolled-only'; matched: string } // found and scrolled, but this browser has no CSS highlight support
  | { status: 'not-located'; reason: LocateResult['status'] | 'no-document' }
  | { status: 'other-lesson' }
  // RAG-PDF-05: a citation of a lesson PDF (pdf-source-highlight.ts)
  | { status: 'pdf-opening' }
  | { status: 'pdf-highlighted'; page: number; matched: string }
  | { status: 'pdf-scrolled-only'; page: number; matched: string } // passage found, no CSS highlight support
  | { status: 'pdf-page-only'; page: number; reason: string } // right page, passage not located exactly: nothing highlighted
  | { status: 'pdf-unavailable'; reason: 'not-a-lesson-file' | 'load-error' | 'page-out-of-range' | 'closed' };

/** Text nodes of `root` in document order, each tagged with its nearest block element. */
export function collectSegments(root: Element): { segments: TextSegment[]; nodes: Text[] } {
  const blocks = new Map<Element, number>();
  const segments: TextSegment[] = [];
  const nodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.data) continue;
    let block: Element | null = node.parentElement;
    while (block && block !== root && !BLOCK_TAGS.has(block.tagName)) block = block.parentElement;
    const key = block ?? root;
    if (!blocks.has(key)) blocks.set(key, blocks.size);
    segments.push({ text: node.data, block: blocks.get(key)! });
    nodes.push(node);
  }
  return { segments, nodes };
}

/** A DOM Range over the exact passage of `snippet` in `root`, or why there is none. */
export function locateInElement(root: Element, snippet: string): { range: Range; matched: string } | { reason: LocateResult['status'] } {
  const { segments, nodes } = collectSegments(root);
  const index = indexSegments(segments);
  const found = locateSnippet(index.canonical.text, snippet);
  if (found.status !== 'found') return { reason: found.status };
  const r = toSegmentRange(index, found.start, found.end);
  if (!r) return { reason: 'not-found' };
  const range = root.ownerDocument.createRange();
  range.setStart(nodes[r.startSeg], r.startOffset);
  range.setEnd(nodes[r.endSeg], r.endOffset);
  return { range, matched: found.matched };
}

export function highlightRegistry(): { set: (name: string, h: unknown) => void; delete: (name: string) => void } | null {
  const css = (globalThis as any).CSS;
  const Highlight = (globalThis as any).Highlight;
  return css?.highlights && typeof Highlight === 'function' ? css.highlights : null;
}

export function clearSourceHighlight(): void {
  highlightRegistry()?.delete(HIGHLIGHT_NAME);
}

/**
 * Centre the passage in its nearest scrollable container (the lesson column on large screens) without moving the window;
 * with no such container (small screens: the page itself scrolls) fall back to scrollIntoView.
 * RAG-PDF-05: `align: 'start'` puts the element's top at the top of the container (a PDF page).
 */
export function scrollAnchorIntoView(anchor: Element, align: 'third' | 'start' = 'third'): void {
  const view = anchor.ownerDocument.defaultView;
  if (view) {
    for (let el = anchor.parentElement; el; el = el.parentElement) {
      const overflowY = view.getComputedStyle(el).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        const offset = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTo({ top: el.scrollTop + offset - (align === 'start' ? 8 : el.clientHeight / 3), behavior: 'smooth' });
        return;
      }
    }
  }
  (anchor as HTMLElement).scrollIntoView?.({ behavior: 'smooth', block: align === 'start' ? 'start' : 'center' });
}

/**
 * Locate, scroll to and highlight `snippet` in the first of `roots` (the displayed lesson text containers, in display order)
 * that contains it exactly once. Never scrolls when the passage is not located exactly; an ambiguous container stops the search.
 */
export function jumpToSource(roots: Element | null | Array<Element | null>, snippet: string): SourceJump {
  clearSourceHighlight();
  const candidates = (Array.isArray(roots) ? roots : [roots]).filter((r): r is Element => !!r);
  if (candidates.length === 0) return { status: 'not-located', reason: 'no-document' };
  let located: ReturnType<typeof locateInElement> = { reason: 'not-found' };
  for (const root of candidates) {
    located = locateInElement(root, snippet);
    if ('range' in located || located.reason === 'ambiguous') break;
  }
  if (!('range' in located)) return { status: 'not-located', reason: located.reason };

  const anchor = located.range.startContainer.parentElement;
  if (anchor) scrollAnchorIntoView(anchor);

  const registry = highlightRegistry();
  if (!registry) return { status: 'scrolled-only', matched: located.matched };
  registry.set(HIGHLIGHT_NAME, new (globalThis as any).Highlight(located.range));
  return { status: 'highlighted', matched: located.matched };
}
