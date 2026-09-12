import logger from '../../../utils/logger';
import { DocumentChunkData, DocumentMetadata } from '../types';

/**
 * RecursiveChunker — Splits text using hierarchical separators.
 *
 * Strategy:
 * 1. Try to split by the highest-priority separator (e.g., "## " headings).
 * 2. If a resulting piece is still too large, recursively split it using the next separator.
 * 3. Overlap is added between consecutive chunks for context continuity.
 *
 * This is NOT line-based chunking. It respects document structure.
 */
export class RecursiveChunker {
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly separators: string[];

  constructor(chunkSize: number, chunkOverlap: number, separators?: string[]) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
    this.separators = separators || [
      '\n## ',    // H2 headings
      '\n### ',   // H3 headings
      '\n\n',     // Paragraph breaks
      '\n',       // Line breaks
      '. ',       // Sentence ends
      ' ',        // Word boundaries (last resort)
    ];
  }

  /**
   * Chunk a document's content into DocumentChunkData[].
   * Each chunk inherits the parent document's metadata.
   */
  chunk(
    content: string,
    documentId: string,
    title: string,
    sourceType: string,
    version: number,
    metadata: DocumentMetadata,
  ): DocumentChunkData[] {
    if (!content || content.trim().length === 0) {
      return [];
    }

    const rawChunks = this.splitText(content, 0);
    const chunks: DocumentChunkData[] = rawChunks.map((text, index) => ({
      chunkIndex: index,
      content: text,
      metadata: {
        ...metadata,
        documentId,
        title,
        sourceType,
        version,
      },
    }));

    logger.info(`[RecursiveChunker] Split "${title}" into ${chunks.length} chunks (size=${this.chunkSize}, overlap=${this.chunkOverlap})`);
    return chunks;
  }

  /**
   * Recursively split text using the separator hierarchy.
   */
  private splitText(text: string, separatorIndex: number): string[] {
    if (text.length <= this.chunkSize) {
      return [text.trim()].filter(t => t.length > 0);
    }

    // If we've exhausted all separators, force-split at chunkSize
    if (separatorIndex >= this.separators.length) {
      return this.forceSplit(text);
    }

    const separator = this.separators[separatorIndex];
    const parts = this.splitBySeparator(text, separator);

    // If the separator doesn't produce splits, try the next one
    if (parts.length <= 1) {
      return this.splitText(text, separatorIndex + 1);
    }

    // Merge small parts and recursively split large ones
    const result: string[] = [];
    let currentPiece = '';

    for (const part of parts) {
      const candidate = currentPiece ? currentPiece + separator + part : part;

      if (candidate.length <= this.chunkSize) {
        currentPiece = candidate;
      } else {
        // Flush current piece if it has content
        if (currentPiece.trim().length > 0) {
          result.push(currentPiece.trim());
        }

        // If this part alone is too large, split it recursively
        if (part.length > this.chunkSize) {
          const subChunks = this.splitText(part, separatorIndex + 1);
          result.push(...subChunks);
          currentPiece = '';
        } else {
          currentPiece = part;
        }
      }
    }

    // Flush remaining
    if (currentPiece.trim().length > 0) {
      result.push(currentPiece.trim());
    }

    // Apply overlap between consecutive chunks
    return this.applyOverlap(result);
  }

  /**
   * Split text by a separator, keeping the separator attached to the next part
   * to preserve heading context.
   */
  private splitBySeparator(text: string, separator: string): string[] {
    const parts = text.split(separator);
    if (parts.length <= 1) return parts;

    // Re-attach separator to subsequent parts (to preserve headings)
    const result: string[] = [parts[0]];
    for (let i = 1; i < parts.length; i++) {
      result.push(separator.trimStart() + parts[i]);
    }
    return result.filter(p => p.trim().length > 0);
  }

  /**
   * Force-split at character boundaries when no separator works.
   */
  private forceSplit(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + this.chunkSize, text.length);
      const chunk = text.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      start = end - this.chunkOverlap;
      if (start >= end) break; // prevent infinite loop
    }
    return chunks;
  }

  /**
   * Apply overlap: prepend the tail of chunk N to the beginning of chunk N+1.
   */
  private applyOverlap(chunks: string[]): string[] {
    if (chunks.length <= 1 || this.chunkOverlap <= 0) {
      return chunks;
    }

    const result: string[] = [chunks[0]];
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1];
      // Take the last `chunkOverlap` characters from the previous chunk
      const overlapText = prevChunk.slice(-this.chunkOverlap);
      const overlappedChunk = overlapText + ' ' + chunks[i];

      // Only use overlap if it doesn't make the chunk too huge
      if (overlappedChunk.length <= this.chunkSize * 1.3) {
        result.push(overlappedChunk.trim());
      } else {
        result.push(chunks[i]);
      }
    }
    return result;
  }
}
