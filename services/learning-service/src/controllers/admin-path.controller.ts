import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminPathService, AdminPathFilters } from '../services/admin-path.service';
import { HTTP_STATUS } from '../utils/constants';
import logger from '../utils/logger';

export class AdminPathController {
  static async getPaths(req: AuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const filters: AdminPathFilters = {
        search: req.query.search as string,
        category: req.query.category as string,
        difficulty: req.query.difficulty as string,
        status: req.query.status as string,
      };

      const result = await AdminPathService.getPaths(page, limit, filters);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error) {
      logger.error('Get admin paths error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get paths' });
    }
  }

  static async getPathById(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const path = await AdminPathService.getPathById(id);
      res.status(HTTP_STATUS.OK).json({ data: path });
    } catch (error: any) {
      logger.error('Get admin path by id error:', error);
      if (error.message === 'Learning path not found') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get path' });
    }
  }

  static async createPath(req: AuthRequest, res: Response) {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }
      const data = req.body;
      const path = await AdminPathService.createPath(data, req.user.userId);
      res.status(HTTP_STATUS.CREATED).json({ message: 'Path created successfully', data: path });
    } catch (error) {
      logger.error('Create admin path error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to create path' });
    }
  }

  static async updatePath(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;
      const path = await AdminPathService.updatePath(id, data);
      res.status(HTTP_STATUS.OK).json({ message: 'Path updated successfully', data: path });
    } catch (error: any) {
      logger.error('Update admin path error:', error);
      if (error.message === 'Learning path not found') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to update path' });
    }
  }

  static async updateStatus(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!status) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Status is required' });
      }
      const path = await AdminPathService.updateStatus(id, status);
      res.status(HTTP_STATUS.OK).json({ message: 'Status updated successfully', data: path });
    } catch (error) {
      logger.error('Update admin path status error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to update status' });
    }
  }

  static async deletePath(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const result = await AdminPathService.deletePath(id);
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error) {
      logger.error('Delete admin path error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to delete path' });
    }
  }

  static async duplicatePath(req: AuthRequest, res: Response) {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }
      const { id } = req.params;
      const path = await AdminPathService.duplicatePath(id, req.user.userId);
      res.status(HTTP_STATUS.CREATED).json({ message: 'Path duplicated successfully', data: path });
    } catch (error: any) {
      logger.error('Duplicate admin path error:', error);
      if (error.message === 'Learning path not found') {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to duplicate path' });
    }
  }
}
