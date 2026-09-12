import { IEmbeddingService, IVectorStore, MetadataFilter, RetrievedChunk, SearchOptions } from '../types';
import { RAGConfig } from '../rag.config';
import logger from '../../../utils/logger';

/**
 * RetrievalService — Dense retrieval pipeline.
 *
 * Flow: Query → Embed → Vector Search (with optional metadata filter) → Top-K
 *
 * This is baseline Dense Retrieval only.
 * Hybrid Search (BM25), RRF, and Reranking belong to Tầng 3 (Advanced RAG).
 */
export class RetrievalService {
  private embeddingService: IEmbeddingService;
  private vectorStore: IVectorStore;
  private defaultTopK: number;
  private defaultScoreThreshold: number;

  constructor(
    config: RAGConfig,
    embeddingService: IEmbeddingService,
    vectorStore: IVectorStore,
  ) {
    this.embeddingService = embeddingService;
    this.vectorStore = vectorStore;
    this.defaultTopK = config.retrievalTopK;
    this.defaultScoreThreshold = config.retrievalScoreThreshold;
  }

  /**
   * Retrieve relevant chunks for a query.
   *
   * @param query - Natural language query
   * @param filter - Optional metadata filter (courseId, lessonId, etc.)
   * @param topK - Number of results (overrides default)
   * @param scoreThreshold - Minimum similarity score (overrides default)
   * @returns Retrieved chunks sorted by relevance score descending
   */
  async retrieve(
    query: string,
    filter?: MetadataFilter,
    topK?: number,
    scoreThreshold?: number,
  ): Promise<RetrievedChunk[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const options: SearchOptions = {
      topK: topK || this.defaultTopK,
      scoreThreshold: scoreThreshold ?? this.defaultScoreThreshold,
    };

    logger.info(`[Retrieval] Query: "${query.substring(0, 100)}...", topK=${options.topK}, filter=${JSON.stringify(filter || {})}`);

    // 1. Embed the query
    const queryVector = await this.embeddingService.embedQuery(query);

    // 2. Search vector store
    let results: RetrievedChunk[];
    if (filter && Object.keys(filter).some(k => (filter as any)[k])) {
      results = await this.vectorStore.searchByFilter(queryVector, filter, options);
    } else {
      results = await this.vectorStore.search(queryVector, options);
    }

    logger.info(`[Retrieval] Found ${results.length} chunks (scores: ${results.map(r => r.score.toFixed(3)).join(', ')})`);

    return results;
  }
}
