import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { RAGRequester } from './access/rag-access.service';
import { isRAGError, describeError } from './errors';
import logger from '../../utils/logger';

/** The authenticated caller: userId / role from authenticateToken (auth-service + user-service), token for the access checks. */
export function requesterFrom(req: AuthRequest): RAGRequester | null {
  const userId = req.user?.userId;
  const token = req.headers.authorization?.split(' ')[1];
  if (!userId || !token) return null;
  return { userId, role: req.user?.role, token };
}

/**
 * Send a RAG failure: RAGError -> its status, code and fixed Vietnamese message; anything else -> 500 with a generic code.
 * Never `success: true`, never the internal error text (it may carry URLs or upstream payloads).
 */
export function sendRAGError(res: Response, error: unknown, context: string, fallbackCode = 'RAG_REQUEST_FAILED'): void {
  if (isRAGError(error)) {
    if (error.status >= 500) logger.error(`[${context}] ${error.code}: ${error.message}`);
    else logger.info(`[${context}] refused: ${error.message}`);
    res.status(error.status).json({ success: false, error: error.code, message: error.userMessage });
    return;
  }
  logger.error(`[${context}] unexpected error: ${describeError(error)}`);
  res.status(500).json({ success: false, error: fallbackCode, message: 'Đã có lỗi xảy ra. Vui lòng thử lại sau.' });
}
