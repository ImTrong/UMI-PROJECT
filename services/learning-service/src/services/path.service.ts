import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface PathFilters {
  categories?: string[];
  difficulties?: string[];
  search?: string;
  sortBy?: 'newest' | 'oldest' | 'name_asc' | 'name_desc';
}

export class PathService {
  private static courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

  /**
   * Get all available learning paths with optional filters
   */
  static async getLearningPaths(filters?: PathFilters) {
    const where: any = { status: 'PUBLISHED' };

    if (filters?.categories && filters.categories.length > 0) {
      where.category = { in: filters.categories, mode: 'insensitive' };
    }

    if (filters?.difficulties && filters.difficulties.length > 0) {
      const validDifficulties = filters.difficulties.filter(d => d !== 'ALL');
      if (validDifficulties.length > 0) {
        where.difficulty = { in: validDifficulties };
      }
    }

    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    let orderBy: any = { createdAt: 'desc' };
    if (filters?.sortBy === 'oldest') {
      orderBy = { createdAt: 'asc' };
    } else if (filters?.sortBy === 'name_asc') {
      orderBy = { title: 'asc' };
    } else if (filters?.sortBy === 'name_desc') {
      orderBy = { title: 'desc' };
    }

    return prisma.learningPath.findMany({
      where,
      orderBy,
    });
  }

  /**
   * Get distinct categories from all learning paths
   */
  static async getCategories(): Promise<string[]> {
    const paths = await prisma.learningPath.findMany({
      where: { status: 'PUBLISHED' },
      select: { category: true },
      distinct: ['category'],
    });
    return paths.map((p) => p.category).filter(Boolean) as string[];
  }

