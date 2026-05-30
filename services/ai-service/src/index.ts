import dotenv from 'dotenv';
import app from './app';
import logger from './utils/logger';
import { initializeGemini } from './config/gemini.config';
import { LearningContextService } from './services/learning-context.service';

dotenv.config();

const PORT = process.env.PORT || 3007;

// Initialize Gemini AI client
try {
  initializeGemini();
} catch (error) {
  logger.error('Failed to initialize Gemini AI:', error);
  process.exit(1);
}

// Initialize Learning Context Service (internal API clients)
LearningContextService.initialize();

app.listen(PORT, () => {
  logger.info(`AI service running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Gemini model: ${process.env.GEMINI_MODEL || 'gemini-2.0-flash'}`);
  logger.info(`Features: chat, learning-summary, recommendations, coach, insights`);
});
