/**
 * FIX 07B-2A (AUTH-OP-05) - inventory of the Order <-> Payment relation, so that a later change cannot quietly bring the shared
 * INTERNAL_SERVICE_TOKEN back or add a caller without the dedicated credential.
 *
 * It reads the SOURCE of every service in the repository (comments stripped) and pins:
 *   - who calls /api/payments/internal/* and /api/orders/webhook/payment (exact files and endpoints - a new caller fails this test);
 *   - that each of those callers takes its credential from ORDER_PAYMENT_TOKEN through the shared helper, sends it in the
 *     X-Internal-Service-Token header and has no INTERNAL_SERVICE_TOKEN code path left;
 *   - that both receiving apps protect exactly those routes with requireServiceToken('ORDER_PAYMENT_TOKEN').
 *
 * Run: node -r ts-node/register/transpile-only --test test/order-payment-inventory.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SERVICES = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(SERVICES, '..');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', 'dist', 'test', 'tests', 'prisma'].includes(e.name) ? [] : walk(p);
    return /\.(ts|tsx|js|mjs|py)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
};
const rel = (p: string) => path.relative(REPO, p).split(path.sep).join('/');
const ENDPOINT = /\/api\/payments\/internal\/[a-z-]+|\/api\/orders\/webhook\/payment/g;

const sources = [...fs.readdirSync(SERVICES).flatMap((s) => walk(path.join(SERVICES, s, 'src'))), ...walk(path.join(REPO, 'frontend', 'src'))]
  .map((file) => ({ file: rel(file), code: stripComments(fs.readFileSync(file, 'utf8')) }));

const ROUTE_FILES = ['services/order-service/src/app.ts', 'services/payment-service/src/app.ts'];
const EXPECTED_CALLERS: Record<string, string[]> = {
  'services/order-service/src/services/payment.client.ts': [
    '/api/payments/internal/cancel-payos', '/api/payments/internal/confirm', '/api/payments/internal/create-intent', '/api/payments/internal/create-payos',
    '/api/payments/internal/create-refund', '/api/payments/internal/payment-evidence', '/api/payments/internal/payment-status',   // payment-evidence: ADMIN-DASHBOARD-01 (sales statistics)
  ],
  'services/payment-service/src/jobs/order-sync.job.ts': ['/api/orders/webhook/payment'],
  'services/payment-service/src/services/payment.service.ts': ['/api/orders/webhook/payment'],
};

describe('FIX 07B-2A AUTH-OP-05: Order <-> Payment routes and callers inventory', () => {
  it('the source tree was found (sanity)', () => {
    assert.ok(sources.length > 50);
    assert.ok(sources.some((s) => s.file === 'services/learning-service/src/app.ts'));
    assert.ok(sources.some((s) => s.file.startsWith('frontend/src/')));
  });

  it('exactly these files call the Order <-> Payment endpoints - no other service, job or the frontend does', () => {
    const found: Record<string, string[]> = {};
    for (const { file, code } of sources) {
      if (ROUTE_FILES.includes(file)) continue;
      const hits = Array.from(new Set(code.match(ENDPOINT) || [])).sort();
      if (hits.length) found[file] = hits;
    }
    assert.deepEqual(found, EXPECTED_CALLERS);
  });

  it('every caller takes ORDER_PAYMENT_TOKEN through the shared helper, sends it as X-Internal-Service-Token, and has no shared-token code path', () => {
    for (const file of Object.keys(EXPECTED_CALLERS)) {
      const code = sources.find((s) => s.file === file)!.code;
      assert.ok(!/INTERNAL_SERVICE_TOKEN/.test(code), `${file} still reads INTERNAL_SERVICE_TOKEN`);
      assert.ok(!/PAYMENT_USER_TOKEN/.test(code) || file.endsWith('payment.service.ts'), `${file} uses the Payment -> User token`);
      assert.ok(/(readServiceToken|checkServiceToken)\('ORDER_PAYMENT_TOKEN'/.test(code), `${file} does not read ORDER_PAYMENT_TOKEN through the helper`);
      assert.ok(/\[SERVICE_TOKEN_HEADER\]: token\.value/.test(code), `${file} does not send the token in the standard header`);
      assert.ok(!/['"]X-Internal-Service-Token['"]/i.test(code), `${file} builds the header by hand`);
      assert.ok(!/process\.env\.ORDER_PAYMENT_TOKEN\s*\|\|/.test(code), `${file} has a fallback`);
    }
    // the order-service client: all seven calls (the six of 07B-2A.1 + payment-evidence, ADMIN-DASHBOARD-01) go through the one header builder that refuses to send without a usable token
    const client = sources.find((s) => s.file === 'services/order-service/src/services/payment.client.ts')!.code;
    assert.equal((client.match(/this\.getInternalHeaders\(\)/g) || []).length, 7);
    assert.ok(!/axios\.(get|post)\(`\$\{this\.baseUrl\}\/api\/payments\/(?!internal\/)/.test(client), 'no call to a user (JWT) payment route is left');
    // payment-service: the PAYMENT_USER_TOKEN of payment.service.ts belongs to notifyUserService only
    const svc = sources.find((s) => s.file === 'services/payment-service/src/services/payment.service.ts')!.code;
    const notifyOrder = svc.slice(svc.indexOf('private static async notifyOrderService'), svc.indexOf('private static async notifyUserService'));
    assert.ok(/readServiceToken\('ORDER_PAYMENT_TOKEN'\)/.test(notifyOrder) && !/PAYMENT_USER_TOKEN/.test(notifyOrder));
  });

  it('the receiving routes are declared with requireServiceToken(\'ORDER_PAYMENT_TOKEN\') and nothing else uses that credential', () => {
    const orderApp = sources.find((s) => s.file === 'services/order-service/src/app.ts')!.code;
    assert.match(orderApp, /'\/api\/orders\/webhook\/payment',\s*requireServiceToken\('ORDER_PAYMENT_TOKEN'\),/);
    const paymentApp = sources.find((s) => s.file === 'services/payment-service/src/app.ts')!.code;
    assert.match(paymentApp, /const orderPaymentAuth = requireServiceToken\('ORDER_PAYMENT_TOKEN'\);/);
    for (const route of EXPECTED_CALLERS['services/order-service/src/services/payment.client.ts']) {
      assert.match(paymentApp, new RegExp(`'${route.replace(/\//g, '\\/')}(\\/:[A-Za-z]+)?',\\s*orderPaymentAuth,`), route);
    }
    const users = sources.filter((s) => /ORDER_PAYMENT_TOKEN/.test(s.code)).map((s) => s.file).sort();
    assert.deepEqual(users, [
      'services/order-service/src/app.ts',
      'services/order-service/src/services/payment.client.ts',
      'services/order-service/src/utils/startup-config.ts',
      'services/payment-service/src/app.ts',
      'services/payment-service/src/jobs/order-sync.job.ts',
      'services/payment-service/src/services/payment.service.ts',
      'services/payment-service/src/utils/startup-config.ts',
    ], 'ORDER_PAYMENT_TOKEN is used only by the Order <-> Payment relation');
  });

  it('configuration: compose passes ORDER_PAYMENT_TOKEN through to exactly these two services, without a default; the examples carry no value', () => {
    const compose = fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8');
    const lines = compose.split(/\r?\n/);
    const owners: string[] = [];
    let service = '';
    for (const line of lines) {
      const m = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
      if (m) service = m[1];
      if (/ORDER_PAYMENT_TOKEN/.test(line) && !line.trim().startsWith('#')) {
        owners.push(service);
        assert.equal(line.trim(), 'ORDER_PAYMENT_TOKEN: "${ORDER_PAYMENT_TOKEN}"', 'passthrough only, no default');
      }
    }
    assert.deepEqual(owners.sort(), ['order-service', 'payment-service']);
    for (const s of ['order-service', 'payment-service']) {
      const example = fs.readFileSync(path.join(SERVICES, s, '.env.example'), 'utf8');
      assert.match(example, /^ORDER_PAYMENT_TOKEN=\r?$/m, `${s}/.env.example has the name only`);
    }
  });
});
