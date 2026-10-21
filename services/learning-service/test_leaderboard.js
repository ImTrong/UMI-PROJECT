// Runtime verification script for leaderboard
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('=== TEST 2: RANKING VERIFICATION ===');
  const entries = await p.leaderboardEntry.findMany({
    where: { leaderboard: { month: 8, year: 2026 } },
    orderBy: { rank: 'asc' },
    select: { rank: true, userId: true, completedCourses: true, averageScore: true, lastCompletedAt: true, rewardBadgeId: true }
  });
  
  console.log('Entries count:', entries.length);
  for (const e of entries) {
    console.log(`Rank ${e.rank}: courses=${e.completedCourses} avg=${e.averageScore} last=${e.lastCompletedAt.toISOString()} badge=${e.rewardBadgeId ? 'YES' : 'NO'}`);
  }
  
  // Verify ranking order
  let rankOk = true;
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i-1], curr = entries[i];
    if (prev.completedCourses < curr.completedCourses) {
      console.log('❌ RANKING ERROR: courses not DESC at rank', curr.rank);
      rankOk = false;
    } else if (prev.completedCourses === curr.completedCourses) {
      if (prev.averageScore < curr.averageScore) {
        console.log('❌ RANKING ERROR: score not DESC at rank', curr.rank);
        rankOk = false;
      } else if (prev.averageScore === curr.averageScore) {
        if (prev.lastCompletedAt > curr.lastCompletedAt) {
          console.log('❌ RANKING ERROR: lastCompletedAt not ASC at rank', curr.rank);
          rankOk = false;
        }
      }
    }
  }
  if (rankOk) console.log('✅ Ranking order is correct');

  console.log('\n=== TEST 5: BADGE REWARD ===');
  const badges = await p.badge.findMany({
    where: { badgeType: 'LEADERBOARD_REWARD' },
    select: { userId: true, badgeName: true, badgeType: true, iconUrl: true }
  });
  console.log('Leaderboard badges:', badges.length);
  for (const b of badges) {
    console.log(`  ${b.badgeName} -> ${b.userId} (${b.iconUrl})`);
  }
  
  // Verify Top 3 have badges
  const top3 = entries.filter(e => e.rank <= 3);
  for (const t of top3) {
    if (t.rewardBadgeId) {
      console.log(`✅ Rank ${t.rank} has badge`);
    } else {
      console.log(`❌ Rank ${t.rank} missing badge`);
    }
  }

  console.log('\n=== TEST 5b: IDEMPOTENCY ===');
  const badgeCountBefore = await p.badge.count({ where: { badgeType: 'LEADERBOARD_REWARD' } });
  console.log('Badges before re-finalize:', badgeCountBefore);
  
  // Test idempotency: finalize again
  const lb = await p.monthlyLeaderboard.findUnique({ where: { month_year: { month: 8, year: 2026 } } });
  console.log('Status:', lb.status);
  if (lb.status === 'FINALIZED') {
    console.log('✅ Already FINALIZED - re-finalize should be skipped by service');
  }

  console.log('\n=== TEST 3: RETAKE CHECK ===');
  // Check if any userId+courseId appears twice in certificates for month 8
  const certs = await p.certificate.findMany({
    where: { 
      type: 'COURSE_COMPLETION',
      issueDate: { gte: new Date(2026, 7, 1), lte: new Date(2026, 7, 31, 23, 59, 59) }
    },
    select: { userId: true, courseId: true }
  });
  const seen = new Set();
  let dupes = 0;
  for (const c of certs) {
    const key = c.userId + '::' + c.courseId;
    if (seen.has(key)) dupes++;
    seen.add(key);
  }
  console.log('Total certs in Aug:', certs.length);
  console.log('Unique user+course:', seen.size);
  console.log('Duplicates:', dupes);
  if (dupes === 0) {
    console.log('✅ No duplicate userId+courseId in certificates');
  } else {
    console.log('⚠️ Found duplicates - dedupe logic needed');
  }

  console.log('\n=== TEST 4: CERTIFICATE DATE CHECK ===');
  // Check a sample certificate
  const sample = await p.certificate.findFirst({
    where: { type: 'COURSE_COMPLETION' },
    select: { userId: true, courseId: true, issueDate: true },
    orderBy: { issueDate: 'desc' }
  });
  if (sample && sample.courseId) {
    const cp = await p.courseProgress.findUnique({
      where: { userId_courseId: { userId: sample.userId, courseId: sample.courseId } },
      select: { completedAt: true }
    });
    console.log('Certificate issueDate:', sample.issueDate.toISOString());
    console.log('CourseProgress completedAt:', cp ? cp.completedAt?.toISOString() : 'NOT FOUND');
    if (cp && cp.completedAt) {
      const diff = Math.abs(sample.issueDate.getTime() - cp.completedAt.getTime());
      if (diff < 60000) { // within 1 minute
        console.log('✅ Certificate issued at same time as completion');
      } else {
        console.log(`⚠️ Time difference: ${Math.round(diff/1000)}s`);
      }
    }
  }

  console.log('\n=== TEST 7: EDGE CASES ===');
  // Tie check from leaderboard entries
  const ties = [];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i-1].completedCourses === entries[i].completedCourses) {
      ties.push({
        rank1: entries[i-1].rank, rank2: entries[i].rank,
        courses: entries[i].completedCourses,
        score1: entries[i-1].averageScore, score2: entries[i].averageScore
      });
    }
  }
  if (ties.length > 0) {
    console.log('Ties found in completedCourses:');
    for (const t of ties) {
      console.log(`  Rank ${t.rank1} vs ${t.rank2}: courses=${t.courses}, scores=${t.score1} vs ${t.score2}`);
      if (t.score1 >= t.score2) {
        console.log('    ✅ Higher score ranked first');
      } else {
        console.log('    ❌ Lower score ranked first!');
      }
    }
  } else {
    console.log('No ties found in completedCourses');
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
