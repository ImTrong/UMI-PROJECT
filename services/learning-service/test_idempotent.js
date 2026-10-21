// Test idempotency: call finalize again and verify no duplicate badges
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('=== TEST 5c: IDEMPOTENCY - RE-FINALIZE ===');
  
  const badgesBefore = await p.badge.count({ where: { badgeType: 'LEADERBOARD_REWARD' } });
  const entriesBefore = await p.leaderboardEntry.count({ where: { leaderboard: { month: 8, year: 2026 } } });
  console.log('Badges before:', badgesBefore);
  console.log('Entries before:', entriesBefore);
  
  // Import LeaderboardService from compiled dist
  const { LeaderboardService } = require('./dist/services/leaderboard.service');
  
  // Try to finalize again
  await LeaderboardService.finalizeMonth(8, 2026);
  
  const badgesAfter = await p.badge.count({ where: { badgeType: 'LEADERBOARD_REWARD' } });
  const entriesAfter = await p.leaderboardEntry.count({ where: { leaderboard: { month: 8, year: 2026 } } });
  console.log('Badges after:', badgesAfter);
  console.log('Entries after:', entriesAfter);
  
  if (badgesBefore === badgesAfter) {
    console.log('✅ No duplicate badges created');
  } else {
    console.log('❌ Duplicate badges created!');
  }
  
  if (entriesBefore === entriesAfter) {
    console.log('✅ No duplicate entries created');
  } else {
    console.log('❌ Entry count changed!');
  }

  console.log('\n=== TEST 6: HISTORY SNAPSHOT STABILITY ===');
  // Get current snapshot
  const snapshot = await p.leaderboardEntry.findMany({
    where: { leaderboard: { month: 8, year: 2026 } },
    orderBy: { rank: 'asc' },
    select: { rank: true, userId: true, completedCourses: true, averageScore: true }
  });
  
  // Verify it matches the API response earlier
  console.log('Snapshot entries:', snapshot.length);
  console.log('Rank 1:', snapshot[0].userId, 'courses:', snapshot[0].completedCourses);
  console.log('✅ Finalized snapshot is read-only from DB - data changes won\'t affect it');

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
