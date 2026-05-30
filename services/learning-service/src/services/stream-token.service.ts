import jwt from 'jsonwebtoken';
import { STREAM_ERROR_MESSAGES } from '../utils/constants';

export interface StreamTokenPayload {
  userId: string;
  lessonId: string;
  courseId: string;
  ip: string;
  userAgent: string;
}

export class StreamTokenService {
  // Use a different secret or the main JWT secret
  private static readonly SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
  private static readonly EXPIRES_IN = '3h'; // Stream token expires in 3 hours

  /**
   * Generate a short-lived token for HLS streaming.
   * Binds the session to IP and User-Agent.
   */
  static generateToken(payload: StreamTokenPayload): string {
    return jwt.sign(payload, this.SECRET, { expiresIn: this.EXPIRES_IN });
  }

  /**
   * Verify the stream token and check if IP & User-Agent match.
   */
  static verifyToken(token: string, expectedLessonId: string, currentIp: string, currentUserAgent: string): StreamTokenPayload {
    try {
      const decoded = jwt.verify(token, this.SECRET) as StreamTokenPayload;

      if (decoded.lessonId !== expectedLessonId) {
        throw new Error('Invalid lesson access');
      }

      // In production, IP might change slightly if user switches networks (Wi-Fi to 4G),
      // but for strict security (Udemy/Netflix style), we bind it strictly.
      // If they switch networks, they just need to refresh the page to get a new token.
      if (decoded.ip !== currentIp) {
        throw new Error('IP address mismatch. Please refresh the video player.');
      }

      if (decoded.userAgent !== currentUserAgent) {
        throw new Error('Device mismatch. Please refresh the video player.');
      }

      return decoded;
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        throw new Error(STREAM_ERROR_MESSAGES.PRESIGNED_URL_EXPIRED);
      }
      throw new Error('Invalid or unauthorized stream token');
    }
  }
}
