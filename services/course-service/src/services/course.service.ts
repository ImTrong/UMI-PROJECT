import { Level } from '@prisma/client';
import slugify from 'slugify';
import axios from 'axios';
import prisma from '../utils/prisma';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export interface CreateCourseData {
  title: string;
  description: string;
  instructorId: string;
  price: number;
  thumbnail?: string;
  categoryId?: string;
  level?: Level;
  language?: string;
  whatYouWillLearn?: string;
  requirements?: string[];
  targetAudience?: string[];
}

export interface UpdateCourseData {
  title?: string;
  description?: string;
  price?: number;
  thumbnail?: string;
  categoryId?: string;
  level?: Level;
  language?: string;
  whatYouWillLearn?: string;
  requirements?: string[];
  targetAudience?: string[];
  published?: boolean;
}

export class CourseService {
  private static async generateUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;
    
    while (true) {
      const existingCourse = await prisma.course.findUnique({
        where: { slug },
      });
      
      if (!existingCourse) {
        return slug;
      }
      
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  static async createCourse(data: CreateCourseData) {
    const { title, instructorId, price, categoryId } = data;

    // Sanitize data
    const sanitizedData = {
      ...data,
      price: typeof price === 'string' ? parseFloat(price) : price,
      categoryId: categoryId === '' || categoryId === 'undefined' ? undefined : categoryId,
    };

    // Generate slug from title
    const baseSlug = slugify(title, { lower: true, strict: true });
    const slug = await this.generateUniqueSlug(baseSlug);

    const course = await prisma.course.create({
      data: {
        ...sanitizedData,
        slug,
      },
      include: {
        category: true,
        lessons: {
          orderBy: { order: 'asc' },
        },
      },
    });

    logger.info(`Course created: ${course.title} by ${instructorId}`);
    return course;
  }

  static async getCourseById(courseId: string, user?: { userId: string, role: string }, authToken?: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        category: true,
        lessons: {
          orderBy: { order: 'asc' },
        },
        reviews: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    const isAdmin = user?.role === 'ADMIN';
    const isOwner = user?.userId === course.instructorId;
    
    // Check enrollment status
    let isEnrolled = false;
    if (user?.userId && authToken) {
      try {
        const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
        const response = await axios.get(
          `${learningServiceUrl}/api/learning/progress/course/${courseId}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (response.data && response.data.data) {
          isEnrolled = true;
        }
      } catch (error) {
        // Just log and continue, maybe it's not purchased
        logger.debug(`Enrollment check failed for course ${courseId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const canViewUnpublished = isAdmin || isOwner || isEnrolled;

    if (!course.published && !canViewUnpublished) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_PUBLISHED);
    }

    // Filter out unpublished lessons for regular guest users
    if (!canViewUnpublished) {
      course.lessons = course.lessons.filter(l => l.isPreview);
    }

    // Calculate average rating
    const reviews = await prisma.review.aggregate({
      where: { courseId },
      _avg: { rating: true },
      _count: true,
    });

    return {
      ...course,
      averageRating: reviews._avg.rating || 0,
      totalReviews: reviews._count,
    };
  }

  static async getCourseBySlug(slug: string, user?: { userId: string, role: string }, authToken?: string) {
    const course = await prisma.course.findUnique({
      where: { slug },
      include: {
        category: true,
        lessons: {
          orderBy: { order: 'asc' },
        },
        reviews: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    const isAdmin = user?.role === 'ADMIN';
    const isOwner = user?.userId === course.instructorId;

    // Check enrollment status
    let isEnrolled = false;
    if (user?.userId && authToken) {
      try {
        const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
        const response = await axios.get(
          `${learningServiceUrl}/api/learning/progress/course/${course.id}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (response.data && response.data.data) {
          isEnrolled = true;
        }
      } catch (error) {
        logger.debug(`Enrollment check failed for slug ${slug}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const canViewUnpublished = isAdmin || isOwner || isEnrolled;

    if (!course.published && !canViewUnpublished) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_PUBLISHED);
    }

    if (!canViewUnpublished) {
      course.lessons = course.lessons.filter(l => l.isPreview);
    }

    const reviews = await prisma.review.aggregate({
      where: { courseId: course.id },
      _avg: { rating: true },
      _count: true,
    });

    return {
      ...course,
      averageRating: reviews._avg.rating || 0,
      totalReviews: reviews._count,
    };
  }

  static async getAllCourses(
    page: number = 1,
    limit: number = 10,
    filters?: {
      categoryId?: string;
      level?: Level;
      instructorId?: string;
      search?: string;
      minPrice?: number;
      maxPrice?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }
  ) {
    const skip = (page - 1) * limit;

    const where: any = { published: true };

    if (filters?.categoryId) {
      where.categoryId = filters.categoryId;
    }
    if (filters?.level) {
      where.level = filters.level;
    }
    if (filters?.instructorId) {
      where.instructorId = filters.instructorId;
    }
    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters?.minPrice !== undefined) {
      where.price = { gte: filters.minPrice };
    }
    if (filters?.maxPrice !== undefined) {
      where.price = { ...where.price, lte: filters.maxPrice };
    }

    let orderBy: any = { createdAt: 'desc' };
    if (filters?.sortBy) {
      switch (filters.sortBy) {
        case 'price':
          orderBy = { price: filters.sortOrder || 'asc' };
          break;
        case 'rating':
          orderBy = { rating: filters.sortOrder || 'desc' };
          break;
        case 'enrolledCount':
          orderBy = { enrolledCount: filters.sortOrder || 'desc' };
          break;
        case 'newest':
          orderBy = { createdAt: 'desc' };
          break;
      }
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        skip,
        take: limit,
        include: {
          category: true,
          reviews: {
            take: 1,
          },
        },
        orderBy,
      }),
      prisma.course.count({ where }),
    ]);

    return {
      courses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getInstructorCourses(instructorId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where: { instructorId },
        skip,
        take: limit,
        include: {
          category: true,
          _count: {
            select: { lessons: true, reviews: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.course.count({ where: { instructorId } }),
    ]);

    return {
      courses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async updateCourse(courseId: string, instructorId: string, data: UpdateCourseData) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    if (course.instructorId !== instructorId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    const updateData: any = { ...data };
    
    // Nếu đổi title, cần generate slug mới unique
    if (data.title && data.title !== course.title) {
      const baseSlug = slugify(data.title, { lower: true, strict: true });
      updateData.slug = await this.generateUniqueSlug(baseSlug);
    }
    
    // Sanitize price and categoryId
    if (updateData.price !== undefined) {
      updateData.price = typeof updateData.price === 'string' ? parseFloat(updateData.price) : updateData.price;
    }
    if (updateData.categoryId === '' || updateData.categoryId === 'undefined') {
      updateData.categoryId = null;
    } else if (updateData.categoryId === undefined) {
      delete updateData.categoryId;
    }

    const updatedCourse = await prisma.course.update({
      where: { id: courseId },
      data: updateData,
      include: {
        category: true,
        lessons: {
          orderBy: { order: 'asc' },
        },
      },
    });

    logger.info(`Course updated: ${updatedCourse.title}`);
    return updatedCourse;
  }

  static async deleteCourse(courseId: string, instructorId: string, isAdmin: boolean = false) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    if (!isAdmin && course.instructorId !== instructorId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    await prisma.course.delete({
      where: { id: courseId },
    });

    logger.info(`Course deleted: ${course.title}`);
    return { success: true };
  }

  static async publishCourse(courseId: string, instructorId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        lessons: true,
        category: true,
      },
    });

    if (!course) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    if (course.instructorId !== instructorId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    const isCurrentlyPublished = course.published;

    if (isCurrentlyPublished) {
      // Instructor wants to unpublish — allow directly
      const updatedCourse = await prisma.course.update({
        where: { id: courseId },
        data: {
          published: false,
          approvalStatus: 'DRAFT',
        },
      });

      logger.info(`Course unpublished: ${course.title}`);
      return updatedCourse;
    }

    // --- Instructor wants to publish: submit for admin review ---

    // If already pending, don't re-submit
    if (course.approvalStatus === 'PENDING_REVIEW') {
      throw new Error('Khóa học đang chờ Admin duyệt. Vui lòng đợi kết quả.');
    }

    // Validation checks before submitting for review
    if (course.lessons.length === 0) {
      throw new Error('Khóa học phải có ít nhất một bài học trước khi gửi duyệt');
    }

    if (!course.description || course.description.trim().length === 0) {
      throw new Error('Khóa học phải có mô tả trước khi gửi duyệt');
    }

    if (course.price < 0) {
      throw new Error('Giá khóa học không được âm');
    }

    // Submit for admin review (NOT published yet)
    const updatedCourse = await prisma.course.update({
      where: { id: courseId },
      data: {
        published: false,
        approvalStatus: 'PENDING_REVIEW',
      },
    });

    logger.info(`Course submitted for review: ${course.title}`);
    return updatedCourse;
  }

  // ==================== Admin Approval ====================

  static async getPendingCourses(page: number = 1, limit: number = 10, searchTerm?: string) {
    const skip = (page - 1) * limit;

    const whereClause: any = { approvalStatus: 'PENDING_REVIEW' };
    if (searchTerm) {
      whereClause.title = { contains: searchTerm, mode: 'insensitive' };
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: { lessons: { select: { id: true } }, category: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.course.count({ where: whereClause }),
    ]);

    return {
      data: courses, // Changed key to 'data' to match frontend response expected format
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  static async approveCourse(courseId: string, adminId: string) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    if (course.approvalStatus !== 'PENDING_REVIEW') {
      throw new Error('Course is not pending review');
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        approvalStatus: 'APPROVED',
        published: true,
        approvedAt: new Date(),
        approvedBy: adminId,
        rejectionReason: null,
      },
    });

    logger.info(`Course approved: ${course.title} by admin ${adminId}`);
    return updated;
  }

  static async rejectCourse(courseId: string, adminId: string, reason: string) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    if (course.approvalStatus !== 'PENDING_REVIEW') {
      throw new Error('Course is not pending review');
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        approvalStatus: 'REJECTED',
        published: false,
        rejectionReason: reason,
      },
    });

    logger.info(`Course rejected: ${course.title} — ${reason}`);
    return updated;
  }

  // ==================== Instructor Dashboard ====================

  static async getInstructorDashboard(instructorId: string) {
    const courses = await prisma.course.findMany({
      where: { instructorId },
      select: {
        id: true,
        title: true,
        published: true,
        approvalStatus: true,
        enrolledCount: true,
        rating: true,
        totalReviews: true,
        createdAt: true,
      },
    });

    const totalCourses = courses.length;
    const publishedCourses = courses.filter((c) => c.published).length;
    const pendingCourses = courses.filter((c) => c.approvalStatus === 'PENDING_REVIEW').length;
    const rejectedCourses = courses.filter((c) => c.approvalStatus === 'REJECTED').length;
    const totalEnrolled = courses.reduce((sum, c) => sum + c.enrolledCount, 0);
    const totalReviews = courses.reduce((sum, c) => sum + c.totalReviews, 0);
    const avgRating = totalReviews > 0
      ? courses.reduce((sum, c) => sum + c.rating * c.totalReviews, 0) / totalReviews
      : 0;

    return {
      totalCourses,
      publishedCourses,
      pendingCourses,
      rejectedCourses,
      totalEnrolled,
      totalReviews,
      averageRating: Math.round(avgRating * 100) / 100,
      courses,
    };
  }

  static async getInstructorCourseStudents(courseId: string, instructorId: string) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    if (course.instructorId !== instructorId) throw new Error(ERROR_MESSAGES.FORBIDDEN);

    // Call learning-service to get enrolled students progress
    const axios = require('axios');
    const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001';

    try {
      const response = await axios.get(
        `${learningServiceUrl}/api/learning/progress/course/${courseId}/students`
      );
      
      const progresses = response.data.data || [];
      
      // Now fetch user details
      const userIds = [...new Set(progresses.map((p: any) => p.userId))];
      let userMap: any = {};
      
      if (userIds.length > 0) {
        try {
          const userRes = await axios.post(`${userServiceUrl}/api/users/batch`, { ids: userIds });
          const users = userRes.data.data || [];
          userMap = users.reduce((acc: any, u: any) => ({ ...acc, [u.userId]: u }), {});
        } catch (error) {
          logger.error('Failed to fetch batch users', error);
        }
      }

      // Merge
      const students = progresses.map((p: any) => ({
        ...p,
        user: {
          userId: p.userId,
          fullName: userMap[p.userId]?.fullName || 'Unknown',
          avatar: userMap[p.userId]?.avatar || '',
        }
      }));

      return { course: { id: course.id, title: course.title }, students };
    } catch (error) {
      // Fallback: return basic course info if learning-service is down
      return { course: { id: course.id, title: course.title, enrolledCount: course.enrolledCount }, students: [] };
    }
  }

  static async getInstructorStudentDetail(courseId: string, studentId: string, instructorId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    if (course.instructorId !== instructorId) throw new Error(ERROR_MESSAGES.FORBIDDEN);

    const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001';

    const lessons = await prisma.lesson.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        title: true,
        order: true,
      },
    });

    let progressData: any;
    try {
      const progressResponse = await axios.get(
        `${learningServiceUrl}/api/learning/progress/course/${courseId}/students/${studentId}`
      );
      progressData = progressResponse.data.data;
    } catch {
      throw new Error('Student progress not found');
    }

    const userResponse = await axios.post(`${userServiceUrl}/api/users/batch`, { ids: [studentId] });
    const student = userResponse.data.data?.[0];

    const lessonProgressMap = new Map<string, {
      lessonId: string;
      completed?: boolean;
      timeSpentSeconds?: number;
      watchCount?: number;
      lastWatchedAt?: string | Date | null;
    }>(
      (progressData.lessons || []).map((item: any) => [item.lessonId, item])
    );

    const lessonStatuses = lessons.map((lesson) => {
      const progress = lessonProgressMap.get(lesson.id);

      let status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' = 'NOT_STARTED';
      if (progress?.completed) {
        status = 'COMPLETED';
      } else if ((progress?.timeSpentSeconds || 0) > 0 || (progress?.watchCount || 0) > 0) {
        status = 'IN_PROGRESS';
      }

      return {
        lessonId: lesson.id,
        title: lesson.title,
        order: lesson.order,
        status,
        lastWatchedAt: progress?.lastWatchedAt || null,
      };
    });

    return {
      course: {
        id: course.id,
        title: course.title,
      },
      student: {
        userId: studentId,
        fullName: student?.fullName || 'Unknown',
        avatar: student?.avatar || '',
      },
      progress: {
        progressPercentage: progressData.progressPercentage || 0,
        completedLessons: progressData.completedLessons || 0,
        totalLessons: progressData.totalLessons || lessons.length,
        enrolledAt: progressData.enrolledAt || null,
        lastAccessedAt: progressData.lastAccessedAt || null,
      },
      lessons: lessonStatuses,
    };
  }

  static async incrementEnrollment(courseId: string) {
    await prisma.course.update({
      where: { id: courseId },
      data: {
        enrolledCount: { increment: 1 },
      },
    });
  }

  static async getCourseAnalytics() {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [total, published, draft, newThisMonth, pending] = await Promise.all([
      prisma.course.count(),
      prisma.course.count({ where: { published: true } }),
      prisma.course.count({ where: { published: false } }),
      prisma.course.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.course.count({ where: { approvalStatus: 'PENDING_REVIEW' } }),
    ]);

    return {
      total,
      published,
      draft,
      newThisMonth,
      pendingApproval: pending,
    };
  }

  static async getBatchCourses(ids: string[]) {
    if (!ids || ids.length === 0) {
      return [];
    }
    
    const courses = await prisma.course.findMany({
      where: {
        id: { in: ids }
      },
      include: {
        category: true,
        _count: {
          select: { lessons: true, reviews: true }
        }
      }
    });
    
    return courses;
  }

  static async healthCheck() {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      return {
        service: 'course-service',
        status: 'active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
      };
    } catch (error) {
      return {
        service: 'course-service',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
      };
    }
  }
}
