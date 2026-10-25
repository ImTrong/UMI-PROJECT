/**
 * Allowlists for writing a UserProfile (FIX-INS-01).
 *
 * A request body is never spread into Prisma. Each writer picks ONLY the fields listed here, so a client cannot reach
 * `role`, `isActive`, `userId`, `email`, `badges` or any other internal column by adding it to the JSON body.
 */
export const SELF_PROFILE_FIELDS = ['fullName', 'avatar', 'bio', 'phoneNumber', 'address', 'dateOfBirth', 'preferences'] as const;

// Only an ADMIN (PUT /api/users/:userId) may also change these two.
export const ADMIN_PROFILE_FIELDS = [...SELF_PROFILE_FIELDS, 'role', 'isActive'] as const;

export const ROLE_VALUES = ['STUDENT', 'INSTRUCTOR', 'ADMIN'] as const;

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
