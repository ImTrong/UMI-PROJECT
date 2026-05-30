import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface AdminPathFilters {
  search?: string;
  category?: string;
  difficulty?: string;
  status?: string;
}

export class AdminPathService {
  static async getPaths(page: number = 1, limit: number = 10, filters: AdminPathFilters = {}) {
    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (filters.search) {
      where.title = { contains: filters.search, mode: 'insensitive' };
    }
    if (filters.category) {
      where.category = filters.category;
    }
    if (filters.difficulty) {
      where.difficulty = filters.difficulty;
    }
    if (filters.status) {
      where.status = filters.status;
    }

    const [paths, total] = await Promise.all([
      prisma.learningPath.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.learningPath.count({ where }),
    ]);

    return {
      paths,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getPathById(id: string) {
    const path = await prisma.learningPath.findUnique({
      where: { id },
    });
    if (!path) {
      throw new Error('Learning path not found');
    }
    return path;
  }

  static async createPath(data: any, createdBy: string) {
    // Generate unique slug
    let baseSlug = data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.learningPath.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const path = await prisma.learningPath.create({
      data: {
        ...data,
        slug,
        createdBy,
      },
    });

    logger.info(`Admin created new learning path: ${path.id}`);
    return path;
  }

  static async updatePath(id: string, data: any) {
    const existing = await prisma.learningPath.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Learning path not found');
    }

    // Generate unique slug if title/slug changed
    if (data.slug && data.slug !== existing.slug) {
      let slug = data.slug;
      let counter = 1;
      while (await prisma.learningPath.findUnique({ where: { slug, NOT: { id } } })) {
        slug = `${data.slug}-${counter++}`;
      }
      data.slug = slug;
    }

    const path = await prisma.learningPath.update({
      where: { id },
      data,
    });

    logger.info(`Admin updated learning path: ${id}`);
    return path;
  }

  static async updateStatus(id: string, status: string) {
    const path = await prisma.learningPath.update({
      where: { id },
      data: { status },
    });
    return path;
  }

  static async deletePath(id: string) {
    // Prevent deletion if there are active enrollments
    const enrollmentsCount = await prisma.userPathEnrollment.count({
      where: { learningPathId: id },
    });

    if (enrollmentsCount > 0) {
      // Archive instead of deleting
      await prisma.learningPath.update({
        where: { id },
        data: { status: 'ARCHIVED' },
      });
      return { message: 'Path has active users and was archived instead of deleted.', status: 'ARCHIVED' };
    }

    await prisma.learningPath.delete({
      where: { id },
    });
    return { message: 'Path deleted successfully', status: 'DELETED' };
  }

  static async duplicatePath(id: string, createdBy: string) {
    const existing = await prisma.learningPath.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Learning path not found');
    }

    const { id: _id, createdAt: _ca, updatedAt: _ua, slug: oldSlug, title: oldTitle, userEnrollments, enrollmentCount, ...rest } = existing as any;

    let baseSlug = `${oldSlug}-copy`;
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.learningPath.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const path = await prisma.learningPath.create({
      data: {
        ...rest,
        title: `${oldTitle} (Copy)`,
        slug,
        status: 'DRAFT',
        enrollmentCount: 0,
        createdBy,
      },
    });

    return path;
  }
}
