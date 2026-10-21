import axios from 'axios';
import logger from '../utils/logger';

export interface CourseMetadata {
  id: string;
  title: string;
  level: string;
  published: boolean;
  approvalStatus: string;
  totalDurationSeconds: number;
  lessonCount: number;
  isValid: boolean;
}

export class CourseClientService {
  private static cache = new Map<string, { data: CourseMetadata; expiresAt: number }>();
  private static TTL_MS = 5 * 60 * 1000; // 5 minutes cache

  /**
   * Fetch course metadata and calculate total duration from lessons.
   */
  static async getCourseMetadata(courseId: string): Promise<CourseMetadata> {
    const cached = this.cache.get(courseId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';

    try {
      const [courseRes, lessonsRes] = await Promise.all([
        axios.get(`${courseServiceUrl}/api/courses/${courseId}`, { timeout: 5000 }),
        axios.get(`${courseServiceUrl}/api/courses/internal/${courseId}/lessons`, { timeout: 5000 }),
      ]);

      const course = courseRes.data?.data || {};
      const lessons = Array.isArray(lessonsRes.data?.data) ? lessonsRes.data.data : [];

      // Calculate total duration safely, clamping negative or abnormal numbers
      let totalDurationSeconds = 0;
      for (const lesson of lessons) {
        const d = Number(lesson.duration);
        if (Number.isFinite(d) && d > 0) {
          totalDurationSeconds += Math.floor(d);
        }
      }

      const metadata: CourseMetadata = {
        id: courseId,
        title: course.title || 'Khóa học',
        level: (course.level || 'BEGINNER').toUpperCase(),
        published: Boolean(course.published),
        approvalStatus: course.approvalStatus || 'APPROVED',
        totalDurationSeconds,
        lessonCount: lessons.length,
        isValid: totalDurationSeconds > 0,
      };

      this.cache.set(courseId, { data: metadata, expiresAt: Date.now() + this.TTL_MS });
      return metadata;
    } catch (error: any) {
      logger.warn(`Failed to fetch course details from course-service for ${courseId}: ${error.message}`);
      // Fallback metadata with 0 duration - never generate fake points
      return {
        id: courseId,
        title: 'Khóa học không xác định',
        level: 'BEGINNER',
        published: false,
        approvalStatus: 'UNKNOWN',
        totalDurationSeconds: 0,
        lessonCount: 0,
        isValid: false,
      };
    }
  }

  /**
   * Clear in-memory cache for a course
   */
  static clearCache(courseId?: string) {
    if (courseId) {
      this.cache.delete(courseId);
    } else {
      this.cache.clear();
    }
  }
}
