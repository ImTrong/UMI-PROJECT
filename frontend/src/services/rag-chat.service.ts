import { aiApi } from './api';

/**
 * RAG-MVP-05A — client of the lesson-scoped RAG chat (ai-service, RAG-P0 contract).
 *
 *   POST /api/ai/rag/chat/new  { message, courseId, lessonId }                  -> first question: creates the conversation
 *   POST /api/ai/rag/chat      { conversationId, message, courseId, lessonId }  -> next questions of that conversation
 *   200 { success: true, data: RagChatResult }
 *   error: RAGError { success: false, error: CODE, message: <Vietnamese> } | 401 { error: 'Unauthorized' }
 *          | 400 { error } | 404 { error: 'Conversation not found' } | 429 { error } (rate limit)
 *
 * The request carries only the course / lesson being displayed; the backend verifies access with the learner's own token
 * (sent by the aiApi interceptor) and restricts retrieval to that lesson. Nothing here grants or assumes access.
 */
export interface RagScope {
  courseId: string;
  lessonId: string;
}

export interface RagSource {
  /** The "[Nguồn n]" number the model was told to cite. */
  sourceIndex: number;
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  courseId?: string;
  lessonId?: string;
  title: string;
  score: number;
  snippet: string;
  /** RAG-PDF-01: a chunk of a lesson file - which file (key in the course bucket) and its PDF page / DOCX paragraphs. */
  location?: RagSourceLocation;
}

export interface RagSourceLocation {
  fileKey: string;
  fileName?: string;
  fileType?: string;
  page?: number;
  paragraphStart?: number;
  paragraphEnd?: number;
  heading?: string;
}

export interface RagChatResult {
  message: string;
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  /** false = no lesson content passed the relevance gate: fixed "not found" answer, no sources. */
  grounded: boolean;
  sources: RagSource[];
  retrievalStats?: { totalChunksRetrieved: number; topScore: number; query: string };
}

/** Same limit as the backend (rag-chat.controller MAX_MESSAGE_LENGTH). */
export const RAG_MAX_MESSAGE_LENGTH = 4000;

export type RagChatErrorKind =
  | 'SESSION_EXPIRED'      // 401
  | 'ACCESS_DENIED'        // 403
  | 'CONVERSATION_GONE'    // 404 on /rag/chat: the conversation no longer exists / is not the learner's
  | 'NOT_FOUND'            // 404 course / lesson
  | 'INVALID_REQUEST'      // 400
  | 'RATE_LIMITED'         // 429
  | 'UNAVAILABLE'          // 5xx (embedding, vector store, LLM, access check)
  | 'NETWORK';             // no response

export class RagChatError extends Error {
  constructor(
    readonly kind: RagChatErrorKind,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RagChatError';
  }
}

const DEFAULT_MESSAGES: Record<RagChatErrorKind, string> = {
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục hỏi về bài học.',
  ACCESS_DENIED: 'Bạn chưa có quyền hỏi về tài liệu của bài học này. Hãy kiểm tra lại việc ghi danh khóa học.',
  CONVERSATION_GONE: 'Không tìm thấy cuộc trò chuyện trước đó. Câu hỏi tiếp theo sẽ bắt đầu cuộc trò chuyện mới.',
  NOT_FOUND: 'Không tìm thấy khóa học hoặc bài học này.',
  INVALID_REQUEST: 'Câu hỏi không hợp lệ. Vui lòng kiểm tra lại nội dung.',
  RATE_LIMITED: 'Bạn đang gửi câu hỏi quá nhanh. Vui lòng đợi một chút rồi thử lại.',
  UNAVAILABLE: 'Trợ lý bài học tạm thời không khả dụng. Vui lòng thử lại sau.',
  NETWORK: 'Không kết nối được tới máy chủ. Vui lòng kiểm tra mạng và thử lại.',
};

/** Normalizes an axios error of the RAG chat endpoints. Never exposes response internals beyond the backend's own message. */
export function toRagChatError(error: unknown): RagChatError {
  if (error instanceof RagChatError) return error;
  const e = error as any;
  const status: number | undefined = e?.response?.status;
  const body = e?.response?.data;
  const code: string | undefined = typeof body?.error === 'string' ? body.error : undefined;
  // RAGError bodies carry a Vietnamese, user-facing message; other bodies only an English technical one
  const backendMessage: string | undefined = body?.success === false && typeof body?.message === 'string' ? body.message : undefined;

  const make = (kind: RagChatErrorKind, retryable: boolean) =>
    new RagChatError(kind, backendMessage || DEFAULT_MESSAGES[kind], retryable, status, code);

  if (!status) return make('NETWORK', true);
  if (status === 401) return make('SESSION_EXPIRED', false);
  if (status === 403) return make('ACCESS_DENIED', false);
  if (status === 404) return code === 'Conversation not found' ? make('CONVERSATION_GONE', true) : make('NOT_FOUND', false);
  if (status === 400) return make('INVALID_REQUEST', false);
  if (status === 429) return make('RATE_LIMITED', true);
  if (status >= 500) return make('UNAVAILABLE', true);
  return make('UNAVAILABLE', true);
}

function readResult(data: any): RagChatResult {
  const result = data?.data;
  if (data?.success !== true || !result || typeof result.message !== 'string' || typeof result.conversationId !== 'string') {
    throw new RagChatError('UNAVAILABLE', DEFAULT_MESSAGES.UNAVAILABLE, true);
  }
  return {
    message: result.message,
    messageId: result.messageId,
    conversationId: result.conversationId,
    conversationTitle: result.conversationTitle,
    grounded: result.grounded === true,
    sources: Array.isArray(result.sources) ? result.sources : [],
    retrievalStats: result.retrievalStats,
  };
}

export const ragChatService = {
  /**
   * Ask a question about the lesson. Without a conversationId the conversation is created (/rag/chat/new);
   * with one, the question continues it (/rag/chat). Throws RagChatError.
   */
  ask: async (scope: RagScope, message: string, conversationId?: string | null): Promise<RagChatResult> => {
    const body = { message, courseId: scope.courseId, lessonId: scope.lessonId };
    try {
      const response = conversationId
        ? await aiApi.post('/api/ai/rag/chat', { conversationId, ...body })
        : await aiApi.post('/api/ai/rag/chat/new', body);
      return readResult(response.data);
    } catch (error) {
      throw toRagChatError(error);
    }
  },
};
