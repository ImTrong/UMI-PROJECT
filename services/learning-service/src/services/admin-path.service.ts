import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import { CourseAccessService, CourseAccessError } from './course-access.service';
import { PathImageService, PathImageError } from './path-image.service';

const prisma = new PrismaClient();

/**
 * FIX-INS-11 - what an ADMIN may write on a learning path. id / createdBy / enrollmentCount / totalDurationMinutes / dates and the
 * relations (enrollments, final project) are decided by the server; anything else in the body is ignored, never spread into Prisma.
 */
export const LEARNING_PATH_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
const MAX_PATH_COURSES = 100;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const isPlainObject = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
const FIELD_RULES: Record<string, (v: unknown) => boolean> = {
  title: (v) => typeof v === 'string' && v.trim().length > 0,
  description: (v) => typeof v === 'string',
  slug: (v) => typeof v === 'string',
  category: (v) => v === null || typeof v === 'string',
  difficulty: (v) => typeof v === 'string',
  imageUrl: (v) => v === null || typeof v === 'string',
  shortDescription: (v) => v === null || typeof v === 'string',
  bannerUrl: (v) => v === null || typeof v === 'string',
  careerGoal: (v) => v === null || typeof v === 'string',
  skills: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
  prerequisiteRules: (v) => v === null || Array.isArray(v),
  completionRule: (v) => typeof v === 'string',
  recommended: (v) => typeof v === 'boolean',
  status: (v) => typeof v === 'string' && (LEARNING_PATH_STATUSES as readonly string[]).includes(v),
  courseIds: (v) => Array.isArray(v) && v.length <= MAX_PATH_COURSES && v.every((c) => typeof c === 'string' && OBJECT_ID.test(c))
    && new Set(v).size === v.length,
  certificateConfig: (v) => v === null || isPlainObject(v),
};
export const LEARNING_PATH_WRITABLE_FIELDS = Object.keys(FIELD_RULES);

/** A body that does not respect FIELD_RULES, or courses the course-service does not know (400). */
export class LearningPathInputError extends Error {
  constructor(message: string, public readonly fields: string[]) {
    super(message);
    this.name = 'LearningPathInputError';
  }
}

/** Allowlisted, type-checked copy of the body; `create` also requires title + description. */
export function pickLearningPathFields(body: any, mode: 'create' | 'update'): Record<string, unknown> {
  if (!isPlainObject(body)) throw new LearningPathInputError('Invalid learning path payload', []);
  const data: Record<string, unknown> = {};
  const invalid: string[] = [];
  for (const key of LEARNING_PATH_WRITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) continue;
    if (FIELD_RULES[key](body[key])) data[key] = body[key];
    else invalid.push(key);
  }
  if (mode === 'create') for (const key of ['title', 'description']) if (!(key in data) && !invalid.includes(key)) invalid.push(key);
  // FIX-INS-14: a signed / legacy display URL coming back from the form is stored in its stable form
  for (const key of ['imageUrl', 'bannerUrl']) {
    if (!(key in data)) continue;
    try {
      data[key] = PathImageService.normalizeIncoming(data[key]);
    } catch (error) {
      if (!(error instanceof PathImageError)) throw error;
      if (!invalid.includes(key)) invalid.push(key);
    }
  }
  if (invalid.length) throw new LearningPathInputError(`Invalid learning path fields: ${invalid.join(', ')}`, invalid);
  return data;
}

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
      paths: paths.map((p) => PathImageService.presentPath(p)),   // FIX-INS-14: displayable image URLs (ADMIN sees every status)
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
    return PathImageService.presentPath(path);
  }

  /** Every course newly put on a path must exist in the course-service (internal route, COURSE_LEARNING_TOKEN). 503 propagates. */
  static async assertCoursesExist(courseIds: string[]) {
    const unknown: string[] = [];
    for (const courseId of courseIds) {
      try {
        await CourseAccessService.fetchCourseLessons(courseId);
      } catch (error) {
        if (error instanceof CourseAccessError && error.statusCode === 404) unknown.push(courseId);
        else throw error;
      }
    }
    if (unknown.length) throw new LearningPathInputError(`Unknown courses: ${unknown.join(', ')}`, ['courseIds']);
  }

  static async createPath(data: any, createdBy: string) {
    if (Array.isArray(data.courseIds)) await this.assertCoursesExist(data.courseIds);

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
    return PathImageService.presentPath(path);
  }

  static async updatePath(id: string, data: any) {
    const existing = await prisma.learningPath.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Learning path not found');
    }
    if (Array.isArray(data.courseIds)) {
      const current = new Set(existing.courseIds || []);
      await this.assertCoursesExist(data.courseIds.filter((c: string) => !current.has(c)));
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
    return PathImageService.presentPath(path);
  }

  static async updateStatus(id: string, status: string) {
    if (!(LEARNING_PATH_STATUSES as readonly string[]).includes(status)) throw new LearningPathInputError('Invalid status', ['status']);
    const existing = await prisma.learningPath.findUnique({ where: { id } });
    if (!existing) throw new Error('Learning path not found');
    const path = await prisma.learningPath.update({
      where: { id },
      data: { status },
    });
    return PathImageService.presentPath(path);
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

    return PathImageService.presentPath(path);
  }
}
