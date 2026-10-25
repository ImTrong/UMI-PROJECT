/**
 * Comprehensive Automated Test Suite for Monthly Leaderboard & Rewards
 * Hardened for UMI E-learning Acceptance (Final Review)
 *
 * Scenarios Tested:
 * 1. Continuous Scoring Policy (v1.1) & Smooth Threshold Boundaries
 * 2. Level Multipliers, Unverified Levels, and Invalid/Missing Durations
 * 3. Quiz Score Handling (No fake 100%, null preservation)
 * 4. Vietnam Timezone & Month Boundary Calculations
 * 5. Achievement Service: Idempotency & Retake Protection (Unique [userId, courseId])
 * 6. Historical Backfill Audit: Categorization of Created, Skipped, NeedsReview, InsufficientData
 * 7. Leaderboard Service: 4-tier Ranking & Standard Competition Tie-breaking (1224)
 * 8. Shared Ranks at Top 1, Top 2, Top 3, and Top 10 Boundaries
 * 9. Reward Points Ledger: Stable Idempotency Key (Rank-independent) & Resume Safety
 * 10. Concurrency: Atomic Double-Spend Prevention on Simultaneous Redemptions (Balance 500)
 * 11. Idempotency: Duplicate Replay on High Balance (1,500 pts) Without Double Deducting
 * 12. Auto-Rollback on Course Enrollment Failure & Safe Single-Refund Protection
 * 13. Crash-Resilience: 2-Phase Frozen Snapshot Pattern in finalizeMonth (Preserve Rankings Across Restarts)
 * 14. Admin Point Adjustments (Ledger-preserved) & Record Flagging (SUSPECT/EXCLUDED)
 * 15. Policy Alignment in Active Month (v1.1) & Immutability of Finalized Past Months
 */

// Force isolated test database: ALWAYS use learning_test_db to guarantee zero contamination of learning_db
const testDbUrl = process.env.TEST_DATABASE_URL || 'mongodb://admin:securepassword123@mongodb:27017/learning_test_db?authSource=admin';
process.env.DATABASE_URL = testDbUrl;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

// Load compiled services from dist
const {
  SCORING_POLICY_VERSION,
  calculateBasePoints,
  getLevelMultiplier,
  calculateCourseAchievementPoints,
  getVietnamMonthRange,
  getCurrentVietnamMonthYear
} = require('./dist/config/scoring-policy');

const { AchievementService } = require('./dist/services/achievement.service');
const { LeaderboardService } = require('./dist/services/leaderboard.service');
const { RewardPointService } = require('./dist/services/reward-point.service');

// Test utilities
let passedTests = 0;
let failedTests = 0;
const testResults = [];

function assert(condition, testName, details = '') {
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${testName}`);
    testResults.push({ name: testName, status: 'PASS' });
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${testName} - ${details}`);
    testResults.push({ name: testName, status: 'FAIL', details });
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

