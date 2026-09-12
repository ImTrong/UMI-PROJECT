import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiClient } from '../../../config/gemini.config';
import { IEmbeddingService } from '../types';
import logger from '../../../utils/logger';

/**
 * Gemini Embedding Service — uses Google's Generative AI SDK.
 *
 * Supports `gemini-embedding-001` (default 3072d, configurable via outputDimensionality).
 * Model and dimension are read from config, NOT hard-coded.
 *
 * Uses the existing `@google/generative-ai` SDK already installed in ai-service.
 */
export class GeminiEmbeddingService implements IEmbeddingService {
  private readonly modelName: string;
  private readonly dimension: number;
  private readonly maxRetries = 3;
  private readonly batchSize = 50;
  private readonly delayBetweenBatchesMs = 100;

  constructor(modelName: string, dimension: number) {
    this.modelName = modelName;
    this.dimension = dimension;
    logger.info(`[GeminiEmbedding] Initialized: model=${modelName}, dimension=${dimension}`);
  }

  getModelName(): string {
    return this.modelName;
  }

  getDimension(): number {
    return this.dimension;
  }

  /**
   * Embed a single document text.
   */
  async embedDocument(text: string): Promise<number[]> {
    return this.embedWithRetry(text);
  }

  /**
   * Embed a query string (for retrieval).
   */
  async embedQuery(text: string): Promise<number[]> {
    return this.embedWithRetry(text);
  }

  /**
   * Embed multiple texts in batches.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchResults = await Promise.all(
        batch.map(text => this.embedWithRetry(text)),
      );
      results.push(...batchResults);

      // Rate limiting between batches
      if (i + this.batchSize < texts.length) {
        await this.sleep(this.delayBetweenBatchesMs);
      }
    }

    return results;
  }

  /**
   * Embed text with retry and exponential backoff.
   */
  private async embedWithRetry(text: string): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const genAI: GoogleGenerativeAI = getGeminiClient();
        const model = genAI.getGenerativeModel({ model: this.modelName });

        const result = await model.embedContent({
          content: { role: 'user', parts: [{ text }] },
          outputDimensionality: this.dimension,
        } as any);

        const embedding = result.embedding.values;

        // Validate dimension
        if (embedding.length !== this.dimension) {
          throw new Error(
            `Embedding dimension mismatch: expected ${this.dimension}, got ${embedding.length}. ` +
            `Check EMBEDDING_DIMENSION env var matches model output.`,
          );
        }

        return embedding;
      } catch (error: any) {
        lastError = error;
        logger.warn(
          `[GeminiEmbedding] Attempt ${attempt}/${this.maxRetries} failed: ${error.message}`,
        );

        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 500; // 1s, 2s, 4s
          await this.sleep(delay);
        }
      }
    }

    throw new Error(
      `[GeminiEmbedding] All ${this.maxRetries} attempts failed: ${lastError?.message}`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
