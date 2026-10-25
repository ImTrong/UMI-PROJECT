import { createHash } from 'crypto';

/**
 * Credentials for ONE service-to-service relation (FIX 07B-1), read from the environment at call time.
 *
 * A value is usable only if it is a long random-looking secret: at least 24 printable ASCII characters, no surrounding whitespace,
 * and not a publicly known default. There is no fallback - not to INTERNAL_SERVICE_TOKEN, not to a default string, not to "".
 * The same rules are applied by the receiving service, which refuses every call while its own value is not usable (fail-closed).
 */
export const SERVICE_TOKEN_HEADER = 'x-internal-service-token';
export const MIN_SERVICE_TOKEN_LENGTH = 24;

// SHA-256 digests of publicly known values that must never authenticate anything (the old docker-compose default).
// Kept as digests so the source does not carry the strings themselves.
const PUBLIC_DEFAULT_DIGESTS = new Set(['30d23fb539a02580a344e25317999647f24cc259700d25f8757d4cfa39f39f5a']);

export type TokenCheck = { ok: true; value: string } | { ok: false; reason: string };

export function checkServiceToken(name: string, value: string | undefined): TokenCheck {
  if (value === undefined || value.trim() === '') return { ok: false, reason: `${name} is not configured` };
  if (!/^[\x21-\x7E]+$/.test(value)) return { ok: false, reason: `${name} must be printable ASCII without spaces` };
  if (value.length < MIN_SERVICE_TOKEN_LENGTH) return { ok: false, reason: `${name} is shorter than ${MIN_SERVICE_TOKEN_LENGTH} characters` };
  if (PUBLIC_DEFAULT_DIGESTS.has(createHash('sha256').update(value).digest('hex'))) return { ok: false, reason: `${name} is a publicly known default value` };
  return { ok: true, value };
}

export function readServiceToken(name: string): TokenCheck {
  return checkServiceToken(name, process.env[name]);
}
