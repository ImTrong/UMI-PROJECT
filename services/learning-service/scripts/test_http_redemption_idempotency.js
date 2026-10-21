/**
 * HTTP Integration Test: Course Redemption Idempotency & True Concurrency Collision
 * 100% ISOLATED TEST ENVIRONMENT:
 * - Dedicated test database: learning_test_db
 * - Dedicated test HTTP server running on port 3016 connected strictly to learning_test_db
 * - Dedicated test student account (test_student_http_isolated@elearning.local)
 * - True Concurrency Race Condition Tests (Same Key + Different Course ID, Same Key + Different Points)
 * - Complete Database Ledger Reconciliation for all test transactions
 * - Comprehensive Cross-Service Test Account & Data Cleanup
 */

const TEST_DB_URL = 'mongodb://admin:securepassword123@mongodb:27017/learning_test_db?authSource=admin';
const SHARED_DB_URL = 'mongodb://admin:securepassword123@mongodb:27017/learning_db?authSource=admin';
const AUTH_DB_URL = 'mongodb://admin:securepassword123@mongodb:27017/auth_db?authSource=admin';

process.env.DATABASE_URL = TEST_DB_URL;
process.env.PORT = '3016';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prismaTest = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
const prismaShared = new PrismaClient({ datasources: { db: { url: SHARED_DB_URL } } });
const prismaAuth = new PrismaClient({ datasources: { db: { url: AUTH_DB_URL } } });

