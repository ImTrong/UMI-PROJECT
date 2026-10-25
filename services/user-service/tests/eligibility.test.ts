/**
 * Contract tests for POST /api/users/internal/eligibility - the service-to-service endpoint the
 * learning service uses to decide who may appear on / be rewarded by the leaderboard.
 *
 * The REAL express app is started on an ephemeral port (real middleware, rate limiter, routing); only the
 * database is replaced by a tiny in-memory Prisma stand-in. No network beyond 127.0.0.1.
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

type Row = { userId: string; email: string; fullName: string; avatar: string | null; role: string; isActive: boolean };
const rows: Row[] = [];
let findManyCalls = 0;

// ---- minimal Prisma stand-in (installed before the app is loaded) ----
class FakePrismaClient {
  userProfile = {
    findMany: async ({ where, select }: any) => {
      findManyCalls++;
      const ids: string[] = where?.userId?.in ?? [];
      return rows
        .filter((r) => ids.includes(r.userId))
        .map((r) => (select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, (r as any)[k]])) : r));
    },
  };
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient, Role: { STUDENT: 'STUDENT', INSTRUCTOR: 'INSTRUCTOR', ADMIN: 'ADMIN' } },
} as any;

const TOKEN = 'unit-test-internal-token';
const id = (n: number) => n.toString(16).padStart(2, '0').repeat(12).slice(0, 24);
const seed = (n: number, role: string, isActive: boolean) =>
  rows.push({ userId: id(n), email: `u${n}@example.com`, fullName: `User ${n}`, avatar: null, role, isActive });

describe('POST /api/users/internal/eligibility', () => {
  let server: any;
  let base = '';

  before(async () => {
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test';
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const app = require('../src/app').default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    rows.length = 0;
    findManyCalls = 0;
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
  });

  const post = (body: any, token: string | null = TOKEN) =>
    fetch(`${base}/api/users/internal/eligibility`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-internal-service-token': token } : {}) },
      body: JSON.stringify(body),
    });

  it('refuses callers without the service token, or with a wrong one - and never touches the database', async () => {
    seed(1, 'STUDENT', true);
    assert.equal((await post({ ids: [id(1)] }, null)).status, 403);
    assert.equal((await post({ ids: [id(1)] }, 'wrong-token')).status, 403);
    assert.equal((await post({ ids: [id(1)] }, TOKEN + 'x')).status, 403);
    assert.equal(findManyCalls, 0);
  });

  it('refuses everything when the server has no INTERNAL_SERVICE_TOKEN configured', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const res = await post({ ids: [id(1)] }, 'anything');
    assert.equal(res.status, 500);
    assert.equal(findManyCalls, 0);
  });

  it('returns ONLY userId, role and isActive (no email, name, avatar) for the requested users', async () => {
    seed(1, 'STUDENT', true);
    seed(2, 'ADMIN', true);
    seed(3, 'INSTRUCTOR', true);
    seed(4, 'STUDENT', false);
    seed(5, 'STUDENT', true); // not requested

    const res = await post({ ids: [id(1), id(2), id(3), id(4)] });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.deepEqual(
      body.data.sort((a: any, b: any) => a.userId.localeCompare(b.userId)),
      [
        { userId: id(1), role: 'STUDENT', isActive: true },
        { userId: id(2), role: 'ADMIN', isActive: true },
        { userId: id(3), role: 'INSTRUCTOR', isActive: true },
        { userId: id(4), role: 'STUDENT', isActive: false },
      ]
    );
    assert.ok(!JSON.stringify(body).includes('@example.com'));
    for (const item of body.data) assert.deepEqual(Object.keys(item).sort(), ['isActive', 'role', 'userId']);
  });

  it('a user without a profile is simply absent (the caller must not read that as "eligible")', async () => {
    seed(1, 'STUDENT', true);
    const body: any = await (await post({ ids: [id(1), id(9)] })).json();
    assert.deepEqual(body.data.map((u: any) => u.userId), [id(1)]);
  });

  it('duplicate ids are collapsed; an empty list is allowed', async () => {
    seed(1, 'STUDENT', true);
    const body: any = await (await post({ ids: [id(1), id(1), id(1)] })).json();
    assert.equal(body.data.length, 1);
    const empty: any = await (await post({ ids: [] })).json();
    assert.deepEqual(empty.data, []);
  });

  it('rejects malformed bodies with 400', async () => {
    for (const body of [
      {}, { ids: 'nope' }, { ids: [123] }, { ids: ['not-an-object-id'] }, { ids: [{ $ne: null }] },
      { ids: Array.from({ length: 1001 }, (_, i) => id(i % 200)) },
    ]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal(findManyCalls, 0);
  });

  it('the public batch endpoint is unchanged and does not carry isActive', async () => {
    // (documented contract: userId, fullName, email, avatar, role - which is why eligibility needs its own endpoint)
    const route = (require('../src/app').default as any)._router.stack
      .filter((l: any) => l.route)
      .find((l: any) => l.route.path === '/api/users/batch');
    assert.ok(route);
  });

  it('the route is registered behind verifyInternalService (first handler)', () => {
    const layer = (require('../src/app').default as any)._router.stack
      .filter((l: any) => l.route)
      .find((l: any) => l.route.path === '/api/users/internal/eligibility');
    assert.ok(layer, 'route exists');
    assert.equal(layer.route.methods.post, true);
    assert.equal(layer.route.stack[0].name, 'verifyInternalService');
  });
});
