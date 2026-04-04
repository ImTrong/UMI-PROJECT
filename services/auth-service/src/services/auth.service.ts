import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import { TokenService } from './token.service';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { emailService } from './email.service';

const prisma = new PrismaClient();

export interface RegisterData {
  email: string;
  password: string;
  fullName: string;
}

export interface LoginData {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export class AuthService {
  static async register(data: RegisterData) {
    const { email, password, fullName } = data;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new Error(ERROR_MESSAGES.EMAIL_EXISTS);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(
      password,
      parseInt(process.env.BCRYPT_ROUNDS || '10')
    );

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName,
      },
    });

    // Generate Verification Token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    await prisma.verificationToken.create({
      data: {
        email: user.email,
        token: verifyToken,
        type: 'VERIFY_EMAIL',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      }
    });
    
    // Send email asynchronously
    emailService.sendVerificationEmail(user.email, verifyToken).catch((err: any) => {
      logger.error('Failed to send verification email', err);
    });

    // Generate tokens
    const { accessToken, refreshToken } = TokenService.generateTokens(
      user.id,
      user.email
    );

    // Save refresh token
    await TokenService.saveRefreshToken(user.id, refreshToken);

    logger.info(`User registered: ${email}`);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        emailVerified: user.emailVerified,
      },
      accessToken,
      refreshToken,
    };
  }

  static async login(data: LoginData) {
    const { email, password, ipAddress, userAgent } = data;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      await this.recordLoginAttempt(email, false, ipAddress, userAgent);
      throw new Error(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    // Check if account is active
    if (!user.isActive) {
      throw new Error(ERROR_MESSAGES.ACCOUNT_DISABLED);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      await this.recordLoginAttempt(email, false, ipAddress, userAgent);
      throw new Error(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    // Record successful login
    await this.recordLoginAttempt(email, true, ipAddress, userAgent);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Generate tokens
    const { accessToken, refreshToken } = TokenService.generateTokens(
      user.id,
      user.email
    );

    // Save refresh token
    await TokenService.saveRefreshToken(user.id, refreshToken);

    logger.info(`User logged in: ${email}`);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        emailVerified: user.emailVerified,
      },
      accessToken,
      refreshToken,
    };
  }

  static async refreshToken(refreshToken: string) {
    const decoded = await TokenService.verifyRefreshToken(refreshToken);
    if (!decoded) {
      throw new Error(ERROR_MESSAGES.TOKEN_INVALID);
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || !user.isActive) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = TokenService.generateTokens(
      user.id,
      user.email
    );

    // Revoke old refresh token and save new one
    await TokenService.revokeRefreshToken(refreshToken);
    await TokenService.saveRefreshToken(user.id, newRefreshToken);

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  static async logout(accessToken: string, refreshToken: string) {
    // Blacklist access token
    await TokenService.blacklistAccessToken(accessToken);
    
    // Revoke refresh token
    await TokenService.revokeRefreshToken(refreshToken);

    logger.info('User logged out');
  }

  static async verifyToken(token: string) {
    try {
      // Check if token is blacklisted
      const isBlacklisted = await TokenService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        return { valid: false, error: ERROR_MESSAGES.TOKEN_INVALID };
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        email: string;
      };

      // Check if user exists and is active
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || !user.isActive) {
        return { valid: false, error: ERROR_MESSAGES.USER_NOT_FOUND };
      }

      return {
        valid: true,
        user: {
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
        },
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return { valid: false, error: ERROR_MESSAGES.TOKEN_EXPIRED };
      }
      return { valid: false, error: ERROR_MESSAGES.TOKEN_INVALID };
    }
  }

  private static async recordLoginAttempt(
    email: string,
    success: boolean,
    ipAddress?: string,
    userAgent?: string
  ) {
    await prisma.loginAttempt.create({
      data: {
        email,
        success,
        ipAddress,
        userAgent,
      },
    });
  }

  static async verifyEmail(token: string) {
    const verificationToken = await prisma.verificationToken.findFirst({
      where: {
        token,
        type: 'VERIFY_EMAIL',
        expiresAt: { gt: new Date() }
      }
    });

    if (!verificationToken) {
      throw new Error(ERROR_MESSAGES.TOKEN_INVALID);
    }

    await prisma.user.update({
      where: { email: verificationToken.email },
      data: { emailVerified: true }
    });

    await prisma.verificationToken.delete({
      where: { id: verificationToken.id }
    });

    logger.info(`Email verified for: ${verificationToken.email}`);
    return { success: true };
  }

  static async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Return success anyway to prevent email enumeration
      return { success: true };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Delete existing reset tokens for this user to avoid clutter
    await prisma.verificationToken.deleteMany({
      where: { email, type: 'RESET_PASSWORD' }
    });

    await prisma.verificationToken.create({
      data: {
        email,
        token: resetToken,
        type: 'RESET_PASSWORD',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      }
    });

    emailService.sendPasswordResetEmail(email, resetToken).catch((err: any) => {
      logger.error('Failed to send reset email', err);
    });

    return { success: true };
  }

  static async resetPassword(token: string, newPassword: string) {
    const verificationToken = await prisma.verificationToken.findFirst({
      where: {
        token,
        type: 'RESET_PASSWORD',
        expiresAt: { gt: new Date() }
      }
    });

    if (!verificationToken) {
      throw new Error(ERROR_MESSAGES.TOKEN_INVALID);
    }

    const hashedPassword = await bcrypt.hash(
      newPassword,
      parseInt(process.env.BCRYPT_ROUNDS || '10')
    );

    await prisma.user.update({
      where: { email: verificationToken.email },
      data: { password: hashedPassword }
    });

    await prisma.verificationToken.delete({
      where: { id: verificationToken.id }
    });

    logger.info(`Password reset via token for: ${verificationToken.email}`);
    return { success: true };
  }

  static async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      throw new Error(ERROR_MESSAGES.INVALID_CURRENT_PASSWORD);
    }

    const hashedPassword = await bcrypt.hash(
      newPassword,
      parseInt(process.env.BCRYPT_ROUNDS || '10')
    );

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    logger.info(`Password changed for user: ${userId}`);
    return { success: true };
  }

  static async healthCheck() {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      return {
        service: 'auth-service',
        status: 'active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
      };
    } catch (error) {
      return {
        service: 'auth-service',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
      };
    }
  }
}
