import axios from 'axios';
import prisma from '../utils/prisma';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import { LESSON_WRITABLE_FIELDS, pickFields } from '../utils/course-fields';

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
  /** FIX-INS-10: the lesson's course and that course's owner, from the database only - null when either is missing. */
  static async getLessonOwnerInternal(lessonId: string) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true, courseId: true } });
    if (!lesson) return null;
    const course = await prisma.course.findUnique({ where: { id: lesson.courseId }, select: { id: true, instructorId: true } });
    if (!course) return null;
    return { lessonId: lesson.id, courseId: course.id, instructorId: course.instructorId };
  }

  static async getCourseLessonsInternal(courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    return prisma.lesson.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
    });
  }

  static async getLessonByIdInternal(courseId: string, lessonId: string) {
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        courseId,
      },
    });

    if (!lesson) {
      throw new Error(ERROR_MESSAGES.LESSON_NOT_FOUND);
    }

    return lesson;
  }

  /**
   * The single ownership rule for writing a course's content (FIX-INS-02): the course must exist (else COURSE_NOT_FOUND)
   * and the caller must be its instructor (else FORBIDDEN). Same rule as updateLesson / deleteLesson / reorderLessons and
   * CourseService.updateCourse / publishCourse: an ADMIN moderates through /approve, /reject and course deletion, and does
   * not edit another instructor's content.
   */
  static async assertCourseOwner(courseId: string, userId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    if (!userId || course.instructorId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    return course;
  }

  static async createLesson(instructorId: string, input: CreateLessonData) {
    const { courseId } = input;
    // Ownership BEFORE anything else is read or written; the caller comes from the token, the course from the URL.
    await this.assertCourseOwner(courseId, instructorId);

    const data = { ...pickFields(input, LESSON_WRITABLE_FIELDS), courseId } as CreateLessonData;
    const { order } = data;

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

  static async getCourseLessons(
    courseId: string, 
    includeUnpublished: boolean = false,
    userId?: string,
    authToken?: string
  ) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    // the course's own instructor sees every lesson of it (FIX-INS-06: owner check here, not "any INSTRUCTOR")
    if (userId && course.instructorId === userId) includeUnpublished = true;

    let isEnrolled = false;
    if (userId && authToken && !includeUnpublished) {
      try {
        const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
        const response = await axios.get(
          `${learningServiceUrl}/api/learning/progress/course/${courseId}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (response.data && response.data.data) {
          isEnrolled = true;
        }
      } catch (error: any) {
        logger.warn(`Failed to check enrollment in getCourseLessons: ${error.message}`);
      }
    }

    // Luôn lấy tất cả lessons để frontend có đủ dữ liệu tính thời lượng
    const lessons = await prisma.lesson.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
    });

    if (!includeUnpublished && !isEnrolled) {
      // Trả về tất cả lessons nhưng ẩn videoUrl cho bài không phải preview
      return lessons.map(l => ({ 
        ...l, 
        videoUrl: l.isPreview ? l.videoUrl : '' 
      }));
    }

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

    // Content fields only: `courseId` (moving the lesson into another instructor's course), `id` and timestamps are dropped.
    const updatedLesson = await prisma.lesson.update({
      where: { id: lessonId },
      data: pickFields(data, LESSON_WRITABLE_FIELDS),
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

    // Owning THIS course must not let the caller reorder lessons of another course: every id has to belong to it.
    const ids = [...new Set(lessonOrders.map(({ id }) => id))];
    const owned = await prisma.lesson.count({ where: { id: { in: ids }, courseId } });
    if (ids.length !== lessonOrders.length || owned !== ids.length) {
      throw new Error(ERROR_MESSAGES.LESSON_NOT_IN_COURSE);
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
