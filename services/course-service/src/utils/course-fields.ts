/**
 * Allowlists for writing courses and lessons (FIX-INS-02).
 *
 * A request body is never spread into Prisma. Writers pick ONLY these fields, so an instructor cannot set `instructorId`,
 * `published`, `approvalStatus`, `approvedAt`, `approvedBy`, `rejectionReason`, `rating`, `totalReviews`, `enrolledCount`,
 * `slug`, `id`, timestamps or relations by adding them to the JSON body. Moderation stays on the ADMIN routes
 * (/approve, /reject) and on /publish; the owner always comes from the authenticated caller.
 */
export const COURSE_WRITABLE_FIELDS = [
  'title',
  'description',
  'price',
  'thumbnail',
  'categoryId',
  'level',
  'language',
  'whatYouWillLearn',
  'requirements',
  'targetAudience',
  'certificateConfig',
] as const;

// courseId comes from the URL and the order may be computed by the server; nothing else of a lesson is client-writable.
export const LESSON_WRITABLE_FIELDS = ['title', 'description', 'videoUrl', 'duration', 'order', 'isPreview', 'resources'] as const;

export const UPLOAD_URL_FIELDS = ['fileName', 'contentType'] as const;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Own keys of `body` that are not in `allowed` (`__proto__` sent as JSON is an own key, so it is listed too). */
export function disallowedFields(body: unknown, allowed: readonly string[]): string[] {
  if (!isPlainObject(body)) return [];
  return Object.keys(body).filter((k) => !allowed.includes(k));
}

/** A new object holding only the allowed keys that `body` owns. Anything else is dropped. */
export function pickFields(body: unknown, allowed: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (!isPlainObject(body)) return out;
  for (const key of allowed) {
    if (has(body, key) && body[key] !== undefined) out[key] = body[key];
  }
  return out;
}
