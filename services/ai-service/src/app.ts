import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AIController } from './controllers/ai.controller';
import { authenticateToken } from './middleware/auth.middleware';
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

// ==================== Evaluation Pipeline Route ====================
app.post('/api/ai/evaluate-submission', insightLimiter, authenticateToken, AIController.evaluateSubmission); // Calls Gemini

// ==================== Global Error Handler ====================
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

export default app;
