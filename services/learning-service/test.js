const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const paths = await prisma.learningPath.findMany();
  console.log('Learning Paths:', paths.length);
  const enrolled = await prisma.userPathEnrollment.findMany();
  console.log('Enrolled Paths:', enrolled.length);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
