import { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { HTTP_STATUS } from '../utils/constants';
import logger from '../utils/logger';
import { checkServiceToken, SERVICE_TOKEN_HEADER } from '../utils/service-token';

/**
 * Authenticates ONE service-to-service relation with its own secret (FIX 07B-1), e.g. Payment -> User with PAYMENT_USER_TOKEN.
 *   - the secret is read from `envVar` at request time; while it is missing or not usable (too short, a public default, ...) every
 *     call is refused with 500 (fail-closed) - the route never falls back to INTERNAL_SERVICE_TOKEN or anything else;
 *   - the caller must send it in the X-Internal-Service-Token header (query string, body and other headers do not count);
 *   - the comparison is constant-time for any length (SHA-256 digests of both values are compared with timingSafeEqual);
 *   - neither the expected nor the provided value is ever logged or returned.
 */
export function requireServiceToken(envVar: string) {
  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const expected = checkServiceToken(envVar, process.env[envVar]);
    if (!expected.ok) {
      logger.error(`Service authentication for ${req.path} is not configured: ${expected.reason}`);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Internal service authentication not configured' });
    }
    const provided = req.headers[SERVICE_TOKEN_HEADER];
    const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();
    const ok = typeof provided === 'string' && timingSafeEqual(digest(provided), digest(expected.value));
    if (!ok) {
      logger.warn(`Unauthorized service call from ${req.ip} to ${req.path}`);
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Forbidden: Invalid internal service token' });
    }
    next();
  };
  Object.defineProperty(middleware, 'name', { value: `requireServiceToken(${envVar})` });
  return middleware;
}
