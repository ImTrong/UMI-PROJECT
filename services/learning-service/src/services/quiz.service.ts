import { PrismaClient, QuizAttemptStatus } from '@prisma/client';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

let fileStorage: any = null;
try {
  const fileStorageModule = require('../../../shared/file-storage/src');
  fileStorage = fileStorageModule.fileStorage;
} catch {
  try {
    const fileStorageModule = require('../../shared/file-storage/src');
    fileStorage = fileStorageModule.fileStorage;
  } catch {
    logger.warn('FileStorageService not available for quiz attachments');
  }
}

const prisma = new PrismaClient();

// Question structure stored in Quiz.questions JSON
export interface QuizQuestion {
  id: string;
  text: string;
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'MULTI_SELECT';
  options: { id: string; text: string }[];
  correctAnswerIds: string[]; // Array of correct option IDs
  points: number;
  explanation?: string;
}

export interface QuizAnswer {
  questionId: string;
  selectedOptionIds: string[];
}

export interface CreateQuizData {
  courseId: string;
  lessonId: string;
  title: string;
  description?: string;
  questions: QuizQuestion[];
  passingScore?: number;
  timeLimitMinutes?: number;
  maxAttempts?: number;
  shuffleQuestions?: boolean;
  createdBy: string;
}

export class QuizService {
  /**
   * Create a quiz for a lesson (Instructor only)
   */
  static async createQuiz(data: CreateQuizData) {
    // Check if quiz already exists for this lesson
    const existing = await prisma.quiz.findUnique({
      where: { lessonId: data.lessonId },
    });

    if (existing) {
      throw new Error('A quiz already exists for this lesson');
    }

    const quiz = await prisma.quiz.create({
      data: {
        courseId: data.courseId,
        lessonId: data.lessonId,
        title: data.title,
        description: data.description,
        questions: data.questions as any,
        passingScore: data.passingScore ?? 70,
        timeLimitMinutes: data.timeLimitMinutes,
        maxAttempts: data.maxAttempts ?? 3,
        shuffleQuestions: data.shuffleQuestions ?? false,
        createdBy: data.createdBy,
      },
    });

    logger.info(`Quiz created: ${quiz.id} for lesson ${data.lessonId}`);
    return quiz;
  }

  /**
   * Update a quiz
   */
  static async updateQuiz(quizId: string, data: Partial<CreateQuizData>, userId: string) {
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new Error('Quiz not found');
    if (quiz.createdBy !== userId) throw new Error(ERROR_MESSAGES.FORBIDDEN);

    const updated = await prisma.quiz.update({
      where: { id: quizId },
      data: {
        title: data.title,
        description: data.description,
        questions: data.questions as any,
        passingScore: data.passingScore,
        timeLimitMinutes: data.timeLimitMinutes,
        maxAttempts: data.maxAttempts,
        shuffleQuestions: data.shuffleQuestions,
      },
    });

    return updated;
  }

  /**
   * Get quiz by lesson ID (hides answers for students)
   */
  static async getQuizByLessonId(lessonId: string, isInstructor: boolean = false) {
    const quiz = await prisma.quiz.findUnique({
      where: { lessonId },
    });

    if (!quiz) throw new Error('Quiz not found');

    if (!isInstructor) {
      // Strip correct answers and explanations for students
      const questions = (quiz.questions as unknown as QuizQuestion[]).map((q) => ({
        id: q.id,
        text: q.text,
        type: q.type,
        options: q.options,
        points: q.points,
        // correctAnswerIds and explanation are hidden
      }));
      return { ...quiz, questions };
    }

    return quiz;
  }