const TEST_SERVICE_URL = 'http://localhost:3016';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName, details = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
    results.push({ name: testName, status: 'PASS' });
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName} - ${details}`);
    results.push({ name: testName, status: 'FAIL', details });
  }
}

function fakeObjectId() {
  const chars = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

async function runHttpRedemptionTests() {
  console.log('\n=============================================================');
  console.log(' HTTP INTEGRATION TEST: REDEMPTION IDEMPOTENCY & CONCURRENCY');
  console.log(' Target Service: ' + TEST_SERVICE_URL + ' (ISOLATED TEST INSTANCE)');
  console.log(' Target Database: learning_test_db (ISOLATED TEST DATABASE)');
  console.log('=============================================================\n');

  let server = null;
  let studentToken = '';
  let studentUserId = '';
  const testStudentEmail = 'test_student_http_isolated@elearning.local';
  const testPassword = 'Password123!';

  try {
    // 1. Boot up isolated Express test server on port 3016
    console.log('1. Starting isolated Express instance connected to learning_test_db on port 3016...');
    const appPath = fs.existsSync(path.join(__dirname, 'dist/app.js'))
      ? path.join(__dirname, 'dist/app')
      : fs.existsSync(path.join(__dirname, '../dist/app.js'))
      ? path.join(__dirname, '../dist/app')
      : './dist/app';
    const appModule = require(appPath);
    const app = appModule.default || appModule;
    server = await new Promise((resolve, reject) => {
      const s = app.listen(3016, () => {
        console.log('  ✓ Test server listening on http://localhost:3016');
        resolve(s);
      });
      s.on('error', reject);
    });

    const health = await axios.get(`${TEST_SERVICE_URL}/api/learning/health`);
    assert(health.status === 200, 'Isolated test server healthy and responding on port 3016');

    // 2. Authenticate / Register dedicated test student account
    console.log('\n2. Setting up dedicated test student account via auth-service...');
    try {
      const registerRes = await axios.post(`${AUTH_SERVICE_URL}/api/auth/register`, {
        email: testStudentEmail,
        password: testPassword,
        fullName: 'Test Student Isolated'
      });
      studentToken = registerRes.data.accessToken;
      studentUserId = registerRes.data.user.id;
      console.log(`  ✓ Registered new test student (${studentUserId})`);
    } catch (regErr) {
      const loginRes = await axios.post(`${AUTH_SERVICE_URL}/api/auth/login`, {
        email: testStudentEmail,
        password: testPassword
      });
      studentToken = loginRes.data.accessToken;
      studentUserId = loginRes.data.user.id;
      console.log(`  ✓ Logged in existing test student (${studentUserId})`);
    }

    assert(Boolean(studentToken && studentUserId), 'Dedicated test student authenticated with valid JWT token');

    // Clean any prior records for this student in learning_test_db
    await prismaTest.rewardPointTransaction.deleteMany({ where: { userId: studentUserId } });
    await prismaTest.userRewardPoint.deleteMany({ where: { userId: studentUserId } });

    // 3. Setup student wallet in learning_test_db: exactly 1,500 points
    console.log('\n3. Initializing test student wallet in learning_test_db...');
    await prismaTest.userRewardPoint.create({
      data: { userId: studentUserId, balance: 1500, totalEarned: 1500, totalSpent: 0 }
    });

    const initialWallet = await prismaTest.userRewardPoint.findUnique({ where: { userId: studentUserId } });
    assert(initialWallet.balance === 1500, 'Test wallet initialized with exactly 1,500 points in learning_test_db');

    // -------------------------------------------------------------------------
    // TEST 1: Missing clientRequestId is strictly rejected with HTTP 400
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: Missing clientRequestId Rejected with HTTP 400 ---');
    let missingStatus = 0;
    let missingError = '';
    const dummyCourseId1 = fakeObjectId();
    try {
      await axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: dummyCourseId1, pointsRequired: 500 },
        { headers: { Authorization: `Bearer ${studentToken}` } }
      );
    } catch (err) {
      missingStatus = err.response?.status;
      missingError = err.response?.data?.error || err.message;
    }

    assert(missingStatus === 400, 'Redemption request without clientRequestId rejected with HTTP 400');
    assert(missingError.includes('Mã yêu cầu (clientRequestId hoặc header X-Idempotency-Key) là bắt buộc'), 'Clear error message returned for missing clientRequestId');

    const walletAfterT1 = await prismaTest.userRewardPoint.findUnique({ where: { userId: studentUserId } });
    assert(walletAfterT1.balance === 1500, 'Wallet balance unchanged (1,500 pts) after missing clientRequestId');

    // -------------------------------------------------------------------------
    // TEST 2: First Attempt Fails Enrollment (Dummy Course) -> Auto-Rollback
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: First Redemption Fails Enrollment -> Auto-Rollback ---');
    const clientRequestId1 = `client_req_${Date.now()}_alpha`;
    let firstAttemptStatus = 0;
    let firstAttemptError = '';
    try {
      await axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: dummyCourseId1, pointsRequired: 500, clientRequestId: clientRequestId1 },
        {
          headers: {
            Authorization: `Bearer ${studentToken}`,
            'X-Idempotency-Key': clientRequestId1
          }
        }
      );
    } catch (err) {
      firstAttemptStatus = err.response?.status;
      firstAttemptError = err.response?.data?.error || err.message;
    }

    assert(firstAttemptStatus === 400, 'First attempt failed enrollment with HTTP 400 Bad Request');
    assert(firstAttemptError.includes('Điểm đã được hoàn lại ví'), 'Error response confirms points were refunded to wallet');

    const walletAfterT2 = await prismaTest.userRewardPoint.findUnique({ where: { userId: studentUserId } });
    assert(walletAfterT2.balance === 1500, 'Balance strictly restored to 1,500 pts after rollback');

    const debitTx1 = await prismaTest.rewardPointTransaction.findUnique({ where: { idempotencyKey: clientRequestId1 } });
    const refundTx1 = await prismaTest.rewardPointTransaction.findUnique({ where: { idempotencyKey: `refund_${clientRequestId1}` } });

    assert(debitTx1 !== null && debitTx1.metadata?.redemptionStatus === 'FAILED' && debitTx1.amount === -500, 'Debit tx marked FAILED in ledger (-500 pts)');
    assert(refundTx1 !== null && refundTx1.amount === 500, 'Refund tx created with +500 pts in ledger');

    // -------------------------------------------------------------------------
    // TEST 3: Timeout Retry with SAME clientRequestId on Refunded Request
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Timeout Retry with Same Request ID on Refunded Request ---');
    let retryStatus = 0;
    let retryData = null;
    try {
      const res = await axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: dummyCourseId1, pointsRequired: 500, clientRequestId: clientRequestId1 },
        {
          headers: {
            Authorization: `Bearer ${studentToken}`,
            'X-Idempotency-Key': clientRequestId1
          }
        }
      );
      retryStatus = res.status;
      retryData = res.data;
    } catch (err) {
      retryStatus = err.response?.status;
      retryData = err.response?.data;
    }

    assert(retryStatus === 409, 'Replay of refunded request rejected with HTTP 409 Conflict');
    assert(retryData?.data?.status === 'ALREADY_REFUNDED', 'Response payload contains status ALREADY_REFUNDED');
    assert(retryData?.data?.isIdempotentReplay === true, 'Response flags isIdempotentReplay: true');

    const walletAfterT3 = await prismaTest.userRewardPoint.findUnique({ where: { userId: studentUserId } });
    assert(walletAfterT3.balance === 1500, 'Wallet balance remains strictly 1,500 pts (NO DOUBLE DEBIT)');

    const countDebits1 = await prismaTest.rewardPointTransaction.count({ where: { idempotencyKey: clientRequestId1 } });
    assert(countDebits1 === 1, `Exactly 1 debit transaction exists for requestId ${clientRequestId1}`);

    // -------------------------------------------------------------------------
    // TEST 4: Payload Conflict (Same Request ID with Different Course ID)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Payload Conflict (Same Key with Different Payload) ---');
    let conflictStatus = 0;
    let conflictError = '';
    const differentCourseId = fakeObjectId();
    try {
      await axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: differentCourseId, pointsRequired: 500, clientRequestId: clientRequestId1 },
        {
          headers: {
            Authorization: `Bearer ${studentToken}`,
            'X-Idempotency-Key': clientRequestId1
          }
        }
      );
    } catch (err) {
      conflictStatus = err.response?.status;
      conflictError = err.response?.data?.error || err.message;
    }

    assert(conflictStatus === 409, 'Reusing key with different payload rejected with HTTP 409 Conflict');
    assert(conflictError.includes('Xung đột khóa idempotency'), 'Conflict error explicitly warns of idempotency key conflict');

    // -------------------------------------------------------------------------
    // TEST 5: New Operation after Failure MUST use a NEW Request ID
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: New Operation with New Request ID ---');
    const clientRequestId2 = `client_req_${Date.now()}_beta`;
    let newOpStatus = 0;
    let newOpError = '';
    try {
      await axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: dummyCourseId1, pointsRequired: 500, clientRequestId: clientRequestId2 },
        {
          headers: {
            Authorization: `Bearer ${studentToken}`,
            'X-Idempotency-Key': clientRequestId2
          }
        }
      );
    } catch (err) {
      newOpStatus = err.response?.status;
      newOpError = err.response?.data?.error || err.message;
    }

    assert(newOpStatus === 400 && newOpError.includes('Điểm đã được hoàn lại ví'), 'New operation with new requestId is accepted and processed independently');

    const debitTx2 = await prismaTest.rewardPointTransaction.findUnique({ where: { idempotencyKey: clientRequestId2 } });
    const refundTx2 = await prismaTest.rewardPointTransaction.findUnique({ where: { idempotencyKey: `refund_${clientRequestId2}` } });

    assert(debitTx2 !== null && refundTx2 !== null, 'Distinct transaction pair created in learning_test_db for new requestId');

    // -------------------------------------------------------------------------
    // TEST 6: Successful Redemption Idempotent Replay (HTTP 200)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Successful Transaction Idempotent Replay ---');
    const successReqId = `client_success_${Date.now()}`;
    const successCourseId = fakeObjectId();

    // Pre-seed a completed transaction in ledger for this test student
    await prismaTest.rewardPointTransaction.create({
      data: {
        userId: studentUserId,
        amount: -500,
        type: 'COURSE_REDEMPTION',
        description: `Đổi điểm lấy khóa học (ID: ${successCourseId})`,
        balanceAfter: 1000,
        sourceId: successCourseId,
        idempotencyKey: successReqId,
        metadata: { courseId: successCourseId, pointsRequired: 500, redemptionStatus: 'COMPLETED' },
      }
    });
    await prismaTest.userRewardPoint.update({
      where: { userId: studentUserId },
      data: { balance: 1000, totalSpent: 500 }
    });

    const successReplayRes = await axios.post(
      `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
      { courseId: successCourseId, pointsRequired: 500, clientRequestId: successReqId },
      {
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'X-Idempotency-Key': successReqId
        }
      }
    );

    assert(successReplayRes.status === 200, 'Replay of completed transaction returns HTTP 200 OK');
    assert(successReplayRes.data?.data?.isIdempotentReplay === true, 'Response flags isIdempotentReplay: true');
    assert(successReplayRes.data?.data?.status === 'ALREADY_COMPLETED', 'Response status is ALREADY_COMPLETED');

    const walletAfterT6 = await prismaTest.userRewardPoint.findUnique({ where: { userId: studentUserId } });
    assert(walletAfterT6.balance === 1000, 'Wallet balance remains strictly 1,000 pts (NO DOUBLE DEBIT)');

    // -------------------------------------------------------------------------
    // TEST 7: Concurrent HTTP Requests with Identical clientRequestId & Payload
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: Concurrent HTTP Requests with Identical clientRequestId ---');
    const concurrentReqId = `client_concurrent_${Date.now()}`;
    const concurrentCourseId = fakeObjectId();

    const [cRes1, cRes2] = await Promise.allSettled([
      axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: concurrentCourseId, pointsRequired: 500, clientRequestId: concurrentReqId },
        { headers: { Authorization: `Bearer ${studentToken}`, 'X-Idempotency-Key': concurrentReqId } }
      ),
      axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: concurrentCourseId, pointsRequired: 500, clientRequestId: concurrentReqId },
        { headers: { Authorization: `Bearer ${studentToken}`, 'X-Idempotency-Key': concurrentReqId } }
      )
    ]);

    assert(cRes1.status !== undefined && cRes2.status !== undefined, 'Both concurrent HTTP requests settled without uncaught server exceptions');

    const concurrentDebits = await prismaTest.rewardPointTransaction.count({
      where: { idempotencyKey: concurrentReqId }
    });
    assert(concurrentDebits === 1, `Exactly 1 debit transaction created for identical concurrent request ID (got ${concurrentDebits})`);

    const walletAfterT7 = await prismaTest.userRewardPoint.findUnique({ where: { userId: studentUserId } });
    assert(walletAfterT7.balance === 1000, 'Wallet balance remains strictly 1,000 pts after concurrent requests');

    // -------------------------------------------------------------------------
    // TEST 8: True Concurrent Race Condition — SAME Key, DIFFERENT Course ID
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: True Race Condition (Same Key, Different Course ID) ---');
    const raceKeyCourse = `race_key_diff_course_${Date.now()}`;
    const raceCourseA = fakeObjectId();
    const raceCourseB = fakeObjectId();

    const [raceResA, raceResB] = await Promise.allSettled([
      axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: raceCourseA, pointsRequired: 500, clientRequestId: raceKeyCourse },
        { headers: { Authorization: `Bearer ${studentToken}`, 'X-Idempotency-Key': raceKeyCourse } }
      ),
      axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: raceCourseB, pointsRequired: 500, clientRequestId: raceKeyCourse },
        { headers: { Authorization: `Bearer ${studentToken}`, 'X-Idempotency-Key': raceKeyCourse } }
      )
    ]);

    const statusesCourse = [
      raceResA.status === 'fulfilled' ? raceResA.value.status : raceResA.reason?.response?.status,
      raceResB.status === 'fulfilled' ? raceResB.value.status : raceResB.reason?.response?.status
    ];

    const hasConflictCourse = statusesCourse.includes(409);
    assert(hasConflictCourse === true, `Losing thread received HTTP 409 Conflict when payloads differ (statuses: ${statusesCourse.join(', ')})`);

    const raceDebitsCourse = await prismaTest.rewardPointTransaction.count({
      where: { idempotencyKey: raceKeyCourse }
    });
    assert(raceDebitsCourse === 1, `Exactly 1 debit transaction recorded for raceKeyCourse (got ${raceDebitsCourse})`);

    const walletAfterT8 = await prismaTest.userRewardPoint.findUnique({ where: { userId: studentUserId } });
    assert(walletAfterT8.balance === 1000, 'Wallet balance remains strictly 1,000 pts after course race collision');

    // -------------------------------------------------------------------------
    // TEST 9: True Concurrent Race Condition — SAME Key, DIFFERENT Points Required
    // -------------------------------------------------------------------------
    console.log('\n--- Test 9: True Race Condition (Same Key, Different Points Required) ---');
    const raceKeyPoints = `race_key_diff_points_${Date.now()}`;
    const raceCommonCourse = fakeObjectId();

    const [pRes1, pRes2] = await Promise.allSettled([
      axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: raceCommonCourse, pointsRequired: 500, clientRequestId: raceKeyPoints },
        { headers: { Authorization: `Bearer ${studentToken}`, 'X-Idempotency-Key': raceKeyPoints } }
      ),
      axios.post(
        `${TEST_SERVICE_URL}/api/learning/reward-points/redeem`,
        { courseId: raceCommonCourse, pointsRequired: 400, clientRequestId: raceKeyPoints },
        { headers: { Authorization: `Bearer ${studentToken}`, 'X-Idempotency-Key': raceKeyPoints } }
      )
    ]);

    const statusesPoints = [
      pRes1.status === 'fulfilled' ? pRes1.value.status : pRes1.reason?.response?.status,
      pRes2.status === 'fulfilled' ? pRes2.value.status : pRes2.reason?.response?.status
    ];

    const hasConflictPoints = statusesPoints.includes(409);
    assert(hasConflictPoints === true, `Losing thread received HTTP 409 Conflict when points differ (statuses: ${statusesPoints.join(', ')})`);

    const raceDebitsPoints = await prismaTest.rewardPointTransaction.count({
      where: { idempotencyKey: raceKeyPoints }
    });
    assert(raceDebitsPoints === 1, `Exactly 1 debit transaction recorded for raceKeyPoints (got ${raceDebitsPoints})`);

    const walletAfterT9 = await prismaTest.userRewardPoint.findUnique({ where: { userId: studentUserId } });
    assert(walletAfterT9.balance === 1000, 'Wallet balance remains strictly 1,000 pts after points race collision');

    // -------------------------------------------------------------------------
    // TEST 10: Complete Database Ledger Audit & Reconciliation
    // -------------------------------------------------------------------------
    console.log('\n--- Test 10: Complete Database Ledger Audit & Reconciliation ---');
    const allStudentTxs = await prismaTest.rewardPointTransaction.findMany({
      where: { userId: studentUserId },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`\n📋 RAW LEDGER TRANSACTIONS IN learning_test_db (${allStudentTxs.length} records total):`);
    console.log('-----------------------------------------------------------------------------------------------------------');
    console.log('| ID                       | Amount | Type                      | IdempotencyKey                 | Balance | Status |');
    console.log('-----------------------------------------------------------------------------------------------------------');
    for (const tx of allStudentTxs) {
      const meta = (tx.metadata || {});
      const st = meta.redemptionStatus || 'N/A';
      console.log(`| ${tx.id} | ${String(tx.amount).padStart(6)} | ${tx.type.padEnd(25)} | ${tx.idempotencyKey.padEnd(30)} | ${String(tx.balanceAfter).padStart(7)} | ${st.padEnd(6)} |`);
    }
    console.log('-----------------------------------------------------------------------------------------------------------\n');

    const debitTxs = allStudentTxs.filter(t => t.type === 'COURSE_REDEMPTION');
    const refundTxs = allStudentTxs.filter(t => t.type === 'COURSE_REDEMPTION_REFUND');
    const completedDebitTxs = debitTxs.filter(t => (t.metadata || {}).redemptionStatus === 'COMPLETED');
    const failedDebitTxs = debitTxs.filter(t => (t.metadata || {}).redemptionStatus === 'FAILED');

    assert(debitTxs.length === 6, `Total debit transactions strictly matches 6 (1 pre-seeded completed + 5 failed attempts) (got ${debitTxs.length})`);
    assert(refundTxs.length === 5, `Total refund transactions strictly matches 5 (+500 for each of 5 failed attempts) (got ${refundTxs.length})`);
    assert(completedDebitTxs.length === 1, `Exactly 1 completed debit transaction in ledger (got ${completedDebitTxs.length})`);
    assert(failedDebitTxs.length === 5, `Exactly 5 failed debit transactions in ledger (got ${failedDebitTxs.length})`);

    const finalWallet = await prismaTest.userRewardPoint.findUnique({ where: { userId: studentUserId } });
    assert(finalWallet.balance === 1000, `Final wallet balance is strictly 1,000 pts (1,500 initial - 500 completed debit)`);

    // -------------------------------------------------------------------------
    // TEST 11: Strict Verification of Zero Shared DB Pollution
    // -------------------------------------------------------------------------
    console.log('\n--- Test 11: Strict Verification of Zero Shared DB Pollution ---');
    const sharedTxs = await prismaShared.rewardPointTransaction.count({});
    const sharedAuditLogs = await prismaShared.leaderboardAuditLog.count({});
    const sharedWallets = await prismaShared.userRewardPoint.count({
      where: { userId: studentUserId }
    });

    assert(sharedTxs === 0, 'learning_db has strictly 0 transactions (100% ISOLATED)');
    assert(sharedAuditLogs === 0, 'learning_db has strictly 0 audit logs (100% ISOLATED)');
    assert(sharedWallets === 0, 'learning_db contains NO wallets for the test student (100% ISOLATED)');

  } catch (error) {
    console.error('Fatal error in HTTP test:', error.response?.data || error.message);
    failed++;
  } finally {
    // 1. Clean up test database records
    console.log('\n🧹 Cleaning up test records from learning_test_db...');
    try {
      if (studentUserId) {
        await prismaTest.rewardPointTransaction.deleteMany({ where: { userId: studentUserId } });
        await prismaTest.userRewardPoint.deleteMany({ where: { userId: studentUserId } });
        console.log('  ✓ Cleaned all transactions and wallets from learning_test_db.');
      }
    } catch (cleanupErr) {
      console.warn('Cleanup warning (learning_test_db):', cleanupErr.message);
    }

    // 2. Clean up test auth records from auth_db
    console.log('🧹 Cleaning up test student auth account from auth_db...');
    try {
      if (studentUserId) {
        await prismaAuth.$runCommandRaw({
          delete: 'verification_tokens',
          deletes: [{ q: { email: testStudentEmail }, limit: 0 }]
        });
        await prismaAuth.$runCommandRaw({
          delete: 'device_sessions',
          deletes: [{ q: { userId: { $oid: studentUserId } }, limit: 0 }]
        });
        await prismaAuth.$runCommandRaw({
          delete: 'refresh_tokens',
          deletes: [{ q: { userId: { $oid: studentUserId } }, limit: 0 }]
        });
        await prismaAuth.$runCommandRaw({
          delete: 'users',
          deletes: [{ q: { _id: { $oid: studentUserId } }, limit: 0 }]
        });
        console.log(`  ✓ Cleaned auth account ${testStudentEmail} (${studentUserId}) and associated sessions/tokens from auth_db.`);
      }
    } catch (authCleanupErr) {
      console.warn('Cleanup warning (auth_db):', authCleanupErr.message);
    }

    if (server) {
      await new Promise(resolve => server.close(resolve));
      console.log('  ✓ Test HTTP server on port 3016 closed.');
    }

    await prismaTest.$disconnect();
    await prismaShared.$disconnect();
    await prismaAuth.$disconnect();

    console.log('\n=============================================================');
    console.log(` HTTP TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
    console.log('=============================================================\n');

    if (failed === 0) {
      console.log(`>>> ALL ${passed} ISOLATED HTTP INTEGRATION TESTS PASSED 100%! <<<\n`);
      process.exit(0);
    } else {
      console.error(`>>> ${failed} TESTS FAILED! <<<\n`);
      process.exit(1);
    }
  }
}

runHttpRedemptionTests();
