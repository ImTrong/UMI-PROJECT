import { forwardRef, ComponentProps, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';

type Components = NonNullable<ComponentProps<typeof ReactMarkdown>['components']>;
type MdProps = { children?: ReactNode; href?: string };

/**
 * RAG-MVP-05D — Markdown rendering for the lesson text and the lesson assistant's answers.
 *
 * ReactMarkdown only (raw HTML in the source is not rendered, no dangerouslySetInnerHTML). The element styles are explicit
 * Tailwind classes: the project has no @tailwindcss/typography, so `prose` classes would do nothing.
 */
export const markdownComponents: Components = {
  h1: ({ children }: MdProps) => <h1 className="text-xl font-bold text-slate-900 mt-4 mb-2 first:mt-0">{children}</h1>,
  h2: ({ children }: MdProps) => <h2 className="text-lg font-bold text-slate-900 mt-4 mb-2 first:mt-0">{children}</h2>,
  h3: ({ children }: MdProps) => <h3 className="text-base font-semibold text-slate-900 mt-3 mb-1.5 first:mt-0">{children}</h3>,
  h4: ({ children }: MdProps) => <h4 className="text-sm font-semibold text-slate-900 mt-3 mb-1 first:mt-0">{children}</h4>,
  p: ({ children }: MdProps) => <p className="my-2 leading-7 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }: MdProps) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
  ol: ({ children }: MdProps) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
  li: ({ children }: MdProps) => <li className="leading-7">{children}</li>,
  strong: ({ children }: MdProps) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em: ({ children }: MdProps) => <em className="italic">{children}</em>,
  blockquote: ({ children }: MdProps) => <blockquote className="border-l-4 border-slate-200 pl-3 my-2 text-slate-600">{children}</blockquote>,
  pre: ({ children }: MdProps) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-5 text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),
  code: ({ children }: MdProps) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">{children}</code>,
  a: ({ href, children }: MdProps) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-700 underline">{children}</a>
  ),
};

/**
 * Display-layer repair of a Markdown text that lost its line breaks (stored flattened on one line), so that "##" / "- **" are
 * not shown as such. Where a heading ended is lost with the line breaks, so an inline heading marker becomes a paragraph break
 * (no heading style is guessed), and inline "- **item**" bullets go back on their own lines. A paragraph that would start with
 * "2. " is escaped so it is not turned into a numbered list. A text that has line breaks is returned as is.
 */
export function restoreMarkdownBreaks(text: string): string {
  if (!text || text.includes('\n')) return text;
  const inlineHeadings = text.match(/\s#{1,6}\s/g) || [];
  if (inlineHeadings.length < 2) return text;
  return text
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s+#{1,6}\s+/g, '\n\n')
    .replace(/\s+-\s+(?=\*\*)/g, '\n- ')
    .replace(/(^|\n\n)(\d+)\.\s/g, '$1$2\\. ');
}

interface LessonMarkdownProps {
  content: string;
  className?: string;
}

/** The lesson text (description / text resource) rendered as Markdown; the ref is the element searched by citations. */
export const LessonMarkdown = forwardRef<HTMLDivElement, LessonMarkdownProps>(function LessonMarkdown({ content, className }, ref) {
  return (
    <div ref={ref} className={`text-slate-700 text-[15px] break-words ${className ?? ''}`} data-lesson-document="true">
      <ReactMarkdown components={markdownComponents}>{restoreMarkdownBreaks(content)}</ReactMarkdown>
    </div>
  );
});

// ==================== answers with clickable citations ====================

const CITATION_HREF = '#rag-source-';

/**
 * "[Nguồn 1]" / "[Nguồn 1, 3]" -> one Markdown link per number, kept at the same place in the text, so ReactMarkdown renders
 * each citation where the model wrote it (code spans / blocks are left untouched).
 */
export function linkCitations(answer: string): string {
  return answer
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\[\s*(nguồn)\s+([^\]]+)\]/giu, (whole, word: string, numbers: string) => {
      const ids = numbers.match(/\d+/g);
      if (!ids) return whole;
      return ids.map((n) => `[${word} ${n}](${CITATION_HREF}${n})`).join(', ');
    })))
    .join('');
}

interface AnswerMarkdownProps {
  content: string;
  /** source numbers that can be opened (cited and present in the source list) */
  citable: number[];
  onCite?: (sourceIndex: number) => void;
  activeIndex?: number | null;
}

export function AnswerMarkdown({ content, citable, onCite, activeIndex }: AnswerMarkdownProps) {
  const components: Components = {
    ...markdownComponents,
    a: ({ href, children }: MdProps) => {
      if (href?.startsWith(CITATION_HREF)) {
        const n = Number(href.slice(CITATION_HREF.length));
        const label = `[Nguồn ${n}]`;
        if (onCite && citable.includes(n)) {
          return (
            <button
              type="button"
              onClick={() => onCite(n)}
              data-citation={n}
              aria-label={`Mở đoạn tài liệu của nguồn ${n}`}
              className={`mx-0.5 rounded px-1 text-xs font-semibold align-baseline ${activeIndex === n ? 'bg-amber-200 text-amber-900' : 'bg-primary-50 text-primary-700 hover:bg-primary-100'}`}
            >
              {label}
            </button>
          );
        }
        return <span className="text-xs font-semibold text-slate-500" data-citation-inert={n}>{label}</span>;
      }
      return markdownComponents.a ? (markdownComponents.a as any)({ href, children }) : <a href={href}>{children}</a>;
    },
  };
  return (
    <div className="text-sm text-slate-800 break-words">
      <ReactMarkdown components={components}>{linkCitations(content)}</ReactMarkdown>
    </div>
  );
}
