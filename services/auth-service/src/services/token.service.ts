import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export class TokenService {
  static generateTokens(userId: string, email: string) {
    const accessToken = jwt.sign(
      { userId, email },
      process.env.JWT_SECRET!,
      { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any }
    );

    const refreshToken = jwt.sign(
      { userId, email },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any }
    );

    return { accessToken, refreshToken };
  }

  static async saveRefreshToken(userId: string, refreshToken: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    // Delete old refresh tokens
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    // Save new refresh token
    const token = await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt,
      },
    });

    return token;
  }

  static async verifyRefreshToken(token: string) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as {
        userId: string;
        email: string;
      };

      const refreshToken = await prisma.refreshToken.findUnique({
        where: { token },
      });

      if (!refreshToken || refreshToken.revoked || refreshToken.expiresAt < new Date()) {
        return null;
      }

      return decoded;
    } catch (error) {
      logger.error('Refresh token verification failed:', error);
      return null;
    }
  }

  static async revokeRefreshToken(token: string) {
    await prisma.refreshToken.update({
      where: { token },
      data: { revoked: true },
    });
  }

  static async revokeAllUserTokens(userId: string) {
    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { revoked: true },
    });
  }

  static async blacklistAccessToken(token: string) {
    // Decode token to get expiration
    const decoded = jwt.decode(token) as { exp: number };
    const expiresAt = new Date(decoded.exp * 1000);

    await prisma.blacklistedToken.create({
      data: {
        token,
        expiresAt,
      },
    });
  }

  static async isTokenBlacklisted(token: string): Promise<boolean> {
    const blacklisted = await prisma.blacklistedToken.findUnique({
      where: { token },
    });
    return !!blacklisted;
  }
}
