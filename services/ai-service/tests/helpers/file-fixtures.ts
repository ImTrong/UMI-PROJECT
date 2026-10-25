/**
 * RAG-PDF-01 — small PDF / DOCX fixtures generated in memory (no binary file in the repository, no private data).
 *
 * PDF: hand-written PDF 1.4, one Type1 standard font (not embedded); every non-ASCII character is given a code 128-255 through
 * an /Encoding /Differences array of `uniXXXX` glyph names, which pdfjs maps back to Unicode - so Vietnamese text is extracted
 * exactly. A page may have no text at all (an "image-only" page, as in a scan).
 * DOCX: the minimal OPC package (content types, relationships, styles with "heading 1/2", document.xml) zipped with jszip
 * (a dependency of mammoth).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');

/** Lines wrapped at word boundaries to stay inside the page (text past the page edge is not extracted by pdfjs). */
function wrap(line: string, width = 80): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current && (current + ' ' + word).length > width) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}

export function buildPdf(rawPages: Array<string[] | null>): Buffer {
  const pages = rawPages.map((p) => (p ? p.flatMap((l) => wrap(l)) : null));
  // code table for every non-ASCII character used
  const extra = [...new Set(pages.flatMap((p) => (p ?? []).join('')).join('').split('').filter((c) => c.charCodeAt(0) > 126))];
  if (extra.length > 128) throw new Error('too many distinct non-ASCII characters for one font');
  const codeOf = new Map(extra.map((c, i) => [c, 128 + i]));
  const encode = (line: string) =>
    line
      .split('')
      .map((c) => {
        if (codeOf.has(c)) return `\\${codeOf.get(c)!.toString(8).padStart(3, '0')}`;
        if (c === '(' || c === ')' || c === '\\') return `\\${c}`;
        return c;
      })
      .join('');

  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const differences = extra.map((c) => `/uni${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
  const catalog = add('');
  const pagesObj = add('');
  const encoding = add(`<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [128 ${differences}] >>`);
  const font = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${encoding} 0 R >>`);
  const kids: number[] = [];
  for (const lines of pages) {
    const stream = lines
      ? `BT /F1 12 Tf 50 780 Td 16 TL ${lines.map((l) => `(${encode(l)}) Tj T*`).join(' ')} ET`
      : '0.2 0.4 0.8 rg 60 300 480 400 re f'; // a filled rectangle only: no text layer
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type DocxBlock = { heading?: 1 | 2; text: string } | { list: string };

export async function buildDocx(blocks: DocxBlock[], options: { withoutDocumentXml?: boolean } = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.file('word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>');
  zip.file('word/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>' +
    '</w:styles>');
  if (!options.withoutDocumentXml) {
    const body = blocks.map((b) => {
      if ('list' in b) {
        return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(b.list)}</w:t></w:r></w:p>`;
      }
      const style = b.heading ? `<w:pPr><w:pStyle w:val="Heading${b.heading}"/></w:pPr>` : '';
      return `<w:p>${style}<w:r><w:t xml:space="preserve">${xmlEscape(b.text)}</w:t></w:r></w:p>`;
    }).join('');
    zip.file('word/document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}
