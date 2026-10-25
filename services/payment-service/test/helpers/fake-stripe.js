/**
 * A local stand-in for the part of the Stripe API the refund core uses (FIX 07B-2A.2 tests) - POST /v1/refunds, GET /v1/refunds/:id -
 * with Stripe's idempotency rules: the same Idempotency-Key with the same parameters replays the stored answer, with other
 * parameters is an idempotency error, and while the first request is still running is a 409. The REAL stripe-node client talks to
 * it (the workers point the SDK at 127.0.0.1); nothing leaves this machine and no real money or account is involved.
 *
 * Per idempotency key the test decides what happens to each attempt (`script(key, [...])`) or the default (`setDefault(mode)`):
 *   succeed | pending | fail-status   create the refund (stored for replays) with status succeeded | pending | failed
 *   decline                           400 invalid_request_error (stored for replays: Stripe rejected it, nothing refunded)
 *   error500                          500 api_error, not stored, stripe-should-retry: false (the SDK does not retry)
 *   reset                             connection reset, nothing processed (the SDK retries)
 *   process-reset                     the refund IS created and stored, then the connection is reset
 *   hang                              no answer at all (the client times out), nothing processed
 *   process-hang                      the refund IS created and stored, but no answer
 *   hold                              the request waits until `release(key, mode)` - a deterministic barrier
 */
const http = require('http');
const querystring = require('querystring');

