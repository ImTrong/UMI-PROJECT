import axios from 'axios';

/**
 * The only way the learning service asks the User Service to create a notification
 * (POST /api/users/internal/notifications - service-to-service, FIX 06C-4B2A).
 *
 * The route requires the shared secret in the X-Internal-Service-Token header (same contract as /api/users/internal/eligibility).
 * This client:
 *   - reads the URL (USER_SERVICE_URL) and the token (INTERNAL_SERVICE_TOKEN) from the environment on every call. There is NO default
 *     token: without a usable token, or with an unusable URL, nothing is sent and the call rejects with a CONFIG error;
 *   - never swallows a failure: network errors, timeouts, HTTP 4xx / 5xx and authentication failures all reject with a
 *     UserNotificationError (what each caller then does with it - log, record, ignore - is the caller's existing behaviour);
 *   - never lets the token reach a log or an error object: an axios error carries the whole request config (headers included),
 *     so it is replaced by an error that has only the message, the HTTP status and the error code;
 *   - sends exactly the payload it is given, only the timeout the caller asks for (none = the axios default, as before) and an
 *     X-Idempotency-Key header ONLY when the caller passes one (FIX 06C-4B2B2: the leaderboard reward notification). A key is never
 *     invented or shared: callers that pass none keep the old, non-idempotent behaviour. A 200 (`deduplicated: true`, a replay the
 *     User Service already handled) is a success exactly like a 201;
 *   - knows nothing about MongoDB. A notification is a network call: callers must not make it inside an open transaction (none does).
 *
 * `axios.post` is called on the shared axios instance on purpose, so request interceptors and test doubles keep applying.
 */

export const NOTIFICATIONS_PATH = '/api/users/internal/notifications';
export const INTERNAL_TOKEN_HEADER = 'x-internal-service-token';
export const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';
const DEFAULT_USER_SERVICE_URL = 'http://localhost:3002'; // the same development fallback every caller used before; the token has none

export interface UserNotificationPayload {
  userId: string;
  title: string;
  message: string;
  type?: string;
  link?: string;
}

export type UserNotificationFailure = 'CONFIG' | 'HTTP' | 'TIMEOUT' | 'NETWORK';

export class UserNotificationError extends Error {
  readonly failure: UserNotificationFailure;
  readonly status?: number;
  readonly code?: string;
  /** The shape callers could already read from an axios error (`err.response.status`) - without the request config that holds the token. */
  readonly response?: { status: number };

  constructor(message: string, failure: UserNotificationFailure, details: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'UserNotificationError';
    this.failure = failure;
    if (details.status !== undefined) {
      this.status = details.status;
      this.response = { status: details.status };
    }
    if (details.code !== undefined) this.code = details.code;
  }
}

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;
// the format the User Service accepts (notification-idempotency.ts): 1-200 characters out of letters, digits and . _ : -
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,200}$/;

function readToken(): string {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token || token.trim() === '') {
    throw new UserNotificationError('INTERNAL_SERVICE_TOKEN is not configured; the notification was not sent', 'CONFIG');
  }
  if (!PRINTABLE_ASCII.test(token)) {
    throw new UserNotificationError('INTERNAL_SERVICE_TOKEN contains characters that cannot be sent in an HTTP header; the notification was not sent', 'CONFIG');
  }
  if (token !== token.trim()) {
    // header values are trimmed in transit, so the User Service would compare a different string and answer 403 every time
    throw new UserNotificationError('INTERNAL_SERVICE_TOKEN has leading or trailing whitespace; the notification was not sent', 'CONFIG');
  }
  return token;
}

function readIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) {
    throw new UserNotificationError('The idempotency key is not valid (1-200 characters out of letters, digits and . _ : -); the notification was not sent', 'CONFIG');
  }
  return key;
}

function readBaseUrl(): string {
  const raw = process.env.USER_SERVICE_URL || DEFAULT_USER_SERVICE_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // the value is not echoed: a URL can carry credentials
    throw new UserNotificationError('USER_SERVICE_URL is not a valid URL; the notification was not sent', 'CONFIG');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UserNotificationError('USER_SERVICE_URL must be an http(s) URL; the notification was not sent', 'CONFIG');
  }
  return raw.replace(/\/+$/, '');
}

function toSafeError(err: any, token: string): UserNotificationError {
  const status = typeof err?.response?.status === 'number' ? err.response.status : undefined;
  const code = typeof err?.code === 'string' ? err.code : undefined;
  let message = String(err?.message ?? err ?? 'unknown error').split(token).join('[redacted]');
  if (status === 401 || status === 403) message += ' (the User Service rejected the internal service token)';
  const failure: UserNotificationFailure =
    status !== undefined ? 'HTTP' : code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(message) ? 'TIMEOUT' : 'NETWORK';
  return new UserNotificationError(message, failure, { status, code });
}

export class UserNotificationClient {
  /**
   * Creates one notification. Resolves when the User Service answered with a 2xx status; rejects with a UserNotificationError otherwise
   * (including when the request could not even be built because the token or the URL is not configured).
   */
  static async send(payload: UserNotificationPayload, options: { timeoutMs?: number; idempotencyKey?: string } = {}): Promise<{ status?: number }> {
    const token = readToken();
    const baseUrl = readBaseUrl();
    const config: { headers: Record<string, string>; timeout?: number } = { headers: { [INTERNAL_TOKEN_HEADER]: token } };
    if (options.idempotencyKey !== undefined) config.headers[IDEMPOTENCY_KEY_HEADER] = readIdempotencyKey(options.idempotencyKey);
    if (options.timeoutMs !== undefined) config.timeout = options.timeoutMs;

    try {
      const response = await axios.post(`${baseUrl}${NOTIFICATIONS_PATH}`, payload, config);
      return { status: response?.status };
    } catch (err) {
      throw toSafeError(err, token);
    }
  }
}