  /**
   * Get detail of a learning path along with personalized milestone progress for a student
   * Enriched milestones include: thumbnail, totalLessons, description, estimatedHours
   */
  static async getLearningPathDetail(pathId: string, userId?: string) {
    const path = await prisma.learningPath.findUnique({
      where: { id: pathId },
    });

    if (!path) {
      throw new Error('Learning path not found');
    }

    // 1. Fetch details for each course in the path
    const courseDetails = await Promise.all(
      path.courseIds.map(async (courseId) => {
        try {
          const response = await axios.get(`${this.courseServiceUrl}/api/courses/${courseId}`);
          return response.data.data;
        } catch (err: any) {
          logger.warn(`Failed to fetch course ${courseId} from course-service: ${err.message}`, {
            status: err.response?.status,
            url: `${this.courseServiceUrl}/api/courses/${courseId}`,
          });
          return {
            id: courseId,
            title: 'Khóa học chưa được định cấu hình',
            slug: '',
            thumbnail: '',
            description: '',
            totalLessons: 0,
            duration: 0,
            price: 0,
          };
        }
      })
    );

    // 2. Build enriched milestones
    let milestones = courseDetails.map((course) => {
      // Estimate hours: use course.duration if available, otherwise totalLessons * 0.25h (15min per lesson)
      const estimatedHours = course.duration
        ? course.duration / 3600
        : (course.totalLessons || course.lessons?.length || 0) * 0.25;

      return {
        courseId: course.id,
        title: course.title,
        slug: course.slug || '',
        thumbnail: course.thumbnail || course.imageUrl || '',
        description: course.description ? course.description.slice(0, 150) : '',
        price: course.price || 0,
        totalLessons: course.totalLessons || course.lessons?.length || 0,
        estimatedHours: Math.round(estimatedHours * 10) / 10,
        status: 'NOT_STARTED' as string,
        progressPercentage: 0,
        completedLessons: 0,
      };
    });

    let enrollment = null;
    let completedCoursesCount = 0;

    // Get final project earlier so we can check it
    const finalProject = await prisma.finalProject.findUnique({
      where: { learningPathId: pathId },
      select: {
        id: true,
        title: true,
        description: true,
        objectives: true,
        maxScore: true,
        passingScore: true,
        maxAttempts: true
      }
    });

    if (userId) {
      // Check path enrollment
      enrollment = await prisma.userPathEnrollment.findUnique({
        where: { userId_learningPathId: { userId, learningPathId: pathId } },
      });

      // Get progress for each course
      const progresses = await prisma.courseProgress.findMany({
        where: {
          userId,
          courseId: { in: path.courseIds },
        },
      });

      // Check if path is fully completed and update status
      let prerequisiteRules: any[] = [];
      try {
        if (Array.isArray((path as any).prerequisiteRules)) {
          prerequisiteRules = (path as any).prerequisiteRules;
        }
      } catch (e) {
        logger.warn('Failed to parse prerequisiteRules for path', path.id);
      }

      milestones = milestones.map((m) => {
        const prog = progresses.find((p) => p.courseId === m.courseId);
        let status = 'NOT_STARTED';
        let progressPercentage = 0;
        let completedLessons = 0;
        let isLocked = false;
        let lockedReason = undefined;

        if (prog) {
          progressPercentage = prog.progressPercentage;
          completedLessons = prog.completedLessons;
          if (prog.progressPercentage >= 100) {
            status = 'COMPLETED';
            completedCoursesCount++;
          } else if (prog.progressPercentage > 0) {
            status = 'IN_PROGRESS';
          }
        }

        // Check prerequisite rules
        const rule = prerequisiteRules.find((r) => r.courseId === m.courseId);
        if (rule && rule.requiredCourseIds && rule.requiredCourseIds.length > 0) {
          const missingPrereqs = rule.requiredCourseIds.filter((reqId: string) => {
            const reqProg = progresses.find(p => p.courseId === reqId);
            return !reqProg || reqProg.progressPercentage < 100;
          });
          
          if (missingPrereqs.length > 0) {
            isLocked = true;
            lockedReason = "Bạn cần hoàn thành các khóa học tiên quyết trước.";
          }
        }

        return {
          ...m,
          status,
          progressPercentage,
          completedLessons,
          isLocked,
          lockedReason
        };
      });
      if (
        enrollment &&
        enrollment.status !== 'COMPLETED' &&
        completedCoursesCount === path.courseIds.length &&
        path.courseIds.length > 0
      ) {
        let shouldComplete = true;

        if (finalProject) {
          // Check if there's a passing submission
          const passingSubmission = await prisma.finalProjectSubmission.findFirst({
            where: {
              finalProjectId: finalProject.id,
              userId,
              status: 'GRADED',
              totalScore: { gte: finalProject.passingScore }
            }
          });

          if (!passingSubmission) {
            shouldComplete = false;
          }
        }

        if (shouldComplete) {
          enrollment = await prisma.userPathEnrollment.update({
            where: { id: enrollment.id },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });

          // Auto-generate certificate
          try {
            const { CertificateService } = require('./certificate.service');
            await CertificateService.generatePathCertificate(userId, pathId);
            logger.info(`Auto-generated certificate for user ${userId} completing path ${pathId} upon detail view`);
          } catch (err) {
            logger.error(`Error auto-generating certificate for path ${pathId}:`, err);
          }
        }
      }
    }

    const overallProgressPercentage =
      path.courseIds.length > 0 ? (completedCoursesCount / path.courseIds.length) * 100 : 0;

    // Calculate total estimated hours and total price for the path
    const totalEstimatedHours = milestones.reduce((sum, m) => sum + m.estimatedHours, 0);
    const totalPrice = milestones.reduce((sum, m) => sum + m.price, 0);
    const totalLessons = milestones.reduce((sum, m) => sum + m.totalLessons, 0);

    // Final project was queried above

    return {
      path,
      milestones,
      enrollment,
      progress: {
        completedCourses: completedCoursesCount,
        totalCourses: path.courseIds.length,
        progressPercentage: overallProgressPercentage,
      },
      summary: {
        totalEstimatedHours: Math.round(totalEstimatedHours * 10) / 10,
        totalPrice,
        totalLessons,
        totalMilestones: path.courseIds.length,
      },
      finalProject,
    };
  }

