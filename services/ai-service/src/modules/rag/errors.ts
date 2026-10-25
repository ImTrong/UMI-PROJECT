// ==================== RAG-P0 — typed RAG errors ====================

/**
 * Every failure of the RAG pipeline that a caller must see as a failure (never as an answer).
 * Controllers map the code to an HTTP status and a fixed Vietnamese message; the internal cause is only logged.
 */
export type RAGErrorCode =
  // access (checked before any retrieval / indexing)
  | 'COURSE_ID_REQUIRED'
  | 'INVALID_COURSE_ID'
  | 'INVALID_LESSON_ID'
  | 'COURSE_NOT_FOUND'
  | 'COURSE_ACCESS_DENIED'
  | 'LESSON_NOT_IN_COURSE'
  | 'DOCUMENT_NOT_FOUND'
  | 'SOURCE_BELONGS_TO_OTHER_COURSE'
  | 'ACCESS_CHECK_FAILED'
  // lesson files (RAG-PDF-01)
  | 'INVALID_FILE_KEY'
  | 'RESOURCE_NOT_FOUND'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'ONLY_PDF_SUPPORTED'
  | 'FILE_TOO_LARGE'
  | 'FILE_EMPTY'
  | 'FILE_CORRUPT'
  | 'FILE_ENCRYPTED'
  | 'PDF_NO_TEXT_LAYER'
  | 'FILE_DOWNLOAD_FAILED'
  // pipeline
  | 'RAG_UNAVAILABLE'
  | 'EMBEDDING_FAILED'
  | 'VECTOR_STORE_FAILED'
  | 'LLM_FAILED';

const STATUS: Record<RAGErrorCode, number> = {
  COURSE_ID_REQUIRED: 400,
  INVALID_COURSE_ID: 400,
  INVALID_LESSON_ID: 400,
  COURSE_NOT_FOUND: 404,
  COURSE_ACCESS_DENIED: 403,
  LESSON_NOT_IN_COURSE: 404,
  DOCUMENT_NOT_FOUND: 404,
  SOURCE_BELONGS_TO_OTHER_COURSE: 409,
  ACCESS_CHECK_FAILED: 503,
  INVALID_FILE_KEY: 400,
  RESOURCE_NOT_FOUND: 404,
  UNSUPPORTED_FILE_TYPE: 415,
  ONLY_PDF_SUPPORTED: 415,
  FILE_TOO_LARGE: 413,
  FILE_EMPTY: 422,
  FILE_CORRUPT: 422,
  FILE_ENCRYPTED: 422,
  PDF_NO_TEXT_LAYER: 422,
  FILE_DOWNLOAD_FAILED: 502,
  RAG_UNAVAILABLE: 503,
  EMBEDDING_FAILED: 503,
  VECTOR_STORE_FAILED: 503,
  LLM_FAILED: 502,
};

const MESSAGES: Record<RAGErrorCode, string> = {
  COURSE_ID_REQUIRED: 'Cần chọn khóa học (courseId) để hỏi về tài liệu.',
  INVALID_COURSE_ID: 'Mã khóa học không hợp lệ.',
  INVALID_LESSON_ID: 'Mã bài học không hợp lệ.',
  COURSE_NOT_FOUND: 'Không tìm thấy khóa học.',
  COURSE_ACCESS_DENIED: 'Bạn không có quyền truy cập tài liệu của khóa học này.',
  LESSON_NOT_IN_COURSE: 'Bài học không thuộc khóa học này.',
  DOCUMENT_NOT_FOUND: 'Không tìm thấy tài liệu.',
  SOURCE_BELONGS_TO_OTHER_COURSE: 'Nguồn tài liệu này đã được lập chỉ mục cho một khóa học khác.',
  ACCESS_CHECK_FAILED: 'Không thể xác minh quyền truy cập lúc này. Vui lòng thử lại sau.',
  INVALID_FILE_KEY: 'Mã tệp không hợp lệ.',
  RESOURCE_NOT_FOUND: 'Không tìm thấy tệp này trong tài nguyên của bài học.',
  UNSUPPORTED_FILE_TYPE: 'Định dạng tệp không được hỗ trợ. Hiện chỉ lập chỉ mục được tệp PDF.',
  ONLY_PDF_SUPPORTED: 'Hiện chỉ lập chỉ mục được tệp PDF cho trợ lý AI. Tệp DOCX sẽ được hỗ trợ sau.',
  FILE_TOO_LARGE: 'Tệp vượt quá giới hạn kích thước hoặc số trang cho phép.',
  FILE_EMPTY: 'Tệp không có nội dung văn bản.',
  FILE_CORRUPT: 'Không đọc được tệp: tệp bị hỏng hoặc không đúng định dạng.',
  FILE_ENCRYPTED: 'Tệp được bảo vệ bằng mật khẩu, không thể trích xuất nội dung.',
  PDF_NO_TEXT_LAYER: 'PDF không có lớp văn bản (có thể là bản scan). Hệ thống chưa hỗ trợ OCR.',
  FILE_DOWNLOAD_FAILED: 'Không tải được tệp từ kho lưu trữ khóa học. Vui lòng thử lại sau.',
  RAG_UNAVAILABLE: 'Hệ thống tra cứu tài liệu tạm thời không khả dụng. Vui lòng thử lại sau.',
  EMBEDDING_FAILED: 'Không thể xử lý câu hỏi để tra cứu tài liệu lúc này. Vui lòng thử lại sau.',
  VECTOR_STORE_FAILED: 'Kho tài liệu tạm thời không khả dụng. Vui lòng thử lại sau.',
  LLM_FAILED: 'Trợ lý AI tạm thời không phản hồi. Vui lòng thử lại sau.',
};

export class RAGError extends Error {
  readonly code: RAGErrorCode;
  readonly status: number;
  readonly userMessage: string;

  constructor(code: RAGErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RAGError';
    this.code = code;
    this.status = STATUS[code];
    this.userMessage = MESSAGES[code];
  }
}

export function isRAGError(error: unknown): error is RAGError {
  return error instanceof RAGError;
}

/** Short, secret-free description of a caught error for logs (no config / headers / request bodies). */
export function describeError(error: any): string {
  if (!error) return 'unknown error';
  const status = error.response?.status ?? error.status;
  const parts = [error.name || 'Error'];
  if (error.code) parts.push(String(error.code));
  if (status) parts.push(`HTTP ${status}`);
  if (typeof error.message === 'string') parts.push(error.message.slice(0, 300));
  return parts.join(' ');
}
