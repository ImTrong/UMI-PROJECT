/**
 * ADMIN-DASHBOARD-01: the admin dashboard's sales block.
 *   - the service calls the one ADMIN route (GET /api/orders/analytics/sales-performance) and returns its `data` untouched
 *   - the wording for missing / unknown / unreliable values never invents a number, a name or a rating
 *   - the revenue label says it is before the refund adjustments that are not allocated
 * HTTP is answered by an axios adapter (no network).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { orderApi } from '../src/services/api';
import { orderService, type SalesPerformance } from '../src/services/order.service';
import { REVENUE_LABEL, NO_DATA, buildQualityNotes, describeLoadError, describeName, describeRating } from '../src/utils/sales-performance';

(globalThis as any).localStorage ??= { getItem: () => null, removeItem: () => {} };

const DQ: SalesPerformance['dataQuality'] = {
  ordersExamined: 0,
  ordersWithoutPaymentEvidence: 0,
  ordersPaymentNotRecordedByOrder: 0,
  fullyRefundedOrders: { count: 0, amount: 0 },
  partiallyRefundedOrders: { count: 0, refundedAmount: 0 },
  duplicateLines: { count: 0, amount: 0 },
  refundedLines: { count: 0, amount: 0 },
  unclassifiedLines: { count: 0, amount: 0 },
  soldLinesWithoutInstructor: 0,
  courseInfoAvailable: true,
  instructorInfoAvailable: true,
  minReliableReviews: 5,
};
const money = (n: number) => `${n} VND`;

describe('sales performance service', () => {
  let calls: Array<{ method: string; url: string }> = [];
  let answer: { status: number; data: any } = { status: 200, data: {} };
  beforeEach(() => {
    calls = [];
    orderApi.defaults.adapter = async (config: any) => {
      calls.push({ method: config.method, url: config.url });
      const response = { data: answer.data, status: answer.status, statusText: String(answer.status), headers: {}, config };
      if (answer.status >= 400) {
        const err: any = new Error(`Request failed with status code ${answer.status}`);
        err.response = response;
        err.config = config;
        throw err;
      }
      return response;
    };
  });

  test('calls GET /api/orders/analytics/sales-performance and returns data as the API gave it', async () => {
    const data = { kpis: { paidOrderAmount: 5, paidOrderCount: 1, soldCourseLineCount: 2, distinctSoldCourseCount: 2 }, topCourses: [], topInstructors: [], dataQuality: DQ };
    answer = { status: 200, data: { data } };
    assert.deepEqual(await orderService.getSalesPerformance(), data as any);
    assert.deepEqual(calls, [{ method: 'get', url: '/api/orders/analytics/sales-performance' }]);
  });

  test('a failed request rejects (the page shows its error state) - no zero-filled substitute', async () => {
    answer = { status: 502, data: { code: 'PAYMENT_EVIDENCE_UNAVAILABLE' } };
    await assert.rejects(() => orderService.getSalesPerformance());
  });
});

describe('describeRating', () => {
  test('unknown count -> no data; known zero reviews -> no review yet; never a 0 rating', () => {
    assert.deepEqual(describeRating(null, null, false, 5), { text: NO_DATA, note: '' });
    assert.deepEqual(describeRating(null, 0, false, 5), { text: 'Chưa có đánh giá', note: '' });
    assert.equal(describeRating(0, 0, false, 5).text, 'Chưa có đánh giá');
  });
  test('shows the average with its review count; few reviews are flagged', () => {
    assert.deepEqual(describeRating(4.5, 8, true, 5), { text: '4.50 ★ (8 lượt đánh giá)', note: '' });
    const few = describeRating(5, 2, false, 5);
    assert.equal(few.text, '5.00 ★ (2 lượt đánh giá)');
    assert.match(few.note, /dưới 5/);
  });
});

describe('describeName / describeLoadError', () => {
  test('a missing name is shown as missing, not rebuilt from anything', () => {
    for (const v of [null, undefined, '', '   ']) assert.equal(describeName(v), 'Chưa có thông tin');
    assert.equal(describeName('Nguyen Van A'), 'Nguyen Van A');
  });
  test('load errors: unverified payments, no permission, offline, other', () => {
    assert.match(describeLoadError({ response: { status: 502, data: { code: 'PAYMENT_EVIDENCE_UNAVAILABLE' } } }), /thanh toán/);
    assert.match(describeLoadError({ response: { status: 403, data: {} } }), /quyền/);
    assert.match(describeLoadError(new Error('Network Error')), /kết nối/);
    assert.match(describeLoadError({ response: { status: 500, data: {} } }), /Không tải được/);
  });
});

describe('labels and notes', () => {
  test('the revenue KPI keeps the required label (before unallocated refund adjustments)', () => {
    assert.equal(REVENUE_LABEL, 'Tổng tiền đơn đã thanh toán (trước điều chỉnh hoàn tiền chưa phân bổ)');
  });
  test('no note when nothing needs saying; each anomaly adds its own note with its numbers', () => {
    assert.deepEqual(buildQualityNotes(DQ, money), []);
    const notes = buildQualityNotes({
      ...DQ,
      ordersWithoutPaymentEvidence: 2,
      fullyRefundedOrders: { count: 1, amount: 400000 },
      partiallyRefundedOrders: { count: 3, refundedAmount: 150000 },
      duplicateLines: { count: 4, amount: 120000 },
      courseInfoAvailable: false,
    }, money);
    assert.equal(notes.length, 5);
    assert.ok(notes.some((n) => n.includes('2 đơn') && n.includes('không có thanh toán thành công')));
    assert.ok(notes.some((n) => n.includes('400000 VND')));
    assert.ok(notes.some((n) => n.includes('3 đơn') && n.includes('150000 VND') && n.includes('chưa trừ')));
    assert.ok(notes.some((n) => n.includes('4 dòng mua trùng')));
    assert.ok(notes.some((n) => n.includes('Chưa có dữ liệu')));
  });
});
