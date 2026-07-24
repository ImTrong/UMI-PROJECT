import React, { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Set worker from CDN
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface SecurePDFViewerProps {
  url: string;
}

export const SecurePDFViewer: React.FC<SecurePDFViewerProps> = ({ url }) => {
  const [numPages, setNumPages] = useState<number | null>(null);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  return (
    <div 
      className="w-full flex flex-col items-center bg-slate-200 py-4" 
      onContextMenu={(e) => e.preventDefault()}
    >
      <Document
        file={url}
        onLoadSuccess={onDocumentLoadSuccess}
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
          <div key={`page_${index + 1}`} className="mb-4 shadow-lg bg-white">
            <Page 
              pageNumber={index + 1} 
              renderTextLayer={false} 
              renderAnnotationLayer={false}
              width={Math.min(window.innerWidth - 64, 900)}
            />
          </div>
        ))}
      </Document>
    </div>
  );
};
