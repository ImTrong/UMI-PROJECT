/**
 * FIX 07B-1.3 - service layer: the three confirmation calls read the REAL answers (tests/fixtures/payment-confirmation-contract.json,
 * checked against the services by their own tests) through the shared reader, and only a SUCCEEDED payment is a success.
 * The HTTP layer is the project's own axios instances with a recording adapter - no network, no running service.
 *
 * Run: node tests/run-unit-tests.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AxiosError } from 'axios';

(globalThis as any).localStorage = { getItem: () => 'test-access-token', setItem: () => undefined, removeItem: () => undefined };

import { orderApi, paymentApi } from '../src/services/api';
import { orderService } from '../src/services/order.service';
import { paymentService } from '../src/services/payment.service';
import {
  classifyPaymentStatus,
  deliverConfirmationResult,
  orderPaymentState,
  readConfirmAnswer,
  readMockCompleteAnswer,
  readOrderPaymentAnswer,
  resultFromError,
  CONFIRMATION_MESSAGES,
} from '../src/services/payment-confirmation';

// the runner runs from the frontend folder (the bundle itself lives in node_modules/.cache)
const contract = JSON.parse(readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'payment-confirmation-contract.json'), 'utf8'));

type Answer = { http: number; body: unknown } | 'network' | 'timeout';
const calls: Array<{ method: string; url: string; data: any }> = [];
let next: Answer = { http: 200, body: {} };
const adapter = async (config: any) => {
  calls.push({ method: config.method, url: config.url, data: config.data ? JSON.parse(config.data) : undefined });
  if (next === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config);
  if (next === 'timeout') throw new AxiosError('timeout of 0ms exceeded', 'ECONNABORTED', config);
  const response = { data: next.body, status: next.http, statusText: String(next.http), headers: {}, config };
  if (next.http < 200 || next.http >= 300) throw new AxiosError(`Request failed with status code ${next.http}`, 'ERR_BAD_RESPONSE', config, null, response as any);
  return response;
};
orderApi.defaults.adapter = adapter as any;
paymentApi.defaults.adapter = adapter as any;
const answer = (a: Answer) => { next = a; };

describe('FIX 07B-1.3 payment confirmation contract - service layer', () => {
  beforeEach(() => { calls.length = 0; });

  it('status classification: only the exact upper-case SUCCEEDED is a success', () => {
    assert.equal(classifyPaymentStatus('SUCCEEDED'), 'SUCCEEDED');
    for (const s of ['PENDING', 'PROCESSING']) assert.equal(classifyPaymentStatus(s), 'PENDING');
    for (const s of ['FAILED', 'CANCELLED']) assert.equal(classifyPaymentStatus(s), 'FAILED');
    for (const s of ['succeeded', 'Succeeded', ' SUCCEEDED', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', '', undefined, null, true, 1, {}, ['SUCCEEDED']]) {
      assert.equal(classifyPaymentStatus(s), 'UNKNOWN', JSON.stringify(s));
    }
  });

  // ------------------------------------------------------------------------------------------- POST /api/payments/confirm (Stripe)
  it('confirm SUCCEEDED -> SUCCEEDED with the payment id', async () => {
    answer(contract.confirm.succeeded);
    const r = await paymentService.confirmPayment({ paymentIntentId: 'pi_x', paymentMethodId: 'pm_x' });
    assert.deepEqual([r.outcome, r.paymentId, r.paymentStatus, r.httpStatus], ['SUCCEEDED', 'd4d4d4d4d4d4d4d4d4d4d4d4', 'SUCCEEDED', 200]);
    assert.deepEqual(calls, [{ method: 'post', url: '/api/payments/confirm', data: { paymentIntentId: 'pi_x', paymentMethodId: 'pm_x' } }]);
  });

  it('confirm PENDING -> PENDING; FAILED / CANCELLED -> FAILED - although every one is HTTP 200 with the same "confirmed" message', async () => {
    for (const [key, outcome, message] of [['pending', 'PENDING', CONFIRMATION_MESSAGES.PENDING], ['failed', 'FAILED', CONFIRMATION_MESSAGES.FAILED], ['cancelled', 'FAILED', CONFIRMATION_MESSAGES.CANCELLED]]) {
      answer(contract.confirm[key]);
      const r = await paymentService.confirmPayment({ paymentIntentId: 'pi_x', paymentMethodId: 'pm_x' });
      assert.equal(r.httpStatus, 200);
      assert.equal(r.outcome, outcome, key);
      assert.equal(r.message, message, key);
    }
  });

  it('confirm refusals (provider mismatch 409, not the owner 404, demo blocked 403) -> REJECTED, never success', async () => {
    for (const [key, message] of [['providerMismatch', CONFIRMATION_MESSAGES.PROVIDER_MISMATCH], ['notOwner', CONFIRMATION_MESSAGES.NOT_FOUND], ['mockBlocked', CONFIRMATION_MESSAGES.DEMO_DISABLED]]) {
      answer(contract.confirm[key]);
      const r = await paymentService.confirmPayment({ paymentIntentId: 'pi_x', paymentMethodId: 'pm_x' });
      assert.deepEqual([r.outcome, r.httpStatus, r.message], ['REJECTED', contract.confirm[key].http, message], key);
    }
  });

  it('confirm 5xx / network error / timeout -> UNVERIFIED (not success, not "failed": the webhook may still complete it)', async () => {
    for (const a of [contract.confirm.providerError, { http: 502, body: '<html>Bad gateway</html>' }, { http: 503, body: {} }, 'network', 'timeout'] as Answer[]) {
      answer(a);
      const r = await paymentService.confirmPayment({ paymentIntentId: 'pi_x', paymentMethodId: 'pm_x' });
      assert.equal(r.outcome, 'UNVERIFIED', JSON.stringify(a));
      assert.equal(r.message, CONFIRMATION_MESSAGES.UNVERIFIED);
    }
  });

  it('confirm answers without a usable status are UNVERIFIED (fail-closed): missing, lower case, unknown, wrong shape, empty body', async () => {
    const bodies = [
      { message: 'Payment confirmed successfully', data: { id: 'x' } },
      { message: 'Payment confirmed successfully', data: { id: 'x', status: 'succeeded' } },
      { message: 'Payment confirmed successfully', data: { id: 'x', status: 'PAID' } },
      { message: 'Payment confirmed successfully', status: 'SUCCEEDED' },          // status outside `data`
      { message: 'Payment confirmed successfully', success: true },               // a success flag alone is not enough
      { data: null }, {}, '', null, 'OK',
    ];
    for (const body of bodies) {
      answer({ http: 200, body });
      assert.equal((await paymentService.confirmPayment({ paymentIntentId: 'pi_x', paymentMethodId: 'pm_x' })).outcome, 'UNVERIFIED', JSON.stringify(body));
    }
  });

  // ------------------------------------------------------------------------------------------- POST /api/payments/mock-complete (demo)
  it('demo answers are not wrapped in `data`: SUCCEEDED (also "already completed") is read correctly; disabled (404) is REJECTED', async () => {
    for (const key of ['succeeded', 'alreadyCompleted']) {
      answer(contract.mockComplete[key]);
      assert.equal((await paymentService.simulateMockPayment('o1')).outcome, 'SUCCEEDED', key);
    }
    answer(contract.mockComplete.disabled);
    const disabled = await paymentService.simulateMockPayment('o1');
    assert.deepEqual([disabled.outcome, disabled.httpStatus], ['REJECTED', 404]);
  });

  it('demo answers that contradict themselves or lack a status are UNVERIFIED', async () => {
    for (const body of [
      { success: false, payment: { status: 'SUCCEEDED' } },
      { success: true, payment: { status: 'PENDING' } },
      { success: true, payment: {} },
      { success: true },
      { payment: { status: 'SUCCEEDED' } },                    // no success flag
      { success: true, data: { status: 'SUCCEEDED' } },        // wrong envelope for this endpoint
    ]) {
      answer({ http: 200, body });
      assert.equal((await paymentService.simulateMockPayment('o1')).outcome, 'UNVERIFIED', JSON.stringify(body));
    }
  });

  // ------------------------------------------------------------------------------------------- POST /api/orders/:orderId/payment
  it('order payment answers ({ message, data: { success, status, payment } }): SUCCEEDED / PENDING / FAILED read from data', async () => {
    for (const [key, outcome] of [['succeeded', 'SUCCEEDED'], ['pending', 'PENDING'], ['failed', 'FAILED']]) {
      answer(contract.orderPayment[key]);
      const r = await orderService.processPayment('o1', 'pm_x');
      assert.equal(r.outcome, outcome, key);
    }
    assert.deepEqual(calls.map((c) => [c.method, c.url]), Array(3).fill(['post', '/api/orders/o1/payment']));
  });

  it('the old misreading is gone: a top-level `success` / missing `data` is not a success; 403 is REJECTED; 500 is UNVERIFIED', async () => {
    for (const body of [
      { success: true, payment: { status: 'SUCCEEDED' } },                                   // what the old code expected
      { message: 'Payment processed successfully' },
      { message: 'Payment processed successfully', data: { success: true, status: 'SUCCEEDED' } },          // no payment
      { message: 'x', data: { success: false, status: 'SUCCEEDED', payment: { status: 'SUCCEEDED' } } },  // contradicts itself
      { message: 'x', data: { success: true, status: 'UNKNOWN', payment: { status: 'succeeded' } } },
    ]) {
      answer({ http: 200, body });
      assert.notEqual((await orderService.processPayment('o1', 'pm')).outcome, 'SUCCEEDED', JSON.stringify(body));
      assert.equal((await orderService.processPayment('o1', 'pm')).outcome, 'UNVERIFIED');
    }
    answer(contract.orderPayment.forbidden);
    assert.equal((await orderService.processPayment('o1', 'pm')).outcome, 'REJECTED');
    answer(contract.orderPayment.serverError);
    assert.equal((await orderService.processPayment('o1', 'pm')).outcome, 'UNVERIFIED');
  });

  it('the confirmation calls never write the order: only the confirm endpoints are called', async () => {
    answer(contract.orderPayment.succeeded);
    await orderService.processPayment('o1', 'pm');
    answer(contract.confirm.succeeded);
    await paymentService.confirmPayment({ paymentIntentId: 'pi', paymentMethodId: 'pm' });
    answer(contract.mockComplete.succeeded);
    await paymentService.simulateMockPayment('o1');
    assert.deepEqual(calls.map((c) => c.url), ['/api/orders/o1/payment', '/api/payments/confirm', '/api/payments/mock-complete']);
    assert.ok(calls.every((c) => c.method === 'post'));
  });

  // ------------------------------------------------------------------------------------------- pure helpers
  it('readers and error mapping agree with the services above (pure functions)', () => {
    assert.equal(readConfirmAnswer(contract.confirm.succeeded.body, 200).outcome, 'SUCCEEDED');
    assert.equal(readMockCompleteAnswer(contract.mockComplete.succeeded.body, 200).outcome, 'SUCCEEDED');
    assert.equal(readOrderPaymentAnswer(contract.orderPayment.succeeded.body, 200).outcome, 'SUCCEEDED');
    assert.equal(resultFromError(new Error('boom')).outcome, 'UNVERIFIED');
    assert.equal(resultFromError({ response: { status: 401, data: {} } }).outcome, 'REJECTED');
    assert.equal(resultFromError(undefined).outcome, 'UNVERIFIED');
  });

  it('deliverConfirmationResult: success callback ONLY for SUCCEEDED', () => {
    const seen: string[] = [];
    const cb = { onSuccess: (id: string) => seen.push(`success:${id}`), onPending: (m: string) => seen.push(`pending:${m}`), onError: (m: string) => seen.push(`error:${m}`) };
    for (const outcome of ['SUCCEEDED', 'PENDING', 'UNVERIFIED', 'FAILED', 'REJECTED'] as const) {
      deliverConfirmationResult({ outcome, paymentId: outcome === 'SUCCEEDED' ? 'p1' : null, paymentStatus: null, httpStatus: 200, message: outcome }, cb, 'fallback');
    }
    assert.deepEqual(seen, ['success:p1', 'pending:PENDING', 'pending:UNVERIFIED', 'error:FAILED', 'error:REJECTED']);
  });

  it('orderPaymentState (success page): PAID / COMPLETED only; PROCESSING alone and unknown states are still pending', () => {
    assert.equal(orderPaymentState({ status: 'COMPLETED', paymentStatus: 'PAID' }), 'PAID');
    assert.equal(orderPaymentState({ status: 'CANCELLED', paymentStatus: 'PAID' }), 'PAID', 'paid but already owned (refund case): the money arrived');
    assert.equal(orderPaymentState({ status: 'PROCESSING', paymentStatus: 'UNPAID' }), 'PENDING');
    assert.equal(orderPaymentState({ status: 'PENDING', paymentStatus: 'UNPAID' }), 'PENDING');
    assert.equal(orderPaymentState({ status: 'FAILED', paymentStatus: 'FAILED' }), 'FAILED');
    assert.equal(orderPaymentState({ status: 'CANCELLED', paymentStatus: 'UNPAID' }), 'FAILED');
    assert.equal(orderPaymentState({ status: 'completed', paymentStatus: 'paid' }), 'PENDING');
    assert.equal(orderPaymentState(null), 'PENDING');
  });
});