function createFakeStripe() {
  const refunds = [];                 // every refund object Stripe "created" - the money that moved
  const keys = new Map();             // key -> { sig, state: 'running' | 'done', stored: { status, body } | null }
  const scripts = new Map();          // key -> modes for the next attempts
  const held = new Map();             // key -> { decide(mode) }
  const sticky = new Map();           // key -> mode applied to EVERY attempt (incl. replays) until cleared
  const log = [];                     // { method, path, key, params }
  let defaultMode = 'succeed';
  let seq = 0;

  const parseBody = (raw) => {
    const flat = querystring.parse(raw);
    const params = {};
    const metadata = {};
    for (const [k, v] of Object.entries(flat)) {
      const m = /^metadata\[(.+)\]$/.exec(k);
      if (m) metadata[m[1]] = String(v); else params[k] = String(v);
    }
    return { params, metadata, sig: Object.keys(flat).sort().map((k) => `${k}=${flat[k]}`).join('&') };
  };
  const send = (res, status, body, extraHeaders = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'request-id': `req_${++seq}`, ...extraHeaders });
    res.end(JSON.stringify(body));
  };
  const create = (params, metadata, status) => {
    const refund = {
      id: `re_fake_${(++seq).toString(36)}_${Math.random().toString(36).slice(2, 8)}`, object: 'refund', status,
      amount: Number(params.amount), currency: 'vnd', payment_intent: params.payment_intent, reason: params.reason || null, metadata,
      failure_reason: status === 'failed' ? 'expired_or_canceled_card' : null,
    };
    refunds.push(refund);
    return refund;
  };

  const perform = (mode, req, res, ctx) => {
    const { key, params, metadata } = ctx;
    const entry = keys.get(key);
    const store = (status, body) => { if (entry) { entry.state = 'done'; entry.stored = { status, body }; } };
    const forget = () => { if (key) keys.delete(key); };
    switch (mode) {
      case 'succeed': case 'pending': case 'fail-status': {
        const refund = create(params, metadata, mode === 'succeed' ? 'succeeded' : mode === 'pending' ? 'pending' : 'failed');
        store(200, refund);
        return send(res, 200, refund);
      }
      case 'decline': {
        const body = { error: { type: 'invalid_request_error', code: 'charge_already_refunded', message: 'Charge has already been refunded.' } };
        store(400, body);
        return send(res, 400, body);
      }
      case 'error500':
        forget();
        return send(res, 500, { error: { type: 'api_error', message: 'An unknown error occurred' } }, { 'stripe-should-retry': 'false' });
      case 'reset':
        forget();
        return req.socket.destroy();
      case 'process-reset': {
        const refund = create(params, metadata, 'succeeded');
        store(200, refund);
        return req.socket.destroy();
      }
      case 'replay':                      // answer with what was stored for this key (see processHeld)
        return send(res, entry.stored.status, entry.stored.body);
      case 'hang':
        forget();
        if (key) sticky.set(key, 'hang');   // every later attempt with this key stays unanswered too, until stick(key, null)
        return undefined;           // never answered
      case 'process-hang': {
        const refund = create(params, metadata, 'succeeded');
        store(200, refund);
        if (key) sticky.set(key, 'hang');   // the SDK's retries get no answer either, until stick(key, null)
        return undefined;
      }
      default:
        throw new Error(`fake-stripe: unknown mode ${mode}`);
    }
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const key = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']) : null;
      if (req.method === 'GET' && req.url.startsWith('/v1/refunds/')) {
        const id = decodeURIComponent(req.url.slice('/v1/refunds/'.length).split('?')[0]);
        log.push({ method: 'GET', path: req.url, key: null, params: null });
        const refund = refunds.find((r) => r.id === id);
        return refund ? send(res, 200, refund) : send(res, 404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: `No such refund: '${id}'` } });
      }
      if (req.method !== 'POST' || req.url.split('?')[0] !== '/v1/refunds') return send(res, 404, { error: { type: 'invalid_request_error', message: 'unknown path' } });
      const { params, metadata, sig } = parseBody(raw);
      log.push({ method: 'POST', path: '/v1/refunds', key, params: { ...params, metadata } });
      if (key && sticky.has(key)) {
        const mode = sticky.get(key);
        if (mode === 'hang') return undefined;
      }
      if (key) {
        const entry = keys.get(key);
        if (entry) {
          if (entry.sig !== sig) {
            return send(res, 400, { error: { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.' } });
          }
          if (entry.state === 'running') return send(res, 409, { error: { type: 'invalid_request_error', code: 'idempotency_key_in_use', message: 'Another request with this key is in progress' } }, { 'stripe-should-retry': 'false' });
          return send(res, entry.stored.status, entry.stored.body, { 'idempotent-replayed': 'true' });
        }
        keys.set(key, { sig, state: 'running', stored: null });
      }
      const queue = key ? scripts.get(key) : null;
      const mode = queue && queue.length ? queue.shift() : defaultMode;
      if (mode === 'hold') {
        held.set(key, { decide: (next) => { held.delete(key); perform(next, req, res, { key, params, metadata }); } });
        return undefined;
      }
      return perform(mode, req, res, { key, params, metadata });
    });
  });

  return {
    server,
    refunds,
    log,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
    setDefault: (mode) => { defaultMode = mode; },
    script: (key, modes) => { scripts.set(key, [...modes]); },
    stick: (key, mode) => { if (mode) sticky.set(key, mode); else sticky.delete(key); },
    isHeld: (key) => held.has(key),
    release: (key, mode) => { const h = held.get(key); if (!h) throw new Error(`fake-stripe: nothing held for ${key}`); h.decide(mode); },
    /** create the refund for a held / pending key as Stripe would, without answering the waiting client (the client is gone) */
    processWithoutAnswer: (key) => {
      const h = held.get(key);
      const entry = keys.get(key);
      const last = [...log].reverse().find((l) => l.key === key && l.method === 'POST');
      const refund = create({ amount: last.params.amount, payment_intent: last.params.payment_intent, reason: last.params.reason }, last.params.metadata, 'succeeded');
      if (entry) { entry.state = 'done'; entry.stored = { status: 200, body: refund }; }
      if (h) held.delete(key);
      return refund;
    },
    /** Stripe processes a held request NOW (refund created and stored) but the answer is sent only on release(key, 'replay') */
    processHeld: (key) => {
      const entry = keys.get(key);
      const last = [...log].reverse().find((l) => l.key === key && l.method === 'POST');
      const refund = create({ amount: last.params.amount, payment_intent: last.params.payment_intent, reason: last.params.reason }, last.params.metadata, 'succeeded');
      entry.state = 'done';
      entry.stored = { status: 200, body: refund };
      return refund;
    },
    setRefundStatus: (id, status) => { const r = refunds.find((x) => x.id === id); r.status = status; return r; },
    reset: () => { refunds.length = 0; keys.clear(); scripts.clear(); held.clear(); sticky.clear(); log.length = 0; defaultMode = 'succeed'; },
    postsFor: (key) => log.filter((l) => l.method === 'POST' && l.key === key),
  };
}

module.exports = { createFakeStripe };
