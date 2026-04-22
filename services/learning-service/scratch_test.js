const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  console.log('Fetching quizzes...');
  const quizzes = await prisma.quiz.findMany();
  console.log('Quizzes:', quizzes.map(q => ({ id: q.id, courseId: q.courseId })));

  console.log('Fetching courseProgress...');
  const cps = await prisma.courseProgress.findMany();
  console.log('CourseProgress:', cps.map(cp => ({ id: cp.id, userId: cp.userId, courseId: cp.courseId })));
}

test()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); });
