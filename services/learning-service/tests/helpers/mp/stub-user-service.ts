/**
 * Loopback stand-in for the User Service, controlled by the test (FIX 06C-2). Runs in the CONTROLLER process; the finalize workers talk to it
 * over real HTTP on 127.0.0.1 (the worker refuses every other destination, so nothing can reach a real service or a Docker container).
 *
 *   POST /api/users/internal/eligibility    { ids }  -> { data: [{ userId, role, isActive }] }   (token protected, like the real one)
 *   POST /api/users/internal/notifications  { userId, ... } -> {}                                  (token protected like the real route since
 *                                                                                                  FIX 06C-4B2A - 403 without the secret, nothing recorded as delivered;
 *                                                                                                  recorded; can be made to fail / to wait)
 *
 * Every request is recorded with WHO sent it (header x-test-worker, added by the worker's axios interceptor) and how many MongoDB
 * transactions that worker had open at the moment of sending (header x-test-open-tx) - the evidence for "no network call inside a transaction".
 * Notification bodies are reduced to userId + rank text; no tokens or personal data are stored.
 *
 * Notification modes (FIX 06C-4B2B2):
 *   idempotent (default) - like the real User Service since FIX 06C-4B2B1: a request with X-Idempotency-Key creates the notification once
 *                          (201, counted in `created`, one `pushes`), a repeat of the key answers 200 `deduplicated: true` and creates /
 *                          pushes nothing, the same key with another userId / type / link answers 422 IDEMPOTENCY_KEY_REUSED. The
 *                          notification is created when the request ARRIVES (before `notificationGate`), as the real service has it
 *                          stored before it answers. Requests without a key create a notification each time.
 *   legacy               - the old server: every accepted request creates a notification and pushes it, keys are ignored.
 */
import http from 'node:http';

export const STUB_TOKEN = 'mp-finalize-test-token';

export interface StubProfile {
  userId: string;
  role: string | null;
  isActive: boolean | null;
}
export interface StubRequest {
  at: number;
  kind: 'eligibility' | 'notification' | 'other';
  worker: string;
  openTx: number | null;
  userId?: string;
  ids?: string[];
  status: number;
  /** Idempotency key the request carried (header x-idempotency-key or body.idempotencyKey) - the production request carries NONE today. */
  idempotencyKey?: string;
  /** Whether the request carried the shared secret (the secret itself is never stored). */
  authenticated?: boolean;
  /** What the (simulated) User Service did with it. */
  outcome?: 'created' | 'deduplicated' | 'conflict' | 'refused' | 'failed';
}

export interface StubNotification { id: string; key?: string; userId: string; type: string; link: string | null; title: string; message: string }

export class StubUserService {
  private server!: http.Server;
  port = 0;
  url = '';
  /** Overrides by userId; users without an entry are ACTIVE STUDENTS. `null` = no profile at all. */
  profiles = new Map<string, StubProfile | null>();
  failNotificationFor = new Set<string>();
  notificationMode: 'idempotent' | 'legacy' = 'idempotent';
  /** The notifications that exist in the simulated User Service (one per key in idempotent mode). */
  notifications: StubNotification[] = [];
  /** Real-time pushes the simulated service made: one per CREATED notification. */
  pushes = 0;
  /** Awaited before a notification is answered (lets a test keep a sender "on the wire"). */
  notificationGate: ((userId: string) => Promise<void>) | null = null;
  requests: StubRequest[] = [];
  private watchers: Array<{ pred: (r: StubRequest) => boolean; resolve: (r: StubRequest) => void }> = [];

