/**
 * FIX 07B-1.3 - UI layer: what the payment forms do with each real answer (tests/fixtures/payment-confirmation-contract.json).
 * The forms delegate to src/components/payment/payment-flow.ts, called here with the real services over a recording axios adapter;
 * the components are rendered with react-dom/server (the project has no DOM test environment and none is added).
 *
 * Run: node tests/run-unit-tests.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { AxiosError } from 'axios';

(globalThis as any).localStorage = { getItem: () => 'test-access-token', setItem: () => undefined, removeItem: () => undefined };

import { orderApi, paymentApi } from '../src/services/api';
import { syncCardPayment, runDemoPayment, confirmInstructorPayment } from '../src/components/payment/payment-flow';
import { PaymentPendingNotice } from '../src/components/payment/PaymentPendingNotice';
import { StripePaymentForm, alreadyChargedIntent } from '../src/components/payment/StripePaymentForm';
import { CONFIRMATION_MESSAGES } from '../src/services/payment-confirmation';

const root = process.cwd();
const contract = JSON.parse(readFileSync(path.join(root, 'tests', 'fixtures', 'payment-confirmation-contract.json'), 'utf8'));

let next: { http: number; body: unknown } | 'network' = { http: 200, body: {} };
const urls: string[] = [];
const bodies: unknown[] = [];
const adapter = async (config: any) => {
  urls.push(`${config.method} ${config.url}`);
  bodies.push(config.data ? JSON.parse(config.data) : undefined);
  if (next === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config);
  const response = { data: next.body, status: next.http, statusText: '', headers: {}, config };
  if (next.http >= 300) throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, response as any);
  return response;
};
orderApi.defaults.adapter = adapter as any;
paymentApi.defaults.adapter = adapter as any;

const recorder = () => {
  const seen: Array<[string, string]> = [];
  return { seen, callbacks: { onSuccess: (id: string) => seen.push(['success', id]), onPending: (m: string) => seen.push(['pending', m]), onError: (m: string) => seen.push(['error', m]) } };
};

describe('FIX 07B-1.3 payment forms - what the user is shown for each answer', () => {
  beforeEach(() => { urls.length = 0; bodies.length = 0; });

  // PAY-FIX-01: the card sync confirms the charged Stripe intent itself (POST /api/payments/confirm), so the answers are that route's
  it('Stripe card form (order payment): SUCCEEDED -> success screen; PENDING -> processing notice; FAILED -> failure', async () => {
    const cases: Array<[string, [string, string]]> = [
      ['succeeded', ['success', 'd4d4d4d4d4d4d4d4d4d4d4d4']],   // the confirmed payment's id (Checkout's onSuccess ignores it)
      ['pending', ['pending', CONFIRMATION_MESSAGES.PENDING]],
      ['failed', ['error', CONFIRMATION_MESSAGES.FAILED]],
    ];
    for (const [key, expected] of cases) {
      next = contract.confirm[key];
      const r = recorder();
      await syncCardPayment('o1', 'pm_1', 'pi_client_ok', r.callbacks);
      assert.deepEqual(r.seen, [expected], key);
    }
  });

  it('Stripe card form: 403 (not the owner), 500, network error after Stripe.js accepted the card -> never the success screen', async () => {
    for (const [answer, kind] of [[contract.confirm.notOwner, 'error'], [contract.confirm.providerMismatch, 'error'], [contract.confirm.providerError, 'pending'], ['network', 'pending']] as const) {
      next = answer as any;
      const r = recorder();
      await syncCardPayment('o1', 'pm_1', 'pi_client_ok', r.callbacks);
      assert.equal(r.seen.length, 1);
      assert.equal(r.seen[0][0], kind, JSON.stringify(answer));
      assert.notEqual(r.seen[0][0], 'success');
    }
  });

  it('Stripe card form: an answer without a verifiable status (old top-level `success`, missing payment) -> "not verified", not success', async () => {
    for (const body of [{ success: true, payment: { status: 'SUCCEEDED' } }, { message: 'Payment confirmed successfully', data: { id: 'd4d4d4d4d4d4d4d4d4d4d4d4' } }]) {
      next = { http: 200, body };
      const r = recorder();
      await syncCardPayment('o1', 'pm_1', 'pi_client_ok', r.callbacks);
      assert.deepEqual(r.seen, [['pending', CONFIRMATION_MESSAGES.UNVERIFIED]], JSON.stringify(body));
    }
  });

  it('demo forms (Stripe sandbox + payOS "simulate"): success only for a SUCCEEDED demo answer; disabled demo (404) is an error', async () => {
    next = contract.mockComplete.succeeded;
    let r = recorder();
    await runDemoPayment('o1', r.callbacks);
    assert.deepEqual(r.seen, [['success', 'd4d4d4d4d4d4d4d4d4d4d4d4']]);
    next = contract.mockComplete.disabled;
    r = recorder();
    await runDemoPayment('o1', r.callbacks);
    assert.equal(r.seen[0][0], 'error');
    next = { http: 200, body: { success: true } };               // a 2xx without a payment status is not a purchase
    r = recorder();
    await runDemoPayment('o1', r.callbacks);
    assert.equal(r.seen[0][0], 'pending');
  });

  it('payOS: its success arrives as a payOS demo answer or through the order (webhook) - the different envelope is read correctly, not as an error', async () => {
    next = contract.mockComplete.alreadyCompleted;
    const r = recorder();
    await runDemoPayment('o1', r.callbacks);
    assert.deepEqual(r.seen.map((s) => s[0]), ['success']);
  });

  it('instructor card form (POST /api/payments/confirm): SUCCEEDED -> success; PENDING / CANCELLED / provider mismatch / not owner / 500 -> not success', async () => {
    const cases: Array<[any, string]> = [
      [contract.confirm.succeeded, 'success'], [contract.confirm.pending, 'pending'], [contract.confirm.failed, 'error'], [contract.confirm.cancelled, 'error'],
      [contract.confirm.providerMismatch, 'error'], [contract.confirm.notOwner, 'error'], [contract.confirm.mockBlocked, 'error'], [contract.confirm.providerError, 'pending'],
    ];
    for (const [answer, kind] of cases) {
      next = answer;
      const r = recorder();
      await confirmInstructorPayment('pi_i', 'pm_i', r.callbacks);
      assert.deepEqual(r.seen.map((s) => s[0]), [kind], JSON.stringify(answer.body));
    }
  });

  it('retrying (same answer three times) asks the same endpoint each time and creates nothing else on the client side', async () => {
    next = contract.confirm.succeeded;
    for (let i = 0; i < 3; i++) await syncCardPayment('o1', 'pm_1', 'pi_client_ok', recorder().callbacks);
    assert.deepEqual(urls, Array(3).fill('post /api/payments/confirm'), 'no payment / order creation, no order status write');
  });

  it('PAY-FIX-01: the card sync names the Stripe intent Stripe.js charged - never the order current payment (payOS after the QR tab)', async () => {
    next = contract.confirm.succeeded;
    await syncCardPayment('o1', 'pm_1', 'pi_charged_by_stripe_js', recorder().callbacks);
    assert.deepEqual(urls, ['post /api/payments/confirm'], 'not POST /api/orders/o1/payment, which confirms order.paymentId');
    assert.deepEqual(bodies, [{ paymentIntentId: 'pi_charged_by_stripe_js', paymentMethodId: 'pm_1' }]);
  });

  it('PAY-FIX-01: an intent Stripe already charged (earlier sync failed) is recovered; any other Stripe.js error is not', () => {
    const charged = { id: 'pi_old', status: 'succeeded', payment_method: 'pm_old' } as any;
    assert.equal(alreadyChargedIntent({ type: 'invalid_request_error', code: 'payment_intent_unexpected_state', payment_intent: charged } as any), charged);
    for (const error of [
      undefined,
      { type: 'invalid_request_error', code: 'payment_intent_unexpected_state', payment_intent: { ...charged, status: 'requires_payment_method' } },
      { type: 'invalid_request_error', code: 'payment_intent_unexpected_state' },
      { type: 'card_error', code: 'card_declined', payment_intent: charged },
    ]) {
      assert.equal(alreadyChargedIntent(error as any), null, JSON.stringify(error));
    }
  });

  it('the pending notice never claims success and is announced as a status', () => {
    const html = renderToStaticMarkup(<PaymentPendingNotice message={CONFIRMATION_MESSAGES.UNVERIFIED} />);
    assert.match(html, /role="status"/);
    assert.match(html, /Đang chờ xác nhận thanh toán/);
    assert.ok(html.includes(CONFIRMATION_MESSAGES.UNVERIFIED));
    assert.ok(!/thành công/i.test(html));
  });

  it('the Stripe form still renders (sandbox form when no publishable key is configured)', () => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(
      <StripePaymentForm orderId="o1" orderNumber="ORD-1" amount={199000} clientSecret="pi_mock_secret" stripePaymentIntentId="pi_mock" onSuccess={noop} onPending={noop} onError={noop} />
    );
    assert.match(html, /Demo Sandbox/);
    assert.match(html, /type="submit"/);
  });

  it('guard: the payment forms never call onSuccess themselves - only deliverConfirmationResult may (no "success after error" fallback)', () => {
    for (const file of ['src/components/payment/StripePaymentForm.tsx', 'src/components/payment/InstructorPaymentForm.tsx', 'src/components/payment/payment-flow.ts']) {
      const src = readFileSync(path.join(root, file), 'utf8');
      assert.ok(!/onSuccess\s*\(/.test(src), `${file} calls onSuccess directly`);
      assert.ok(!/\.success\b/.test(src), `${file} reads a raw .success flag`);
    }
    const checkout = readFileSync(path.join(root, 'src/pages/Checkout.tsx'), 'utf8');
    assert.ok(!/simulateMockPayment\s*\(/.test(checkout), 'Checkout goes through runDemoPayment');
  });
});
