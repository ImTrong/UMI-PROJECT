/**
 * FIX 06C-4B2A: the shared notification client (src/services/user-notification.client.ts).
 *
 * Part 1 - request shape and configuration, with axios.post replaced by a recorder.
 * Part 2 - failures: always surfaced, never carry the token.
 * Part 3 - REAL axios against a loopback HTTP server (127.0.0.1 only): what is really on the wire, and what a real axios error
 *          contains (the token!) versus what the client lets out.
 *
 * No token literal lives in this file: every run draws a random one. No network beyond 127.0.0.1.
 *
 * Run: npm test
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import util from 'node:util';
import type { AddressInfo } from 'node:net';
import { useRandomInternalToken } from './helpers/internal-token';

/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require('axios').default || require('axios');
const {
  UserNotificationClient, UserNotificationError, NOTIFICATIONS_PATH, INTERNAL_TOKEN_HEADER,
} = require('../src/services/user-notification.client');

const payload = () => ({
  userId: 'a1'.repeat(12),
  title: '🏆 Chúc mừng!',
  message: 'Bạn đạt thứ hạng #1.',
  type: 'SUCCESS',
  link: '/leaderboard',
});

let TOKEN = '';
const saved = { token: process.env.INTERNAL_SERVICE_TOKEN, url: process.env.USER_SERVICE_URL };
beforeEach(() => {
  TOKEN = useRandomInternalToken();
  process.env.USER_SERVICE_URL = 'http://user-service.test:3002';
});
afterEach(() => {
  mock.restoreAll();
  if (saved.token === undefined) delete process.env.INTERNAL_SERVICE_TOKEN; else process.env.INTERNAL_SERVICE_TOKEN = saved.token;
  if (saved.url === undefined) delete process.env.USER_SERVICE_URL; else process.env.USER_SERVICE_URL = saved.url;
});

/** An error shaped like a real AxiosError: it carries the whole request config, headers (the secret) included. */
const axiosLikeError = (message: string, over: Record<string, unknown> = {}, config?: any) =>
  Object.assign(new Error(message), { isAxiosError: true, config: config ?? { headers: { [INTERNAL_TOKEN_HEADER]: TOKEN } }, request: { headers: { [INTERNAL_TOKEN_HEADER]: TOKEN } }, ...over });

const recordPost = (impl?: (url: string, body: any, config: any) => any) => {
  const calls: Array<{ url: string; body: any; config: any }> = [];
  mock.method(axios, 'post', async (url: string, body: any, config: any) => {
    calls.push({ url, body, config });
    return impl ? impl(url, body, config) : { status: 201, data: {} };
  });
  return calls;
};
const everywhere = (err: unknown) => [
  util.inspect(err, { depth: 12, showHidden: true }),
  (() => { try { return JSON.stringify(err); } catch { return ''; } })(),
  String((err as any)?.stack),
  String((err as any)?.message),
  Object.getOwnPropertyNames(err as object).join(','),
].join('\n');

describe('UserNotificationClient: the request', () => {
  it('POSTs the payload, untouched, to /api/users/internal/notifications with the internal token header and nothing else', async () => {
    const calls = recordPost();
    const p = payload();
    const result = await UserNotificationClient.send(p);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `http://user-service.test:3002${NOTIFICATIONS_PATH}`);
    assert.equal(NOTIFICATIONS_PATH, '/api/users/internal/notifications');
    assert.equal(calls[0].body, p, 'the very same object is sent');
    assert.deepEqual(p, payload(), 'and it is not modified');
    assert.deepEqual(calls[0].config, { headers: { 'x-internal-service-token': TOKEN } }, 'only the token header, no timeout, no idempotency key');
    assert.equal(INTERNAL_TOKEN_HEADER, 'x-internal-service-token');
    assert.deepEqual(result, { status: 201 });
  });

  it('passes the caller\'s timeout through - and sets none when the caller has none', async () => {
    const calls = recordPost();
    await UserNotificationClient.send(payload());
    await UserNotificationClient.send(payload(), { timeoutMs: 5000 });
    await UserNotificationClient.send(payload(), {});
    assert.equal('timeout' in calls[0].config, false);
    assert.equal(calls[1].config.timeout, 5000);
    assert.equal('timeout' in calls[2].config, false);
  });

  it('reads the token and the URL from the environment at every call (nothing is cached or defaulted)', async () => {
    const calls = recordPost();
    await UserNotificationClient.send(payload());
    const second = useRandomInternalToken();
    process.env.USER_SERVICE_URL = 'https://users.internal.test:8443/';
    await UserNotificationClient.send(payload());
    assert.equal(calls[0].config.headers[INTERNAL_TOKEN_HEADER], TOKEN);
    assert.equal(calls[1].config.headers[INTERNAL_TOKEN_HEADER], second);
    assert.notEqual(TOKEN, second);
    assert.equal(calls[1].url, `https://users.internal.test:8443${NOTIFICATIONS_PATH}`, 'trailing slashes do not produce //api');
  });

  it('falls back to the development URL when USER_SERVICE_URL is not set (the same default every caller had) - but never invents a token', async () => {
    delete process.env.USER_SERVICE_URL;
    const calls = recordPost();
    await UserNotificationClient.send(payload());
    assert.equal(calls[0].url, `http://localhost:3002${NOTIFICATIONS_PATH}`);
    delete process.env.INTERNAL_SERVICE_TOKEN;
    await assert.rejects(UserNotificationClient.send(payload()), (e: any) => e instanceof UserNotificationError && e.failure === 'CONFIG');
    assert.equal(calls.length, 1, 'no second request');
  });

  it('adds no idempotency key of any kind (that is FIX 06C-4B2B)', async () => {
    const calls = recordPost();
    await UserNotificationClient.send(payload());
    const wire = JSON.stringify(calls[0]);
    assert.ok(!/idempot/i.test(wire));
  });
});

