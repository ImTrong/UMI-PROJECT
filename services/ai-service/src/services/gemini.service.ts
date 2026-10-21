import { getGeminiClient, getModelName } from '../config/gemini.config';
import { SYSTEM_PROMPT, TITLE_GENERATION_PROMPT } from '../utils/system-prompt';
import logger from '../utils/logger';

import { FunctionDeclaration, SchemaType, Tool } from '@google/generative-ai';

/**
 * Chat message format for building conversation context
 */
export interface ChatMessage {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

export type ToolHandler = (functionName: string, args: any) => Promise<any>;

/**
 * AI Provider interface — designed for future extensibility
 * Can be replaced with OpenAI, Ollama, etc.
 */
export interface AIProvider {
  generateResponse(systemPrompt: string, history: ChatMessage[], userMessage: string, toolHandler?: ToolHandler): Promise<string>;
  generateTitle(userMessage: string, aiResponse: string): Promise<string>;
}

const UMI_TOOLS: Tool[] = [{
  functionDeclarations: [
    {
      name: 'search_course',
      description: 'Tìm khóa học phù hợp với tên/mô tả người dùng yêu cầu.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: { type: SchemaType.STRING, description: 'Tên khóa học để tìm kiếm' }
        },
        required: ['query']
      }
    },
    {
      name: 'get_course_review_stats',
      description: 'Lấy dữ liệu đánh giá tổng quát của một khóa học (rating, lượt đánh giá, phân bố sao). KHÔNG trả về nội dung text review.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          courseId: { type: SchemaType.STRING, description: 'ID của khóa học' }
        },
        required: ['courseId']
      }
    },
    {
      name: 'search_instructor',
      description: 'Tìm giảng viên phù hợp với tên người dùng yêu cầu.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: { type: SchemaType.STRING, description: 'Tên giảng viên để tìm kiếm' }
        },
        required: ['query']
      }
    },
    {
      name: 'get_instructor_review_stats',
      description: 'Lấy dữ liệu đánh giá tổng quát của một giảng viên (rating, lượt đánh giá).',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          instructorId: { type: SchemaType.STRING, description: 'ID của giảng viên' }
        },
        required: ['instructorId']
      }
    },
    {
      name: 'get_course_reviews',
      description: 'Lấy danh sách các nhận xét, đánh giá (review content) thực tế của học viên về khóa học để phân tích điểm mạnh, điểm yếu.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          courseId: { type: SchemaType.STRING, description: 'ID của khóa học' },
          limit: { type: SchemaType.INTEGER, description: 'Số lượng review muốn lấy (mặc định 20)' }
        },
        required: ['courseId']
      }
    }
  ]
}];

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
    userMessage: string,
    toolHandler?: ToolHandler
  ): Promise<string> {
    try {
      const genAI = getGeminiClient();
      const model = genAI.getGenerativeModel({
        model: getModelName(),
        systemInstruction: systemPrompt,
        tools: toolHandler ? UMI_TOOLS : undefined,
      });

      // Build chat history in Gemini format
      const geminiHistory = history.map((msg) => ({
        role: msg.role === 'USER' ? 'user' as const : 'model' as const,
        parts: [{ text: msg.content }],
      }));

      const chat = model.startChat({
        history: geminiHistory,
      });

      let result = await chat.sendMessage(userMessage);

      // Handle function calls loop
      while (result.response.functionCalls && typeof result.response.functionCalls === 'function' && result.response.functionCalls() && result.response.functionCalls()!.length > 0) {
        const calls = result.response.functionCalls()!;
        const functionResponses = [];

        for (const call of calls) {
          logger.info(`TOOL CALL: ${call.name}`, call.args);
          let callResult;
          try {
            if (toolHandler) {
              callResult = await toolHandler(call.name, call.args);
            } else {
              callResult = { error: 'Tool handler not implemented' };
            }
          } catch (err: any) {
            logger.error(`Tool execution failed for ${call.name}:`, err.message);
            callResult = { error: `Không thể lấy dữ liệu: ${err.message}` };
          }
          
          logger.info(`TOOL RESULT: ${call.name}`, callResult);

          const responsePayload = typeof callResult === 'object' && callResult !== null && !Array.isArray(callResult)
            ? callResult
            : { result: callResult };

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: responsePayload
            }
          });
        }

        // Send tool results back to Gemini
        result = await chat.sendMessage(functionResponses);
      }

      const text = result.response.text();

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
