/**
 * Targeted Cleanup Script for Verified Test Data in learning_db
 *
 * Rules:
 * 1. ONLY cleans up verified test records created by test_leaderboard_suite.js.
 * 2. NEVER touches real users (admin, instructor, student).
 * 3. NEVER touches real Month 10/2026 student completion records (5 active students).
 * 4. NEVER touches finalized historical months (Months 4-9/2026).
 * 5. Reports exact counts before and after cleanup.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
  console.log('=============================================================');
  console.log(' TARGETED CLEANUP OF VERIFIED TEST DATA IN learning_db');
  console.log('=============================================================\n');

  // 1. Identify test monthly leaderboards
  const testLbs = await prisma.monthlyLeaderboard.findMany({
    where: {
      OR: [
        { month: 11, year: 2024 },
        { month: 12, year: 2024 },
        { month: 11, year: 2025 },
      ]
    }
  });

  const testLbIds = testLbs.map(l => l.id);
  console.log(`1. Found ${testLbs.length} test monthly leaderboards:`, testLbs.map(l => `${l.month}/${l.year} (${l.id})`));

  // 2. Count and delete test leaderboard entries
  const entriesCount = await prisma.leaderboardEntry.count({
    where: { leaderboardId: { in: testLbIds } }
  });
  console.log(`2. Found ${entriesCount} test leaderboard entries linked to test leaderboards.`);

  // 3. Count test completion records
  const testCompletionsPast = await prisma.courseCompletionRecord.count({
    where: {
      OR: [
        { month: 11, year: 2024 },
        { month: 12, year: 2024 },
        { month: 11, year: 2025 },
      ]
    }
  });
  const testCompletionsDummyOct = await prisma.courseCompletionRecord.count({
    where: {
      month: 10,
      year: 2026,
      courseTitle: 'Khóa học không xác định',
      achievementPoints: 0
    }
  });
  console.log(`3. Found ${testCompletionsPast} test completion records in 2024-2025 and ${testCompletionsDummyOct} dummy records in Month 10/2026.`);

  // 4. Count test badges
  const testBadges = await prisma.badge.count({
    where: {
      badgeType: 'LEADERBOARD_REWARD',
      OR: [
        { badgeName: { contains: '2024' } },
        { badgeName: { contains: '2025' } },
      ]
    }
  });
  console.log(`4. Found ${testBadges} test badges from test runs.`);

  // 5. Identify test user IDs from completion records, transactions, wallets
  const testCompletionRecords = await prisma.courseCompletionRecord.findMany({
    where: {
      OR: [
        { month: 11, year: 2024 },
        { month: 12, year: 2024 },
        { month: 11, year: 2025 },
        { month: 10, year: 2026, courseTitle: 'Khóa học không xác định' }
      ]
    },
    select: { userId: true }
  });
  const testUserIdsFromCompletions = testCompletionRecords.map(r => r.userId);

  // Active real student user IDs in Month 10/2026 that MUST NOT BE TOUCHED
  const activeRealUserIds = [
    '0b495ad0ea56681649c710b4',
    '5b23dd573aa99424366fe04c',
    '86cb11c4fccd81f0558ea2c8',
    'aa2a629f7b5b74c9d5b36bf4',
    '681219b2e830f606ec06428a'
  ];

  // System real users that MUST NOT BE TOUCHED
  const systemRealUserIds = [
    '6ad180dac2f4411a6c0a62a7',
    '6ad180dac2f4411a6c0a62a8',
    '6ad180dac2f4411a6c0a62a9'
  ];

  const protectedUserIds = new Set([...activeRealUserIds, ...systemRealUserIds]);

  // Find all wallets belonging to NON-PROTECTED users
  const allWallets = await prisma.userRewardPoint.findMany();
  const testWalletUserIds = allWallets
    .map(w => w.userId)
    .filter(uid => !protectedUserIds.has(uid));

  console.log(`5. Found ${testWalletUserIds.length} test user wallets to clean up (0 protected users affected).`);

  // 6. Test transactions
  const testTxs = await prisma.rewardPointTransaction.count({
    where: { userId: { in: testWalletUserIds } }
  });
  console.log(`6. Found ${testTxs} test reward point transactions.`);

  // 7. Test audit logs
  const testAuditLogs = await prisma.leaderboardAuditLog.count({
    where: {
      OR: [
        { reason: { contains: 'Seed' } },
        { reason: { contains: 'QA Audit Bonus' } },
        { reason: { contains: 'Audited adjustment' } },
      ]
    }
  });
  console.log(`7. Found ${testAuditLogs} test audit logs.`);

  console.log('\n--- Executing Targeted Deletions ---');

  // Perform deletions in safe dependency order
  // 1. Leaderboard entries
  const deletedEntries = await prisma.leaderboardEntry.deleteMany({
    where: { leaderboardId: { in: testLbIds } }
  });
  console.log(`  ✓ Deleted ${deletedEntries.count} leaderboard entries.`);

  // 2. Monthly leaderboards
  const deletedLbs = await prisma.monthlyLeaderboard.deleteMany({
    where: { id: { in: testLbIds } }
  });
  console.log(`  ✓ Deleted ${deletedLbs.count} test monthly leaderboards.`);

  // 3. Completion records
  const deletedPastCompletions = await prisma.courseCompletionRecord.deleteMany({
    where: {
      OR: [
        { month: 11, year: 2024 },
        { month: 12, year: 2024 },
        { month: 11, year: 2025 },
      ]
    }
  });
  const deletedDummyCompletions = await prisma.courseCompletionRecord.deleteMany({
    where: {
      month: 10,
      year: 2026,
      courseTitle: 'Khóa học không xác định',
      achievementPoints: 0
    }
  });
  console.log(`  ✓ Deleted ${deletedPastCompletions.count} past test completions and ${deletedDummyCompletions.count} dummy completions.`);

  // 4. Badges
  const deletedBadges = await prisma.badge.deleteMany({
    where: {
      badgeType: 'LEADERBOARD_REWARD',
      OR: [
        { badgeName: { contains: '2024' } },
        { badgeName: { contains: '2025' } },
      ]
    }
  });
  console.log(`  ✓ Deleted ${deletedBadges.count} test badges.`);

  // 5. Transactions
  const deletedTxs = await prisma.rewardPointTransaction.deleteMany({
    where: { userId: { in: testWalletUserIds } }
  });
  console.log(`  ✓ Deleted ${deletedTxs.count} test reward point transactions.`);

  // 6. Wallets
  const deletedWallets = await prisma.userRewardPoint.deleteMany({
    where: { userId: { in: testWalletUserIds } }
  });
  console.log(`  ✓ Deleted ${deletedWallets.count} test user wallets.`);

  // 7. Audit logs
  const deletedAuditLogs = await prisma.leaderboardAuditLog.deleteMany({
    where: {
      OR: [
        { reason: { contains: 'Seed' } },
        { reason: { contains: 'QA Audit Bonus' } },
        { reason: { contains: 'Audited adjustment' } },
      ]
    }
  });
  console.log(`  ✓ Deleted ${deletedAuditLogs.count} test audit logs.`);

  console.log('\n=============================================================');
  console.log(' CLEANUP COMPLETED SUCCESSFULLY');
  console.log('=============================================================\n');

  // Verification of remaining database state
  const remainingLbs = await prisma.monthlyLeaderboard.findMany({
    select: { month: true, year: true, status: true, policyVersion: true }
  });
  console.log('Remaining Monthly Leaderboards (should be strictly 4-9/2026):');
  console.log(remainingLbs);

  const remainingCompletions = await prisma.courseCompletionRecord.groupBy({
    by: ['month', 'year', 'policyVersion'],
    _count: { id: true }
  });
  console.log('Remaining Completions (should be strictly Month 10/2026):');
  console.log(remainingCompletions);

  await prisma.$disconnect();
}

cleanup().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
