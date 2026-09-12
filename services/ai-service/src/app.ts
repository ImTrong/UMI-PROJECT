import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AIController } from './controllers/ai.controller';
import { RAGController } from './modules/rag/rag.controller';
import { RAGChatController } from './modules/rag/chat/rag-chat.controller';
import { authenticateToken, requireAdmin } from './middleware/auth.middleware';
import logger from './utils/logger';

const app = express();
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later.' },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});

// AI insight endpoints use a separate limiter (Gemini calls are expensive)
const insightLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // 5 requests per minute (these call Gemini)
  message: { error: 'Too many AI requests, please try again later.' },
});

// Request logging
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// ==================== Health Check ====================
app.get('/api/ai/health', AIController.healthCheck);

// ==================== AI Chat Routes ====================
app.post('/api/ai/chat', apiLimiter, chatLimiter, authenticateToken, AIController.chat);

// ==================== Conversation Management Routes ====================
app.post('/api/ai/conversations', apiLimiter, authenticateToken, AIController.createConversation);
app.get('/api/ai/conversations', apiLimiter, authenticateToken, AIController.getConversations);
app.get('/api/ai/conversations/:id', apiLimiter, authenticateToken, AIController.getConversationById);
app.delete('/api/ai/conversations/:id', apiLimiter, authenticateToken, AIController.deleteConversation);
app.patch('/api/ai/conversations/:id/rename', apiLimiter, authenticateToken, AIController.renameConversation);

// ==================== Phase 2: AI Insight Routes ====================
app.get('/api/ai/insights', apiLimiter, authenticateToken, AIController.insights);                    // Fast (no Gemini)
app.get('/api/ai/learning-summary', insightLimiter, authenticateToken, AIController.learningSummary); // Calls Gemini
app.get('/api/ai/recommendations', insightLimiter, authenticateToken, AIController.recommendations);  // Calls Gemini
app.post('/api/ai/coach', insightLimiter, authenticateToken, AIController.coach);                     // Calls Gemini
app.get('/api/ai/recommended-paths', insightLimiter, authenticateToken, AIController.recommendedPaths); // Calls Gemini

// ==================== Phase 3: AI Career Path Route ====================
app.post('/api/ai/career-path', insightLimiter, authenticateToken, AIController.careerPathRecommendation); // Calls Gemini

// ==================== Career Advisor Pipeline (Prompt 1 + Prompt 2) ====================
app.post('/api/ai/career-advisor', insightLimiter, authenticateToken, AIController.careerAdvisorStart);              // Calls Gemini (Prompt 1 → optional Prompt 2)
app.post('/api/ai/career-advisor/:sessionId/submit', insightLimiter, authenticateToken, AIController.careerAdvisorSubmit); // Calls Gemini (Prompt 1 continue → optional Prompt 2)
app.post('/api/ai/career-advisor/:sessionId/skip', insightLimiter, authenticateToken, AIController.careerAdvisorSkip); // Calls Gemini (Prompt 2 with foundation-first)

// ==================== Evaluation Pipeline Route ====================
app.post('/api/ai/evaluate-submission', insightLimiter, authenticateToken, AIController.evaluateSubmission); // Calls Gemini

// === Phase 2: Per-Criterion Evaluation Routes ===
app.post('/api/ai/evaluate-criterion', insightLimiter, authenticateToken, AIController.evaluateCriterionEndpoint); // Calls Gemini
app.post('/api/ai/generate-evaluation-feedback', insightLimiter, authenticateToken, AIController.generateEvaluationFeedback); // Calls Gemini

// ==================== GĐ2: Learner Competency Analysis ====================
app.post('/api/ai/learner-analysis/generate', insightLimiter, authenticateToken, AIController.generateLearnerAnalysis); // Calls Gemini (3 calls), caches result
app.get('/api/ai/learner-analysis', apiLimiter, authenticateToken, AIController.getCachedLearnerAnalysis); // Fast — reads from cache

// ==================== RAG Foundation Routes ====================
app.get('/api/ai/rag/health', RAGController.health);                                                                     // Public
app.post('/api/ai/rag/search', apiLimiter, authenticateToken, RAGController.search);                                     // Authenticated
app.post('/api/ai/rag/index/document', apiLimiter, authenticateToken, requireAdmin, RAGController.indexDocument);         // Admin
app.post('/api/ai/rag/index/lesson', apiLimiter, authenticateToken, requireAdmin, RAGController.indexLesson);             // Admin
app.delete('/api/ai/rag/index/document/:id', apiLimiter, authenticateToken, requireAdmin, RAGController.deleteDocument);  // Admin
app.get('/api/ai/rag/documents', apiLimiter, authenticateToken, requireAdmin, RAGController.listDocuments);               // Admin

// ==================== RAG Chat Routes (Tầng 2) ====================
app.post('/api/ai/rag/chat', apiLimiter, chatLimiter, authenticateToken, RAGChatController.chat);             // Authenticated
app.post('/api/ai/rag/chat/new', apiLimiter, chatLimiter, authenticateToken, RAGChatController.createAndChat); // Authenticated

// ==================== Global Error Handler ====================
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

export default app;
