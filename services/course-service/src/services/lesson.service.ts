import axios from 'axios';
import prisma from '../utils/prisma';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export interface CreateLessonData {
  courseId: string;
  title: string;
  description?: string;
  videoUrl: string;
  duration: number;
  order?: number;
  isPreview?: boolean;
  resources?: any[];
}

export interface UpdateLessonData {
  title?: string;
  description?: string;
  videoUrl?: string;
  duration?: number;
  order?: number;
  isPreview?: boolean;
  resources?: any[];
}

export class LessonService {
  static async createLesson(data: CreateLessonData) {
    const { courseId, order } = data;

    // Check if course exists
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    // If order specified, check if it already exists
    if (order !== undefined) {
      const existingLesson = await prisma.lesson.findUnique({
        where: {
          courseId_order: {
            courseId,
            order,
          },
        },
      });

      if (existingLesson) {
        throw new Error(ERROR_MESSAGES.LESSON_ALREADY_EXISTS);
      }
    }

    // If order not specified, append to end
    let lessonOrder = order;
    if (lessonOrder === undefined) {
      const lastLesson = await prisma.lesson.findFirst({
        where: { courseId },
        orderBy: { order: 'desc' },
      });
      lessonOrder = (lastLesson?.order ?? -1) + 1;
    }

    const lesson = await prisma.lesson.create({
      data: {
        ...data,
        order: lessonOrder,
      },
    });

    logger.info(`Lesson created: ${lesson.title} in course ${courseId}`);
    return lesson;
  }

  static async getLessonById(
    lessonId: string, 
    courseId: string, 
    userId?: string, 
    userRole?: string,
    authToken?: string
  ) {
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        courseId,
      },
    });

    if (!lesson) {
      throw new Error(ERROR_MESSAGES.LESSON_NOT_FOUND);
    }

    // Get course info to check instructor
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    const isAdmin = userRole === 'ADMIN';
    const isInstructor = userId === course.instructorId;

    // Case 1: Preview lesson - always accessible
    if (lesson.isPreview) {
      return lesson;
    }

    // Case 2: Admin or Instructor - full access
    if (isAdmin || isInstructor) {
      return lesson;
    }

    // Case 3: Check if user is enrolled student
    if (userId && authToken) {
      try {
        const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
        const response = await axios.get(
          `${learningServiceUrl}/api/learning/progress/course/${courseId}`,
          {
            headers: {
              Authorization: `Bearer ${authToken}`
            }
          }
        );
        
        // Check if user is enrolled
        if (response.data && response.data.data) {
          return lesson;
        }
      } catch (error: any) {
        logger.warn(`Failed to check enrollment for user ${userId} in course ${courseId}: ${error.message}`);
        // Don't throw here, just fall through to deny access
      }
    }

    // Case 4: Not authorized
    throw new Error('Access denied. You must purchase this course to view this lesson.');
  }

  static async getCourseLessons(courseId: string, includeUnpublished: boolean = false) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    const lessons = await prisma.lesson.findMany({
      where: {
        courseId,
        ...(includeUnpublished ? {} : { isPreview: true }),
      },
      orderBy: { order: 'asc' },
    });

    return lessons;
  }

  static async updateLesson(
    lessonId: string,
    courseId: string,
    instructorId: string,
    data: UpdateLessonData
  ) {
    // Verify ownership
    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId,
      },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        courseId,
      },
    });

    if (!lesson) {
      throw new Error(ERROR_MESSAGES.LESSON_NOT_FOUND);
    }

    const updatedLesson = await prisma.lesson.update({
      where: { id: lessonId },
      data,
    });

    logger.info(`Lesson updated: ${updatedLesson.title}`);
    return updatedLesson;
  }

  static async deleteLesson(lessonId: string, courseId: string, instructorId: string) {
    // Verify ownership
    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId,
      },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        courseId,
      },
    });

    if (!lesson) {
      throw new Error(ERROR_MESSAGES.LESSON_NOT_FOUND);
    }

    await prisma.lesson.delete({
      where: { id: lessonId },
    });

    // Reorder remaining lessons
    const remainingLessons = await prisma.lesson.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
    });

    for (let i = 0; i < remainingLessons.length; i++) {
      await prisma.lesson.update({
        where: { id: remainingLessons[i].id },
        data: { order: i },
      });
    }

    logger.info(`Lesson deleted: ${lesson.title}`);
    return { success: true };
  }

  static async reorderLessons(courseId: string, instructorId: string, lessonOrders: { id: string; order: number }[]) {
    // Verify ownership
    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId,
      },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    const updates = lessonOrders.map(({ id, order }) =>
      prisma.lesson.update({
        where: { id },
        data: { order },
      })
    );

    await Promise.all(updates);
    logger.info(`Lessons reordered for course ${courseId}`);
    return { success: true };
  }
}
