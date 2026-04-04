import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { QuizService } from '../services/quiz.service';
import { HTTP_STATUS, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class QuizController {
  static async createQuiz(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      if (req.user.role !== 'INSTRUCTOR' && req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      }

      const { courseId, title, description, questions, passingScore, timeLimitMinutes, maxAttempts, shuffleQuestions } = req.body;
      const { lessonId } = req.params;

      const quiz = await QuizService.createQuiz({
        courseId,
        lessonId,
        title,
        description,
        questions,
        passingScore,
        timeLimitMinutes,
        maxAttempts,
        shuffleQuestions,
        createdBy: req.user.userId,
      });

      res.status(HTTP_STATUS.CREATED).json({ message: 'Quiz created successfully', data: quiz });
    } catch (error: any) {
      logger.error('Create quiz error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async updateQuiz(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { quizId } = req.params;
      const quiz = await QuizService.updateQuiz(quizId, req.body, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ message: 'Quiz updated', data: quiz });
    } catch (error: any) {
      logger.error('Update quiz error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async getQuizByLesson(req: AuthRequest, res: Response) {
    try {
      const { lessonId } = req.params;
      const isInstructor = req.user?.role === 'INSTRUCTOR' || req.user?.role === 'ADMIN';
      const quiz = await QuizService.getQuizByLessonId(lessonId, isInstructor);
      res.status(HTTP_STATUS.OK).json({ data: quiz });
    } catch (error: any) {
      logger.error('Get quiz error:', error);
      if (error.message === 'Quiz not found') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get quiz' });
    }
  }

  static async startAttempt(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { quizId } = req.params;
      const attempt = await QuizService.startQuizAttempt(quizId, req.user.userId);
      res.status(HTTP_STATUS.CREATED).json({ data: attempt });
    } catch (error: any) {
      logger.error('Start quiz attempt error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async submitQuiz(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { attemptId } = req.params;
      const { answers } = req.body;
      const result = await QuizService.submitQuiz(attemptId, req.user.userId, answers);
      res.status(HTTP_STATUS.OK).json({ message: 'Quiz submitted', data: result });
    } catch (error: any) {
      logger.error('Submit quiz error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }

  static async getUserAttempts(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { quizId } = req.params;
      const attempts = await QuizService.getUserAttempts(quizId, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ data: attempts });
    } catch (error: any) {
      logger.error('Get user attempts error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get attempts' });
    }
  }

  static async getAllAttempts(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      if (req.user.role !== 'INSTRUCTOR' && req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
      }
      const { quizId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await QuizService.getAllAttempts(quizId, page, limit);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get all attempts error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get attempts' });
    }
  }

  static async deleteQuiz(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      const { quizId } = req.params;
      await QuizService.deleteQuiz(quizId, req.user.userId);
      res.status(HTTP_STATUS.OK).json({ message: 'Quiz deleted' });
    } catch (error: any) {
      logger.error('Delete quiz error:', error);
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: error.message });
    }
  }
}
