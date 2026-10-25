/**
 * Level 2 Process Restart Recovery Test
 *
 * Verifies that when learning-service is stopped and restarted mid-finalization:
 * 1. An unfinalized month in REWARDING state is automatically detected on startup by checkAndFinalizeAllPastMonths().
 * 2. Service resumes from the saved frozen snapshot instead of recalculating rankings.
 * 3. Students already awarded are NOT awarded twice (idempotent ledger check).
 * 4. Students not yet awarded are processed and receive their points and badges.
 * 5. Leaderboard transitions to FINALIZED with finalizedBy: 'SYSTEM_STARTUP_CATCHUP'.
 * 6. Cleaned up afterwards to leave database pristine.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const { LeaderboardService } = require('./dist/services/leaderboard.service');
const { RewardPointService } = require('./dist/services/reward-point.service');

function fakeObjectId() {
  const chars = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

const testMonth = 3;
const testYear = 2026;

async function setupPreCrashState() {
  console.log('=============================================================');
  console.log(' LEVEL 2 PROCESS RESTART RECOVERY TEST — STEP 1: SETUP');
  console.log(` Target Month: ${testMonth}/${testYear}`);
  console.log('=============================================================\n');

  // Clean any prior artifacts for test month
  const existingLb = await prisma.monthlyLeaderboard.findUnique({
    where: { month_year: { month: testMonth, year: testYear } }
  });
  if (existingLb) {
    await prisma.leaderboardEntry.deleteMany({ where: { leaderboardId: existingLb.id } });
    await prisma.monthlyLeaderboard.delete({ where: { id: existingLb.id } });
  }
  await prisma.courseCompletionRecord.deleteMany({
    where: { month: testMonth, year: testYear }
  });

  // Seed 3 dummy students
  const u1 = fakeObjectId();
  const u2 = fakeObjectId();
  const u3 = fakeObjectId();

  await prisma.courseCompletionRecord.create({
    data: {
      userId: u1,
      courseId: fakeObjectId(),
      courseTitle: 'Distributed Systems & Consensus',
      completedAt: new Date('2026-03-05T10:00:00Z'),
      passed: true,
      totalDurationSeconds: 18000, // 5 hours = 10 pts -> Rank 1 (1000 pts)
      level: 'BEGINNER',
      baseDurationPoints: 10,
      levelMultiplier: 1.0,
      achievementPoints: 10,
      policyVersion: '1.1',
      status: 'VALID',
      month: testMonth,
      year: testYear,
    }
  });

  await prisma.courseCompletionRecord.create({
    data: {
      userId: u2,
      courseId: fakeObjectId(),
      courseTitle: 'High-Concurrency Backend Design',
      completedAt: new Date('2026-03-10T10:00:00Z'),
      passed: true,
      totalDurationSeconds: 9000, // 2.5 hours = 5 pts -> Rank 2 (700 pts)
      level: 'BEGINNER',
      baseDurationPoints: 5,
      levelMultiplier: 1.0,
      achievementPoints: 5,
      policyVersion: '1.1',
      status: 'VALID',
      month: testMonth,
      year: testYear,
    }
  });

  await prisma.courseCompletionRecord.create({
    data: {
      userId: u3,
      courseId: fakeObjectId(),
      courseTitle: 'Event-Driven Architectures',
      completedAt: new Date('2026-03-15T10:00:00Z'),
      passed: true,
      totalDurationSeconds: 3600, // 1 hour = 2 pts -> Rank 3 (500 pts)
      level: 'BEGINNER',
      baseDurationPoints: 2,
      levelMultiplier: 1.0,
      achievementPoints: 2,
      policyVersion: '1.1',
      status: 'VALID',
      month: testMonth,
      year: testYear,
    }
  });

  console.log('✓ Seeded 3 completion records for Month 3/2026:');
  console.log(`  - User 1 (${u1}): 10 pts (Rank 1 -> 1,000 pts + Gold)`);
  console.log(`  - User 2 (${u2}): 5 pts (Rank 2 -> 700 pts + Silver)`);
  console.log(`  - User 3 (${u3}): 2 pts (Rank 3 -> 500 pts + Bronze)`);

  // Run finalizeMonth with simulated crash after 1st reward
  console.log('\nRunning finalizeMonth up to REWARDING state (halting after User 1)...');
  try {
    await LeaderboardService.finalizeMonth(testMonth, testYear, 'CRASH_SIMULATION', {
      simulateFailureAt: 'AFTER_FIRST_REWARD',
    });
  } catch (err) {
    console.log(`✓ Caught simulated failure: ${err.message}`);
  }

  // Verify intermediate state
  const lbMid = await prisma.monthlyLeaderboard.findUnique({
    where: { month_year: { month: testMonth, year: testYear } },
    include: { entries: { orderBy: { rank: 'asc' } } }
  });

  console.log('\n📊 Database State BEFORE Container Restart:');
  console.log(`  - Leaderboard Status: ${lbMid.status}`);
  console.log(`  - Frozen Entries: ${lbMid.entries.length}`);
  console.log(`  - User 1 Balance: ${(await RewardPointService.getUserPoints(u1)).balance} pts`);
  console.log(`  - User 2 Balance: ${(await RewardPointService.getUserPoints(u2)).balance} pts`);
  console.log(`  - User 3 Balance: ${(await RewardPointService.getUserPoints(u3)).balance} pts`);

  // Save user IDs to a temporary file for Step 2 verification
  const fs = require('fs');
  fs.writeFileSync('/tmp/restart_test_users.json', JSON.stringify({ u1, u2, u3, testMonth, testYear }));
  console.log('\n✓ Saved test context to /tmp/restart_test_users.json.');
  console.log('👉 NEXT ACTION: Restart container: docker restart elearning-learning-service');

  await prisma.$disconnect();
}

async function verifyPostRestartState() {
  console.log('=============================================================');
  console.log(' LEVEL 2 PROCESS RESTART RECOVERY TEST — STEP 2: VERIFICATION');
  console.log(` Target Month: ${testMonth}/${testYear}`);
  console.log('=============================================================\n');

  const fs = require('fs');
  if (!fs.existsSync('/tmp/restart_test_users.json')) {
    console.error('Error: Context file /tmp/restart_test_users.json not found!');
    process.exit(1);
  }

  const { u1, u2, u3 } = JSON.parse(fs.readFileSync('/tmp/restart_test_users.json', 'utf8'));

  const lbFinal = await prisma.monthlyLeaderboard.findUnique({
    where: { month_year: { month: testMonth, year: testYear } },
    include: { entries: { orderBy: { rank: 'asc' } } }
  });

  console.log('📊 Database State AFTER Container Restart:');
  console.log(`  - Leaderboard Status: ${lbFinal?.status}`);
  console.log(`  - Finalized By: ${lbFinal?.finalizedBy}`);
  console.log(`  - Total Participants: ${lbFinal?.totalParticipants}`);
  console.log(`  - Total Points Awarded: ${lbFinal?.totalPointsAwarded}`);

  let passCount = 0;
  let failCount = 0;

  function assert(cond, name) {
    if (cond) {
      passCount++;
      console.log(`  ✓ PASS: ${name}`);
    } else {
      failCount++;
      console.error(`  ✗ FAIL: ${name}`);
    }
  }

  assert(lbFinal?.status === 'FINALIZED', 'Leaderboard automatically reached FINALIZED upon service restart catchup');
  assert(lbFinal?.finalizedBy === 'SYSTEM_STARTUP_CATCHUP', 'Finalized by SYSTEM_STARTUP_CATCHUP');
  assert(lbFinal?.entries.length === 3, 'Exactly 3 snapshot entries preserved');
  assert(lbFinal?.entries[0].userId === u1 && lbFinal?.entries[0].rank === 1, 'User 1 retained Rank 1 in frozen snapshot');
  assert(lbFinal?.entries[1].userId === u2 && lbFinal?.entries[1].rank === 2, 'User 2 retained Rank 2 in frozen snapshot');
  assert(lbFinal?.entries[2].userId === u3 && lbFinal?.entries[2].rank === 3, 'User 3 retained Rank 3 in frozen snapshot');

  // Verify wallet balances & no duplicate transactions
  const w1 = await RewardPointService.getUserPoints(u1);
  const w2 = await RewardPointService.getUserPoints(u2);
  const w3 = await RewardPointService.getUserPoints(u3);

  const tx1Count = await prisma.rewardPointTransaction.count({ where: { userId: u1, type: 'LEADERBOARD_REWARD' } });
  const tx2Count = await prisma.rewardPointTransaction.count({ where: { userId: u2, type: 'LEADERBOARD_REWARD' } });
  const tx3Count = await prisma.rewardPointTransaction.count({ where: { userId: u3, type: 'LEADERBOARD_REWARD' } });

  const badge1Count = await prisma.badge.count({ where: { userId: u1, badgeType: 'LEADERBOARD_REWARD' } });
  const badge2Count = await prisma.badge.count({ where: { userId: u2, badgeType: 'LEADERBOARD_REWARD' } });
  const badge3Count = await prisma.badge.count({ where: { userId: u3, badgeType: 'LEADERBOARD_REWARD' } });

  assert(w1.balance === 1000, `User 1 balance strictly preserved at 1,000 pts (NO DOUBLE REWARD! got ${w1.balance})`);
  assert(tx1Count === 1, 'User 1 has strictly 1 reward transaction');
  assert(badge1Count === 1, 'User 1 has strictly 1 badge');

  assert(w2.balance === 700, `User 2 received 700 pts upon restart catchup (got ${w2.balance})`);
  assert(tx2Count === 1, 'User 2 has strictly 1 reward transaction');
  assert(badge2Count === 1, 'User 2 has strictly 1 badge');

  assert(w3.balance === 500, `User 3 received 500 pts upon restart catchup (got ${w3.balance})`);
  assert(tx3Count === 1, 'User 3 has strictly 1 reward transaction');
  assert(badge3Count === 1, 'User 3 has strictly 1 badge');

  // Clean up
  console.log('\n🧹 Cleaning up Month 3/2026 test artifacts from database...');
  await prisma.leaderboardEntry.deleteMany({ where: { leaderboardId: lbFinal.id } });
  await prisma.monthlyLeaderboard.delete({ where: { id: lbFinal.id } });
  await prisma.courseCompletionRecord.deleteMany({ where: { month: testMonth, year: testYear } });
  await prisma.rewardPointTransaction.deleteMany({ where: { userId: { in: [u1, u2, u3] } } });
  await prisma.userRewardPoint.deleteMany({ where: { userId: { in: [u1, u2, u3] } } });
  await prisma.badge.deleteMany({ where: { userId: { in: [u1, u2, u3] } } });
  fs.unlinkSync('/tmp/restart_test_users.json');

  console.log('✓ Cleaned up all test artifacts.');

  await prisma.$disconnect();

  console.log('\n=============================================================');
  console.log(` RESTART TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================================\n');

  if (failCount === 0) {
    console.log('>>> LEVEL 2 PROCESS RESTART RECOVERY TEST PASSED 100%! <<<\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

const action = process.argv[2];
if (action === 'setup') {
  setupPreCrashState().catch(console.error);
} else if (action === 'verify') {
  verifyPostRestartState().catch(console.error);
} else {
  console.log('Usage: node test_process_restart_recovery.js [setup|verify]');
}
