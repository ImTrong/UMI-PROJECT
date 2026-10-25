/**
 * RAG-SEC-LOG-01 — no JWT, refresh token, API key or credential reaches a log line, while the facts needed to investigate
 * an error stay: service, method, path without query string, HTTP status, error code, sanitized message.
 * Every secret is random and fake (JWT-shaped / key-shaped); the auth-service is a loopback stub; nothing real is called.
 * The output checked is what the winston transports receive (the logger's own formats applied).
 *
 * Run: npm test
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import axios from 'axios';

const b64 = (n: number) => randomBytes(n).toString('base64url');
const JWT = `eyJ${b64(12)}.eyJ${b64(30)}.${b64(32)}`;
const REFRESH = `eyJ${b64(12)}.eyJ${b64(20)}.${b64(32)}`;
const OPAQUE_TOKEN = `opaque-${b64(24)}`;
const SERVICE_TOKEN = b64(32);
const GOOGLE_KEY = `AIza${b64(27).slice(0, 35)}`;
const SECRETS = [JWT, REFRESH, OPAQUE_TOKEN, SERVICE_TOKEN, GOOGLE_KEY];

// eslint-disable-next-line @typescript-eslint/no-var-requires
const winston = require('winston');
const logger = require('../src/utils/logger').default;
const lines: string[] = [];
logger.transports.forEach((t: any) => { t.silent = true; }); // no file written by the test
logger.add(new winston.transports.Stream({ stream: new Writable({ write: (c, _e, cb) => { lines.push(String(c)); cb(); } }) }));

const SERVICE = require('../package.json').name as string;
const output = () => lines.join('\n');
const assertNoSecret = () => { const all = output(); for (const s of SECRETS) assert.ok(!all.includes(s), `secret leaked: ${s.slice(0, 6)}...`); };
const flush = () => new Promise((r) => setTimeout(r, 30));

/** a real axios error: request to a closed port, carrying every kind of credential */
async function axiosError(): Promise<any> {
  try {
    await axios.post(`http://127.0.0.1:9/api/auth/verify-token?token=${JWT}&refresh_token=${REFRESH}&page=2`, { token: OPAQUE_TOKEN, refreshToken: REFRESH }, {
      headers: { Authorization: `Bearer ${JWT}`, 'X-Internal-Service-Token': SERVICE_TOKEN, Cookie: `session=${OPAQUE_TOKEN}` },
      timeout: 1000,
    });
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

describe(`RAG-SEC-LOG-01 ${SERVICE}: secrets never logged`, () => {
  beforeEach(() => { lines.length = 0; });

  it('a raw axios error passed to the logger keeps service / method / path / code, without any credential or query string', async () => {
    const error = await axiosError();
    logger.error('Upstream call failed:', error);
    logger.warn('as meta', { error, headers: { authorization: `Bearer ${JWT}` } });
    await flush();
    assertNoSecret();
    const all = output();
    assert.match(all, new RegExp(`"service":"${SERVICE}"`));
    assert.match(all, /"method":"POST"/);
    assert.match(all, /"url":"http:\/\/127\.0\.0\.1:9\/api\/auth\/verify-token"/, 'path kept, query string dropped');
    assert.match(all, /ECONNREFUSED/, 'error code / message kept');
    assert.doesNotMatch(all, /page=2|refresh_token=|"headers"\s*:\s*\{[^}]*Bearer/i);
  });

  it('tokens, keys and secret query parameters inside messages, stacks and nested objects are masked', async () => {
    logger.info(`download /api/courses/files/download?bucket=courses&key=a.pdf&token=${OPAQUE_TOKEN} by Bearer ${JWT}`);
    logger.error(new Error(`refresh failed for ${REFRESH} with key ${GOOGLE_KEY}`));
    logger.debug('body', { body: JSON.stringify({ token: OPAQUE_TOKEN, password: 'p' }), nested: { deeper: { 'x-internal-service-token': SERVICE_TOKEN, apiKey: GOOGLE_KEY } } });
    await flush();
    assertNoSecret();
    assert.match(output(), /key=a\.pdf&token=\[REDACTED\]/, 'the non-secret storage key stays readable');
    assert.match(output(), /\[REDACTED\]/);
  });

  describe('authentication middleware', () => {
    let stub: http.Server;
    let status = 401;
    before(async () => {
      stub = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ valid: false, error: 'Token has expired' })); }); });
      await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
      process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    });
    after(async () => { await new Promise((r) => stub.close(r)); });

    const run = async () => {
      const { authenticateToken } = require('../src/middleware/auth.middleware');
      const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
      let nextCalled = false;
      await authenticateToken({ headers: { authorization: `Bearer ${JWT}` }, cookies: {}, query: {} } as any, res, () => { nextCalled = true; });
      await flush();
      return { res, nextCalled };
    };

    it('a refused token (401 from the auth-service) is logged as such - no token, no axios config', async () => {
      status = 401;
      const { res, nextCalled } = await run();
      assert.equal(res.statusCode, 401);
      assert.equal(nextCalled, false, 'authentication behaviour unchanged');
      assertNoSecret();
      assert.match(output(), /Authentication refused by auth-service \(HTTP 401\)/);
      assert.doesNotMatch(output(), /"config"|adapter|transformRequest/);
    });

    it('an auth-service failure (500) keeps method, path and status for diagnosis - no token', async () => {
      status = 500;
      const { res } = await run();
      assert.equal(res.statusCode, 401);
      assertNoSecret();
      assert.match(output(), /Authentication error: POST http:\/\/127\.0\.0\.1:\d+\/api\/auth\/verify-token HTTP 500/);
    });
  });
});