  /**
   * Enroll a user in a learning path
   */
  static async enrollInPath(userId: string, pathId: string) {
    const path = await prisma.learningPath.findUnique({
      where: { id: pathId },
    });

    if (!path) {
      throw new Error('Learning path not found');
    }

    const existing = await prisma.userPathEnrollment.findUnique({
      where: { userId_learningPathId: { userId, learningPathId: pathId } },
    });

    if (existing) {
      return existing;
    }

    // Check if user already completed all courses in the path
    const progresses = await prisma.courseProgress.findMany({
      where: {
        userId,
        courseId: { in: path.courseIds },
      },
    });

    const completedCount = progresses.filter((p) => p.progressPercentage >= 100).length;
    let isCompleted = completedCount === path.courseIds.length && path.courseIds.length > 0;

    if (isCompleted) {
      const finalProject = await prisma.finalProject.findUnique({
        where: { learningPathId: pathId }
      });
      
      if (finalProject) {
        const passingSubmission = await prisma.finalProjectSubmission.findFirst({
          where: {
            finalProjectId: finalProject.id,
            userId,
            status: 'GRADED',
            totalScore: { gte: finalProject.passingScore }
          }
        });
        
        if (!passingSubmission) {
          isCompleted = false;
        }
      }
    }

    const enrollment = await prisma.userPathEnrollment.create({
      data: {
        userId,
        learningPathId: pathId,
        status: isCompleted ? 'COMPLETED' : 'IN_PROGRESS',
        completedAt: isCompleted ? new Date() : null,
      },
    });

    if (isCompleted) {
      try {
        const { CertificateService } = require('./certificate.service');
        await CertificateService.generatePathCertificate(userId, pathId);
        logger.info(`Auto-generated certificate for user ${userId} completing path ${pathId} on enrollment`);
        
        // Notify user
        const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
        await axios.post(`${userServiceUrl}/api/users/internal/notifications`, {
          userId,
          title: '🎉 Lộ trình hoàn thành!',
          message: `Chúc mừng bạn đã hoàn thành lộ trình "${path.title}". Chứng chỉ lộ trình của bạn đã được tạo!`,
          type: 'SUCCESS',
          link: '/certificates',
        });
      } catch (err: any) {
        logger.error(`Error auto-generating certificate for path ${pathId}:`, err);
      }
    }

    return enrollment;
  }

  /**
   * Unenroll a user from a learning path
   * Note: This only removes the path enrollment. Course progress is preserved.
   */
  static async unenrollFromPath(userId: string, pathId: string) {
    const enrollment = await prisma.userPathEnrollment.findUnique({
      where: { userId_learningPathId: { userId, learningPathId: pathId } },
    });

    if (!enrollment) {
      throw new Error('Enrollment not found');
    }

    await prisma.userPathEnrollment.delete({
      where: { id: enrollment.id },
    });

    return { message: 'Successfully unenrolled from learning path' };
  }

  /**
   * Update path progress — called when a user completes a course
   * Checks if all courses in any enrolled path are completed and updates status
   */
  static async updatePathProgress(userId: string, courseId: string) {
    try {
      // Find all paths that contain this course AND user is enrolled in
      const enrollments = await prisma.userPathEnrollment.findMany({
        where: {
          userId,
          status: 'IN_PROGRESS',
        },
        include: { learningPath: true },
      });

      for (const enrollment of enrollments) {
        const path = enrollment.learningPath;
        if (!path.courseIds.includes(courseId)) continue;

        // Check completion
        const progresses = await prisma.courseProgress.findMany({
          where: {
            userId,
            courseId: { in: path.courseIds },
          },
        });

        const completedCount = progresses.filter((p) => p.progressPercentage >= 100).length;

        if (completedCount === path.courseIds.length && path.courseIds.length > 0) {
          // Check if path has a final project
          const finalProject = await prisma.finalProject.findUnique({
            where: { learningPathId: path.id }
          });
          
          if (finalProject) {
            // Path has final project, do not auto-complete path here.
            // Completing all courses only unlocks the final project.
            continue;
          }
          await prisma.userPathEnrollment.update({
            where: { id: enrollment.id },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
          logger.info(`Path ${path.id} completed by user ${userId}`);

          // Auto-generate certificate and notify
          try {
            const { CertificateService } = require('./certificate.service');
            await CertificateService.generatePathCertificate(userId, path.id);
            logger.info(`Auto-generated certificate for user ${userId} completing path ${path.id}`);
            
            // Notify user
            const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
            await axios.post(`${userServiceUrl}/api/users/internal/notifications`, {
              userId,
              title: '🎉 Lộ trình hoàn thành!',
              message: `Chúc mừng bạn đã hoàn thành lộ trình "${path.title}". Chứng chỉ lộ trình của bạn đã được tạo!`,
              type: 'SUCCESS',
              link: '/certificates',
            });
          } catch (err: any) {
            logger.error(`Error auto-generating certificate for path ${path.id}:`, err);
          }
        }
      }
    } catch (error) {
      logger.error('Error updating path progress:', error);
    }
  }
}
