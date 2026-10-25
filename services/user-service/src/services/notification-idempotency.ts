import { createHash } from 'crypto';

/**
 * Idempotent notification creation (FIX 06C-4B2B1) - the pure part: reading and checking the X-Idempotency-Key header and
 * turning a key into the notification's MongoDB _id.
 *
 * Why the _id: MongoDB enforces a unique _id on every collection, so when the _id of a keyed notification is a function of its
 * key, two requests with the same key - one after the other or at the same instant - can never both create a document. No extra
 * unique index is needed (a unique index on an optional field would fail on the existing key-less notifications, FIX 06C-4B1).
 */

/** Fixed and versioned: changing it would make every key map to a new _id and re-create already delivered notifications. */
export const NOTIFICATION_ID_NAMESPACE = 'umi:notification-idempotency:v1:';
export const IDEMPOTENCY_HEADER = 'x-idempotency-key';
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
export const REWARD_KEY_PREFIX = 'reward_lb_notify_';

// letters, digits and . _ : - only: no whitespace, no control characters, no comma (a repeated header arrives comma-joined)
const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const REWARD_KEY_PATTERN = /^reward_lb_notify_(\d{1,2})_(\d{4})_([0-9a-fA-F]{24})$/;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export class IdempotencyKeyError extends Error {
  readonly code = 'INVALID_IDEMPOTENCY_KEY';
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyKeyError';
  }
}

/** Checks the FORMAT of a key (not its relation to a request body). Throws IdempotencyKeyError. */
export function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) throw new IdempotencyKeyError('The idempotency key is empty');
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) throw new IdempotencyKeyError(`The idempotency key is longer than ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
  if (!KEY_PATTERN.test(key)) throw new IdempotencyKeyError('The idempotency key may contain only letters, digits and . _ : -');
  if (key.startsWith(REWARD_KEY_PREFIX)) {
    const m = REWARD_KEY_PATTERN.exec(key);
    if (!m) throw new IdempotencyKeyError(`A ${REWARD_KEY_PREFIX} key must be ${REWARD_KEY_PREFIX}<month>_<year>_<userId>`);
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month < 1 || month > 12) throw new IdempotencyKeyError('The month in the idempotency key is not 1-12');
    if (year < 2000 || year > 2100) throw new IdempotencyKeyError('The year in the idempotency key is out of range');
  }
}

/**
 * Reads the header and checks it against the request body. Returns undefined when the request carries NO key (the existing,
 * non-idempotent flow applies); throws IdempotencyKeyError for anything else that is not exactly one valid key for this recipient.
 */
export function readIdempotencyKey(header: string | string[] | undefined, body: any): string | undefined {
  if (header === undefined) return undefined;
  if (Array.isArray(header)) throw new IdempotencyKeyError('Exactly one X-Idempotency-Key header is allowed');
  assertValidKey(header);
  const userId = body?.userId;
  if (typeof userId !== 'string' || !OBJECT_ID.test(userId)) {
    throw new IdempotencyKeyError('A request with an idempotency key needs a valid userId');
  }
  const reward = REWARD_KEY_PATTERN.exec(header);
  if (reward && reward[3].toLowerCase() !== userId.toLowerCase()) {
    throw new IdempotencyKeyError('The userId in the idempotency key does not match the recipient');
  }
  return header;
}

/**
 * The notification _id for a key: the first 12 bytes of SHA-256(namespace + key) as 24 hex characters (a valid ObjectId).
 * Pure: the same key gives the same id in every process, at every time.
 */
export function deriveNotificationId(key: string): string {
  assertValidKey(key);
  return createHash('sha256').update(NOTIFICATION_ID_NAMESPACE + key, 'utf8').digest().subarray(0, 12).toString('hex');
}

/** The fields that make two requests "the same notification": the names of those that differ between a stored one and a request. */
export function identityMismatch(
  stored: { userId: string; type: string; link: string | null },
  request: { userId: string; type?: string; link?: string | null }
): string[] {
  const out: string[] = [];
  if (stored.userId.toLowerCase() !== String(request.userId).toLowerCase()) out.push('userId');
  if (stored.type !== (request.type || 'INFO')) out.push('type');
  if ((stored.link ?? null) !== (request.link ?? null)) out.push('link');
  return out;
}
