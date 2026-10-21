const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
  const leaderboards = await prisma.monthlyLeaderboard.findMany({
    include: { _count: { select: { entries: true } } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }]
  });
  console.log('=== MONTHLY LEADERBOARDS ===');
  console.log(JSON.stringify(leaderboards.map(l => ({
    id: l.id,
    month: l.month,
    year: l.year,
    status: l.status,
    policyVersion: l.policyVersion,
    finalizedBy: l.finalizedBy,
    totalParticipants: l.totalParticipants,
    entriesCount: l._count.entries
  })), null, 2));

  const completions = await prisma.courseCompletionRecord.groupBy({
    by: ['month', 'year', 'policyVersion', 'status'],
    _count: { id: true }
  });
  console.log('\n=== COMPLETIONS BY MONTH/YEAR ===');
  console.log(JSON.stringify(completions, null, 2));

  const completionRecords = await prisma.courseCompletionRecord.findMany({
    select: { id: true, userId: true, month: true, year: true, courseTitle: true, achievementPoints: true }
  });
  console.log('\n=== ALL COMPLETION RECORDS (Total:', completionRecords.length, ') ===');
  console.log(JSON.stringify(completionRecords, null, 2));

  const txs = await prisma.rewardPointTransaction.findMany({
    select: { id: true, userId: true, amount: true, type: true, idempotencyKey: true, description: true }
  });
  console.log('\n=== ALL REWARD TRANSACTIONS (Total:', txs.length, ') ===');
  console.log(JSON.stringify(txs, null, 2));

  const wallets = await prisma.userRewardPoint.findMany();
  console.log('\n=== ALL WALLETS (Total:', wallets.length, ') ===');
  console.log(JSON.stringify(wallets.map(w => ({ userId: w.userId, balance: w.balance, totalEarned: w.totalEarned, totalSpent: w.totalSpent })), null, 2));

  const badges = await prisma.badge.findMany({
    select: { id: true, userId: true, badgeName: true, badgeType: true, metadata: true }
  });
  console.log('\n=== ALL BADGES (Total:', badges.length, ') ===');
  console.log(JSON.stringify(badges, null, 2));

  const auditLogs = await prisma.leaderboardAuditLog.findMany({
    select: { id: true, action: true, targetUserId: true, reason: true, createdAt: true }
  });
  console.log('\n=== ALL AUDIT LOGS (Total:', auditLogs.length, ') ===');
  console.log(JSON.stringify(auditLogs, null, 2));

  await prisma.$disconnect();
}
inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
