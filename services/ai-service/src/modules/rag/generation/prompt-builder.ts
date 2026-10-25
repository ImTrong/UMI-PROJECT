import { GroundedContext } from '../types';
import { ChatMessage } from '../../../services/gemini.service';
import logger from '../../../utils/logger';

/**
 * RAG Prompt Builder — Constructs structured prompts for grounded generation.
 *
 * Input:
 *   - question: user's current message
 *   - groundedContext: retrieved chunks that passed the RelevanceGate
 *   - conversationHistory: previous messages in the conversation
 *   - learnerSummary: minimal relevant learner context (name, current courses)
 *
 * Output:
 *   - A system prompt with the numbered sources embedded ([Nguồn 1], [Nguồn 2], ...)
 *   - Conversation history (unchanged)
 *   - The user's question (unchanged)
 *   - usedChunks: EXACTLY the chunks embedded in the prompt, in source order — the only valid citations
 *
 * Design principles (RAG-P0):
 *   1. The retrieved UMI course content is the ONLY knowledge source of the answer
 *   2. Not enough information in the sources -> the fixed "not found" sentence, no general knowledge
 *   3. Only minimal learner context (name, course enrollment) — NOT a full data dump
 *   4. The generation layer never calls the LLM without sources (see RAGGenerationService)
 */

export interface RAGPromptInput {
  question: string;
  groundedContext: GroundedContext;
  conversationHistory: ChatMessage[];
  learnerName?: string;
  learnerSummary?: string; // Minimal learner context (e.g., courses enrolled)
}

export type PromptChunk = GroundedContext['chunks'][number];

export interface RAGPromptOutput {
  systemPrompt: string;
  history: ChatMessage[];
  userMessage: string;
  usedChunks: PromptChunk[];
}

/** The answer when the course documents do not contain the information (also returned without any LLM call). */
export const NOT_FOUND_IN_COURSE_MESSAGE =
  'Mình chưa tìm thấy thông tin liên quan trong tài liệu của khóa học này để trả lời câu hỏi của bạn. ' +
  'Bạn có thể diễn đạt lại câu hỏi, hỏi về một nội dung khác của khóa học hoặc liên hệ giảng viên.';

/**
 * Build a structured prompt that grounds the LLM response
 * in retrieved knowledge chunks.
 */
export function buildRAGPrompt(input: RAGPromptInput): RAGPromptOutput {
  const { question, groundedContext, conversationHistory, learnerName, learnerSummary } = input;

  const usedChunks: PromptChunk[] = [...groundedContext.chunks];

  // Build knowledge context section from retrieved chunks
  let knowledgeSection: string;

  if (usedChunks.length > 0) {
    const chunkTexts = usedChunks.map((chunk, i) => {
      const source = chunk.title || 'Tài liệu khóa học';
      return `--- [Nguồn ${i + 1}] ${source} ---\n${chunk.content}`;
    });
    knowledgeSection = chunkTexts.join('\n\n');
  } else {
    knowledgeSection = '(Không có tài liệu khóa học nào liên quan)';
  }

  // Build minimal learner context
  let learnerSection = '';
  if (learnerName || learnerSummary) {
    learnerSection = `\n## Thông tin người học\n`;
    if (learnerName) {
      learnerSection += `Tên: ${learnerName}\n`;
    }
    if (learnerSummary) {
      learnerSection += `${learnerSummary}\n`;
    }
  }

  // Construct system prompt
  const systemPrompt = `Bạn là AI Learning Coach của nền tảng E-Learning UMI.

## Vai trò
Bạn trả lời câu hỏi của học viên **chỉ dựa trên tài liệu của khóa học** được cung cấp bên dưới.
${learnerSection}
## Tài liệu khóa học được truy xuất
${knowledgeSection}

## Quy tắc bắt buộc
1. **Chỉ dùng tài liệu khóa học**: Mọi thông tin trong câu trả lời phải có trong phần "Tài liệu khóa học được truy xuất". Không dùng kiến thức bên ngoài, không suy đoán, không bịa thêm chi tiết.
2. **Khi tài liệu không đủ**: Nếu tài liệu không chứa thông tin để trả lời, chỉ trả lời đúng câu sau và không thêm gì khác: "${NOT_FOUND_IN_COURSE_MESSAGE}"
3. **Trích dẫn nguồn**: Ghi rõ nguồn cho từng ý theo dạng [Nguồn 1], [Nguồn 2] tương ứng với các nguồn ở trên. Chỉ trích dẫn những nguồn có trong danh sách.
4. **Không mạo danh nguồn**: Không trình bày kiến thức chung như thể lấy từ tài liệu UMI.
5. **Ngôn ngữ**: Trả lời bằng tiếng Việt (trừ thuật ngữ chuyên ngành và code).
6. **Format**: Sử dụng Markdown (headings, bold, lists, code blocks).
7. **Ngắn gọn, chính xác**: Đủ chi tiết nhưng không lan man.`;

  logger.info(
    `[RAGPrompt] Built prompt: ${usedChunks.length} knowledge chunks, ` +
    `${conversationHistory.length} history messages`,
  );

  return {
    systemPrompt,
    history: conversationHistory,
    userMessage: question,
    usedChunks,
  };
}
