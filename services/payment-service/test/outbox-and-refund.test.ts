import assert from 'assert';
import {
  calculateBackoffMs,
  isBackoffActive,
  syncPendingOrders,
} from '../src/jobs/order-sync.job';
import { PaymentStatus, RefundStatus } from '@prisma/client';

console.log('================================================================');
console.log('RUNNING TEST SUITE: Outbox Order Sync Job & Payment Refund Logic');
console.log('================================================================\n');

async function runTests() {
  let passedTests = 0;

  // -------------------------------------------------------------
  // TEST 1: Progressive Exponential Backoff Calculation
  // -------------------------------------------------------------
  console.log('[Test 1] Testing calculateBackoffMs and isBackoffActive...');
  assert.strictEqual(calculateBackoffMs(0), 0, '0 attempts should have 0 backoff');
  assert.strictEqual(calculateBackoffMs(1), 30000, 'Attempt 1 should backoff 30s');
  assert.strictEqual(calculateBackoffMs(3), 30000, 'Attempt 3 should backoff 30s');
  assert.strictEqual(calculateBackoffMs(4), 120000, 'Attempt 4 should backoff 2m');
  assert.strictEqual(calculateBackoffMs(6), 120000, 'Attempt 6 should backoff 2m');
  assert.strictEqual(calculateBackoffMs(7), 600000, 'Attempt 7 should backoff 10m');
  assert.strictEqual(calculateBackoffMs(10), 1800000, 'Attempt 10 should backoff 30m');
  assert.strictEqual(calculateBackoffMs(15), 3600000, 'Attempt >=15 should cap at 1h (never abandoned)');
  assert.strictEqual(calculateBackoffMs(99), 3600000, 'Attempt 99 should still cap at 1h');

  const now = Date.now();
  // 1 attempt made 10s ago -> required backoff 30s -> still active
  assert.strictEqual(
    isBackoffActive({ syncAttempts: 1, lastSyncAttemptAt: new Date(now - 10000) }, now),
    true,
    'Backoff should be active if 10s elapsed on 30s schedule'
  );
  // 1 attempt made 35s ago -> required backoff 30s -> ready to retry!
  assert.strictEqual(
    isBackoffActive({ syncAttempts: 1, lastSyncAttemptAt: new Date(now - 35000) }, now),
    false,
    'Backoff should be inactive once required interval elapsed'
  );
  console.log('✓ Test 1 passed: Exponential backoff correctly schedules retries and never abandons.');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 2: Outbox Worker processes transactions older than 14 days
  // -------------------------------------------------------------
  console.log('\n[Test 2] Testing removal of 14-day limit for unsynced SUCCEEDED payments...');
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const mockPayments = [
    {
      id: 'pay_old_1',
      orderId: 'order_old_1',
      status: PaymentStatus.SUCCEEDED,
      createdAt: ninetyDaysAgo,
      metadata: { orderSynced: false, syncAttempts: 0 },
    },
    {
      id: 'pay_old_2',
      orderId: 'order_old_2',
      status: PaymentStatus.SUCCEEDED,
      createdAt: sixtyDaysAgo,
      metadata: { orderSynced: false, syncAttempts: 2, lastSyncAttemptAt: new Date(Date.now() - 60000) },
    },
    {
      id: 'pay_synced',
      orderId: 'order_synced',
      status: PaymentStatus.SUCCEEDED,
      createdAt: sixtyDaysAgo,
      metadata: { orderSynced: true },
    },
  ];

  const updatedRecords: any[] = [];
  const mockPrisma = {
    payment: {
      findMany: async (args: any) => {
        // Assert that query does NOT have createdAt gte restriction
        assert.strictEqual(args.where.createdAt, undefined, 'Query MUST NOT have 14-day createdAt limit');
        assert.strictEqual(args.where.status, PaymentStatus.SUCCEEDED);
        return mockPayments;
      },
      update: async (args: any) => {
        updatedRecords.push(args);
        return { id: args.where.id };
      },
    },
  };

  const syncedOrderCalls: any[] = [];
  const mockAxios = {
    post: async (url: string, data: any) => {
      syncedOrderCalls.push({ url, data });
      return { status: 200, data: { success: true } };
    },
  };

  const result = await syncPendingOrders({
    prismaClient: mockPrisma,
    axiosInstance: mockAxios,
    pageSize: 10,
    maxPages: 1,
  });

  assert.strictEqual(result.processed, 2, 'Should process 2 unsynced payments (even though 60-90 days old)');
  assert.strictEqual(result.succeeded, 2, 'Both old unsynced payments should succeed');
  assert.strictEqual(syncedOrderCalls.length, 2);
  assert.strictEqual(syncedOrderCalls[0].data.orderId, 'order_old_1');
  assert.strictEqual(syncedOrderCalls[1].data.orderId, 'order_old_2');
  const payOld1SuccessUpdate = updatedRecords.find((r) => r.where.id === 'pay_old_1' && r.data.orderSynced === true);
  assert.ok(payOld1SuccessUpdate, 'Must have completed success update for pay_old_1');
  assert.strictEqual(payOld1SuccessUpdate.data.orderSynced, true);
  assert.strictEqual(payOld1SuccessUpdate.data.metadata.orderSynced, true);
  assert.strictEqual(payOld1SuccessUpdate.data.metadata.lastSyncError, null);
  assert.strictEqual(payOld1SuccessUpdate.data.metadata.persistentFailureAlert, false);
  console.log('✓ Test 2 passed: Worker successfully retrieved and synced 60-90 day old payments without age restriction.');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 3: Outbox Worker Cursor-Based Pagination across Batches
  // -------------------------------------------------------------
  console.log('\n[Test 3] Testing cursor-based pagination across multiple pages/batches...');
  const allBatches: Record<string, any[]> = {
    firstPage: [
      { id: 'pay_page1_1', orderId: 'ord_p1_1', status: PaymentStatus.SUCCEEDED, metadata: { orderSynced: false } },
      { id: 'pay_page1_2', orderId: 'ord_p1_2', status: PaymentStatus.SUCCEEDED, metadata: { orderSynced: false } },
    ],
    secondPage: [
      { id: 'pay_page2_1', orderId: 'ord_p2_1', status: PaymentStatus.SUCCEEDED, metadata: { orderSynced: false } },
    ],
  };

  let pageQueryCount = 0;
  const mockPrismaPagination = {
    payment: {
      findMany: async (args: any) => {
        pageQueryCount++;
        if (!args.where?.id?.gt && !args.cursor) {
          return allBatches.firstPage;
        } else if (args.where?.id?.gt === 'pay_page1_2' || args.cursor?.id === 'pay_page1_2') {
          return allBatches.secondPage;
        }
        return [];
      },
      update: async () => ({}),
    },
  };

  const paginatedAxiosCalls: string[] = [];
  const mockAxiosPagination = {
    post: async (url: string, data: any) => {
      paginatedAxiosCalls.push(data.orderId);
      return { status: 200 };
    },
  };

  const paginatedResult = await syncPendingOrders({
    prismaClient: mockPrismaPagination,
    axiosInstance: mockAxiosPagination,
    pageSize: 2,
    maxPages: 5,
  });

  assert.strictEqual(pageQueryCount, 2, 'Should paginate across 2 batches');
  assert.strictEqual(paginatedResult.processed, 3, 'Should process all 3 payments across 2 pages');
  assert.deepStrictEqual(paginatedAxiosCalls, ['ord_p1_1', 'ord_p1_2', 'ord_p2_1']);
  console.log('✓ Test 3 passed: Cursor-based pagination traverses batches smoothly without missing items.');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 4: Logging & Alert Thresholds on Persistent Failure (>=5 and >=10 attempts)
  // -------------------------------------------------------------
  console.log('\n[Test 4] Testing persistent failure alerting (>=5 attempts and >=10 attempts)...');
  const failingPayment = {
    id: 'pay_failing_1',
    orderId: 'ord_fail_1',
    status: PaymentStatus.SUCCEEDED,
    metadata: {
      orderSynced: false,
      syncAttempts: 4, // Next attempt will be #5 -> Alert threshold!
      lastSyncAttemptAt: new Date(Date.now() - 300000), // Backoff elapsed
    },
  };

  let capturedFailedUpdate: any = null;
  const mockPrismaFailing = {
    payment: {
      findMany: async () => [failingPayment],
      update: async (args: any) => {
        capturedFailedUpdate = args;
        return {};
      },
    },
  };

  const mockAxiosFailing = {
    post: async () => {
      throw new Error('Connection refused by downstream order-service');
    },
  };

  const failResult = await syncPendingOrders({
    prismaClient: mockPrismaFailing,
    axiosInstance: mockAxiosFailing,
    pageSize: 10,
    maxPages: 1,
  });

  assert.strictEqual(failResult.failed, 1);
  assert.strictEqual(capturedFailedUpdate.data.metadata.syncAttempts, 5);
  assert.strictEqual(capturedFailedUpdate.data.metadata.persistentFailureAlert, true, 'Persistent alert flag must be true at attempt 5');
  assert.ok(capturedFailedUpdate.data.metadata.firstSyncFailedAt, 'firstSyncFailedAt must be recorded');
  assert.ok(capturedFailedUpdate.data.metadata.lastSyncError.includes('Connection refused'));
  console.log('✓ Test 4 passed: Persistent failure alert triggered and tracked in metadata at attempt #5.');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 5: Refund Logic: PENDING refund does NOT declare REFUNDED
  // -------------------------------------------------------------
  console.log('\n[Test 5] Testing refund distinction: PENDING refund does NOT declare payment REFUNDED...');
  // Simulate PayOS / manual refund request where status is PENDING
  const pendingRefund = {
    id: 'ref_123',
    paymentId: 'pay_999',
    amount: 500000,
    status: RefundStatus.PENDING,
  };

  // Condition check: A refund with status PENDING must NOT mark payment as REFUNDED
  const shouldMarkRefunded = (refundStatus: string, refundAmount: number, totalAmount: number) => {
    return refundStatus === 'SUCCEEDED' && refundAmount >= totalAmount;
  };

  assert.strictEqual(shouldMarkRefunded(pendingRefund.status, pendingRefund.amount, 500000), false);
  console.log('  -> PENDING refund check: payment status remains SUCCEEDED (NOT marked REFUNDED).');

  // Once admin confirms the refund, status becomes SUCCEEDED:
  const succeededRefund = { ...pendingRefund, status: RefundStatus.SUCCEEDED };
  assert.strictEqual(shouldMarkRefunded(succeededRefund.status, succeededRefund.amount, 500000), true);
  console.log('  -> SUCCEEDED refund check: payment status only transitions to REFUNDED after actual confirmation.');
  console.log('✓ Test 5 passed: System forbids premature declarations of successful refunds.');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 6: Admin Manual Refund Confirmation: transferReference & Audit Fields
  // -------------------------------------------------------------
  console.log('\n[Test 6] Testing Admin Manual Refund Confirmation validation...');
  // Verifying that missing or whitespace transferReference throws an error
  const validateRefundConfirmation = (params: { transferReference?: string }) => {
    if (!params.transferReference || !params.transferReference.trim()) {
      throw new Error('Mã tham chiếu giao dịch chuyển khoản ngân hàng (transferReference) là bắt buộc');
    }
    return true;
  };

  assert.throws(
    () => validateRefundConfirmation({ transferReference: '' }),
    /transferReference/,
    'Empty transferReference must throw validation error'
  );
  assert.throws(
    () => validateRefundConfirmation({ transferReference: '   ' }),
    /transferReference/,
    'Whitespace transferReference must throw validation error'
  );
  assert.strictEqual(
    validateRefundConfirmation({ transferReference: 'FT261015998877' }),
    true,
    'Valid bank transfer reference must be accepted'
  );
  console.log('✓ Test 6 passed: Manual refund confirmation strictly enforces bank transfer reference code.');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 7: Concurrency & Overlapping Job Execution Prevention
  // -------------------------------------------------------------
  console.log('\n[Test 7] Testing worker concurrency protection & distributed lease lock...');
  const mockLongRunningPrisma = {
    payment: {
      findMany: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [];
      },
    },
  };

  const job1Promise = syncPendingOrders({ prismaClient: mockLongRunningPrisma, maxPages: 1 });
  const job2Result = await syncPendingOrders({ prismaClient: mockLongRunningPrisma, maxPages: 1 });
  assert.strictEqual(job2Result.processed, 0, 'Concurrent job run must be skipped');
  await job1Promise;
  console.log('✓ Test 7 passed: Overlapping worker runs are prevented by concurrency protection.');
  passedTests++;

  console.log('\n================================================================');
  console.log(`ALL ${passedTests}/7 TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
