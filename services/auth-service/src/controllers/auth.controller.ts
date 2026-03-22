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
      logger.error('Registration error:', error);

      if (error.message === ERROR_MESSAGES.EMAIL_EXISTS) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: error.message,
        });
      }

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
      logger.error('Login error:', error);

      if (error.message === ERROR_MESSAGES.INVALID_CREDENTIALS) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          error: error.message,
        });
      }

      if (error.message === ERROR_MESSAGES.ACCOUNT_DISABLED) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          error: error.message,
        });
      }

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

      if (!accessToken || !refreshToken) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Access token and refresh token are required',
        });
      }

      await AuthService.logout(accessToken, refreshToken);

      res.status(HTTP_STATUS.OK).json({
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS,
      });
    } catch (error: any) {
      logger.error('Logout error:', error);

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Logout failed',
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

  static async healthCheck(req: Request, res: Response) {
    const health = await AuthService.healthCheck();
    const statusCode = health.database === 'connected' 
      ? HTTP_STATUS.OK 
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    
    res.status(statusCode).json(health);
  }
}
