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
}
