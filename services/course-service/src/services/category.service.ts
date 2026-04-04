import slugify from 'slugify';
import prisma from '../utils/prisma';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export interface CreateCategoryData {
  name: string;
  description?: string;
  icon?: string;
}

export interface UpdateCategoryData {
  name?: string;
  description?: string;
  icon?: string;
}

export class CategoryService {
  static async createCategory(data: CreateCategoryData) {
    const { name } = data;
    const slug = slugify(name, { lower: true, strict: true });

    // Check if category already exists
    const existingCategory = await prisma.category.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          { slug },
        ],
      },
    });

    if (existingCategory) {
      throw new Error(ERROR_MESSAGES.CATEGORY_ALREADY_EXISTS);
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        description: data.description,
        icon: data.icon,
      },
    });

    logger.info(`Category created: ${category.name}`);
    return category;
  }

  static async getAllCategories(includeCourseCount: boolean = false) {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      ...(includeCourseCount && {
        include: {
          _count: {
            select: { courses: true },
          },
        },
      }),
    });

    return categories;
  }

  static async getCategoryById(categoryId: string, includeCourses: boolean = false) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      ...(includeCourses && {
        include: {
          courses: {
            where: { published: true },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    });

    if (!category) {
      throw new Error(ERROR_MESSAGES.CATEGORY_NOT_FOUND);
    }

    return category;
  }

  static async getCategoryBySlug(slug: string, includeCourses: boolean = false) {
    const category = await prisma.category.findUnique({
      where: { slug },
      ...(includeCourses && {
        include: {
          courses: {
            where: { published: true },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    });

    if (!category) {
      throw new Error(ERROR_MESSAGES.CATEGORY_NOT_FOUND);
    }

    return category;
  }

  static async updateCategory(categoryId: string, data: UpdateCategoryData) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      throw new Error(ERROR_MESSAGES.CATEGORY_NOT_FOUND);
    }

    const updateData: any = { ...data };
    if (data.name) {
      updateData.slug = slugify(data.name, { lower: true, strict: true });
    }

    const updatedCategory = await prisma.category.update({
      where: { id: categoryId },
      data: updateData,
    });

    logger.info(`Category updated: ${updatedCategory.name}`);
    return updatedCategory;
  }

  static async deleteCategory(categoryId: string) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: {
        _count: {
          select: { courses: true },
        },
      },
    });

    if (!category) {
      throw new Error(ERROR_MESSAGES.CATEGORY_NOT_FOUND);
    }

    if (category._count.courses > 0) {
      throw new Error('Cannot delete category with existing courses. Please reassign or delete courses first.');
    }

    await prisma.category.delete({
      where: { id: categoryId },
    });

    logger.info(`Category deleted: ${category.name}`);
    return { success: true };
  }

  static async getCategoryStats() {
    const stats = await prisma.category.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        _count: {
          select: { courses: true },
        },
      },
      orderBy: {
        courses: {
          _count: 'desc',
        },
      },
    });

    return stats;
  }
}
