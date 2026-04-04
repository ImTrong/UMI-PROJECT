import prisma from '../utils/prisma';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

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
}