  /**
   * Start a quiz attempt — creates IN_PROGRESS record with start time
   */
  static async startQuizAttempt(quizId: string, userId: string) {
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new Error('Quiz not found');

    // Check max attempts
    const attemptCount = await prisma.quizAttempt.count({
      where: {
        quizId,
        userId,
        status: { in: [QuizAttemptStatus.SUBMITTED, QuizAttemptStatus.TIMED_OUT] },
      },
    });

    if (attemptCount >= quiz.maxAttempts) {
      throw new Error(`Maximum attempts (${quiz.maxAttempts}) reached`);
    }

    // Check if there's an in-progress attempt already
    const inProgress = await prisma.quizAttempt.findFirst({
      where: { quizId, userId, status: QuizAttemptStatus.IN_PROGRESS },
    });

    if (inProgress) {
      // Check if timed out
      if (quiz.timeLimitMinutes) {
        const elapsed = (Date.now() - inProgress.startedAt.getTime()) / 1000 / 60;
        if (elapsed > quiz.timeLimitMinutes) {
          await prisma.quizAttempt.update({
            where: { id: inProgress.id },
            data: { status: QuizAttemptStatus.TIMED_OUT, submittedAt: new Date() },
          });
          // Fall through to create new
        } else {
          return inProgress; // Return existing in-progress attempt
        }
      } else {
        return inProgress;
      }
    }

    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId,
        userId,
        courseId: quiz.courseId,
        answers: [],
        totalQuestions: (quiz.questions as unknown as QuizQuestion[]).length,
        status: QuizAttemptStatus.IN_PROGRESS,
      },
    });

    return attempt;
  }

  /**
   * Submit quiz — auto-grade and return results
   */
  static async submitQuiz(attemptId: string, userId: string, answers: QuizAnswer[]) {
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: { quiz: true },
    });

    if (!attempt) throw new Error('Quiz attempt not found');
    if (attempt.userId !== userId) throw new Error(ERROR_MESSAGES.FORBIDDEN);
    if (attempt.status !== QuizAttemptStatus.IN_PROGRESS) {
      throw new Error('This quiz attempt has already been submitted');
    }

    const quiz = attempt.quiz;

    // Check time limit
    if (quiz.timeLimitMinutes) {
      const elapsedMinutes = (Date.now() - attempt.startedAt.getTime()) / 1000 / 60;
      if (elapsedMinutes > quiz.timeLimitMinutes + 0.5) {
        // 30s grace period
        await prisma.quizAttempt.update({
          where: { id: attemptId },
          data: { status: QuizAttemptStatus.TIMED_OUT, submittedAt: new Date(), answers: answers as any },
        });
        throw new Error('Time limit exceeded');
      }
    }

    // Auto-grade
    const questions = quiz.questions as unknown as QuizQuestion[];
    let totalPoints = 0;
    let earnedPoints = 0;
    let correctCount = 0;

    for (const question of questions) {
      totalPoints += question.points;
      const userAnswer = answers.find((a) => a.questionId === question.id);

      if (userAnswer) {
        const isCorrect = this.checkAnswer(question, userAnswer.selectedOptionIds);
        if (isCorrect) {
          earnedPoints += question.points;
          correctCount++;
        }
      }
    }

    const score = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
    const passed = score >= quiz.passingScore;
    const timeTaken = Math.floor((Date.now() - attempt.startedAt.getTime()) / 1000);

    const updatedAttempt = await prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        answers: answers as any,
        score,
        correctAnswers: correctCount,
        passed,
        status: QuizAttemptStatus.SUBMITTED,
        submittedAt: new Date(),
        timeTakenSeconds: timeTaken,
      },
    });

    logger.info(`Quiz submitted: attempt ${attemptId}, score ${score.toFixed(1)}%, passed: ${passed}`);

    // Check if this submission completes the course
    const { ProgressService } = require('./progress.service');
    const axios = require('axios');
    const courseResponse = await axios.get(`${process.env.COURSE_SERVICE_URL || 'http://localhost:3003'}/api/courses/${quiz.courseId}`).catch(() => ({ data: { data: { title: 'Khóa học' } }}));
    const courseTitle = courseResponse?.data?.data?.title || 'Khóa học';
    const completionResult = await ProgressService.checkAndCompleteCourse(userId, quiz.courseId, courseTitle);

    return {
      attempt: updatedAttempt,
      courseCompleted: completionResult.isComplete && completionResult.newlyCompleted,
      results: {
        score: Math.round(score * 100) / 100,
        correctAnswers: correctCount,
        totalQuestions: questions.length,
        passed,
        timeTakenSeconds: timeTaken,
        // Include explanations in results
        questionResults: questions.map((q) => {
          const userAnswer = answers.find((a) => a.questionId === q.id);
          return {
            questionId: q.id,
            correct: userAnswer ? this.checkAnswer(q, userAnswer.selectedOptionIds) : false,
            correctAnswerIds: q.correctAnswerIds,
            selectedOptionIds: userAnswer?.selectedOptionIds || [],
            explanation: q.explanation,
          };
        }),
      },
    };
  }

  /**
   * Check if answer is correct
   */
  private static checkAnswer(question: QuizQuestion, selectedIds: string[]): boolean {
    if (question.correctAnswerIds.length !== selectedIds.length) return false;
    return question.correctAnswerIds.every((id) => selectedIds.includes(id));
  }

  /**
   * Get quiz attempts for a user
   */
  static async getUserAttempts(quizId: string, userId: string) {
    return prisma.quizAttempt.findMany({
      where: { quizId, userId },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Get all attempts for a quiz (Instructor)
   */
  static async getAllAttempts(quizId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [attempts, total] = await Promise.all([
      prisma.quizAttempt.findMany({
        where: { quizId, status: QuizAttemptStatus.SUBMITTED },
        skip,
        take: limit,
        orderBy: { submittedAt: 'desc' },
      }),
      prisma.quizAttempt.count({
        where: { quizId, status: QuizAttemptStatus.SUBMITTED },
      }),
    ]);

    return {
      data: attempts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Delete quiz
   */
  static async deleteQuiz(quizId: string, userId: string) {
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new Error('Quiz not found');
    if (quiz.createdBy !== userId) throw new Error(ERROR_MESSAGES.FORBIDDEN);

    await prisma.quiz.delete({ where: { id: quizId } });
    logger.info(`Quiz deleted: ${quizId}`);
  }

  /**
   * Get presigned upload URL for quiz attachment files (import files)
   */
  static async getUploadUrl(fileName: string, mimeType: string) {
    if (!fileStorage) {
      throw new Error('File storage service is not available');
    }

    const result = await fileStorage.getPresignedUploadUrl({
      bucket: 'quiz-attachments',
      fileName,
      mimeType,
    });

    return {
      uploadUrl: result.uploadUrl,
      fileUrl: `/api/learning/files/download?bucket=quiz-attachments&key=${result.fileKey}`,
      fileKey: result.fileKey,
    };
  }
}
