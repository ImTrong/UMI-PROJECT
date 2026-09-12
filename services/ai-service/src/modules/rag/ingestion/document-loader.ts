import axios, { AxiosInstance } from 'axios';
import { RawDocument, SourceType, DocumentMetadata } from '../types';
import { RAGConfig } from '../rag.config';
import logger from '../../../utils/logger';

/**
 * DocumentLoader — loads raw content from knowledge sources.
 *
 * Currently supports:
 * - Direct content (admin provides text via API body)
 * - Lesson loading from course-service (if lesson has text content)
 *
 * If a lesson only has videoUrl and no text content, throws
 * LESSON_CONTENT_NOT_AVAILABLE rather than fabricating content.
 */
export class DocumentLoader {
  private courseApi: AxiosInstance;

  constructor(config: RAGConfig) {
    this.courseApi = axios.create({
      baseURL: config.courseServiceUrl,
      timeout: 10000,
    });
  }

  /**
   * Load a document from various sources.
   *
   * @param sourceType - Type of knowledge source
   * @param sourceId - ID of the source entity
   * @param providedContent - Optional direct content (admin API)
   * @param providedTitle - Optional title
   * @param providedMetadata - Optional metadata
   */
  async load(
    sourceType: SourceType,
    sourceId: string,
    providedContent?: string,
    providedTitle?: string,
    providedMetadata?: DocumentMetadata,
  ): Promise<RawDocument> {
    // If content is directly provided via admin API, use it
    if (providedContent && providedContent.trim().length > 0) {
      return {
        content: providedContent,
        title: providedTitle || `${sourceType} - ${sourceId}`,
        sourceType,
        sourceId,
        metadata: providedMetadata || {},
      };
    }

    // Otherwise, try to load from the appropriate service
    switch (sourceType) {
      case 'LESSON':
        return this.loadLesson(sourceId, providedMetadata);
      case 'COURSE':
        return this.loadCourse(sourceId, providedMetadata);
      default:
        throw new Error(
          `No content provided and auto-loading is not supported for sourceType="${sourceType}". ` +
          `Please provide content in the request body.`,
        );
    }
  }

  /**
   * Load a lesson from course-service.
   * If the lesson doesn't have text content, throw LESSON_CONTENT_NOT_AVAILABLE.
   */
  private async loadLesson(
    lessonId: string,
    metadata?: DocumentMetadata,
  ): Promise<RawDocument> {
    try {
      // Fetch lesson from course-service internal API
      const response = await this.courseApi.get(`/api/courses/lessons/${lessonId}`);
      const lesson = response.data?.data || response.data;

      if (!lesson) {
        throw new Error(`Lesson not found: ${lessonId}`);
      }

      // Check if lesson has any text content
      const textContent = this.extractLessonContent(lesson);
      if (!textContent || textContent.trim().length === 0) {
        const error: any = new Error(
          `Lesson "${lesson.title || lessonId}" chưa có text content (chỉ có videoUrl). ` +
          `Cần bổ sung transcript hoặc content trước khi index.`,
        );
        error.code = 'LESSON_CONTENT_NOT_AVAILABLE';
        throw error;
      }

      return {
        content: textContent,
        title: lesson.title || `Lesson ${lessonId}`,
        sourceType: 'LESSON',
        sourceId: lessonId,
        metadata: {
          courseId: lesson.courseId || metadata?.courseId || '',
          lessonId,
          ...(metadata || {}),
        },
      };
    } catch (error: any) {
      if (error.code === 'LESSON_CONTENT_NOT_AVAILABLE') {
        throw error;
      }
      logger.error(`[DocumentLoader] Failed to load lesson ${lessonId}: ${error.message}`);
      throw new Error(`Failed to load lesson ${lessonId}: ${error.message}`);
    }
  }

  /**
   * Load a course description/overview from course-service.
   */
  private async loadCourse(
    courseId: string,
    metadata?: DocumentMetadata,
  ): Promise<RawDocument> {
    try {
      const response = await this.courseApi.get(`/api/courses/${courseId}`);
      const course = response.data?.data || response.data;

      if (!course) {
        throw new Error(`Course not found: ${courseId}`);
      }

      const parts: string[] = [];
      if (course.title) parts.push(`# ${course.title}`);
      if (course.description) parts.push(course.description);
      if (course.whatYouWillLearn) parts.push(`## Bạn sẽ học được gì\n${course.whatYouWillLearn}`);
      if (course.requirements?.length) {
        parts.push(`## Yêu cầu\n${course.requirements.join('\n')}`);
      }

      const content = parts.join('\n\n');
      if (!content || content.trim().length === 0) {
        const error: any = new Error(`Course "${courseId}" has no text content.`);
        error.code = 'LESSON_CONTENT_NOT_AVAILABLE';
        throw error;
      }

      return {
        content,
        title: course.title || `Course ${courseId}`,
        sourceType: 'COURSE',
        sourceId: courseId,
        metadata: {
          courseId,
          ...(metadata || {}),
        },
      };
    } catch (error: any) {
      if (error.code === 'LESSON_CONTENT_NOT_AVAILABLE') throw error;
      logger.error(`[DocumentLoader] Failed to load course ${courseId}: ${error.message}`);
      throw new Error(`Failed to load course ${courseId}: ${error.message}`);
    }
  }

  /**
   * Extract text content from a lesson object.
   * Looks for description, resources (markdown), transcript fields.
   * Returns null if only videoUrl exists.
   */
  private extractLessonContent(lesson: any): string | null {
    const parts: string[] = [];

    if (lesson.title) {
      parts.push(`# ${lesson.title}`);
    }
    if (lesson.description && lesson.description.trim().length > 0) {
      parts.push(lesson.description);
    }

    // Check resources for text content
    if (lesson.resources) {
      let resources: any[];
      try {
        resources = typeof lesson.resources === 'string'
          ? JSON.parse(lesson.resources)
          : lesson.resources;
      } catch {
        resources = [];
      }

      for (const resource of resources) {
        if (resource.content && typeof resource.content === 'string') {
          parts.push(resource.content);
        }
      }
    }

    // If we only got a title, that's not enough content
    if (parts.length <= 1 && (!lesson.description || lesson.description.trim().length < 50)) {
      return null;
    }

    return parts.join('\n\n');
  }
}
