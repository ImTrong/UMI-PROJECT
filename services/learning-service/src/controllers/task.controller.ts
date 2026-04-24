import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { TaskService } from '../services/task.service';
import { HTTP_STATUS } from '../utils/constants';

export class TaskController {
  static async getCourseTasks(req: AuthRequest, res: Response) {
    try {
      const { courseId } = req.params;
      const tasks = await TaskService.getCourseTasks(courseId);
      res.status(HTTP_STATUS.OK).json({ data: tasks });
    } catch (error: any) {
      console.error('Error fetching course tasks:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Lỗi lấy thông tin nhiệm vụ khóa học' });
    }
  }

  static async getUserTasks(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }
      const tasks = await TaskService.getUserTasks(userId);
      res.status(HTTP_STATUS.OK).json({ data: tasks });
    } catch (error: any) {
      console.error('Error fetching user tasks:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Lỗi lấy danh sách nhiệm vụ của bạn' });
    }
  }

  static async getTaskDetail(req: AuthRequest, res: Response) {
    try {
      const { taskId } = req.params;
      const type = (req.query.type as string)?.toUpperCase();
      if (type !== 'QUIZ' && type !== 'ASSIGNMENT') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'type must be QUIZ or ASSIGNMENT' });
      }
      const detail = await TaskService.getTaskDetail(taskId, type);
      res.status(HTTP_STATUS.OK).json({ data: detail });
    } catch (error: any) {
      console.error('Error fetching task detail:', error);
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Lỗi lấy thông tin chi tiết nhiệm vụ' });
    }
  }
}
