import { GroundedContext } from '../types';
import { ChatMessage } from '../../../services/gemini.service';
import logger from '../../../utils/logger';

/**
 * RAG Prompt Builder — Constructs structured prompts for grounded generation.
 *
 * Input:
 *   - question: user's current message
 *   - groundedContext: retrieved chunks from Qdrant
 *   - conversationHistory: previous messages in the conversation
 *   - learnerSummary: minimal relevant learner context (name, current courses)
 *
 * Output:
 *   - A system prompt with embedded knowledge context
 *   - Conversation history (unchanged)
 *   - The user's question (unchanged)
 *
 * Design principles:
 *   1. Retrieved UMI content is the PRIMARY knowledge source
 *   2. If no context retrieved → model must say "không đủ thông tin"
 *   3. Only include minimal learner context (name, course enrollment) — NOT full data dump
 *   4. LLM should NOT pretend it has read the entire UMI knowledge base
 */

export interface RAGPromptInput {
  question: string;
  groundedContext: GroundedContext;
  conversationHistory: ChatMessage[];
  learnerName?: string;
  learnerSummary?: string; // Minimal learner context (e.g., courses enrolled)
}

export interface RAGPromptOutput {
  systemPrompt: string;
  history: ChatMessage[];
  userMessage: string;
}

/**
 * Build a structured prompt that grounds the LLM response
 * in retrieved knowledge chunks.
 */
export function buildRAGPrompt(input: RAGPromptInput): RAGPromptOutput {
  const { question, groundedContext, conversationHistory, learnerName, learnerSummary } = input;

  // Build knowledge context section from retrieved chunks
  let knowledgeSection: string;

  if (groundedContext.chunks.length > 0) {
    const chunkTexts = groundedContext.chunks.map((chunk, i) => {
      const source = chunk.title || 'Unknown Source';
      return `--- Nguồn ${i + 1}: ${source} (score: ${chunk.score}) ---\n${chunk.content}`;
    });
    knowledgeSection = chunkTexts.join('\n\n');
  } else {
    knowledgeSection = '(Không tìm thấy kiến thức liên quan trong cơ sở dữ liệu UMI)';
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
Bạn là trợ lý học tập thông minh. Bạn trả lời câu hỏi dựa trên **kiến thức được truy xuất từ cơ sở dữ liệu UMI** bên dưới.
${learnerSection}
## Kiến thức UMI được truy xuất
${knowledgeSection}

## Quy tắc bắt buộc
1. **Trả lời dựa trên kiến thức được truy xuất**: Chỉ sử dụng nội dung trong phần "Kiến thức UMI được truy xuất" để trả lời. Đây là nguồn kiến thức chính.
2. **Không bịa thông tin UMI**: Nếu kiến thức truy xuất không đủ để trả lời, hãy nói rõ: "Dựa trên kiến thức hiện có trong UMI, tôi không tìm thấy đủ thông tin để trả lời câu hỏi này."
3. **Kiến thức chung**: Bạn có thể bổ sung kiến thức lập trình chung NHƯNG phải ghi rõ phần nào từ UMI, phần nào là kiến thức chung.
4. **Ngôn ngữ**: Trả lời bằng tiếng Việt (trừ thuật ngữ chuyên ngành và code).
5. **Format**: Sử dụng Markdown (headings, bold, lists, code blocks).
6. **Ngắn gọn, chính xác**: Đủ chi tiết nhưng không lan man.
7. **Trích dẫn nguồn**: Khi dùng thông tin từ kiến thức UMI, ghi rõ nguồn (ví dụ: "Theo bài học X...").`;

  logger.info(
    `[RAGPrompt] Built prompt: ${groundedContext.chunks.length} knowledge chunks, ` +
    `${conversationHistory.length} history messages` +
    (learnerName ? `, learner: ${learnerName}` : ''),
  );

  return {
    systemPrompt,
    history: conversationHistory,
    userMessage: question,
  };
}
