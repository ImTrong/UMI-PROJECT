const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  const total = await prisma.courseProgress.count();
  const withCompletedAt = await prisma.courseProgress.count({ where: { completedAt: { not: null } } });
  const withPassed = await prisma.courseProgress.count({ where: { passed: true } });
  const fullyEligible = await prisma.courseProgress.count({ where: { completedAt: { not: null }, passed: true } });
  const records = await prisma.courseCompletionRecord.count();
  
  // Look for records needing review: 100% progress but not passed or missing completedAt
  const allProgress = await prisma.courseProgress.findMany();
  let needsReviewCount = 0;
  let insufficientDataCount = 0;
  
  for (const p of allProgress) {
    if (p.progressPercentage >= 100 && (!p.passed || !p.completedAt)) {
      needsReviewCount++;
    }
  }

  console.log(JSON.stringify({ 
    total, 
    withCompletedAt, 
    withPassed, 
    fullyEligible, 
    records,
    needsReviewCount 
  }, null, 2));

  // Also print all completion records
  const allCompletions = await prisma.courseCompletionRecord.findMany();
  console.log("Completion records in DB:", allCompletions.length);
  for (const c of allCompletions) {
    console.log(`- User: ${c.userId}, Course: ${c.courseId}, Points: ${c.achievementPoints}, Period: ${c.month}/${c.year}, Policy: ${c.policyVersion}`);
  }

  await prisma.$disconnect();
}

run().catch(console.error);
