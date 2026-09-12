import logger from '../../../utils/logger';

/**
 * DocumentCleaner — normalizes raw text content before chunking.
 *
 * Rules:
 * - Remove HTML tags
 * - Normalize whitespace (multiple spaces/newlines → single)
 * - Remove excessive formatting noise (---, ***, etc.)
 * - Trim empty lines at start/end
 * - PRESERVE semantic content: headings, code blocks, lists, emphasis
 */
export class DocumentCleaner {
  /**
   * Clean raw text content for chunking.
   */
  static clean(content: string): string {
    if (!content) return '';

    let cleaned = content;

    // 1. Remove HTML tags (but preserve content inside)
    cleaned = cleaned.replace(/<[^>]+>/g, '');

    // 2. Decode common HTML entities
    cleaned = cleaned
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // 3. Remove excessive horizontal rules (--- or *** repeated)
    cleaned = cleaned.replace(/^[-*=]{3,}\s*$/gm, '');

    // 4. Normalize multiple blank lines to max 2
    cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');

    // 5. Normalize whitespace within lines (but preserve indentation for code)
    cleaned = cleaned.replace(/[^\S\n]{3,}/g, '  ');

    // 6. Remove trailing whitespace on each line
    cleaned = cleaned.replace(/[ \t]+$/gm, '');

    // 7. Trim start and end
    cleaned = cleaned.trim();

    return cleaned;
  }
}