  /** Resolves when a request accepted by `pred` has ARRIVED at the stub (before it is answered): "the service has received it". */
  waitForRequest(pred: (r: StubRequest) => boolean, timeoutMs = 30_000): Promise<StubRequest> {
    const past = this.requests.find(pred);
    if (past) return Promise.resolve(past);
    return new Promise<StubRequest>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the stub did not receive the awaited request within ${timeoutMs} ms`)), timeoutMs);
      this.watchers.push({ pred, resolve: (r) => { clearTimeout(timer); resolve(r); } });
    });
  }
  private record(r: StubRequest) {
    this.requests.push(r);
    this.watchers = this.watchers.filter((w) => { if (w.pred(r)) { w.resolve(r); return false; } return true; });
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => void this.handle(req, res, raw));
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as any).port;
    this.url = `http://127.0.0.1:${this.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reset() {
    this.profiles.clear();
    this.failNotificationFor.clear();
    this.notificationGate = null;
    this.notificationMode = 'idempotent';
    this.notifications = [];
    this.pushes = 0;
    this.requests = [];
    this.watchers = [];
  }

  of(kind: StubRequest['kind'], worker?: string) {
    return this.requests.filter((r) => r.kind === kind && (!worker || r.worker === worker));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string) {
    const worker = String(req.headers['x-test-worker'] || 'unknown');
    const openTxHeader = req.headers['x-test-open-tx'];
    const openTx = openTxHeader === undefined ? null : Number(openTxHeader);
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* malformed body: handled below */ }

    if (req.method === 'POST' && req.url === '/api/users/internal/eligibility') {
      const ok = req.headers['x-internal-service-token'] === STUB_TOKEN;
      const status = ok ? 200 : 403;
      this.requests.push({ at: Date.now(), kind: 'eligibility', worker, openTx, ids: body.ids, status });
      if (!ok) return reply(403, { error: 'forbidden' });
      const data = ((body.ids || []) as string[])
        .map((id) => (this.profiles.has(id) ? this.profiles.get(id) : { userId: id, role: 'STUDENT', isActive: true }))
        .filter((p) => p !== null);
      return reply(200, { data });
    }
    if (req.method === 'POST' && req.url === '/api/users/internal/notifications') {
      const userId = String(body.userId || '');
      const authenticated = req.headers['x-internal-service-token'] === STUB_TOKEN;
      const failing = this.failNotificationFor.has(userId);
      const key = (req.headers['x-idempotency-key'] as string | undefined) ?? (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined);
      const rec: StubRequest = { at: Date.now(), kind: 'notification', worker, openTx, userId, status: 0, idempotencyKey: key, authenticated };
      let answer: [number, unknown];
      if (!authenticated) { rec.outcome = 'refused'; answer = [403, { error: 'forbidden' }]; }
      else if (failing) { rec.outcome = 'failed'; answer = [503, { error: 'unavailable' }]; }
      else {
        const type = String(body.type || 'INFO');
        const link = body.link ?? null;
        const existing = this.notificationMode === 'idempotent' && key !== undefined ? this.notifications.find((n) => n.key === key) : undefined;
        if (!existing) {
          const created: StubNotification = { id: `n${this.notifications.length + 1}`, key, userId, type, link, title: String(body.title), message: String(body.message) };
          this.notifications.push(created);
          this.pushes++;
          rec.outcome = 'created';
          answer = [201, { message: 'Notification created successfully', data: created, ...(key !== undefined && this.notificationMode === 'idempotent' ? { deduplicated: false } : {}) }];
        } else if (existing.userId !== userId || existing.type !== type || existing.link !== link) {
          rec.outcome = 'conflict';
          answer = [422, { error: 'The idempotency key was already used for a different notification', code: 'IDEMPOTENCY_KEY_REUSED' }];
        } else {
          rec.outcome = 'deduplicated';
          answer = [200, { message: 'Notification already created', data: existing, deduplicated: true, ...(existing.title !== body.title || existing.message !== body.message ? { payloadChanged: true } : {}) }];
        }
      }
      rec.status = answer[0];
      this.record(rec);
      if (authenticated && this.notificationGate) await this.notificationGate(userId);
      return reply(answer[0], answer[1]);
    }
    this.requests.push({ at: Date.now(), kind: 'other', worker, openTx, status: 404 });
    return reply(404, { error: 'not found' });
  }
}