describe('UserNotificationClient: configuration problems send NOTHING', () => {
  const badTokens: Array<[string, string | undefined]> = [
    ['unset', undefined],
    ['empty', ''],
    ['spaces only', '   '],
    ['leading space', ' abc123'],
    ['trailing space', 'abc123 '],
    ['a newline (header injection)', 'abc\r\nx-evil: 1'],
    ['a tab', 'abc\tdef'],
    ['non-ASCII', 'bí-mật-123'],
  ];
  for (const [label, value] of badTokens) {
    it(`token ${label}: rejects with a CONFIG error and makes no request`, async () => {
      if (value === undefined) delete process.env.INTERNAL_SERVICE_TOKEN; else process.env.INTERNAL_SERVICE_TOKEN = value;
      const calls = recordPost();
      await assert.rejects(UserNotificationClient.send(payload()), (e: any) => {
        assert.ok(e instanceof UserNotificationError);
        assert.equal(e.failure, 'CONFIG');
        assert.equal(e.status, undefined);
        assert.match(e.message, /INTERNAL_SERVICE_TOKEN/);
        assert.match(e.message, /was not sent/);
        if (value) assert.ok(!e.message.includes(value.trim() || '\u0000'), 'the value is not echoed');
        return true;
      });
      assert.equal(calls.length, 0);
    });
  }

  for (const url of ['not a url', 'ftp://users.test/', 'javascript:alert(1)', 'file:///etc/passwd', '//users.test']) {
    it(`USER_SERVICE_URL ${JSON.stringify(url)}: rejects with a CONFIG error and makes no request`, async () => {
      process.env.USER_SERVICE_URL = url;
      const calls = recordPost();
      await assert.rejects(UserNotificationClient.send(payload()), (e: any) => e instanceof UserNotificationError && e.failure === 'CONFIG' && /USER_SERVICE_URL/.test(e.message));
      assert.equal(calls.length, 0);
    });
  }

  it('an unusable URL with credentials in it is not echoed into the error', async () => {
    process.env.USER_SERVICE_URL = 'http://admin:hunter2@';
    await assert.rejects(UserNotificationClient.send(payload()), (e: any) => !everywhere(e).includes('hunter2'));
  });
});

describe('UserNotificationClient: failures are surfaced and never carry the token', () => {
  const cases: Array<[string, Record<string, unknown>, string, number | undefined]> = [
    ['HTTP 500', { response: { status: 500 } }, 'HTTP', 500],
    ['HTTP 404', { response: { status: 404 } }, 'HTTP', 404],
    ['HTTP 401', { response: { status: 401 } }, 'HTTP', 401],
    ['HTTP 403', { response: { status: 403 } }, 'HTTP', 403],
    ['timeout (ECONNABORTED)', { code: 'ECONNABORTED' }, 'TIMEOUT', undefined],
    ['timeout (ETIMEDOUT)', { code: 'ETIMEDOUT' }, 'TIMEOUT', undefined],
    ['connection refused', { code: 'ECONNREFUSED' }, 'NETWORK', undefined],
    ['DNS failure', { code: 'ENOTFOUND' }, 'NETWORK', undefined],
  ];
  for (const [label, over, failure, status] of cases) {
    it(`${label}: rejects (never swallows) with a sanitized UserNotificationError`, async () => {
      const text = status ? `Request failed with status code ${status}` : over.code === 'ECONNABORTED' || over.code === 'ETIMEDOUT' ? 'timeout of 5000ms exceeded' : `connect ${over.code} 127.0.0.1:3002`;
      recordPost(() => { throw axiosLikeError(text, over); });
      await assert.rejects(UserNotificationClient.send(payload(), { timeoutMs: 5000 }), (e: any) => {
        assert.ok(e instanceof UserNotificationError);
        assert.equal(e.name, 'UserNotificationError');
        assert.equal(e.failure, failure);
        assert.equal(e.status, status);
        assert.equal(e.response?.status, status, 'callers that read err.response.status keep working');
        assert.ok(e.message.startsWith(text), 'the original message is kept (it is what callers record and log)');
        for (const own of ['config', 'request', 'cause', 'headers']) assert.equal(own in e, false, `no ${own} on the error`);
        assert.ok(!everywhere(e).includes(TOKEN), 'the secret is nowhere in the error');
        assert.ok(!everywhere(e).includes(TOKEN.slice(0, 10)), 'nor any part of it');
        return true;
      });
    });
  }

  it('an authentication refusal (401 / 403) says so, without saying more', async () => {
    for (const status of [401, 403]) {
      recordPost(() => { throw axiosLikeError(`Request failed with status code ${status}`, { response: { status } }); });
      await assert.rejects(UserNotificationClient.send(payload()), /rejected the internal service token/);
      mock.restoreAll();
    }
    recordPost(() => { throw axiosLikeError('Request failed with status code 500', { response: { status: 500 } }); });
    await assert.rejects(UserNotificationClient.send(payload()), (e: any) => !/rejected the internal service token/.test(e.message));
  });

  it('a library that echoes the secret into its message gets it redacted', async () => {
    recordPost(() => { throw axiosLikeError(`socket hang up while sending header ${INTERNAL_TOKEN_HEADER}: ${TOKEN}`); });
    await assert.rejects(UserNotificationClient.send(payload()), (e: any) => {
      assert.ok(!everywhere(e).includes(TOKEN));
      assert.match(e.message, /\[redacted\]/);
      return true;
    });
  });

  it('a non-Error rejection is still turned into a UserNotificationError', async () => {
    recordPost(() => { throw 'boom'; });
    await assert.rejects(UserNotificationClient.send(payload()), (e: any) => e instanceof UserNotificationError && e.message === 'boom');
  });
});

