import axios from 'axios';
import logger from '../utils/logger';

/**
 * Who may compete for (and receive) leaderboard rewards.
 *
 * Source of truth is the User Service, through its internal, token-protected endpoint
 * POST /api/users/internal/eligibility -> [{ userId, role, isActive }]. The learning service never reads
 * the user database itself, and never exposes role / active state in its public API.
 *
 * Policy: a user is eligible only if role === 'STUDENT' AND isActive === true, both explicitly reported.
 * Everything unverifiable is NOT eligible:
 *   - user missing from the answer            -> PROFILE_NOT_FOUND
 *   - role / isActive missing or mistyped     -> PROFILE_INCOMPLETE
 * Everything that makes the answer itself unreliable FAILS THE WHOLE CHECK (UserEligibilityError, 503) so
 * that no snapshot or reward is produced from a half-known population:
 *   - network error / timeout / non-2xx / missing service token / malformed body
 *   - the service returns nothing for a non-empty request, or only malformed entries
 *     (a contract mismatch must not silently empty the leaderboard)
 */
export const ELIGIBLE_ROLE = 'STUDENT';

export interface EligibilityVerdict {
  eligible: boolean;
  reason?: 'ROLE_NOT_STUDENT' | 'INACTIVE' | 'PROFILE_NOT_FOUND' | 'PROFILE_INCOMPLETE';
  role?: string;
}

export class UserEligibilityError extends Error {
  public readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'UserEligibilityError';
  }
}

const CHUNK_SIZE = 500;
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { verdict: EligibilityVerdict; expiresAt: number }>();

export class UserEligibilityService {
  /** Drop cached verdicts (tests, admin actions). */
  static clearCache() {
    cache.clear();
  }

  /**
   * Verdict for every requested user id. `fresh: true` bypasses the short-lived cache and MUST be used
   * for anything that persists a snapshot or pays a reward; the cache only serves live read-only views.
   */
  static async check(userIds: string[], options: { fresh?: boolean } = {}): Promise<Map<string, EligibilityVerdict>> {
    const ids = [...new Set(userIds)];
    const verdicts = new Map<string, EligibilityVerdict>();
    if (ids.length === 0) return verdicts;

    const now = Date.now();
    const toFetch: string[] = [];
    for (const id of ids) {
      const hit = options.fresh ? undefined : cache.get(id);
      if (hit && hit.expiresAt > now) verdicts.set(id, hit.verdict);
      else toFetch.push(id);
    }

    for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
      const chunk = toFetch.slice(i, i + CHUNK_SIZE);
      const chunkVerdicts = await this.fetchChunk(chunk);
      for (const [id, verdict] of chunkVerdicts) {
        verdicts.set(id, verdict);
        cache.set(id, { verdict, expiresAt: Date.now() + CACHE_TTL_MS });
      }
    }

    const excluded = [...verdicts.values()].filter((v) => !v.eligible);
    if (excluded.length > 0) {
      const byReason: Record<string, number> = {};
      for (const v of excluded) byReason[v.reason || 'UNKNOWN'] = (byReason[v.reason || 'UNKNOWN'] || 0) + 1;
      logger.info(`🏆 [Eligibility] ${excluded.length}/${ids.length} users excluded from the leaderboard: ${JSON.stringify(byReason)}`);
    }
    return verdicts;
  }

  private static async fetchChunk(ids: string[]): Promise<Map<string, EligibilityVerdict>> {
    const token = process.env.INTERNAL_SERVICE_TOKEN;
    if (!token) {
      throw new UserEligibilityError('INTERNAL_SERVICE_TOKEN is not configured; learner eligibility cannot be verified');
    }
    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';

    let body: any;
    try {
      const response = await axios.post(
        `${userServiceUrl}/api/users/internal/eligibility`,
        { ids },
        { timeout: TIMEOUT_MS, headers: { 'x-internal-service-token': token } }
      );
      body = response.data;
    } catch (err: any) {
      logger.warn(`User service eligibility lookup failed: ${err?.message}`);
      throw new UserEligibilityError('User service is unavailable; learner eligibility could not be verified');
    }

    if (!body || !Array.isArray(body.data)) {
      throw new UserEligibilityError('User service returned an unexpected eligibility response');
    }

    const requested = new Set(ids);
    const returned = (body.data as any[]).filter((p) => p && typeof p.userId === 'string' && requested.has(p.userId));
    if (returned.length === 0) {
      throw new UserEligibilityError(`User service returned no profile for ${ids.length} requested users; refusing to guess`);
    }

    const result = new Map<string, EligibilityVerdict>();
    let wellFormed = 0;
    for (const p of returned) {
      if (typeof p.role !== 'string' || !p.role || typeof p.isActive !== 'boolean') {
        result.set(p.userId, { eligible: false, reason: 'PROFILE_INCOMPLETE' });
        continue;
      }
      wellFormed++;
      if (p.role !== ELIGIBLE_ROLE) result.set(p.userId, { eligible: false, reason: 'ROLE_NOT_STUDENT', role: p.role });
      else if (p.isActive !== true) result.set(p.userId, { eligible: false, reason: 'INACTIVE', role: p.role });
      else result.set(p.userId, { eligible: true, role: p.role });
    }
    if (wellFormed === 0) {
      throw new UserEligibilityError('User service returned no usable role / isActive data; contract mismatch');
    }

    for (const id of ids) {
      if (!result.has(id)) result.set(id, { eligible: false, reason: 'PROFILE_NOT_FOUND' });
    }
    return result;
  }
}
