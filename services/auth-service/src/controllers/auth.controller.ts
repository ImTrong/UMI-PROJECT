import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { TokenService } from '../services/token.service';
import { HTTP_STATUS, SUCCESS_MESSAGES, ERROR_MESSAGES } from '../utils/constants';
import { AuthRequest } from '../middleware/auth.middleware';
import logger from '../utils/logger';

export class AuthController {
  static async register(req: Request, res: Response) {
    try {
      const { email, password, fullName } = req.body;

      const result = await AuthService.register({
        email,
        password,
        fullName,
      });

      res.status(HTTP_STATUS.CREATED).json({
        message: SUCCESS_MESSAGES.REGISTER_SUCCESS,
        ...result,
      });
    } catch (error: any) {
      if (error.message === ERROR_MESSAGES.EMAIL_EXISTS) {
        logger.warn(`Registration attempt with existing email: ${req.body.email}`);
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }

      logger.error('Registration error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Registration failed',
      });
    }
  }

  static async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip;
      const userAgent = req.get('user-agent');

      const result = await AuthService.login({
        email,
        password,
        ipAddress,
        userAgent,
      });

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
        ...result,
      });
    } catch (error: any) {
      if (error.message === ERROR_MESSAGES.INVALID_CREDENTIALS) {
        logger.warn(`Failed login attempt for email: ${req.body.email}`);
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.ACCOUNT_DISABLED) {
        logger.warn(`Login attempt for disabled account: ${req.body.email}`);
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

      logger.error('Login error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Login failed',
      });
    }
  }

  static async refreshToken(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Refresh token is required',
        });
      }

      const result = await AuthService.refreshToken(refreshToken);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.TOKEN_REFRESHED,
        ...result,
      });
    } catch (error: any) {
      logger.error('Token refresh error:', error);

      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: error.message || ERROR_MESSAGES.TOKEN_INVALID,
      });
    }
  }

  static async logout(req: AuthRequest, res: Response) {
    try {
      const accessToken = req.headers.authorization?.split(' ')[1];
      const { refreshToken } = req.body;

      if (accessToken || refreshToken) {
        await AuthService.logout(accessToken || '', refreshToken || '');
      }

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS,
      });
    } catch (error: any) {
      logger.error('Logout error:', error);

      // Still return OK if it's already logged out or token is invalid
      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS,
      });
    }
  }

  static async verifyToken(req: Request, res: Response) {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Token is required',
        });
      }

      const result = await AuthService.verifyToken(token);

      if (!result.valid) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          valid: false,
          error: result.error,
        });
      }

      res.status(HTTP_STATUS.OK).json({
        valid: true,
        user: result.user,
      });
    } catch (error: any) {
      logger.error('Token verification error:', error);

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        valid: false,
        error: 'Verification failed',
      });
    }
  }

  static async changePassword(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: ERROR_MESSAGES.UNAUTHORIZED,
        });
      }

      const { currentPassword, newPassword } = req.body;
      const result = await AuthService.changePassword(req.user.userId, currentPassword, newPassword);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.PASSWORD_CHANGED,
        ...result,
      });
    } catch (error: any) {
      logger.error('Change password error:', error);
      res.status(
        error.message === ERROR_MESSAGES.INVALID_CURRENT_PASSWORD 
          ? HTTP_STATUS.BAD_REQUEST 
          : HTTP_STATUS.INTERNAL_SERVER_ERROR
      ).json({
        error: error.message || 'Failed to change password',
      });
    }
  }

  static async forgotPassword(req: Request, res: Response) {
    try {
      const { email } = req.body;
      await AuthService.forgotPassword(email);

      // Always return OK to prevent email enumeration
      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.PASSWORD_RESET_EMAIL_SENT,
      });
    } catch (error: any) {
      logger.error('Forgot password error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to process request',
      });
    }
  }

  static async resetPassword(req: Request, res: Response) {
    try {
      const { token, newPassword } = req.body;
      const result = await AuthService.resetPassword(token, newPassword);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.PASSWORD_CHANGED,
        ...result,
      });
    } catch (error: any) {
      logger.error('Reset password error:', error);
      res.status(
        error.message === ERROR_MESSAGES.TOKEN_INVALID 
          ? HTTP_STATUS.BAD_REQUEST 
          : HTTP_STATUS.INTERNAL_SERVER_ERROR
      ).json({
        error: error.message || 'Failed to reset password',
      });
    }
  }

  static async verifyEmail(req: Request, res: Response) {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Token is required',
        });
      }

      const result = await AuthService.verifyEmail(token);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.EMAIL_VERIFIED,
        ...result,
      });
    } catch (error: any) {
      logger.error('Email verification error:', error);
      res.status(
        error.message === ERROR_MESSAGES.TOKEN_INVALID 
          ? HTTP_STATUS.BAD_REQUEST 
          : HTTP_STATUS.INTERNAL_SERVER_ERROR
      ).json({
        error: error.message || 'Failed to verify email',
      });
    }
  }

  static async healthCheck(req: Request, res: Response) {
    const health = await AuthService.healthCheck();
    const statusCode = health.database === 'connected' 
      ? HTTP_STATUS.OK 
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    
    res.status(statusCode).json(health);
  }
}