// every test here talks to a real socket: a bounded time each, so a broken client fails instead of hanging the run
describe('UserNotificationClient: real axios against a loopback server', { timeout: 15_000 }, () => {
  let server: http.Server;
  let base = '';
  let answer: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void = () => undefined;
  const seen: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders; body: any }> = [];

  const startServer = async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: any = null;
        try { body = JSON.parse(raw); } catch { /* not JSON */ }
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        answer(req, res, raw);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.USER_SERVICE_URL = base;
  };
  const stopServer = async () => { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); };

  beforeEach(async () => { seen.length = 0; await startServer(); });
  afterEach(async () => { await stopServer(); });

  it('what goes on the wire: POST, JSON body, exactly the internal token header, the real payload', async () => {
    answer = (_req, res) => { res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"message":"ok"}'); };
    const result = await UserNotificationClient.send(payload(), { timeoutMs: 2000 });
    assert.deepEqual(result, { status: 201 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, NOTIFICATIONS_PATH);
    assert.equal(seen[0].headers[INTERNAL_TOKEN_HEADER], TOKEN);
    assert.equal(seen[0].headers['x-idempotency-key'], undefined);
    assert.match(String(seen[0].headers['content-type']), /application\/json/);
    assert.deepEqual(seen[0].body, payload());
  });

  it('a 403 from the server: a plain axios error DOES carry the secret - the client\'s error does not', async () => {
    answer = (_req, res) => { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"Forbidden: Invalid internal service token"}'); };

    const raw = await axios.post(`${base}${NOTIFICATIONS_PATH}`, payload(), { headers: { [INTERNAL_TOKEN_HEADER]: TOKEN } }).catch((e: any) => e);
    assert.ok(util.inspect(raw, { depth: 6 }).includes(TOKEN), 'precondition: a raw axios error leaks the request headers - which is why the client replaces it');

    await assert.rejects(UserNotificationClient.send(payload()), (e: any) => {
      assert.ok(e instanceof UserNotificationError);
      assert.equal(e.failure, 'HTTP');
      assert.equal(e.status, 403);
      assert.match(e.message, /Request failed with status code 403/);
      assert.match(e.message, /rejected the internal service token/);
      assert.ok(!everywhere(e).includes(TOKEN));
      return true;
    });
  });

  it('a 500 from the server is rejected with the status, and nothing else about the request', async () => {
    answer = (_req, res) => { res.writeHead(500); res.end('boom'); };
    await assert.rejects(UserNotificationClient.send(payload()), (e: any) => {
      assert.equal(e.failure, 'HTTP');
      assert.equal(e.status, 500);
      assert.ok(!everywhere(e).includes(TOKEN));
      return true;
    });
  });

  it('a server that never answers: the caller\'s timeout fires and is reported as a TIMEOUT', async () => {
    answer = () => undefined; // never respond
    await assert.rejects(UserNotificationClient.send(payload(), { timeoutMs: 150 }), (e: any) => {
      assert.equal(e.failure, 'TIMEOUT');
      assert.match(e.message, /timeout of 150ms exceeded/);
      assert.ok(!everywhere(e).includes(TOKEN));
      return true;
    });
  });

  it('nothing listening: a NETWORK failure', async () => {
    const port = (server.address() as AddressInfo).port;
    await stopServer();
    process.env.USER_SERVICE_URL = `http://127.0.0.1:${port}`;
    await assert.rejects(UserNotificationClient.send(payload(), { timeoutMs: 1000 }), (e: any) => {
      assert.equal(e.failure, 'NETWORK');
      assert.ok(!everywhere(e).includes(TOKEN));
      return true;
    });
    await startServer(); // so afterEach can stop it
  });
});
