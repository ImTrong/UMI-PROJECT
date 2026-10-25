/* eslint-disable */
// Runs INSIDE elearning-user-service (`docker exec -i ... node -`), with INPUT prepended by seed-ranking-demo.mjs.
// Creates the learner profile of each demo account exactly as UserService.createUserProfile does (userId = the auth user id,
// email, fullName, role STUDENT; isActive defaults to true). An existing profile is never changed: if it does not match
// (other userId, not a STUDENT, inactive) the run stops. mode 'plan' = read-only; mode 'apply' = create the missing profiles.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const out = (o) => console.log('RESULT:' + JSON.stringify(o));

(async () => {
  const { mode, accounts } = INPUT;
  const result = [];
  for (const a of accounts) {
    const byEmail = await prisma.userProfile.findUnique({ where: { email: a.email } });
    const byUser = a.userId ? await prisma.userProfile.findUnique({ where: { userId: a.userId } }) : null;
    const existing = byEmail || byUser;
    if (existing) {
      const ok = existing.userId === a.userId && existing.email === a.email && existing.role === 'STUDENT' && existing.isActive === true;
      if (!ok) throw new Error(`existing profile for ${a.key} does not match (userId/email/role/isActive); nothing changed`);
      result.push({ key: a.key, userId: existing.userId, action: 'reuse', role: existing.role, isActive: existing.isActive });
      continue;
    }
    if (mode !== 'apply' || !a.userId) { result.push({ key: a.key, userId: a.userId || null, action: 'create' }); continue; }
    const p = await prisma.userProfile.create({ data: { userId: a.userId, email: a.email, fullName: a.fullName, role: 'STUDENT' } });
    result.push({ key: a.key, userId: p.userId, action: 'created', role: p.role, isActive: p.isActive });
  }
  // digest of the profiles that are NOT demo profiles (identity fields only)
  const others = await prisma.userProfile.findMany({
    where: { email: { notIn: accounts.map((a) => a.email) } },
    orderBy: { id: 'asc' },
    select: { id: true, userId: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
  });
  const digest = require('crypto').createHash('sha256').update(JSON.stringify(others)).digest('hex');
  out({ profiles: result, total: await prisma.userProfile.count(), othersDigest: digest });
  await prisma.$disconnect();
})().catch(async (e) => { out({ error: e.message }); await prisma.$disconnect().catch(() => {}); process.exit(1); });
