/**
 * FIX-INS-03 - order-service side of the Order -> Course credential ORDER_COURSE_TOKEN.
 *
 *   calling   OrderService.incrementEnrollmentCount (run for every course granted when an order is fulfilled) sends
 *             POST /api/courses/:courseId/increment-enrollment with ORDER_COURSE_TOKEN in X-Internal-Service-Token - and
 *             nothing at all without a usable value (no fallback to INTERNAL_SERVICE_TOKEN, a default or "")
 *   logging   a refused / failed call is logged with its HTTP status only; the token never reaches the logs
 *
 * The course-service is a loopback stub that records every call and answers like the real route (403 unless the right token).
 * The database client is an inert stand-in. Every token is drawn at random for this run.
 *
 * Run: node -r ts-node/register/transpile-only --test test/order-course-token.test.ts
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

class FakePrismaClient {
  constructor() { return new Proxy({}, { get: () => new Proxy({}, { get: () => async () => null }) }); }
}
const prismaPath = require.resolve('@prisma/client');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: {
    PrismaClient: FakePrismaClient,
    OrderStatus: { PENDING: 'PENDING', PROCESSING: 'PROCESSING', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', FAILED: 'FAILED' },
    PaymentStatus: { UNPAID: 'UNPAID', PAID: 'PAID', REFUNDED: 'REFUNDED', FAILED: 'FAILED' },
    Prisma: {},
  },
} as any;

const TOKEN = randomBytes(32).toString('hex');      // ORDER_COURSE_TOKEN for this run
const SHARED = randomBytes(32).toString('hex');     // INTERNAL_SERVICE_TOKEN - must never be sent instead
const COURSE = 'c4'.repeat(12);
const PUBLIC_DEFAULTS = Array.from(new Set(Array.from(
  fs.readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8').matchAll(/\$\{[A-Z_]*TOKEN:-([^}]+)\}/g), (m) => m[1]
)));

describe('FIX-INS-03 order-service: ORDER_COURSE_TOKEN on the enrolledCount increment', () => {
  let stub: http.Server;
  let OrderService: any;
  const calls: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders }> = [];
  const logs: string[] = [];
  let acceptedToken = TOKEN;

  before(async () => {
    stub = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        calls.push({ method: req.method || '', url: req.url || '', headers: req.headers });
        res.setHeader('content-type', 'application/json');
        if (req.headers['x-internal-service-token'] !== acceptedToken) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: 'Forbidden: Invalid internal service token' }));
        }
        res.end(JSON.stringify({ message: 'Enrollment incremented' }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    process.env.COURSE_SERVICE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    process.env.INTERNAL_SERVICE_TOKEN = SHARED;
    const logger = require('../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    for (const level of ['error', 'warn', 'info', 'debug']) {
      const original = logger[level].bind(logger);
      logger[level] = (...args: any[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack} ${JSON.stringify((a as any).config || {})}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        return original(...args);
      };
    }
    ({ OrderService } = require('../src/services/order.service'));
  });

  after(async () => { await new Promise((resolve) => stub.close(resolve)); });

  beforeEach(() => {
    calls.length = 0;
    logs.length = 0;
    acceptedToken = TOKEN;
    process.env.ORDER_COURSE_TOKEN = TOKEN;
  });

  const increment = (courseId = COURSE) => OrderService.incrementEnrollmentCount(courseId);

  it('sends POST /api/courses/:courseId/increment-enrollment with ORDER_COURSE_TOKEN in X-Internal-Service-Token', async () => {
    await increment();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, `/api/courses/${COURSE}/increment-enrollment`, 'no query string');
    assert.equal(calls[0].headers['x-internal-service-token'], TOKEN);
    assert.equal(calls[0].headers.authorization, undefined);
    assert.ok(!JSON.stringify(calls[0].headers).includes(SHARED), 'the shared INTERNAL_SERVICE_TOKEN is never sent here');
    assert.ok(!logs.some((l) => /Failed to increment|Not incrementing/.test(l)));
  });

  it('WITHOUT a usable ORDER_COURSE_TOKEN (unset, empty, short, with spaces, the public default) nothing is sent - no fallback', async () => {
    for (const configured of [undefined, '', '   ', 'too-short-value', `${TOKEN.slice(0, 20)} ${TOKEN.slice(20)}`, ...PUBLIC_DEFAULTS]) {
      if (configured === undefined) delete process.env.ORDER_COURSE_TOKEN;
      else process.env.ORDER_COURSE_TOKEN = configured;
      await increment();
    }
    assert.equal(calls.length, 0, 'no request at all');
    assert.ok(logs.some((l) => l.includes('Not incrementing enrollment') && l.includes('ORDER_COURSE_TOKEN')));
  });

  it('a refused call (the course-service expects another value) never throws into the fulfillment flow and logs the status only, not the token', async () => {
    acceptedToken = randomBytes(32).toString('hex');
    await assert.doesNotReject(() => increment());
    assert.equal(calls.length, 1);
    const line = logs.find((l) => l.includes('Failed to increment enrollment'));
    assert.ok(line && line.includes('HTTP 403'), line);
    assert.ok(!logs.some((l) => l.includes(TOKEN)), 'the token never reaches the logs');
  });

  it('a network failure is logged without the token either', async () => {
    process.env.COURSE_SERVICE_URL = 'http://127.0.0.1:1';
    try {
      await assert.doesNotReject(() => increment());
    } finally {
      process.env.COURSE_SERVICE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    }
    assert.ok(logs.some((l) => l.includes('Failed to increment enrollment')));
    assert.ok(!logs.some((l) => l.includes(TOKEN)));
  });

  it('the fulfillment path still calls incrementEnrollmentCount for every granted course (the only caller of the route)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/services/order.service.ts'), 'utf8');
    assert.equal((source.match(/increment-enrollment/g) || []).length, 1, 'exactly one place builds the URL');
    assert.ok(/await this\.incrementEnrollmentCount\(item\.courseId\)/.test(source));
  });
});
