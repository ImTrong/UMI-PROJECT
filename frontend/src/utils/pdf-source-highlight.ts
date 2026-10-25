import type { TextSegment } from './source-locator';
import { locatePdfSnippet, PdfLocateResult } from './pdf-source-locator';
import { clearSourceHighlight, highlightRegistry, HIGHLIGHT_NAME, scrollAnchorIntoView } from './source-highlight';

/**
 * RAG-PDF-05 — DOM side of "click a PDF citation -> that page, that passage highlighted".
 *
 * The page's pdfjs text layer (react-pdf `.react-pdf__Page__textContent`) holds one <span> per text item and a <br> after an
 * item that ends a line. The passage is highlighted with the same CSS Custom Highlight API entry as the lesson text
 * (`rag-source`, one highlight on screen at a time): the text layer is not modified and nothing from a snippet is inserted.
 */
export type PdfHighlightOutcome =
  | { status: 'highlighted' | 'scrolled-only'; matched: string }
  | { status: 'not-located'; reason: Exclude<PdfLocateResult['status'], 'found'> };

/** Text nodes of a text layer in display order; each <br> starts a new line (a word break between the two lines). */
export function collectTextLayerSegments(root: Node): { segments: TextSegment[]; nodes: Text[] } {
  const segments: TextSegment[] = [];
  const nodes: Text[] = [];
  let line = 0;
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const text = child as Text;
        if (text.data) {
          segments.push({ text: text.data, block: line });
          nodes.push(text);
        }
      } else if (child.nodeType === 1) {
        if ((child as Element).tagName === 'BR') line++;
        else walk(child);
      }
    });
  };
  walk(root);
  return { segments, nodes };
}

/** Locate `snippet` in this page's text layer; highlight it and scroll to it only when it is located exactly. */
export function highlightPdfSnippet(textLayer: Element, snippet: string): PdfHighlightOutcome {
  clearSourceHighlight();
  const { segments, nodes } = collectTextLayerSegments(textLayer);
  const found = locatePdfSnippet(segments, snippet);
  if (found.status !== 'found') return { status: 'not-located', reason: found.status };

  const range = textLayer.ownerDocument.createRange();
  range.setStart(nodes[found.startSeg], found.startOffset);
  range.setEnd(nodes[found.endSeg], found.endOffset);
  const anchor = nodes[found.startSeg].parentElement;
  if (anchor) scrollAnchorIntoView(anchor);

  const registry = highlightRegistry();
  if (!registry) return { status: 'scrolled-only', matched: found.matched };
  registry.set(HIGHLIGHT_NAME, new (globalThis as any).Highlight(range));
  return { status: 'highlighted', matched: found.matched };
}

/** The text layer react-pdf rendered inside a page element, if any. */
export function textLayerOf(pageElement: Element | null | undefined): Element | null {
  return pageElement?.querySelector('.react-pdf__Page__textContent') ?? null;
}
