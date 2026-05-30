import { getGeminiClient, getModelName } from '../config/gemini.config';
import { SYSTEM_PROMPT, TITLE_GENERATION_PROMPT } from '../utils/system-prompt';
import logger from '../utils/logger';

/**
 * Chat message format for building conversation context
 */
export interface ChatMessage {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

/**
 * AI Provider interface — designed for future extensibility
 * Can be replaced with OpenAI, Ollama, etc.
 */
export interface AIProvider {
  generateResponse(systemPrompt: string, history: ChatMessage[], userMessage: string): Promise<string>;
  generateTitle(userMessage: string, aiResponse: string): Promise<string>;
}

/**
 * Google Gemini AI Service
 * Implements the AIProvider interface using Google's Generative AI SDK
 */
export class GeminiService implements AIProvider {
  /**
   * Generate a response from Gemini given conversation context
   * Sends system prompt + chat history + new user message
   */
  async generateResponse(
    systemPrompt: string,
    history: ChatMessage[],
    userMessage: string
  ): Promise<string> {
    try {
      const genAI = getGeminiClient();
      const model = genAI.getGenerativeModel({
        model: getModelName(),
        systemInstruction: systemPrompt,
      });

      // Build chat history in Gemini format
      const geminiHistory = history.map((msg) => ({
        role: msg.role === 'USER' ? 'user' as const : 'model' as const,
        parts: [{ text: msg.content }],
      }));

      const chat = model.startChat({
        history: geminiHistory,
      });

      const result = await chat.sendMessage(userMessage);
      const response = result.response;
      const text = response.text();

      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      return text;
    } catch (error: any) {
      logger.error('Gemini API error:', {
        message: error.message,
        status: error.status,
        statusText: error.statusText,
      });
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  /**
   * Auto-generate a short conversation title based on the first exchange
   */
  async generateTitle(userMessage: string, aiResponse: string): Promise<string> {
    try {
      const genAI = getGeminiClient();
      const model = genAI.getGenerativeModel({ model: getModelName() });

      const prompt = TITLE_GENERATION_PROMPT
        .replace('{userMessage}', userMessage.substring(0, 200))
        .replace('{aiResponse}', aiResponse.substring(0, 200));

      const result = await model.generateContent(prompt);
      const title = result.response.text().trim();

      // Clean up: remove quotes, limit length
      const cleanTitle = title
        .replace(/^["'`]+|["'`]+$/g, '')
        .substring(0, 80);

      return cleanTitle || 'Cuộc trò chuyện mới';
    } catch (error) {
      logger.warn('Failed to generate title, using default:', error);
      return 'Cuộc trò chuyện mới';
    }
  }
}

// Singleton instance
export const geminiService = new GeminiService();
