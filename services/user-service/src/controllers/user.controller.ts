import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { UserService } from '../services/user.service';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';

export class UserController {
  // User Profile Controllers
  static async createUserProfile(req: AuthRequest, res: Response) {
    try {
      const { userId, email, fullName, role } = req.body;

      const userProfile = await UserService.createUserProfile({
        userId,
        email,
        fullName,
        role,
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.USER_CREATED,
        data: userProfile,
      });
    } catch (error: any) {
      logger.error('Create user profile error:', error);

      if (error.message === ERROR_MESSAGES.USER_ALREADY_EXISTS ||
          error.message === ERROR_MESSAGES.EMAIL_ALREADY_EXISTS) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create user profile',
      });
    }
  }

  static async getUserProfile(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      const userProfile = await UserService.getUserProfile(userId);

      res.status(HTTP_STATUS.OK).json({
        data: userProfile,
      });
    } catch (error: any) {
      logger.error('Get user profile error:', error);

      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get user profile',
      });
    }
  }

  static async getMyProfile(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      let userProfile;
      try {
        userProfile = await UserService.getUserProfile(req.user.userId);
      } catch (error: any) {
        if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
          userProfile = await UserService.createUserProfile({
            userId: req.user.userId,
            email: req.user.email,
            fullName: req.user.fullName || 'New User',
          });
        } else {
          throw error;
        }
      }

      res.status(HTTP_STATUS.OK).json({
        data: userProfile,
      });
    } catch (error: any) {
      logger.error('Get my profile error:', error);

      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get profile',
      });
    }
  }

  static async getAllUsers(req: AuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const filters = {
        role: req.query.role as string,
        isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
        search: req.query.search as string,
      };

      const result = await UserService.getAllUserProfiles(page, limit, filters);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get all users error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get users',
      });
    }
  }

  static async updateMyProfile(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const updatedProfile = await UserService.updateUserProfile(
        req.user.userId,
        req.body
      );

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.USER_UPDATED,
        data: updatedProfile,
      });
    } catch (error: any) {
      logger.error('Update profile error:', error);

      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to update profile',
      });
    }
  }

  static async deleteMyProfile(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      await UserService.deleteUserProfile(req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.USER_DELETED,
      });
    } catch (error: any) {
      logger.error('Delete profile error:', error);

      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to delete profile',
      });
    }
  }

  // Education Controllers
  static async addEducation(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const education = await UserService.addEducation(req.user.userId, req.body);

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.EDUCATION_ADDED,
        data: education,
      });
    } catch (error: any) {
      logger.error('Add education error:', error);

      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to add education',
      });
    }
  }

  static async updateEducation(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { id } = req.params;
      const education = await UserService.updateEducation(id, req.user.userId, req.body);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.EDUCATION_UPDATED,
        data: education,
      });
    } catch (error: any) {
      logger.error('Update education error:', error);

      if (error.message === ERROR_MESSAGES.EDUCATION_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to update education',
      });
    }
  }

  static async deleteEducation(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { id } = req.params;
      await UserService.deleteEducation(id, req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.EDUCATION_DELETED,
      });
    } catch (error: any) {
      logger.error('Delete education error:', error);

      if (error.message === ERROR_MESSAGES.EDUCATION_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to delete education',
      });
    }
  }

  // Work Experience Controllers
  static async addWorkExperience(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const work = await UserService.addWorkExperience(req.user.userId, req.body);

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.WORK_ADDED,
        data: work,
      });
    } catch (error: any) {
      logger.error('Add work experience error:', error);

      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to add work experience',
      });
    }
  }

  static async updateWorkExperience(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { id } = req.params;
      const work = await UserService.updateWorkExperience(id, req.user.userId, req.body);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.WORK_UPDATED,
        data: work,
      });
    } catch (error: any) {
      logger.error('Update work experience error:', error);

      if (error.message === ERROR_MESSAGES.WORK_EXPERIENCE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to update work experience',
      });
    }
  }

  static async deleteWorkExperience(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { id } = req.params;
      await UserService.deleteWorkExperience(id, req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.WORK_DELETED,
      });
    } catch (error: any) {
      logger.error('Delete work experience error:', error);

      if (error.message === ERROR_MESSAGES.WORK_EXPERIENCE_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to delete work experience',
      });
    }
  }

  // Stats
  static async getUserStats(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const stats = await UserService.getUserStats(req.user.userId);

      res.status(HTTP_STATUS.OK).json({
        data: stats,
      });
    } catch (error: any) {
      logger.error('Get user stats error:', error);

      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get user statistics',
      });
    }
  }

  static async healthCheck(req: AuthRequest, res: Response) {
    const health = await UserService.healthCheck();
    const statusCode = health.database === 'connected'
      ? HTTP_STATUS.OK
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;

    res.status(statusCode).json(health);
  }
}
