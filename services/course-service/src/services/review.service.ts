import prisma from '../utils/prisma';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import axios from 'axios';

export interface CreateReviewData {
  courseId: string;
  userId: string;
  rating: number;
  comment?: string;
}

export interface UpdateReviewData {
  rating?: number;
  comment?: string;
}

export class ReviewService {
  static async createReview(data: CreateReviewData) {
    const { courseId, userId, rating, comment } = data;

    // Check if course exists and is published
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course || !course.published) {
      throw new Error(ERROR_MESSAGES.COURSE_NOT_FOUND);
    }

    // Check if user is enrolled
    try {
      const learningServiceUrl = process.env.LEARNING_SERVICE_URL || 'http://localhost:3006';
      await axios.get(`${learningServiceUrl}/api/learning/progress/course/${courseId}/students/${userId}`);
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        throw new Error('Bạn phải tham gia khóa học này mới có thể đánh giá.');
      }
      logger.error(`Failed to check enrollment for review: ${error.message}`);
      throw new Error('Không thể kiểm tra trạng thái tham gia khóa học. Vui lòng thử lại sau.');
    }

    // Check if user already reviewed
    const existingReview = await prisma.review.findUnique({
      where: {
        courseId_userId: {
          courseId,
          userId,
        },
      },
    });

    if (existingReview) {
      throw new Error(ERROR_MESSAGES.ALREADY_REVIEWED);
    }

    const review = await prisma.review.create({
      data: {
        courseId,
        userId,
        rating,
        comment,
      },
    });

    // Update course rating
    await this.updateCourseRating(courseId);

    logger.info(`Review created for course ${courseId} by user ${userId}`);
    return review;
  }

  static async getCourseReviews(courseId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { courseId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.review.count({ where: { courseId } }),
    ]);

    // Enrich reviews with user info from user-service
    const enrichedReviews = await this.enrichReviewsWithUserInfo(reviews);

    return {
      reviews: enrichedReviews,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getUserReview(courseId: string, userId: string) {
    const review = await prisma.review.findUnique({
      where: {
        courseId_userId: {
          courseId,
          userId,
        },
      },
    });

    return review;
  }

  static async updateReview(reviewId: string, userId: string, data: UpdateReviewData) {
    const review = await prisma.review.findFirst({
      where: {
        id: reviewId,
        userId,
      },
    });

    if (!review) {
      throw new Error(ERROR_MESSAGES.REVIEW_NOT_FOUND);
    }

    const updatedReview = await prisma.review.update({
      where: { id: reviewId },
      data,
    });

    // Update course rating
    await this.updateCourseRating(review.courseId);

    logger.info(`Review updated: ${reviewId}`);
    return updatedReview;
  }

  static async deleteReview(reviewId: string, userId: string, isAdmin: boolean = false) {
    const review = await prisma.review.findFirst({
      where: {
        id: reviewId,
        ...(isAdmin ? {} : { userId }),
      },
    });

    if (!review) {
      throw new Error(ERROR_MESSAGES.REVIEW_NOT_FOUND);
    }

    await prisma.review.delete({
      where: { id: reviewId },
    });

    // Update course rating
    await this.updateCourseRating(review.courseId);

    logger.info(`Review deleted: ${reviewId}`);
    return { success: true };
  }

  private static async updateCourseRating(courseId: string) {
    const reviews = await prisma.review.aggregate({
      where: { courseId },
      _avg: { rating: true },
      _count: true,
    });

    const averageRating = reviews._avg.rating || 0;
    const totalReviews = reviews._count;

    await prisma.course.update({
      where: { id: courseId },
      data: {
        rating: averageRating,
        totalReviews,
      },
    });
  }

  static async getRatingDistribution(courseId: string) {
    const distribution = await prisma.review.groupBy({
      by: ['rating'],
      where: { courseId },
      _count: true,
    });

    const result: { [key: number]: number } = {};
    for (let i = 1; i <= 5; i++) {
      const found = distribution.find(d => d.rating === i);
      result[i] = found ? found._count : 0;
    }

    return result;
  }

  static async getUserReviews(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { userId },
        skip,
        take: limit,
        include: {
          course: {
            select: {
              title: true,
              slug: true,
              thumbnail: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.review.count({ where: { userId } }),
    ]);

    return {
      reviews,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ==================== Instructor Rating (Tổng hợp từ CourseReview) ====================

  // Helper: Enrich reviews with user info from user-service
  private static async enrichReviewsWithUserInfo(reviews: any[]) {
    if (reviews.length === 0) return reviews;

    const userIds = [...new Set(reviews.map(r => r.userId))];
    let userMap: Record<string, { fullName: string; avatar?: string }> = {};

    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001';
      const userRes = await axios.post(`${userServiceUrl}/api/users/batch`, { ids: userIds });
      const users = userRes.data.data || [];
      userMap = users.reduce((acc: any, u: any) => ({
        ...acc,
        [u.userId]: { fullName: u.fullName, avatar: u.avatar },
      }), {});
    } catch (error) {
      logger.error('Failed to fetch user info for reviews:', error);
    }

    return reviews.map(review => ({
      ...review,
      user: userMap[review.userId] || { fullName: 'Ẩn danh', avatar: null },
    }));
  }

  // Instructor Stats: rating trung bình, tổng review, tổng học viên, tổng khóa
  static async getInstructorStats(instructorId: string) {
    const courses = await prisma.course.findMany({
      where: { instructorId, published: true },
      select: {
        id: true,
        enrolledCount: true,
        rating: true,
        totalReviews: true,
      },
    });

    const totalCourses = courses.length;
    const totalStudents = courses.reduce((sum, c) => sum + c.enrolledCount, 0);
    const totalReviews = courses.reduce((sum, c) => sum + c.totalReviews, 0);

    // Weighted average rating
    const averageRating = totalReviews > 0
      ? courses.reduce((sum, c) => sum + c.rating * c.totalReviews, 0) / totalReviews
      : 0;

    return {
      totalCourses,
      totalStudents,
      totalReviews,
      averageRating: Math.round(averageRating * 100) / 100,
    };
  }

  // Instructor Reviews: tất cả course reviews từ các khóa của instructor
  static async getInstructorReviews(instructorId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    // Lấy tất cả courseIds của instructor
    const courses = await prisma.course.findMany({
      where: { instructorId, published: true },
      select: { id: true, title: true, slug: true },
    });

    const courseIds = courses.map(c => c.id);
    const courseMap = courses.reduce((acc: any, c) => ({ ...acc, [c.id]: { title: c.title, slug: c.slug } }), {});

    if (courseIds.length === 0) {
      return { reviews: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { courseId: { in: courseIds } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.review.count({ where: { courseId: { in: courseIds } } }),
    ]);

    // Enrich with user info and course info
    const enrichedReviews = await this.enrichReviewsWithUserInfo(reviews);
    const finalReviews = enrichedReviews.map(r => ({
      ...r,
      course: courseMap[r.courseId] || null,
    }));

    return {
      reviews: finalReviews,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Instructor Rating Distribution: phân bố tổng hợp từ tất cả courses
  static async getInstructorRatingDistribution(instructorId: string) {
    const courses = await prisma.course.findMany({
      where: { instructorId, published: true },
      select: { id: true },
    });

    const courseIds = courses.map(c => c.id);

    if (courseIds.length === 0) {
      return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    }

    const distribution = await prisma.review.groupBy({
      by: ['rating'],
      where: { courseId: { in: courseIds } },
      _count: true,
    });

    const result: { [key: number]: number } = {};
    for (let i = 1; i <= 5; i++) {
      const found = distribution.find(d => d.rating === i);
      result[i] = found ? found._count : 0;
    }

    return result;
  }
}
