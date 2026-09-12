/**
 * BM25Index — In-memory BM25 (Best Matching 25) implementation.
 *
 * Native TypeScript implementation with zero external dependencies.
 * Vietnamese-aware tokenization (whitespace + punctuation splitting).
 *
 * Standard BM25 parameters:
 *   k1 = 1.2 (term frequency saturation)
 *   b  = 0.75 (document length normalization)
 *
 * This index is kept in sync with the Qdrant vector store:
 *   - addDocument() on ingest/update
 *   - removeDocument() on delete
 *   - rebuildFromChunks() on initialization
 */

import { BM25Document } from './advanced-types';
import { MetadataFilter } from '../types';
import logger from '../../../utils/logger';

export class BM25Index {
  /** BM25 parameters */
  private readonly k1: number;
  private readonly b: number;

  /** All indexed documents */
  private documents: Map<string, BM25Document> = new Map();

  /** Inverted index: token → Set of chunkIds */
  private invertedIndex: Map<string, Set<string>> = new Map();

  /** Document frequency: token → number of documents containing it */
  private docFrequency: Map<string, number> = new Map();

  /** Total number of documents */
  private docCount = 0;

  /** Average document length (in tokens) */
  private avgDocLength = 0;

  /** Total token count across all documents */
  private totalTokens = 0;

  constructor(k1 = 1.2, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  /**
   * Tokenize text for BM25.
   * Vietnamese-aware: splits on whitespace and punctuation.
   * Lowercases all tokens. Filters out single-char tokens and stopwords.
   */
  static tokenize(text: string): string[] {
    if (!text) return [];

    return text
      .toLowerCase()
      // Replace punctuation with spaces (keep Vietnamese chars)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      // Split on whitespace
      .split(/\s+/)
      // Filter empty and single-char tokens
      .filter(t => t.length > 1);
  }

  /**
   * Add a document to the BM25 index.
   * If a document with the same chunkId already exists, it is replaced.
   */
  addDocument(doc: Omit<BM25Document, 'tokens'>): void {
    const chunkId = doc.chunkId;

    // Remove existing version if present
    if (this.documents.has(chunkId)) {
      this.removeDocument(chunkId);
    }

    const tokens = BM25Index.tokenize(doc.content);
    const bm25Doc: BM25Document = { ...doc, tokens };
    this.documents.set(chunkId, bm25Doc);
    this.docCount++;
    this.totalTokens += tokens.length;
    this.avgDocLength = this.totalTokens / this.docCount;

    // Update inverted index and doc frequency
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
        this.docFrequency.set(token, 0);
      }
      this.invertedIndex.get(token)!.add(chunkId);
      this.docFrequency.set(token, this.docFrequency.get(token)! + 1);
    }
  }

  /**
   * Remove a document from the BM25 index by chunkId.
   */
  removeDocument(chunkId: string): boolean {
    const doc = this.documents.get(chunkId);
    if (!doc) return false;

    const uniqueTokens = new Set(doc.tokens);
    for (const token of uniqueTokens) {
      const postings = this.invertedIndex.get(token);
      if (postings) {
        postings.delete(chunkId);
        const newFreq = (this.docFrequency.get(token) || 1) - 1;
        if (newFreq <= 0 || postings.size === 0) {
          this.invertedIndex.delete(token);
          this.docFrequency.delete(token);
        } else {
          this.docFrequency.set(token, newFreq);
        }
      }
    }

    this.totalTokens -= doc.tokens.length;
    this.docCount--;
    this.avgDocLength = this.docCount > 0 ? this.totalTokens / this.docCount : 0;
    this.documents.delete(chunkId);
    return true;
  }

  /**
   * Remove all documents belonging to a documentId.
   */
  removeByDocumentId(documentId: string): number {
    const toRemove: string[] = [];
    for (const [chunkId, doc] of this.documents) {
      if (doc.documentId === documentId) {
        toRemove.push(chunkId);
      }
    }
    for (const chunkId of toRemove) {
      this.removeDocument(chunkId);
    }
    return toRemove.length;
  }

  /**
   * Rebuild the entire index from a list of chunks.
   * Replaces all existing data.
   */
  rebuildFromChunks(chunks: Omit<BM25Document, 'tokens'>[]): void {
    // Clear everything
    this.documents.clear();
    this.invertedIndex.clear();
    this.docFrequency.clear();
    this.docCount = 0;
    this.totalTokens = 0;
    this.avgDocLength = 0;

    for (const chunk of chunks) {
      this.addDocument(chunk);
    }

    logger.info(`[BM25] Rebuilt index: ${this.docCount} documents, ${this.invertedIndex.size} unique tokens`);
  }

  /**
   * Search for documents matching a query.
   * Returns results sorted by BM25 score descending.
   *
   * @param query - Natural language query
   * @param topK - Max results to return
   * @param filter - Optional metadata filter (same constraints as dense retrieval)
   */
  search(query: string, topK: number, filter?: MetadataFilter): Array<{ doc: BM25Document; score: number }> {
    const queryTokens = BM25Index.tokenize(query);
    if (queryTokens.length === 0 || this.docCount === 0) return [];

    // Calculate BM25 score for each matching document
    const scores = new Map<string, number>();

    for (const token of queryTokens) {
      const postings = this.invertedIndex.get(token);
      if (!postings) continue;

      // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
      const df = this.docFrequency.get(token) || 0;
      const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);

      for (const chunkId of postings) {
        const doc = this.documents.get(chunkId)!;

        // Apply metadata filter
        if (filter && !this.matchesFilter(doc, filter)) continue;

        // Term frequency in document
        const tf = this.countOccurrences(doc.tokens, token);
        const docLen = doc.tokens.length;

        // BM25 score for this term-document pair
        const tfNorm = (tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength)));

        const current = scores.get(chunkId) || 0;
        scores.set(chunkId, current + idf * tfNorm);
      }
    }

    // Sort by score descending
    const results = Array.from(scores.entries())
      .map(([chunkId, score]) => ({ doc: this.documents.get(chunkId)!, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return results;
  }

  /**
   * Check if a document matches a metadata filter.
   * Same constraints as Qdrant dense retrieval.
   */
  private matchesFilter(doc: BM25Document, filter: MetadataFilter): boolean {
    if (filter.courseId && doc.metadata.courseId !== filter.courseId) return false;
    if (filter.lessonId && doc.metadata.lessonId !== filter.lessonId) return false;
    if (filter.learningPathId && doc.metadata.learningPathId !== filter.learningPathId) return false;
    if (filter.sourceType && doc.metadata.sourceType !== filter.sourceType) return false;
    if (filter.skills && filter.skills.length > 0) {
      const docSkills = (doc.metadata.skills as string[]) || [];
      for (const skill of filter.skills) {
        if (!docSkills.includes(skill)) return false;
      }
    }
    return true;
  }

  /** Count occurrences of a token in a token array. */
  private countOccurrences(tokens: string[], target: string): number {
    let count = 0;
    for (const t of tokens) {
      if (t === target) count++;
    }
    return count;
  }

  /** Get the number of indexed documents. */
  getDocumentCount(): number {
    return this.docCount;
  }

  /** Get the number of unique tokens in the index. */
  getTokenCount(): number {
    return this.invertedIndex.size;
  }
}
