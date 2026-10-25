import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { highlightPdfSnippet, textLayerOf } from '../../utils/pdf-source-highlight';
import { clearSourceHighlight, scrollAnchorIntoView } from '../../utils/source-highlight';

// Set worker from CDN
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

/** RAG-PDF-05: a cited passage to show - page number in the file (1-based) and the citation snippet. */
export interface PdfJumpTarget {
  id: number;
  page: number;
  snippet: string;
}

export type PdfJumpOutcome =
  | { status: 'highlighted' | 'scrolled-only'; page: number; matched: string }
  | { status: 'page-only'; page: number; reason: string }
  | { status: 'unavailable'; reason: 'page-out-of-range' | 'load-error' };

/** How long the cited page's text layer may take before the jump is answered "right page, passage not located". */
export const TEXT_LAYER_TIMEOUT_MS = 10000;

interface SecurePDFViewerProps {
  url: string;
  /** RAG-PDF-05: the passage to go to; a new `id` is a new jump */
  target?: PdfJumpTarget | null;
  /** called once per target id */
  onTargetResult?: (id: number, outcome: PdfJumpOutcome) => void;
}

export const SecurePDFViewer: React.FC<SecurePDFViewerProps> = ({ url, target = null, onTargetResult }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const pageElements = useRef(new Map<number, HTMLDivElement>());
  // react-pdf re-renders a text layer whenever its callbacks change: they are stable and read the current target from refs
  const targetRef = useRef<PdfJumpTarget | null>(target);
  targetRef.current = target;
  const resultRef = useRef(onTargetResult);
  resultRef.current = onTargetResult;
  const answered = useRef<number | null>(null);
  // the page whose text layer has finished rendering (its <div> exists, empty, before that)
  const textLayerReadyFor = useRef<number | null>(null);
  const textLayerPage = useRef<number | null>(null);
  // only the target page has a text layer: another page (or none) means a new one has to render first (set during render,
  // before react-pdf starts rendering that layer, so its success callback always finds the right page)
  if (textLayerPage.current !== (target?.page ?? null)) {
    textLayerPage.current = target?.page ?? null;
    textLayerReadyFor.current = null;
  }

  const answer = useCallback((outcome: PdfJumpOutcome) => {
    const current = targetRef.current;
    if (!current || answered.current === current.id) return;
    answered.current = current.id;
    resultRef.current?.(current.id, outcome);
  }, []);

  /** The cited page's text layer is on screen: locate the passage there. false = no text layer yet (wait for it). */
  const locateOnPage = useCallback((): boolean => {
    const current = targetRef.current;
    if (!current || answered.current === current.id) return true;
    if (textLayerReadyFor.current !== current.page) return false;
    const layer = textLayerOf(pageElements.current.get(current.page));
    if (!layer) return false;
    const outcome = highlightPdfSnippet(layer, current.snippet);
    if (outcome.status === 'not-located') {
      scrollAnchorIntoView(pageElements.current.get(current.page)!, 'start'); // the pages above may have grown meanwhile
      answer({ status: 'page-only', page: current.page, reason: outcome.reason });
    } else {
      answer({ status: outcome.status, page: current.page, matched: outcome.matched });
    }
    return true;
  }, [answer]);

  const onTextLayerReady = useCallback(() => {
    textLayerReadyFor.current = textLayerPage.current;
    locateOnPage();
  }, [locateOnPage]);
  const onTextLayerError = useCallback(() => {
    const current = targetRef.current;
    if (current) answer({ status: 'page-only', page: current.page, reason: 'text-layer-error' });
  }, [answer]);

  useEffect(() => {
    if (!target) {
      clearSourceHighlight();
      return;
    }
    if (answered.current === target.id) return; // already shown (a re-run must not remove its highlight)
    clearSourceHighlight();
    if (loadFailed) {
      answer({ status: 'unavailable', reason: 'load-error' });
      return;
    }
    if (numPages === null) return; // the document is still loading: this runs again once it is
    if (target.page > numPages) {
      answer({ status: 'unavailable', reason: 'page-out-of-range' });
      return;
    }
    const pageElement = pageElements.current.get(target.page);
    if (pageElement) scrollAnchorIntoView(pageElement, 'start');
    if (locateOnPage()) return;
    const timer = setTimeout(() => answer({ status: 'page-only', page: target.page, reason: 'text-layer-timeout' }), TEXT_LAYER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [target, numPages, loadFailed, answer, locateOnPage]);

  // closing the PDF (or another file) removes its highlight
  useEffect(() => () => clearSourceHighlight(), []);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  return (
    <div
      className="secure-pdf-viewer w-full flex flex-col items-center bg-slate-200 py-4"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Document
        file={url}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={() => setLoadFailed(true)}
        loading={
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        }
        error={
          <div className="text-red-500 py-10">
            Lỗi tải tài liệu PDF. Vui lòng thử lại.
          </div>
        }
      >
        {numPages && Array.from(new Array(numPages), (_, index) => (
          <div
            key={`page_${index + 1}`}
            className="mb-4 shadow-lg bg-white"
            data-pdf-page={index + 1}
            ref={(el) => {
              if (el) pageElements.current.set(index + 1, el);
              else pageElements.current.delete(index + 1);
            }}
          >
            <Page
              pageNumber={index + 1}
              // RAG-PDF-05: only the cited page gets a text layer (to locate and highlight the passage); it is not selectable
              renderTextLayer={target?.page === index + 1}
              onRenderTextLayerSuccess={onTextLayerReady}
              onRenderTextLayerError={onTextLayerError}
              renderAnnotationLayer={false}
              width={Math.min(window.innerWidth - 64, 900)}
            />
          </div>
        ))}
      </Document>
    </div>
  );
};
