import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { UserService } from '../services/user.service';
import { InstructorApplicationService, InstructorApplicationError } from '../services/instructor-application.service';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import { fileStorage } from '@umi/file-storage';
import { ROLE_VALUES } from '../utils/profile-fields';

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

      // The full profile (email, phone, address, date of birth...) goes only to its owner or an ADMIN. Everyone else who is
      // signed in gets the same public subset as GET /api/users/public/:userId. req.user.role comes from the database
      // (attachUserRole). Other services call this route with the user's own token for the user's own id, so they stay on
      // the full-profile branch.
      const isOwner = !!req.user && String(req.user.userId).toLowerCase() === String(userId).toLowerCase();
      const isAdmin = req.user?.role === 'ADMIN';

      const userProfile = isOwner || isAdmin
        ? await UserService.getUserProfile(userId)
        : await UserService.getPublicProfile(userId);

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

  static async getPublicProfile(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      const publicProfile = await UserService.getPublicProfile(userId);

      res.status(HTTP_STATUS.OK).json({
        data: publicProfile,
      });
    } catch (error: any) {
      logger.error('Get public profile error:', error);

      if (error.message === ERROR_MESSAGES.USER_NOT_FOUND) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: error.message,
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get public profile',
      });
    }
  }

  static async getBatchUsers(req: AuthRequest, res: Response) {
    try {
      // Called without credentials by the course / learning / review code to show names and avatars, so the answer is
      // limited to what the public profile already shows: userId, fullName, avatar (FIX-INS-01).
      const { ids } = req.body || {};
      const valid =
        Array.isArray(ids) &&
        ids.length <= 1000 &&
        ids.every((id: unknown) => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id));
      if (!valid) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'ids must be an array of at most 1000 user ids' });
      }

      const users = await UserService.getBatchUserProfiles([...new Set<string>(ids)]);

      res.status(HTTP_STATUS.OK).json({
        data: users,
      });
    } catch (error: any) {
      logger.error('Get batch users error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get batch users',
      });
    }
  }

  /**
   * POST /api/users/internal/eligibility  (service-to-service, X-Internal-Service-Token)
   * Body: { ids: string[] } -> { data: [{ userId, role, isActive }] }
   */
  static async getEligibilityBatch(req: AuthRequest, res: Response) {
    try {
      const { ids } = req.body || {};
      const valid =
        Array.isArray(ids) &&
        ids.length <= 1000 &&
        ids.every((id: unknown) => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id));
      if (!valid) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'ids must be an array of at most 1000 user ids' });
      }

      const users = await UserService.getEligibilityBatch([...new Set<string>(ids)]);
      res.status(HTTP_STATUS.OK).json({ data: users });
    } catch (error: any) {
      logger.error('Get eligibility batch error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get eligibility' });
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
          // A profile created on first sign-in is ALWAYS a STUDENT. The role is never guessed from the e-mail address
          // (FIX-INS-01): ADMIN comes only from the seed / an ADMIN (PUT /api/users/:userId), INSTRUCTOR only from the
          // instructor registration flow (still to be replaced by the contract flow, FIX-INS-05/06).
          userProfile = await UserService.createUserProfile({
            userId: req.user.userId,
            email: req.user.email,
            fullName: req.user.fullName || 'New User',
            role: 'STUDENT' as any,
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
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const rawLimit = parseInt(req.query.limit as string) || 10;
      const role = typeof req.query.role === 'string' ? req.query.role : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;

      // Anyone who is not an ADMIN only gets the instructor directory (active instructors, by display name, public fields).
      if (req.user?.role !== 'ADMIN') {
        if (role && role !== 'INSTRUCTOR') {
          return res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MESSAGES.FORBIDDEN });
        }
        const directory = await UserService.searchPublicInstructors(page, Math.min(Math.max(rawLimit, 1), 20), search);
        return res.status(HTTP_STATUS.OK).json(directory);
      }

      if (role && !ROLE_VALUES.includes(role as any)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid role filter' });
      }
      const filters = {
        role,
        isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
        search,
      };

      const result = await UserService.getAllUserProfiles(page, Math.min(Math.max(rawLimit, 1), 100), filters);

      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      logger.error('Get all users error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get users',
      });
    }
  }

  static async getAvatarUploadUrl(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { fileName, mimeType } = req.query;
      
      if (!fileName || !mimeType) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'fileName and mimeType are required',
        });
      }

      const result = await fileStorage.getPresignedUploadUrl({
        bucket: 'avatars',
        fileName: fileName as string,
        mimeType: mimeType as string,
      });

      res.status(HTTP_STATUS.OK).json({
        data: result,
      });
    } catch (error: any) {
      logger.error('Get avatar upload URL error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to generate upload URL',
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

      if (error.message.includes('Invalid date')) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Định dạng ngày tháng không hợp lệ.',
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

  // ==================== Analytics ====================
  static async getAnalytics(req: AuthRequest, res: Response) {
    try {
      if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
      }

      const result = await UserService.getUserAnalytics();

      res.status(HTTP_STATUS.OK).json({
        message: 'User analytics retrieved successfully',
        data: result,
      });
    } catch (error: any) {
      logger.error('Get user analytics error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to retrieve analytics',
      });
    }
  }

  /**
   * POST /api/users/become-instructor - IMPLEMENT-01: files an application (PENDING); the role does NOT change. Only a STUDENT
   * without a pending application may apply; the applicant is the authenticated caller (userId / role in the body are ignored).
   * Contact fields of the form (phoneNumber, address) update the caller's own profile, exactly like PUT /api/users/me would.
   */
  static async becomeInstructor(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      }
      const input = InstructorApplicationService.validateSubmission(req.body);
      const application = await InstructorApplicationService.submit(req.user.userId, input);

      const { phoneNumber, address } = req.body || {};
      const contact: any = {};
      if (typeof phoneNumber === 'string' && phoneNumber.trim()) contact.phoneNumber = phoneNumber.trim();
      if (typeof address === 'string' && address.trim()) contact.address = address.trim();
      if (Object.keys(contact).length > 0) {
        await UserService.updateUserProfile(req.user.userId, contact).catch((e: any) => logger.warn(`Contact details not saved: ${e?.message}`));
      }

      res.status(HTTP_STATUS.CREATED).json({
        message: 'Đã gửi đơn đăng ký giảng viên. Vui lòng chờ quản trị viên xét duyệt.',
        data: InstructorApplicationService.toApplicantView(application),
      });
    } catch (error: any) {
      if (error instanceof InstructorApplicationError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      logger.error('Become instructor error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Đăng ký giảng viên thất bại' });
    }
  }

  /** GET /api/users/become-instructor/me - the caller's current role and latest application. */
  static async getMyInstructorApplication(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MESSAGES.UNAUTHORIZED });
      res.status(HTTP_STATUS.OK).json({ data: await InstructorApplicationService.getMine(req.user.userId) });
    } catch (error: any) {
      logger.error('Get instructor application error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get application' });
    }
  }

  /** GET /api/users/admin/instructor-applications?status=&page=&limit= (ADMIN) */
  static async listInstructorApplications(req: AuthRequest, res: Response) {
    try {
      const result = await InstructorApplicationService.list(
        req.query.status, parseInt(req.query.page as string, 10), parseInt(req.query.limit as string, 10)
      );
      res.status(HTTP_STATUS.OK).json(result);
    } catch (error: any) {
      if (error instanceof InstructorApplicationError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
      logger.error('List instructor applications error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to list applications' });
    }
  }

  /** POST /api/users/admin/instructor-applications/:applicationId/approve (ADMIN) - the reviewer is the caller. */
  static async approveInstructorApplication(req: AuthRequest, res: Response) {
    try {
      const application = await InstructorApplicationService.approve(req.params.applicationId, req.user!.userId);
      res.status(HTTP_STATUS.OK).json({ message: 'Đã duyệt đơn đăng ký giảng viên', data: application });
    } catch (error: any) {
      if (error instanceof InstructorApplicationError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
      logger.error('Approve instructor application error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to approve application' });
    }
  }

  /** POST /api/users/admin/instructor-applications/:applicationId/reject { reason } (ADMIN) */
  static async rejectInstructorApplication(req: AuthRequest, res: Response) {
    try {
      const application = await InstructorApplicationService.reject(req.params.applicationId, req.user!.userId, req.body?.reason);
      res.status(HTTP_STATUS.OK).json({ message: 'Đã từ chối đơn đăng ký giảng viên', data: application });
    } catch (error: any) {
      if (error instanceof InstructorApplicationError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
      logger.error('Reject instructor application error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to reject application' });
    }
  }

  /**
   * POST /api/users/become-instructor/confirm (payment-service, PAYMENT_USER_TOKEN) - IMPLEMENT-01: a paid registration fee no
   * longer upgrades anyone. The learner gets (at most one) PENDING application for an ADMIN to review; the role is untouched.
   */
  static async confirmInstructor(req: AuthRequest, res: Response) {
    try {
      const { userId, status } = req.body || {};

      if (status !== 'INSTRUCTOR_REGISTRATION_SUCCESS' || typeof userId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(userId)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Invalid status',
        });
      }

      const result = await InstructorApplicationService.fromLegacyPayment(userId);

      res.status(HTTP_STATUS.OK).json({
        message: 'Instructor registration is reviewed by an administrator; no role was changed',
        data: { upgraded: false, applicationQueued: result.queued },
      });
    } catch (error: any) {
      logger.error('Confirm instructor error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to record instructor registration',
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
