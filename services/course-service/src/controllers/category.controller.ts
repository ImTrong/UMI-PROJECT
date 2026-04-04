import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { CategoryService } from '../services/category.service';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class CategoryController {
  static async createCategory(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      const category = await CategoryService.createCategory(req.body);

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.CATEGORY_CREATED,
        data: category,
      });
    } catch (error: any) {
      logger.error('Create category error:', error);

      if (error.message === ERROR_MESSAGES.CATEGORY_ALREADY_EXISTS) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create category',
      });
    }
  }

  static async getAllCategories(req: AuthRequest, res: Response) {
    try {
      const includeCourseCount = req.query.includeCount === 'true';
      const categories = await CategoryService.getAllCategories(includeCourseCount);

      res.status(HTTP_STATUS.OK).json({
        data: categories,
      });
    } catch (error: any) {
      logger.error('Get all categories error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get categories',
      });
    }
  }

  static async getCategoryById(req: AuthRequest, res: Response) {
    try {
      const { categoryId } = req.params;
      const includeCourses = req.query.includeCourses === 'true';
      const category = await CategoryService.getCategoryById(categoryId, includeCourses);

      res.status(HTTP_STATUS.OK).json({
        data: category,
      });
    } catch (error: any) {
      logger.error('Get category error:', error);

      if (error.message === ERROR_MESSAGES.CATEGORY_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get category',
      });
    }
  }

  static async getCategoryBySlug(req: AuthRequest, res: Response) {
    try {
      const { slug } = req.params;
      const includeCourses = req.query.includeCourses === 'true';
      const category = await CategoryService.getCategoryBySlug(slug, includeCourses);

      res.status(HTTP_STATUS.OK).json({
        data: category,
      });
    } catch (error: any) {
      logger.error('Get category by slug error:', error);

      if (error.message === ERROR_MESSAGES.CATEGORY_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get category',
      });
    }
  }

  static async updateCategory(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      const { categoryId } = req.params;
      const category = await CategoryService.updateCategory(categoryId, req.body);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.CATEGORY_UPDATED,
        data: category,
      });
    } catch (error: any) {
      logger.error('Update category error:', error);

      if (error.message === ERROR_MESSAGES.CATEGORY_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to update category',
      });
    }
  }

  static async deleteCategory(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: ERROR_MESSAGES.FORBIDDEN,
        });
      }

      const { categoryId } = req.params;
      await CategoryService.deleteCategory(categoryId);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.CATEGORY_DELETED,
      });
    } catch (error: any) {
      logger.error('Delete category error:', error);

      if (error.message === ERROR_MESSAGES.CATEGORY_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to delete category',
      });
    }
  }

  static async getCategoryStats(req: AuthRequest, res: Response) {
    try {
      const stats = await CategoryService.getCategoryStats();

      res.status(HTTP_STATUS.OK).json({
        data: stats,
      });
    } catch (error: any) {
      logger.error('Get category stats error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get category statistics',
      });
    }
  }
}
