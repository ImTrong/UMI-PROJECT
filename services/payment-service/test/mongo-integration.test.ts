import assert from 'assert';
import { PrismaClient, PaymentStatus } from '@prisma/client';
import { syncPendingOrders } from '../src/jobs/order-sync.job';

import dotenv from 'dotenv';
dotenv.config();

const rawUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!rawUrl) {
  throw new Error('TEST_DATABASE_URL or DATABASE_URL environment variable must be defined.');
}
const mongoUrl = rawUrl.includes('mongodb:27017')
  ? rawUrl.replace('mongodb:27017', 'localhost:27017') + (rawUrl.includes('directConnection') ? '' : '&directConnection=true')
  : rawUrl;

const prisma = new PrismaClient({
  datasources: {
    db: { url: mongoUrl },
  },
});

console.log('================================================================');
console.log('RUNNING INTEGRATION TEST SUITE ON LOCAL DOCKER MONGODB (rs0, localhost:27017)');
console.log('Note: Verified against local container replica set (elearning-mongo).');
console.log('================================================================\n');

async function runIntegrationTests() {
  await prisma.$connect();
  let passedTests = 0;
  const testUserId = '654321654321654321654321';
  const runId = `intg_${Date.now()}`;

  // -------------------------------------------------------------
  // TEST 1: Five Test Cases on Real MongoDB (false, null, missing, meta.true, true)
  // -------------------------------------------------------------
  console.log('[Integration Test 1] Testing 5 distinct Outbox cases on Real MongoDB...');
  
  // Case 1: orderSynced = false
  await prisma.payment.create({
    data: {
      userId: testUserId,
      orderId: '654321654321654321654101',
      orderNumber: `${runId}_C1_FALSE`,
      amount: 100000,
      status: PaymentStatus.SUCCEEDED,
      orderSynced: false,
      metadata: { testRun: runId, case: 'C1' },
    },
  });

  // Case 2: orderSynced = null
  await prisma.payment.create({
    data: {
      userId: testUserId,
      orderId: '654321654321654321654102',
      orderNumber: `${runId}_C2_NULL`,
      amount: 200000,
      status: PaymentStatus.SUCCEEDED,
      orderSynced: null,
      metadata: { testRun: runId, case: 'C2' },
    },
  });

  // Case 3: Completely omitted orderSynced field in MongoDB
  await prisma.$runCommandRaw({
    insert: 'payments',
    documents: [
      {
        userId: { $oid: testUserId },
        orderId: { $oid: '654321654321654321654103' },
        orderNumber: `${runId}_C3_OMITTED`,
        amount: 300000,
        currency: 'vnd',
        status: 'SUCCEEDED',
        type: 'COURSE_PURCHASE',
        provider: 'payos',
        metadata: { testRun: runId, case: 'C3' },
        createdAt: { $date: new Date().toISOString() },
        updatedAt: { $date: new Date().toISOString() },
      },
    ],
  });

  // Case 4: Omitted orderSynced field, but metadata.orderSynced = true (Legacy synced record)
  await prisma.$runCommandRaw({
    insert: 'payments',
    documents: [
      {
        userId: { $oid: testUserId },
        orderId: { $oid: '654321654321654321654104' },
        orderNumber: `${runId}_C4_LEGACY_SYNCED`,
        amount: 400000,
        currency: 'vnd',
        status: 'SUCCEEDED',
        type: 'COURSE_PURCHASE',
        provider: 'payos',
        metadata: { testRun: runId, case: 'C4', orderSynced: true },
        createdAt: { $date: new Date().toISOString() },
        updatedAt: { $date: new Date().toISOString() },
      },
    ],
  });

  // Case 5: orderSynced = true (Already synced record)
  await prisma.payment.create({
    data: {
      userId: testUserId,
      orderId: '654321654321654321654105',
      orderNumber: `${runId}_C5_SYNCED_TRUE`,
      amount: 500000,
      status: PaymentStatus.SUCCEEDED,
      orderSynced: true,
      metadata: { testRun: runId, case: 'C5' },
    },
  });

  // Execute syncPendingOrders with mock downstream Axios
  const downstreamCalls: string[] = [];
  const mockAxios = {
    post: async (url: string, data: any) => {
      downstreamCalls.push(data.orderId);
      return { status: 200, data: { success: true } };
    },
  };

  const sweepResult = await syncPendingOrders({
    prismaClient: prisma,
    axiosInstance: mockAxios,
    pageSize: 10,
    maxPages: 1,
    ignoreConcurrencyLock: true,
  });

  // Verify downstream calls: ONLY C1, C2, and C3 must be called!
  // C4 had metadata.orderSynced=true -> MUST NOT call downstream!
  // C5 had orderSynced=true -> MUST NOT call downstream!
  assert.strictEqual(
    downstreamCalls.includes('654321654321654321654101'),
    true,
    'C1 (orderSynced=false) must be synced downstream'
  );
  assert.strictEqual(
    downstreamCalls.includes('654321654321654321654102'),
    true,
    'C2 (orderSynced=null) must be synced downstream'
  );
  assert.strictEqual(
    downstreamCalls.includes('654321654321654321654103'),
    true,
    'C3 (field omitted) must be synced downstream'
  );
  assert.strictEqual(
    downstreamCalls.includes('654321654321654321654104'),
    false,
    'C4 (legacy metadata.orderSynced=true) MUST NOT be re-synced downstream'
  );
  assert.strictEqual(
    downstreamCalls.includes('654321654321654321654105'),
    false,
    'C5 (orderSynced=true) MUST NOT be re-synced'
  );

  // Check C4 in MongoDB: It must have been self-healed to orderSynced=true
  const c4Db = await prisma.payment.findFirst({
    where: { orderNumber: `${runId}_C4_LEGACY_SYNCED` },
  });
  assert.strictEqual(c4Db?.orderSynced, true, 'C4 must be self-healed to orderSynced=true in MongoDB');

  console.log('✓ Integration Test 1 passed: All 5 cases handled with precision on real MongoDB (zero duplicate sync, zero omission).');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 2: Cursor Pagination on Real MongoDB
  // -------------------------------------------------------------
  console.log('\n[Integration Test 2] Testing Cursor Pagination across batches on Real MongoDB...');
  const paginatedOrderIds = [
    '654321654321654321654201',
    '654321654321654321654202',
    '654321654321654321654203',
    '654321654321654321654204',
  ];

  for (let i = 0; i < paginatedOrderIds.length; i++) {
    await prisma.payment.create({
      data: {
        userId: testUserId,
        orderId: paginatedOrderIds[i],
        orderNumber: `${runId}_PAGINATE_${i + 1}`,
        amount: 150000,
        status: PaymentStatus.SUCCEEDED,
        orderSynced: false,
        metadata: { testRun: runId },
      },
    });
  }

  const paginatedDownstreamCalls: string[] = [];
  const mockPaginatedAxios = {
    post: async (url: string, data: any) => {
      paginatedDownstreamCalls.push(data.orderId);
      return { status: 200 };
    },
  };

  const paginatedResult = await syncPendingOrders({
    prismaClient: prisma,
    axiosInstance: mockPaginatedAxios,
    pageSize: 2, // 2 items per page -> Requires at least 2 pages
    maxPages: 5,
    ignoreConcurrencyLock: true,
  });

  assert.strictEqual(paginatedResult.succeeded >= 4, true, 'At least 4 payments processed across pages');
  for (const oid of paginatedOrderIds) {
    assert.strictEqual(paginatedDownstreamCalls.includes(oid), true, `Order ${oid} must be synced via pagination`);
  }
  console.log('✓ Integration Test 2 passed: Cursor pagination successfully traversed multiple batches on Real MongoDB.');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 3: Distributed Concurrency Lock on Real MongoDB (syncLockUntil)
  // -------------------------------------------------------------
  console.log('\n[Integration Test 3] Testing Distributed Lease Lock (syncLockUntil) on Real MongoDB...');
  const lockedOrder = await prisma.payment.create({
    data: {
      userId: testUserId,
      orderId: '654321654321654321654301',
      orderNumber: `${runId}_LOCKED_PAYMENT`,
      amount: 100000,
      status: PaymentStatus.SUCCEEDED,
      orderSynced: false,
      syncLockUntil: new Date(Date.now() + 120000), // Locked for 2 minutes into the future
      metadata: { testRun: runId },
    },
  });

  const lockedDownstreamCalls: string[] = [];
  const mockLockAxios = {
    post: async (url: string, data: any) => {
      lockedDownstreamCalls.push(data.orderId);
      return { status: 200 };
    },
  };

  const lockResult = await syncPendingOrders({
    prismaClient: prisma,
    axiosInstance: mockLockAxios,
    pageSize: 10,
    maxPages: 1,
    ignoreConcurrencyLock: true,
  });

  assert.strictEqual(
    lockedDownstreamCalls.includes('654321654321654321654301'),
    false,
    'Locked record MUST NOT be synced by another worker'
  );
  assert.strictEqual(
    (lockResult.skippedLocked || 0) >= 1,
    true,
    'lockResult must report skippedLocked >= 1'
  );
  console.log('✓ Integration Test 3 passed: Active lease lock (syncLockUntil) strictly prevents concurrent worker processing.');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 4: Retry and Progressive Backoff Persistence on Real MongoDB
  // -------------------------------------------------------------
  console.log('\n[Integration Test 4] Testing Failure Tracking and Backoff on Real MongoDB...');
  const failingOrder = await prisma.payment.create({
    data: {
      userId: testUserId,
      orderId: '654321654321654321654401',
      orderNumber: `${runId}_FAILING_PAYMENT`,
      amount: 100000,
      status: PaymentStatus.SUCCEEDED,
      orderSynced: false,
      metadata: { testRun: runId },
    },
  });

  const mockFailAxios = {
    post: async () => {
      throw new Error('Downstream network timeout simulation');
    },
  };

  // Run 1: Failure occurs
  const failRun1 = await syncPendingOrders({
    prismaClient: prisma,
    axiosInstance: mockFailAxios,
    pageSize: 10,
    maxPages: 1,
    ignoreConcurrencyLock: true,
  });

  const failingDbAfterRun1 = await prisma.payment.findUnique({
    where: { id: failingOrder.id },
  });

  assert.strictEqual(failingDbAfterRun1?.syncAttempts, 1, 'syncAttempts must be 1 in MongoDB');
  assert.ok(failingDbAfterRun1?.lastSyncAttemptAt, 'lastSyncAttemptAt must be saved in MongoDB');
  assert.strictEqual(failingDbAfterRun1?.syncLockUntil, null, 'syncLockUntil must be cleared after failure');
  assert.ok(failingDbAfterRun1?.lastSyncError?.includes('Downstream network timeout'));

  // Run 2: Immediately run again -> Should skip due to backoff!
  const failRun2 = await syncPendingOrders({
    prismaClient: prisma,
    axiosInstance: mockFailAxios,
    pageSize: 10,
    maxPages: 1,
    ignoreConcurrencyLock: true,
  });

  assert.strictEqual(
    failRun2.skippedBackoff >= 1,
    true,
    'Subsequent immediate run must be skipped due to active backoff'
  );
  console.log('✓ Integration Test 4 passed: Failure attempts, error logs, and backoff persist accurately in real MongoDB.');
  passedTests++;

  // -------------------------------------------------------------
  // TEST 5: Unique Sparse Indexes for stripePaymentIntentId & payosOrderCode
  // -------------------------------------------------------------
  console.log('\n[Integration Test 5] Testing Unique Sparse Indexes (null, omitted, valid, duplicate)...');
  
  // A. Multiple payments where stripePaymentIntentId is null or omitted (PayOS payments)
  const payos1 = await prisma.payment.create({
    data: {
      userId: testUserId,
      orderId: '654321654321654321654501',
      orderNumber: `${runId}_SPARSE_PAYOS_1`,
      amount: 100000,
      status: PaymentStatus.PENDING,
      provider: 'payos',
      payosOrderCode: String(Math.floor(100000 + Math.random() * 800000)),
      stripePaymentIntentId: null, // explicit null
    },
  });

  const payos2 = await prisma.payment.create({
    data: {
      userId: testUserId,
      orderId: '654321654321654321654502',
      orderNumber: `${runId}_SPARSE_PAYOS_2`,
      amount: 100000,
      status: PaymentStatus.PENDING,
      provider: 'payos',
      payosOrderCode: String(Math.floor(100000 + Math.random() * 800000)),
      // stripePaymentIntentId omitted
    },
  });
  assert.ok(payos1.id && payos2.id, 'Multiple payments with null/omitted stripePaymentIntentId must coexist');

  // B. Multiple payments where payosOrderCode is null or omitted (Stripe payments)
  const stripe1 = await prisma.payment.create({
    data: {
      userId: testUserId,
      orderId: '654321654321654321654503',
      orderNumber: `${runId}_SPARSE_STRIPE_1`,
      amount: 200000,
      status: PaymentStatus.PENDING,
      provider: 'stripe',
      stripePaymentIntentId: `pi_${runId}_1`,
      payosOrderCode: null as any, // explicit null
    },
  });

  const stripe2 = await prisma.payment.create({
    data: {
      userId: testUserId,
      orderId: '654321654321654321654504',
      orderNumber: `${runId}_SPARSE_STRIPE_2`,
      amount: 200000,
      status: PaymentStatus.PENDING,
      provider: 'stripe',
      stripePaymentIntentId: `pi_${runId}_2`,
      // payosOrderCode omitted
    },
  });
  assert.ok(stripe1.id && stripe2.id, 'Multiple payments with null/omitted payosOrderCode must coexist');

  // C. Duplicate valid payosOrderCode must be rejected
  let duplicatePayosError: any = null;
  try {
    await prisma.payment.create({
      data: {
        userId: testUserId,
        orderId: '654321654321654321654505',
        orderNumber: `${runId}_SPARSE_PAYOS_DUP`,
        amount: 100000,
        status: PaymentStatus.PENDING,
        provider: 'payos',
        payosOrderCode: payos1.payosOrderCode, // Duplicate!
      },
    });
  } catch (err: any) {
    duplicatePayosError = err;
  }
  assert.ok(duplicatePayosError, 'Duplicate payosOrderCode must throw unique constraint error');

  // D. Duplicate valid stripePaymentIntentId must be rejected
  let duplicateStripeError: any = null;
  try {
    await prisma.payment.create({
      data: {
        userId: testUserId,
        orderId: '654321654321654321654506',
        orderNumber: `${runId}_SPARSE_STRIPE_DUP`,
        amount: 200000,
        status: PaymentStatus.PENDING,
        provider: 'stripe',
        stripePaymentIntentId: stripe1.stripePaymentIntentId, // Duplicate!
      },
    });
  } catch (err: any) {
    duplicateStripeError = err;
  }
  assert.ok(duplicateStripeError, 'Duplicate stripePaymentIntentId must throw unique constraint error');

  console.log('✓ Integration Test 5 passed: Unique sparse indexes enforce uniqueness on valid values while permitting multiple null/omitted values.');
  passedTests++;

  // -------------------------------------------------------------
  // TEARDOWN: Clean up only test records for this runId
  // -------------------------------------------------------------
  console.log('\n--- Cleaning up test records from Real MongoDB ---');
  const deleteResult = await prisma.payment.deleteMany({
    where: {
      orderNumber: { startsWith: runId },
    },
  });
  console.log(`Cleaned up ${deleteResult.count} test records. Existing database records untouched.`);

  console.log('\n================================================================');
  console.log(`ALL ${passedTests}/5 INTEGRATION TESTS PASSED ON LOCAL DOCKER MONGODB!`);
  console.log('================================================================');

  await prisma.$disconnect();
}

runIntegrationTests().catch(async (err) => {
  console.error('Integration test failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
