export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const ERROR_MESSAGES = {
  COURSE_NOT_FOUND: 'Course not found',
  COURSE_ALREADY_EXISTS: 'Course with this title already exists',
  LESSON_NOT_FOUND: 'Lesson not found',
  LESSON_ALREADY_EXISTS: 'A lesson with this order already exists in this course',
  REVIEW_NOT_FOUND: 'Review not found',
  CATEGORY_NOT_FOUND: 'Category not found',
  CATEGORY_ALREADY_EXISTS: 'Category already exists',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'You do not have permission to perform this action',
  INVALID_RATING: 'Rating must be between 1 and 5',
  ALREADY_REVIEWED: 'You have already reviewed this course',
  COURSE_NOT_PUBLISHED: 'Course is not published yet',
  INVALID_COURSE_DATA: 'Invalid course data',
  INSTRUCTOR_NOT_FOUND: 'Instructor not found',
} as const;

export const SUCCESS_MESSAGES = {
  COURSE_CREATED: 'Course created successfully',
  COURSE_UPDATED: 'Course updated successfully',
  COURSE_DELETED: 'Course deleted successfully',
  COURSE_PUBLISHED: 'Course published successfully',
  LESSON_CREATED: 'Lesson created successfully',
  LESSON_UPDATED: 'Lesson updated successfully',
  LESSON_DELETED: 'Lesson deleted successfully',
  REVIEW_CREATED: 'Review created successfully',
  REVIEW_UPDATED: 'Review updated successfully',
  REVIEW_DELETED: 'Review deleted successfully',
  CATEGORY_CREATED: 'Category created successfully',
  CATEGORY_UPDATED: 'Category updated successfully',
  CATEGORY_DELETED: 'Category deleted successfully',
} as const;
