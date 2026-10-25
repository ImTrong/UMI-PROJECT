/**
 * Stand-in for the User Service as seen by the learning service (axios.post is mocked):
 *   POST /api/users/internal/eligibility   -> [{ userId, role, isActive }]   (token protected)
 *   POST /api/users/internal/notifications -> forwarded to `onNotify` (may throw to simulate a failure)   (token protected, like
 *                                              the real route since FIX 06C-4B2A: without the shared secret it answers 403 and
 *                                              `onNotify` is not called)
 *
 * By default every user is an ACTIVE STUDENT. Tests override individual users, or make the whole
 * eligibility endpoint time out / fail / answer with a broken body.
 */
export const TEST_INTERNAL_TOKEN = 'test-internal-token';
process.env.INTERNAL_SERVICE_TOKEN = TEST_INTERNAL_TOKEN;

export type EligibilityMode = 'ok' | 'timeout' | 'http500' | 'empty' | 'not-array' | 'wrong-token';

export interface UserServiceStub {
  /** Overrides keyed by userId. `null` = the user has no profile (absent from the answer). */
  profiles: Map<string, any | null>;
  mode: EligibilityMode;
  /** Replaces the whole answer body (receives the requested ids). */
  rawAnswer?: (ids: string[]) => any;
  eligibilityCalls: Array<{ ids: string[]; token: string | undefined }>;
  /** Every notification request, accepted or refused: the body, the secret it carried, the idempotency key, the timeout the caller asked for. */
  notificationCalls: Array<{ url: string; body: any; token: string | undefined; key: string | undefined; timeout: number | undefined; headerNames: string[]; outcome?: string }>;
  /**
   * 'legacy' (default here): every accepted request reaches `onNotify` (the old server). 'idempotent': like the real User Service since
   * FIX 06C-4B2B1 - the first request of a key reaches `onNotify` (= created + pushed; if `onNotify` throws nothing was created), a repeat
   * answers 200 deduplicated without calling it, the same key with another userId / type / link answers 422.
   */
  notificationMode: 'legacy' | 'idempotent';
  /** idempotent mode: the notifications that exist, by key */
  createdByKey: Map<string, { userId: string; type: string; link: string | null; title: string; message: string }>;
  /** idempotent mode: called right after a notification was stored (e.g. to lose the answer AFTER the service stored it) */
  afterCreate?: (body: any) => void | Promise<void>;
  /** Awaited at the START of every eligibility call - lets a test pause a run exactly while it waits for the User Service. */
  gate?: (ids: string[]) => Promise<void>;
}

export function installUserServiceStub(
  axios: any,
  mock: any,
  onNotify: (body: any) => void | Promise<void> = () => undefined
): UserServiceStub {
  // the client keeps a short-lived verdict cache: every test starts from a clean one
  require('../../src/services/user-eligibility.service').UserEligibilityService.clearCache();

  const stub: UserServiceStub = { profiles: new Map(), mode: 'ok', eligibilityCalls: [], notificationCalls: [], notificationMode: 'legacy', createdByKey: new Map() };

  mock.method(axios, 'post', async (url: string, body: any, config?: any) => {
    if (url.endsWith('/api/users/internal/eligibility')) {
      const token = config?.headers?.['x-internal-service-token'];
      stub.eligibilityCalls.push({ ids: body.ids, token });
      if (stub.gate) await stub.gate(body.ids);
      if (token !== TEST_INTERNAL_TOKEN) throw Object.assign(new Error('Forbidden'), { response: { status: 403 } });
      if (stub.mode === 'timeout') throw Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' });
      if (stub.mode === 'http500') throw Object.assign(new Error('HTTP 500'), { response: { status: 500 } });
      if (stub.mode === 'empty') return { data: { data: [] } };
      if (stub.mode === 'not-array') return { data: { data: 'nope' } };
      if (stub.rawAnswer) return { data: stub.rawAnswer(body.ids) };
      const data = (body.ids as string[])
        .map((id) => (stub.profiles.has(id) ? stub.profiles.get(id) : { userId: id, role: 'STUDENT', isActive: true }))
        .filter((p) => p !== null);
      return { data: { data } };
    }
    if (url.endsWith('/api/users/internal/notifications')) {
      const token = config?.headers?.['x-internal-service-token'];
      const key: string | undefined = config?.headers?.['x-idempotency-key'];
      const call: UserServiceStub['notificationCalls'][number] = { url, body, token, key, timeout: config?.timeout, headerNames: Object.keys(config?.headers ?? {}) };
      stub.notificationCalls.push(call);
      if (token !== TEST_INTERNAL_TOKEN) { call.outcome = 'refused'; throw Object.assign(new Error('Forbidden'), { response: { status: 403 } }); }
      if (stub.notificationMode === 'idempotent' && key !== undefined) {
        const existing = stub.createdByKey.get(key);
        if (existing) {
          if (existing.userId !== body.userId || existing.type !== (body.type || 'INFO') || existing.link !== (body.link ?? null)) {
            call.outcome = 'conflict';
            throw Object.assign(new Error('Request failed with status code 422'), { response: { status: 422, data: { code: 'IDEMPOTENCY_KEY_REUSED' } } });
          }
          call.outcome = 'deduplicated';
          return { status: 200, data: { message: 'Notification already created', data: existing, deduplicated: true, ...(existing.title !== body.title || existing.message !== body.message ? { payloadChanged: true } : {}) } };
        }
        await onNotify(body); // throws = the service failed before storing anything
        stub.createdByKey.set(key, { userId: body.userId, type: body.type || 'INFO', link: body.link ?? null, title: body.title, message: body.message });
        call.outcome = 'created';
        if (stub.afterCreate) await stub.afterCreate(body); // e.g. the answer is lost AFTER the service stored it
        return { status: 201, data: { message: 'Notification created successfully', deduplicated: false } };
      }
      await onNotify(body);
      call.outcome = 'created';
      return { status: 201, data: {} };
    }
    if (url.endsWith('/api/users/batch')) {
      // the PUBLIC batch endpoint really returns email + role; the leaderboard must never forward them
      return {
        data: {
          data: (body.ids as string[]).map((id) => ({
            userId: id, fullName: `Learner ${id.slice(0, 4)}`, email: `${id.slice(0, 4)}@example.com`, avatar: null, role: 'STUDENT',
          })),
        },
      };
    }
    throw new Error(`unexpected POST ${url}`);
  });

  return stub;
}
