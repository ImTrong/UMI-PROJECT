import winston from 'winston';

/**
 * RAG-SEC-LOG-01 — secrets never reach a log line (same rules as the ai-service logger, RAG-P0).
 *
 * Every entry goes through `redactSecrets` before any transport formats it:
 *   - JWTs, "Bearer <x>" values, Google API keys and secret query parameters (token=, refresh_token=, api_key=, presigned
 *     URL signatures) inside any string - message, stack, nested meta - are masked;
 *   - values of sensitive keys (authorization, cookie, token, password, secret, api key, internal-service token) are masked;
 *   - an axios error (its config holds the request headers and body) is reduced to
 *     name / code / HTTP status / method / URL path without query string.
 * Callers should still log short descriptions instead of raw errors; this is the safety net for every existing call.
 */
const MASK = '[REDACTED]';
const JWT_RE = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const GOOGLE_KEY_RE = /AIza[0-9A-Za-z_-]{20,}/g;
// "token":"<x>" inside serialized JSON (e.g. an axios request body), whatever the token looks like
const JSON_SECRET_RE = /("(?:token|access_?token|refresh_?token|password|secret|api_?key)"\s*:\s*")[^"]*"/gi;
// ?token=<x> / &refresh_token=<x> ... in a URL written anywhere in a string
const QUERY_SECRET_RE = /([?&](?:token|access_token|refresh_token|id_token|api_?key|apikey|password|x-amz-signature|x-amz-credential|x-amz-security-token)=)[^&\s"'#]+/gi;
const SENSITIVE_KEY_RE = /^(authorization|proxy-authorization|cookie|set-cookie|token|access_?token|refresh_?token|id_?token|password|passwd|secret|client_?secret|api_?key|x-api-key|x-goog-api-key|x-internal-service-token)$/i;
const MAX_DEPTH = 6;

export function redactString(value: string): string {
  return value
    .replace(JWT_RE, MASK)
    .replace(BEARER_RE, `$1${MASK}`)
    .replace(GOOGLE_KEY_RE, MASK)
    .replace(JSON_SECRET_RE, `$1${MASK}"`)
    .replace(QUERY_SECRET_RE, `$1${MASK}`);
}

/** An axios error, also once winston copied its own fields (config / request / response) into the log entry. */
function looksLikeAxiosError(v: any): boolean {
  if (!v || typeof v !== 'object') return false;
  if (v.isAxiosError === true) return true;
  const config = v.config;
  return !!config && typeof config === 'object' && 'headers' in config && ('url' in config || 'method' in config);
}

function summarizeAxiosError(error: any): Record<string, unknown> {
  const url = typeof error.config?.url === 'string' ? error.config.url.split('?')[0] : undefined;
  return {
    name: error.name,
    message: typeof error.message === 'string' ? redactString(error.message) : undefined,
    code: error.code,
    status: error.response?.status,
    method: typeof error.config?.method === 'string' ? error.config.method.toUpperCase() : undefined,
    url: url ? redactString(url) : undefined,
  };
}

export function sanitizeForLog(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);

  const v: any = value;
  if (looksLikeAxiosError(v)) return summarizeAxiosError(v);
  if (Array.isArray(v)) return v.map((item) => sanitizeForLog(item, depth + 1, seen));
  if (Buffer.isBuffer(v)) return `[Buffer ${v.length}]`;
  if (v instanceof Date) return v;

  const out: Record<string, unknown> = {};
  if (v instanceof Error) {
    out.name = v.name;
    out.message = redactString(v.message);
    if (v.stack) out.stack = redactString(v.stack);
  }
  for (const key of Object.keys(v)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? MASK : sanitizeForLog(v[key], depth + 1, seen);
  }
  return out;
}

/** Sanitizes the string-keyed fields of the log entry in place (winston keeps its Symbol keys: level, message, splat). */
export const redactSecrets = winston.format((info: any) => {
  if (looksLikeAxiosError(info)) {
    const summary = summarizeAxiosError(info);
    for (const key of ['config', 'request', 'response', 'toJSON', 'cause']) delete info[key];
    Object.assign(info, { httpStatus: summary.status, url: summary.url, method: summary.method });
  }
  for (const key of Object.keys(info)) {
    if (key === 'level') continue;
    info[key] = SENSITIVE_KEY_RE.test(key) ? MASK : sanitizeForLog(info[key]);
  }
  return info;
});

/** Short, secret-free description of a caught HTTP error for an explicit log line. */
export function describeHttpError(error: any): string {
  const s = summarizeAxiosError(error ?? {});
  return [s.method, s.url, s.status ? `HTTP ${s.status}` : undefined, s.code].filter(Boolean).join(' ') || 'error';
}
