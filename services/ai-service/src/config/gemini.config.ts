import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';

let genAI: GoogleGenerativeAI | null = null;

/**
 * Initialize the Google Generative AI client
 * Called once at startup
 */
export function initializeGemini(): void {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-api-key-here') {
    logger.error('GEMINI_API_KEY is not set or is using placeholder value');
    throw new Error('GEMINI_API_KEY environment variable is required');
  }

  genAI = new GoogleGenerativeAI(apiKey);
  logger.info('Google Gemini AI client initialized successfully');
}

/**
 * Get the initialized Gemini client
 */
export function getGeminiClient(): GoogleGenerativeAI {
  if (!genAI) {
    throw new Error('Gemini client not initialized. Call initializeGemini() first.');
  }
  return genAI;
}

/**
 * Get the model name from environment or default
 */
export function getModelName(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
}
