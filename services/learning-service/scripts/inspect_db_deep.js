const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
  const records = await prisma.courseCompletionRecord.findMany();
  console.log('Total completion records:', records.length);
  for (const r of records) {
    console.log(JSON.stringify({
      id: r.id,
      userId: r.userId,
      courseId: r.courseId,
      month: r.month,
      year: r.year,
      points: r.achievementPoints,
      policyVersion: r.policyVersion,
      status: r.status,
      duration: r.totalDurationSeconds
    }));
  }

  const leaderboards = await prisma.monthlyLeaderboard.findMany();
  console.log('\nMonthlyLeaderboards in DB:', leaderboards.length);
  for (const lb of leaderboards) {
    console.log(JSON.stringify({
      id: lb.id,
      month: lb.month,
      year: lb.year,
      status: lb.status,
      policyVersion: lb.policyVersion,
      totalParticipants: lb.totalParticipants,
      finalizedAt: lb.finalizedAt
    }));
  }

  await prisma.$disconnect();
}

inspect().catch(console.error);