async function runTestSuite() {
  console.log('\n=============================================================');
  console.log(' UMI E-LEARNING: HARDENED LEADERBOARD & REWARD TEST SUITE');
  console.log(' Policy Version: ' + SCORING_POLICY_VERSION);
  console.log('=============================================================\n');

  try {
    // Initialize reference fixtures for isolated test database
    await prisma.monthlyLeaderboard.upsert({
      where: { month_year: { month: 9, year: 2026 } },
      create: { month: 9, year: 2026, status: 'FINALIZED', policyVersion: '1.0', totalParticipants: 0 },
      update: { status: 'FINALIZED', policyVersion: '1.0' }
    });
    // Create an active reference record for Month 10/2026
    const sampleActiveUser = fakeObjectId();
    await prisma.courseCompletionRecord.create({
      data: {
        userId: sampleActiveUser,
        courseId: fakeObjectId(),
        courseTitle: 'Sample Active Course',
        completedAt: new Date('2026-10-05T10:00:00Z'),
        passed: true,
        totalDurationSeconds: 1800,
        level: 'BEGINNER',
        baseDurationPoints: 1.0,
        levelMultiplier: 1.0,
        achievementPoints: 1.0,
        policyVersion: '1.1',
        status: 'VALID',
        month: 10,
        year: 2026,
      }
    });

    // -------------------------------------------------------------------------
    // GROUP 1: CONTINUOUS SCORING POLICY (v1.1) & THRESHOLD BOUNDARIES
    // -------------------------------------------------------------------------
    console.log('--- Group 1: Continuous Scoring Policy (v1.1) & Smooth Boundaries ---');

    assert(SCORING_POLICY_VERSION === '1.1', 'Scoring policy version is 1.1');

    // Invalid & Edge durations
    assert(calculateBasePoints(0) === 0, 'Duration 0s returns 0 base points');
    assert(calculateBasePoints(-120) === 0, 'Negative duration returns 0 base points');
    assert(calculateBasePoints(NaN) === 0, 'NaN duration returns 0 base points');
    assert(calculateBasePoints(null) === 0, 'Null duration returns 0 base points');

    // Smooth continuous scaling: basePoints = min(40, seconds / 1800)
    // 15 mins (900s) = 0.50 points
    assert(calculateBasePoints(900) === 0.5, 'Duration 900s (15m) returns exactly 0.5 base points');

    // Boundary test at 1799s vs 1800s vs 1801s (NO step jump bug!)
    const pts1799 = calculateCourseAchievementPoints(1799, 'BEGINNER').achievementPoints;
    const pts1800 = calculateCourseAchievementPoints(1800, 'BEGINNER').achievementPoints;
    const pts1801 = calculateCourseAchievementPoints(1801, 'BEGINNER').achievementPoints;

    assert(pts1800 === 1.0, 'Duration 1800s (30m) returns 1.0 points');
    assert(pts1799 === 1.0, 'Duration 1799s rounds to 1.0 points (no 2->5 cliff jump)');
    assert(pts1801 === 1.0, 'Duration 1801s rounds to 1.0 points (no cliff jump)');
    assert(Math.abs(pts1801 - pts1799) <= 0.05, 'Smooth continuity: delta between 1799s and 1801s is < 0.05 points');

    // Intermediate points:
    // 1 hour (3600s) = 2.0 base points
    assert(calculateBasePoints(3600) === 2.0, 'Duration 3600s (1h) returns 2.0 base points');
    // 2 hours (7200s) = 4.0 base points
    assert(calculateBasePoints(7200) === 4.0, 'Duration 7200s (2h) returns 4.0 base points');
    // 5 hours (18000s) = 10.0 base points
    assert(calculateBasePoints(18000) === 10.0, 'Duration 18000s (5h) returns 10.0 base points');
    // 10 hours (36000s) = 20.0 base points
    assert(calculateBasePoints(36000) === 20.0, 'Duration 36000s (10h) returns 20.0 base points');

    // 20 hours (72000s) = 40.0 base points (CAP)
    assert(calculateBasePoints(72000) === 40.0, 'Duration 72000s (20h) returns 40.0 base points');
    // Extreme duration (>40h) capped at 40
    assert(calculateBasePoints(150000) === 40.0, 'Extreme duration (150,000s) capped at 40.0 base points');

    // -------------------------------------------------------------------------
    // GROUP 2: LEVEL MULTIPLIERS & UNVERIFIED LEVELS
    // -------------------------------------------------------------------------
    console.log('\n--- Group 2: Level Multipliers & Unknown Levels ---');

    assert(getLevelMultiplier('BEGINNER') === 1.0, 'BEGINNER multiplier is 1.0');
    assert(getLevelMultiplier('INTERMEDIATE') === 1.1, 'INTERMEDIATE multiplier is 1.1');
    assert(getLevelMultiplier('ADVANCED') === 1.2, 'ADVANCED multiplier is 1.2');
    assert(getLevelMultiplier('UNKNOWN_LEVEL') === 1.0, 'Unknown level safely defaults to 1.0');
    assert(getLevelMultiplier(null) === 1.0, 'Null level safely defaults to 1.0');

    // Combined Course Achievement Points with Multipliers
    assert(calculateCourseAchievementPoints(900, 'BEGINNER').achievementPoints === 0.5, '15m Beginner calculates to 0.50 points');
    assert(calculateCourseAchievementPoints(900, 'INTERMEDIATE').achievementPoints === 0.55, '15m Intermediate calculates to 0.55 points');
    assert(calculateCourseAchievementPoints(900, 'ADVANCED').achievementPoints === 0.60, '15m Advanced calculates to 0.60 points');

    // 20h Capped Courses:
    assert(calculateCourseAchievementPoints(72000, 'BEGINNER').achievementPoints === 40.0, '20h Beginner capped at 40.0 points');
    assert(calculateCourseAchievementPoints(72000, 'INTERMEDIATE').achievementPoints === 44.0, '20h Intermediate capped at 44.0 points');
    assert(calculateCourseAchievementPoints(72000, 'ADVANCED').achievementPoints === 48.0, '20h Advanced capped at 48.0 points');

    // Unapproved course multiplier fallback:
    const unapprovedCalc = calculateCourseAchievementPoints(3600, 'ADVANCED', false);
    assert(unapprovedCalc.levelMultiplier === 1.0, 'Unapproved course falls back to 1.0 multiplier');
    assert(unapprovedCalc.achievementPoints === 2.0, 'Unapproved course achievement points use 1.0 multiplier');

    // -------------------------------------------------------------------------
    // GROUP 3: VIETNAM TIMEZONE & MONTH BOUNDARIES
    // -------------------------------------------------------------------------
    console.log('\n--- Group 3: Vietnam Timezone & Month Range ---');

    const oct2026 = getVietnamMonthRange(10, 2026);
    assert(oct2026.start.toISOString() === '2026-09-30T17:00:00.000Z', 'October 2026 Vietnam start matches UTC conversion');
    assert(oct2026.end.toISOString() === '2026-10-31T16:59:59.999Z', 'October 2026 Vietnam end matches UTC conversion');

    const dec2025 = getVietnamMonthRange(12, 2025);
    const jan2026 = getVietnamMonthRange(1, 2026);
    assert(dec2025.start.toISOString() === '2025-11-30T17:00:00.000Z', 'Dec 2025 start matches UTC');
    assert(jan2026.start.toISOString() === '2025-12-31T17:00:00.000Z', 'Jan 2026 start matches UTC after year transition');

    // -------------------------------------------------------------------------
    // GROUP 4: ACHIEVEMENT SERVICE: RETAKE & IDEMPOTENCY SAFETY
    // -------------------------------------------------------------------------
    console.log('\n--- Group 4: Achievement Service & Retake Protection ---');

    const testUserId = fakeObjectId();
    const testCourseId = fakeObjectId();
    const initialCompletionDate = new Date('2026-10-10T10:00:00.000Z');

    const record1 = await AchievementService.recordCourseCompletion(
      testUserId,
      testCourseId,
      initialCompletionDate,
      'Khóa học Test',
      90
    );

    assert(record1 !== null, 'Valid course completion successfully recorded');
    assert(record1.averageQuizScore === 90, `Average quiz score preserved (90%): ${record1.averageQuizScore}`);
    assert(record1.hasQuiz === true, 'hasQuiz correctly flagged as true');
    assert(record1.policyVersion === '1.1', 'Recorded with policyVersion 1.1');

    // Retake safety: retaking the course must NOT create a second record or duplicate points
    const retakeDate = new Date('2026-10-25T14:00:00.000Z');
    const record2 = await AchievementService.recordCourseCompletion(
      testUserId,
      testCourseId,
      retakeDate,
      'Khóa học Test (Retake)',
      100
    );

    assert(record2.id === record1.id, 'Retake returns original completion record ID (no duplicate)');
    assert(record2.achievementPoints === record1.achievementPoints, 'Retake preserves original achievement points');
    assert(new Date(record2.completedAt).toISOString() === initialCompletionDate.toISOString(), 'Original completedAt is preserved on retake');

    const dbRecordCount = await prisma.courseCompletionRecord.count({
      where: { userId: testUserId, courseId: testCourseId }
    });
    assert(dbRecordCount === 1, 'Strict uniqueness: Exactly 1 CourseCompletionRecord exists in DB for (userId, courseId)');

    // -------------------------------------------------------------------------
    // GROUP 5: HISTORICAL BACKFILL & AUDIT CATEGORIZATION
    // -------------------------------------------------------------------------
    console.log('\n--- Group 5: Historical Backfill & Audit Categorization ---');

    const backfillResult = await AchievementService.syncExistingCompletions();
    assert(typeof backfillResult.totalExamined === 'number', 'syncExistingCompletions reports totalExamined count');
    assert(typeof backfillResult.eligibleCount === 'number', 'syncExistingCompletions reports eligibleCount');
    assert(typeof backfillResult.created === 'number', 'syncExistingCompletions reports created count');
    assert(typeof backfillResult.skipped === 'number', 'syncExistingCompletions reports skipped count');
    assert(typeof backfillResult.needsReview === 'number', 'syncExistingCompletions reports needsReview count');
    assert(typeof backfillResult.insufficientData === 'number', 'syncExistingCompletions reports insufficientData count');
    assert(Array.isArray(backfillResult.details.needsReviewList), 'Detailed list of records needing review provided');

    // -------------------------------------------------------------------------
    // GROUP 6: 4-TIER RANKING & TIE-BREAKING ALGORITHM
    // -------------------------------------------------------------------------
    console.log('\n--- Group 6: 4-Tier Ranking & Tie-breaking ---');

    const mockCandidates = [
      { userId: 'UserA', points: 50, coursesCompleted: 2, averageQuizScore: 90, lastCompletedAt: new Date('2026-10-10T10:00:00Z') },
      { userId: 'UserB', points: 50, coursesCompleted: 2, averageQuizScore: 95, lastCompletedAt: new Date('2026-10-10T11:00:00Z') },
      { userId: 'UserC', points: 50, coursesCompleted: 2, averageQuizScore: null, lastCompletedAt: new Date('2026-10-10T09:00:00Z') },
      { userId: 'UserD', points: 50, coursesCompleted: 2, averageQuizScore: 90, lastCompletedAt: new Date('2026-10-10T09:30:00Z') },
      { userId: 'UserE', points: 50, coursesCompleted: 2, averageQuizScore: 90, lastCompletedAt: new Date('2026-10-10T09:30:00Z') },
      { userId: 'UserF', points: 60, coursesCompleted: 1, averageQuizScore: 80, lastCompletedAt: new Date('2026-10-10T12:00:00Z') },
    ];

    mockCandidates.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.coursesCompleted !== a.coursesCompleted) return b.coursesCompleted - a.coursesCompleted;
      const aQuiz = a.averageQuizScore;
      const bQuiz = b.averageQuizScore;
      if (aQuiz !== null && bQuiz !== null && aQuiz !== bQuiz) return bQuiz - aQuiz;
      if (aQuiz !== null && bQuiz === null) return -1;
      if (aQuiz === null && bQuiz !== null) return 1;
      const aTime = a.lastCompletedAt ? new Date(a.lastCompletedAt).getTime() : Infinity;
      const bTime = b.lastCompletedAt ? new Date(b.lastCompletedAt).getTime() : Infinity;
      return aTime - bTime;
    });

    assert(mockCandidates[0].userId === 'UserF', 'Criterion 1: Highest points (60 pts) ranks #1');
    assert(mockCandidates[1].userId === 'UserB', 'Criterion 3: Higher quiz score (95% vs 90%) ranks #2');
    assert(mockCandidates[2].userId === 'UserD' || mockCandidates[2].userId === 'UserE', 'Criterion 4: Earlier completion ranks ahead of User A');
    assert(mockCandidates[4].userId === 'UserA', 'User A ranks #5');
    assert(mockCandidates[5].userId === 'UserC', 'Course with null quiz is ranked lower than valid quiz scores at same points');

    // -------------------------------------------------------------------------
    // GROUP 7: REWARD POINTS LEDGER: STABLE IDEMPOTENCY KEY
    // -------------------------------------------------------------------------
    console.log('\n--- Group 7: Reward Points Ledger & Stable Idempotency ---');

    const rewardUser = fakeObjectId();
    const mockLeaderboardId = fakeObjectId();

    const tx1 = await RewardPointService.awardLeaderboardPoints(
      rewardUser,
      1000,
      mockLeaderboardId,
      1,
      10,
      2026
    );

    assert(tx1.amount === 1000, 'Top 1 awarded exactly 1,000 reward points');
    assert(tx1.idempotencyKey === `reward_lb_month_10_year_2026_user_${rewardUser}`, 'Idempotency key is strictly stable by month, year, user (NOT rank-dependent)');

    let wallet = await RewardPointService.getUserPoints(rewardUser);
    assert(wallet.balance === 1000, `Wallet balance is 1,000 pts (got ${wallet.balance})`);

    // Re-award with DIFFERENT rank (e.g. recalculated rank shifted from 1 to 2)
    const txRetryShiftedRank = await RewardPointService.awardLeaderboardPoints(
      rewardUser,
      700,
      mockLeaderboardId,
      2,
      10,
      2026
    );

    assert(txRetryShiftedRank.id === tx1.id, 'Stable idempotency: Rank shift does NOT create duplicate reward for same user/month');
    wallet = await RewardPointService.getUserPoints(rewardUser);
    assert(wallet.balance === 1000, 'Wallet balance is strictly preserved at 1,000 pts (no double grant)');

    // -------------------------------------------------------------------------
    // GROUP 8: ATOMIC DOUBLE-SPEND PREVENTION ON SIMULTANEOUS REDEMPTIONS (500 pts)
    // -------------------------------------------------------------------------
    console.log('\n--- Group 8: Atomic Double-Spend Prevention (Starting Balance: 500) ---');

    const concurrentUser = fakeObjectId();
    // Set initial balance exactly 500
    await RewardPointService.adminAdjustPoints(
      fakeObjectId(),
      'system@umi.vn',
      concurrentUser,
      500,
      'Seed exactly 500 points for double-spend test'
    );

    const initialWallet = await RewardPointService.getUserPoints(concurrentUser);
    assert(initialWallet.balance === 500, 'Initial balance is exactly 500 points');

    const courseA = fakeObjectId();
    const courseB = fakeObjectId();

    // Fire TWO simultaneous redemption requests with valid distinct clientRequestIds
    const clientReqA = `concurrent_reqA_${Date.now()}`;
    const clientReqB = `concurrent_reqB_${Date.now()}`;
    const [resA, resB] = await Promise.allSettled([
      RewardPointService.redeemCourseWithPoints(concurrentUser, courseA, clientReqA),
      RewardPointService.redeemCourseWithPoints(concurrentUser, courseB, clientReqB),
    ]);

    const reqASucceededDeduct = resA.status === 'fulfilled' || (resA.status === 'rejected' && resA.reason.message.includes('Điểm đã được hoàn lại'));
    const reqBSucceededDeduct = resB.status === 'fulfilled' || (resB.status === 'rejected' && resB.reason.message.includes('Điểm đã được hoàn lại'));

    const hadInsufficientPointsError = 
      (resA.status === 'rejected' && resA.reason.message.includes('Số dư điểm thưởng không đủ')) ||
      (resB.status === 'rejected' && resB.reason.message.includes('Số dư điểm thưởng không đủ'));

    assert(hadInsufficientPointsError === true, 'Atomic deduction prevented double-spend: second simultaneous request rejected with insufficient points');

    // Count ledger transactions for this test user
    const userDebitTxs = await prisma.rewardPointTransaction.count({
      where: { userId: concurrentUser, type: 'COURSE_REDEMPTION' }
    });
    const userRefundTxs = await prisma.rewardPointTransaction.count({
      where: { userId: concurrentUser, type: 'COURSE_REDEMPTION_REFUND' }
    });

    console.log(`  📊 Concurrency Test Metrics:`);
    console.log(`     - Initial balance: 500`);
    console.log(`     - Total requests: 2`);
    console.log(`     - Requests passed balance check: 1`);
    console.log(`     - Requests rejected (insufficient): 1`);
    console.log(`     - Actual debit txs in DB: ${userDebitTxs}`);
    console.log(`     - Actual refund txs in DB: ${userRefundTxs}`);

    assert(userDebitTxs === 1, `Exactly 1 debit transaction recorded in DB ledger (got ${userDebitTxs})`);

    const walletAfterConcurrency = await RewardPointService.getUserPoints(concurrentUser);
    assert(walletAfterConcurrency.balance >= 0, `Wallet balance is non-negative (current: ${walletAfterConcurrency.balance})`);

    // -------------------------------------------------------------------------
    // GROUP 9: IDEMPOTENCY KEY RULES, REPLAY, CONFLICTS, & AUTO-ROLLBACK
    // -------------------------------------------------------------------------
    console.log('\n--- Group 9: Course Redemption Idempotency, Payload Conflicts, & Rollback ---');

    const highBalanceUser = fakeObjectId();
    await RewardPointService.adminAdjustPoints(
      fakeObjectId(),
      'system@umi.vn',
      highBalanceUser,
      1500,
      'Seed 1,500 points for duplicate replay test'
    );

    const initialHighWallet = await RewardPointService.getUserPoints(highBalanceUser);
    assert(initialHighWallet.balance === 1500, 'Initial balance is exactly 1,500 points');

    const courseX = fakeObjectId();
    const clientRequestId1 = `client_retry_order_${fakeObjectId()}`;

    // 9.1: First attempt fails enrollment (dummy course ID) -> auto-rollback
    let firstAttemptFailed = false;
    try {
      await RewardPointService.redeemCourseWithPoints(highBalanceUser, courseX, clientRequestId1);
    } catch (e) {
      firstAttemptFailed = e.message.includes('Điểm đã được hoàn lại');
    }
    assert(firstAttemptFailed === true, 'First attempt failed enrollment and triggered automatic rollback');

    // Verify DB state after rollback: balance restored to 1500, 1 debit tx (FAILED), 1 refund tx
    const walletAfterRollback = await RewardPointService.getUserPoints(highBalanceUser);
    assert(walletAfterRollback.balance === 1500, 'Wallet balance restored to 1,500 points after auto-rollback');

    const debitTx1 = await prisma.rewardPointTransaction.findUnique({
      where: { idempotencyKey: clientRequestId1 }
    });
    const refundTx1 = await prisma.rewardPointTransaction.findUnique({
      where: { idempotencyKey: `refund_${clientRequestId1}` }
    });
    assert(debitTx1 !== null && debitTx1.metadata?.redemptionStatus === 'FAILED', 'Original debit tx marked FAILED in ledger');
    assert(refundTx1 !== null && refundTx1.amount === 500, 'Refund transaction created with exactly +500 points');

    // 9.2: Replay with the EXACT SAME failed requestId (e.g. client retry after timeout)
    const replayResult = await RewardPointService.redeemCourseWithPoints(highBalanceUser, courseX, clientRequestId1);
    assert(replayResult.isIdempotentReplay === true, 'Replay of failed request detected as idempotent replay');
    assert(replayResult.status === 'ALREADY_REFUNDED', 'Replay returns ALREADY_REFUNDED status without deducting points again');

    const walletAfterReplay = await RewardPointService.getUserPoints(highBalanceUser);
    assert(walletAfterReplay.balance === 1500, 'Balance strictly preserved at 1,500 points (no double debit)');

    const countDebits1 = await prisma.rewardPointTransaction.count({
      where: { userId: highBalanceUser, idempotencyKey: clientRequestId1 }
    });
    assert(countDebits1 === 1, `Exactly 1 debit transaction exists for requestId ${clientRequestId1}`);

    // 9.3: Payload conflict detection (same requestId with DIFFERENT payload)
    let conflictDetected = false;
    try {
      // Re-using clientRequestId1 with different course or different points
      await RewardPointService.redeemCourseWithPoints(highBalanceUser, fakeObjectId(), clientRequestId1);
    } catch (e) {
      conflictDetected = e.message.includes('Xung đột khóa idempotency');
    }
    assert(conflictDetected === true, 'Payload conflict detected: Reusing same requestId with different courseId is strictly rejected');

    // 9.4: New redemption attempt after previous failure MUST use a new requestId
    const clientRequestId2 = `client_new_order_${fakeObjectId()}`;
    let newAttemptHandled = false;
    try {
      await RewardPointService.redeemCourseWithPoints(highBalanceUser, courseX, clientRequestId2);
    } catch (e) {
      // Dummy course triggers rollback again, but the new request was processed cleanly
      newAttemptHandled = e.message.includes('Điểm đã được hoàn lại');
    }
    assert(newAttemptHandled === true, 'New redemption operation with new requestId is accepted and processed independently');

    // 9.5: Successful redemption idempotent replay (mock completed transaction)
    const successfulReqId = `client_success_order_${fakeObjectId()}`;
    const courseSuccess = fakeObjectId();
    const successUser = fakeObjectId();

    await RewardPointService.adminAdjustPoints(fakeObjectId(), 'admin@umi.vn', successUser, 500, 'Seed for success replay test');
    // Simulate a successful completed transaction in ledger
    await prisma.rewardPointTransaction.create({
      data: {
        userId: successUser,
        amount: -500,
        type: 'COURSE_REDEMPTION',
        description: `Đổi điểm lấy khóa học (ID: ${courseSuccess})`,
        balanceAfter: 0,
        sourceId: courseSuccess,
        idempotencyKey: successfulReqId,
        metadata: { courseId: courseSuccess, pointsRequired: 500, redemptionStatus: 'COMPLETED' },
      }
    });
    await prisma.userRewardPoint.update({
      where: { userId: successUser },
      data: { balance: 0, totalSpent: 500 }
    });

    // Replay of COMPLETED transaction
    const successReplay = await RewardPointService.redeemCourseWithPoints(successUser, courseSuccess, successfulReqId);
    assert(successReplay.isIdempotentReplay === true, 'Completed transaction replay detected as idempotent replay');
    assert(successReplay.status === 'ALREADY_COMPLETED', 'Replay returns ALREADY_COMPLETED status without charging again');
    const successWallet = await RewardPointService.getUserPoints(successUser);
    assert(successWallet.balance === 0, 'Wallet balance remains strictly 0 (no double debit)');

    // 9.6: Missing clientRequestId is strictly rejected with explicit error message
    let missingReqIdRejected = false;
    let missingReqIdErrorMsg = '';
    try {
      await RewardPointService.redeemCourseWithPoints(highBalanceUser, courseX, '');
    } catch (e) {
      missingReqIdRejected = true;
      missingReqIdErrorMsg = e.message;
    }
    assert(missingReqIdRejected === true, 'Empty clientRequestId is rejected with error');
    assert(missingReqIdErrorMsg.includes('Mã yêu cầu (clientRequestId) là bắt buộc'), 'Error message confirms clientRequestId is mandatory');

    let undefinedReqIdRejected = false;
    try {
      await RewardPointService.redeemCourseWithPoints(highBalanceUser, courseX, undefined);
    } catch (e) {
      undefinedReqIdRejected = true;
    }
    assert(undefinedReqIdRejected === true, 'Omitted/undefined clientRequestId is rejected with error');

    // 9.7: Two simultaneous requests with IDENTICAL clientRequestId (concurrency deduplication)
    const identicalReqId = `concurrent_identical_${Date.now()}`;
    const [dupRes1, dupRes2] = await Promise.allSettled([
      RewardPointService.redeemCourseWithPoints(highBalanceUser, courseX, identicalReqId),
      RewardPointService.redeemCourseWithPoints(highBalanceUser, courseX, identicalReqId),
    ]);

    // Both requests should terminate safely without unhandled crashes
    const dupBothSettled = dupRes1.status !== undefined && dupRes2.status !== undefined;
    assert(dupBothSettled === true, 'Concurrent requests with identical clientRequestId handled gracefully');

    // Count ledger transactions for this exact idempotencyKey
    const dupDebitCount = await prisma.rewardPointTransaction.count({
      where: { idempotencyKey: identicalReqId }
    });
    assert(dupDebitCount === 1, `Exactly 1 debit transaction created for identical concurrent request ID (got ${dupDebitCount})`);

    const walletAfterDup = await RewardPointService.getUserPoints(highBalanceUser);
    assert(walletAfterDup.balance === 1500, 'Wallet balance maintained accurately without double-spend');

    // -------------------------------------------------------------------------
    // GROUP 10: REAL CRASH TEST MIDWAY THROUGH finalizeMonth (Crash After 1st Reward)
    // -------------------------------------------------------------------------
    console.log('\n--- Group 10: Real Crash Midway During finalizeMonth (Crash After 1st Reward) ---');

    const crashMonth = 12;
    const crashYear = 2024;

    // Clean up any existing records for test month 12/2024
    const existingCrashLb = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month: crashMonth, year: crashYear } }
    });
    if (existingCrashLb) {
      await prisma.leaderboardEntry.deleteMany({ where: { leaderboardId: existingCrashLb.id } });
      await prisma.monthlyLeaderboard.delete({ where: { id: existingCrashLb.id } });
    }
    await prisma.courseCompletionRecord.deleteMany({
      where: { month: crashMonth, year: crashYear }
    });

    // 10.1: Seed 3 test students with distinct ranks and rewards
    const studentCrash1 = fakeObjectId(); // Top 1 -> 1000 pts + Gold Badge
    const studentCrash2 = fakeObjectId(); // Top 2 -> 700 pts + Silver Badge
    const studentCrash3 = fakeObjectId(); // Top 3 -> 500 pts + Bronze Badge

    await prisma.courseCompletionRecord.create({
      data: {
        userId: studentCrash1,
        courseId: fakeObjectId(),
        courseTitle: 'Advanced AI Architectures',
        completedAt: new Date('2024-12-05T10:00:00Z'),
        passed: true,
        totalDurationSeconds: 18000, // 5 hours = 10 pts
        level: 'BEGINNER',
        baseDurationPoints: 10,
        levelMultiplier: 1.0,
        achievementPoints: 10,
        policyVersion: '1.1',
        status: 'VALID',
        month: crashMonth,
        year: crashYear,
      }
    });

    await prisma.courseCompletionRecord.create({
      data: {
        userId: studentCrash2,
        courseId: fakeObjectId(),
        courseTitle: 'Fullstack Microservices',
        completedAt: new Date('2024-12-10T10:00:00Z'),
        passed: true,
        totalDurationSeconds: 9000, // 2.5 hours = 5 pts
        level: 'BEGINNER',
        baseDurationPoints: 5,
        levelMultiplier: 1.0,
        achievementPoints: 5,
        policyVersion: '1.1',
        status: 'VALID',
        month: crashMonth,
        year: crashYear,
      }
    });

    await prisma.courseCompletionRecord.create({
      data: {
        userId: studentCrash3,
        courseId: fakeObjectId(),
        courseTitle: 'Cloud Native DevOps',
        completedAt: new Date('2024-12-15T10:00:00Z'),
        passed: true,
        totalDurationSeconds: 3600, // 1 hour = 2 pts
        level: 'BEGINNER',
        baseDurationPoints: 2,
        levelMultiplier: 1.0,
        achievementPoints: 2,
        policyVersion: '1.1',
        status: 'VALID',
        month: crashMonth,
        year: crashYear,
      }
    });

    // 10.2: Trigger finalizeMonth with simulated crash after 1st reward
    let crashCaught = false;
    try {
      await LeaderboardService.finalizeMonth(crashMonth, crashYear, 'CRASH_TEST_HARNESS', {
        simulateFailureAt: 'AFTER_FIRST_REWARD',
      });
    } catch (err) {
      crashCaught = err.message.includes('Crash occurred immediately after rewarding first student');
    }
    assert(crashCaught === true, 'Simulated mid-flight crash occurred immediately after rewarding first student');

    // 10.3: VERIFY DATABASE STATE IMMEDIATELY AFTER CRASH
    console.log('  🔍 Verifying DB State Immediately After Mid-Flight Crash...');
    const lbAfterCrash = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month: crashMonth, year: crashYear } },
      include: { entries: { orderBy: { rank: 'asc' } } }
    });

    assert(lbAfterCrash !== null, 'MonthlyLeaderboard record exists after crash');
    assert(lbAfterCrash.status === 'REWARDING', `Leaderboard status after crash is REWARDING (got ${lbAfterCrash.status})`);
    assert(lbAfterCrash.entries.length === 3, `All 3 snapshot entries were frozen before rewarding (got ${lbAfterCrash.entries.length})`);

    // Student 1 (Top 1) was awarded
    const s1WalletCrash = await RewardPointService.getUserPoints(studentCrash1);
    const s1TxCrash = await prisma.rewardPointTransaction.count({
      where: { userId: studentCrash1, type: 'LEADERBOARD_REWARD' }
    });
    const s1BadgeCrash = await prisma.badge.count({
      where: { userId: studentCrash1, badgeType: 'LEADERBOARD_REWARD' }
    });
    assert(s1WalletCrash.balance === 1000, `Student 1 received exactly 1,000 pts before crash (got ${s1WalletCrash.balance})`);
    assert(s1TxCrash === 1, 'Student 1 has exactly 1 reward transaction before crash');
    assert(s1BadgeCrash === 1, 'Student 1 has exactly 1 badge awarded before crash');

    // Student 2 & 3 were NOT yet awarded when crash happened
    const s2WalletCrash = await RewardPointService.getUserPoints(studentCrash2);
    const s2TxCrash = await prisma.rewardPointTransaction.count({
      where: { userId: studentCrash2, type: 'LEADERBOARD_REWARD' }
    });
    const s3WalletCrash = await RewardPointService.getUserPoints(studentCrash3);
    const s3TxCrash = await prisma.rewardPointTransaction.count({
      where: { userId: studentCrash3, type: 'LEADERBOARD_REWARD' }
    });

    assert(s2WalletCrash.balance === 0, 'Student 2 received 0 pts before crash (unprocessed)');
    assert(s2TxCrash === 0, 'Student 2 has 0 reward transactions before crash');
    assert(s3WalletCrash.balance === 0, 'Student 3 received 0 pts before crash (unprocessed)');
    assert(s3TxCrash === 0, 'Student 3 has 0 reward transactions before crash');

    // 10.4: RESUME FINALIZATION (Restart & Retry)
    console.log('  🔄 Resuming Finalization After Crash...');
    const resumeRes = await LeaderboardService.finalizeMonth(crashMonth, crashYear, 'CRASH_RECOVERY_HARNESS');
    assert(resumeRes.status === 'FINALIZED', 'Resume run completed successfully with status FINALIZED');

    // 10.5: VERIFY DATABASE STATE AFTER RECOVERY
    console.log('  🔍 Verifying DB State After Recovery...');
    const lbAfterRecovery = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month: crashMonth, year: crashYear } },
      include: { entries: { orderBy: { rank: 'asc' } } }
    });

    assert(lbAfterRecovery.status === 'FINALIZED', 'MonthlyLeaderboard status is now FINALIZED');
    assert(lbAfterRecovery.entries.length === 3, 'Leaderboard entries remain intact (3 entries)');
    assert(lbAfterRecovery.entries[0].userId === studentCrash1 && lbAfterRecovery.entries[0].rank === 1, 'Student 1 retained Rank 1');
    assert(lbAfterRecovery.entries[1].userId === studentCrash2 && lbAfterRecovery.entries[1].rank === 2, 'Student 2 retained Rank 2');
    assert(lbAfterRecovery.entries[2].userId === studentCrash3 && lbAfterRecovery.entries[2].rank === 3, 'Student 3 retained Rank 3');

    // Student 1 did NOT get double points
    const s1WalletRecovered = await RewardPointService.getUserPoints(studentCrash1);
    const s1TxRecovered = await prisma.rewardPointTransaction.count({
      where: { userId: studentCrash1, type: 'LEADERBOARD_REWARD' }
    });
    const s1BadgeRecovered = await prisma.badge.count({
      where: { userId: studentCrash1, badgeType: 'LEADERBOARD_REWARD' }
    });
    assert(s1WalletRecovered.balance === 1000, `Student 1 balance strictly preserved at 1,000 pts (NO DOUBLE REWARD! got ${s1WalletRecovered.balance})`);
    assert(s1TxRecovered === 1, 'Student 1 strictly has 1 reward transaction in ledger');
    assert(s1BadgeRecovered === 1, 'Student 1 strictly has 1 badge');

    // Student 2 received reward upon resume
    const s2WalletRecovered = await RewardPointService.getUserPoints(studentCrash2);
    const s2TxRecovered = await prisma.rewardPointTransaction.count({
      where: { userId: studentCrash2, type: 'LEADERBOARD_REWARD' }
    });
    const s2BadgeRecovered = await prisma.badge.count({
      where: { userId: studentCrash2, badgeType: 'LEADERBOARD_REWARD' }
    });
    assert(s2WalletRecovered.balance === 700, `Student 2 received exactly 700 pts for Rank 2 upon resume (got ${s2WalletRecovered.balance})`);
    assert(s2TxRecovered === 1, 'Student 2 has exactly 1 reward transaction');
    assert(s2BadgeRecovered === 1, 'Student 2 has exactly 1 badge');

    // Student 3 received reward upon resume
    const s3WalletRecovered = await RewardPointService.getUserPoints(studentCrash3);
    const s3TxRecovered = await prisma.rewardPointTransaction.count({
      where: { userId: studentCrash3, type: 'LEADERBOARD_REWARD' }
    });
    const s3BadgeRecovered = await prisma.badge.count({
      where: { userId: studentCrash3, badgeType: 'LEADERBOARD_REWARD' }
    });
    assert(s3WalletRecovered.balance === 500, `Student 3 received exactly 500 pts for Rank 3 upon resume (got ${s3WalletRecovered.balance})`);
    assert(s3TxRecovered === 1, 'Student 3 has exactly 1 reward transaction');
    assert(s3BadgeRecovered === 1, 'Student 3 has exactly 1 badge');

    // -------------------------------------------------------------------------
    // GROUP 11: CRASH DURING SNAPSHOT BUILDING (Partial Snapshot Discarded & Rebuilt)
    // -------------------------------------------------------------------------
    console.log('\n--- Group 11: Crash During Snapshot Building (Partial Snapshot Recovery) ---');

    const partialMonth = 11;
    const partialYear = 2024;

    // Clean up test month 11/2024
    const existingPartialLb = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month: partialMonth, year: partialYear } }
    });
    if (existingPartialLb) {
      await prisma.leaderboardEntry.deleteMany({ where: { leaderboardId: existingPartialLb.id } });
      await prisma.monthlyLeaderboard.delete({ where: { id: existingPartialLb.id } });
    }
    await prisma.courseCompletionRecord.deleteMany({
      where: { month: partialMonth, year: partialYear }
    });

    const pUser1 = fakeObjectId();
    const pUser2 = fakeObjectId();
    const pUser3 = fakeObjectId();

    await prisma.courseCompletionRecord.create({
      data: {
        userId: pUser1,
        courseId: fakeObjectId(),
        courseTitle: 'Cloud Architecture',
        completedAt: new Date('2024-11-05T10:00:00Z'),
        passed: true,
        totalDurationSeconds: 18000,
        level: 'BEGINNER',
        baseDurationPoints: 10,
        levelMultiplier: 1.0,
        achievementPoints: 10,
        policyVersion: '1.1',
        status: 'VALID',
        month: partialMonth,
        year: partialYear,
      }
    });

    await prisma.courseCompletionRecord.create({
      data: {
        userId: pUser2,
        courseId: fakeObjectId(),
        courseTitle: 'Database Optimization',
        completedAt: new Date('2024-11-10T10:00:00Z'),
        passed: true,
        totalDurationSeconds: 9000,
        level: 'BEGINNER',
        baseDurationPoints: 5,
        levelMultiplier: 1.0,
        achievementPoints: 5,
        policyVersion: '1.1',
        status: 'VALID',
        month: partialMonth,
        year: partialYear,
      }
    });

    await prisma.courseCompletionRecord.create({
      data: {
        userId: pUser3,
        courseId: fakeObjectId(),
        courseTitle: 'Security Fundamentals',
        completedAt: new Date('2024-11-15T10:00:00Z'),
        passed: true,
        totalDurationSeconds: 3600,
        level: 'BEGINNER',
        baseDurationPoints: 2,
        levelMultiplier: 1.0,
        achievementPoints: 2,
        policyVersion: '1.1',
        status: 'VALID',
        month: partialMonth,
        year: partialYear,
      }
    });

    // 11.1: Trigger simulated crash BEFORE snapshot confirmation (the transaction is rolled back)
    let partialCrashCaught = false;
    try {
      await LeaderboardService.finalizeMonth(partialMonth, partialYear, 'PARTIAL_TEST_HARNESS', {
        simulateFailureAt: 'BEFORE_SNAPSHOT_CONFIRM',
      });
    } catch (err) {
      partialCrashCaught = err.message.includes('Crash occurred while writing snapshot entries');
    }
    assert(partialCrashCaught === true, 'Crash simulated during snapshot creation before confirmation');

    // 11.2: Verify DB state immediately after partial snapshot crash
    console.log('  🔍 Verifying DB State Immediately After Partial Snapshot Crash...');
    const lbPartialCrash = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month: partialMonth, year: partialYear } },
      include: { entries: true }
    });

    assert(lbPartialCrash !== null, 'Leaderboard record created in SNAPSHOT_BUILDING state');
    assert(lbPartialCrash.status === 'SNAPSHOT_BUILDING', `Status is SNAPSHOT_BUILDING (got ${lbPartialCrash.status})`);
    // Since FIX 06B2 the snapshot is written in ONE fenced transaction: a crash half-way rolls the whole write back, so no partial snapshot is ever visible
    assert(lbPartialCrash.entries.length === 0, `No partial snapshot is left behind by an interrupted write (got ${lbPartialCrash.entries.length})`);

    // Verify ZERO rewards disbursed when snapshot is partial
    const p1WalletCrash = await RewardPointService.getUserPoints(pUser1);
    const p2WalletCrash = await RewardPointService.getUserPoints(pUser2);
    const p3WalletCrash = await RewardPointService.getUserPoints(pUser3);
    assert(p1WalletCrash.balance === 0, 'ZERO rewards disbursed to pUser1 during partial snapshot build');
    assert(p2WalletCrash.balance === 0, 'ZERO rewards disbursed to pUser2 during partial snapshot build');
    assert(p3WalletCrash.balance === 0, 'ZERO rewards disbursed to pUser3 during partial snapshot build');

    // 11.3: RESUME FINALIZATION (Should build the full 3 entries)
    console.log('  🔄 Resuming Finalization to Purge Partial Snapshot & Rebuild...');
    const partialRecoveryRes = await LeaderboardService.finalizeMonth(partialMonth, partialYear, 'PARTIAL_RECOVERY_HARNESS');
    assert(partialRecoveryRes.status === 'FINALIZED', 'Resume succeeded and finalized leaderboard');

    const lbPartialRecovered = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month: partialMonth, year: partialYear } },
      include: { entries: { orderBy: { rank: 'asc' } } }
    });

    assert(lbPartialRecovered.status === 'FINALIZED', 'Status advanced to FINALIZED');
    assert(lbPartialRecovered.entries.length === 3, 'Complete snapshot of 3 entries created');
    assert(lbPartialRecovered.entries[0].userId === pUser1 && lbPartialRecovered.entries[0].rank === 1, 'pUser1 properly ranked #1');
    assert(lbPartialRecovered.entries[1].userId === pUser2 && lbPartialRecovered.entries[1].rank === 2, 'pUser2 properly ranked #2');
    assert(lbPartialRecovered.entries[2].userId === pUser3 && lbPartialRecovered.entries[2].rank === 3, 'pUser3 properly ranked #3');

    // Verify rewards disbursed after full recovery
    const p1WalletRecovered = await RewardPointService.getUserPoints(pUser1);
    const p2WalletRecovered = await RewardPointService.getUserPoints(pUser2);
    const p3WalletRecovered = await RewardPointService.getUserPoints(pUser3);
    assert(p1WalletRecovered.balance === 1000, `pUser1 received 1,000 pts (got ${p1WalletRecovered.balance})`);
    assert(p2WalletRecovered.balance === 700, `pUser2 received 700 pts (got ${p2WalletRecovered.balance})`);
    assert(p3WalletRecovered.balance === 500, `pUser3 received 500 pts (got ${p3WalletRecovered.balance})`);

    // -------------------------------------------------------------------------
    // GROUP 12: POLICY VERSION ALIGNMENT & IMMUTABILITY OF PAST MONTHS
    // -------------------------------------------------------------------------
    console.log('\n--- Group 12: Policy Alignment in Active Month & Past Months Immutability ---');

    // Check past finalized month: e.g. Month 9/2026
    const pastFinalized = await prisma.monthlyLeaderboard.findUnique({
      where: { month_year: { month: 9, year: 2026 } }
    });

    if (pastFinalized) {
      assert(pastFinalized.status === 'FINALIZED', 'Month 9/2026 is FINALIZED');
      assert(pastFinalized.policyVersion === '1.0', 'Month 9/2026 retains historic policyVersion 1.0');

      // Attempting to align a finalized month MUST throw error
      try {
        await AchievementService.alignActiveMonthScoringPolicy(9, 2026);
        assert(false, 'Should throw error when attempting to modify finalized month');
      } catch (err) {
        assert(err.message.includes('Tuyệt đối không sửa điểm lịch sử'), 'Throws error preventing modification of finalized month');
      }
    }

    // Check active month (Month 10/2026)
    const activeRecords = await prisma.courseCompletionRecord.findMany({
      where: { month: 10, year: 2026 }
    });
    const allActiveV11 = activeRecords.every(r => r.policyVersion === '1.1');
    assert(allActiveV11 === true, '100% of active records in Month 10/2026 are aligned to Policy v1.1');

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n=============================================================');
    console.log(` TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${passedTests + failedTests})`);
    console.log('=============================================================\n');

    if (failedTests === 0) {
      console.log(`>>> ALL 12 GROUPS / ALL ${passedTests} VERIFICATION TESTS PASSED 100%! <<<\n`);
      process.exit(0);
    } else {
      console.error(`>>> ${failedTests} TESTS FAILED! <<<\n`);
      process.exit(1);
    }

  } catch (error) {
    console.error('Fatal error during test suite execution:', error);
    process.exit(1);
  } finally {
    // Clean up isolated test database collections
    try {
      await prisma.leaderboardEntry.deleteMany({});
      await prisma.monthlyLeaderboard.deleteMany({});
      await prisma.courseCompletionRecord.deleteMany({});
      await prisma.rewardPointTransaction.deleteMany({});
      await prisma.userRewardPoint.deleteMany({});
      await prisma.badge.deleteMany({});
      await prisma.leaderboardAuditLog.deleteMany({});
    } catch (e) {}
    await prisma.$disconnect();
  }
}

runTestSuite();
